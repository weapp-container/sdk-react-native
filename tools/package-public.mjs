import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assetEntry, cleanSource, filesUnder, readRelease, run, sha256, versionOf } from './public-release.mjs';
import { verifySourceInventory } from './source-inventory.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const version = versionOf(root), sourceCommit = cleanSource(root);
const reviewed = verifySourceInventory(root);
if (!option('--ios-release') || !option('--android-release')) throw Error('Select --ios-release and --android-release from the verified public native publication');
const dependencies = {
  ios: readRelease(resolve(option('--ios-release')), 'weapp-container/sdk-ios', version),
  android: readRelease(resolve(option('--android-release')), 'weapp-container/sdk-android', version),
};
if (!dependencies.ios.assets.some(asset => asset.component === 'cocoapods-sdk') || !dependencies.android.assets.some(asset => asset.component === 'maven-installation' || asset.component === 'maven-central')) throw Error('Public iOS and Maven native dependencies are required');
const out = resolve(option('--out') ?? join(root, '.build/public'));
mkdirSync(out, { recursive: true });
run('npm', ['run', 'typecheck'], root);
run('npm', ['run', 'build'], root);
run('npm', ['run', 'codegen'], root);
const stage = mkdtempSync(join(out, '.package-'));
try {
  for (const file of ['package.json', 'lib', 'src', 'ios', 'android', 'WeappContainerReactNative.podspec', 'react-native.config.js', 'README.md', 'README.en.md', 'LICENSE']) {
    cpSync(join(root, file), join(stage, file), { recursive: true, filter: path => !['build', '.gradle', '.cxx'].includes(path.split('/').at(-1)) });
  }
  const pkg = JSON.parse(readFileSync(join(stage, 'package.json')));
  pkg.files = pkg.files.filter(file => file !== 'native');
  delete pkg.scripts;
  delete pkg.devDependencies;
  writeFileSync(join(stage, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  const files = Object.fromEntries(filesUnder(stage).map(file => [file, sha256(readFileSync(join(stage, file)))]));
  writeFileSync(join(stage, 'sdk-artifact.json'), JSON.stringify({ schema: 1, sourceCommit, sourceDirty: false, nativeDependencies: dependencies, files }, null, 2) + '\n');
  if (cleanSource(root) !== sourceCommit) throw Error('Source changed during package assembly');
  const [pack] = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', out], stage));
  const expected = ['lib/index.js', 'lib/index.d.ts', 'src/index.tsx', 'android/build.gradle', 'WeappContainerReactNative.podspec', 'sdk-artifact.json'];
  if (expected.some(file => !pack.files.some(entry => entry.path === file)) || pack.files.some(entry => /^(?:native|tools|node_modules)\//.test(entry.path))) throw Error('npm archive has an invalid file closure');
  const receipt = { schemaVersion: 1, sdkVersion: version, sourceCommit, sourceDirty: false, sourceInventorySha256: reviewed.inventorySha256, nativeDependencies: dependencies, ...assetEntry(out, pack.filename), integrity: pack.integrity, published: false };
  writeFileSync(join(out, 'build.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt, null, 2));
} finally { rmSync(stage, { recursive: true, force: true }); }
