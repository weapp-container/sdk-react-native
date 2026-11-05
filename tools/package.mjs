import { assertDistributionIdentity, distributionIdentity } from './distribution-identity.mjs';
import { SDK_VERSION } from './runtime-artifacts.mjs';
import { verifySourceInventory } from './source-inventory.mjs';
import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {packageOptions, verifyNativePackageInputs} from './package-inputs.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const reviewedSource = verifySourceInventory(root);
const options = packageOptions(process.argv.slice(2), root);
const {ios, android, out} = options;
const source = root;
function run(command, args, cwd) { const result = spawnSync(command, args, {cwd, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, timeout: 600_000}); if (result.status !== 0) throw new Error(`${command} failed: ${result.error ?? ''}\n${result.stdout}\n${result.stderr}`); return result.stdout; }
for (const path of [resolve(ios, 'Frameworks/WeappContainerNative.xcframework/Info.plist'), resolve(android, `maven/com/sonofmagic/weapp/weapp-container-android/${SDK_VERSION}/weapp-container-android-${SDK_VERSION}.aar`), resolve(android, 'licenses'), resolve(ios, 'licenses')]) if (!existsSync(path)) throw new Error(`Prepare the authorized pinned native SDK first: ${path}`);
const nativeInputs = verifyNativePackageInputs(options);
const expectedDistribution = distributionIdentity(options);
const nativeProducerReceipts = {};
for (const [platform, receiptPath] of [['ios', resolve(ios, 'build.json')], ['android', resolve(android, 'distribution.json')]]) {
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  assertDistributionIdentity(receipt, expectedDistribution);
  for (const native of receipt.native ?? []) assertDistributionIdentity(native, expectedDistribution);
  nativeProducerReceipts[platform] = receipt;
}
const nativeInstallations = nativeInputs.installations;
mkdirSync(out, {recursive: true});
run('npm', ['run', 'build'], source);
run('npm', ['run', 'codegen'], source);
const stage = mkdtempSync(resolve(out, 'package-'));
try {
  for (const item of ['package.json', 'lib', 'src', 'ios', 'react-native.config.js', 'WeappContainerReactNative.podspec', 'README.md', 'LICENSE']) cpSync(resolve(source, item), resolve(stage, item), {recursive: true});
  cpSync(resolve(source, 'android/build.gradle'), resolve(stage, 'android/build.gradle'), {recursive: true});
  cpSync(resolve(source, 'android/src'), resolve(stage, 'android/src'), {recursive: true});
  cpSync(ios, resolve(stage, 'native/ios'), {recursive: true});
  cpSync(resolve(android, 'maven'), resolve(stage, 'native/android/maven'), {recursive: true});
  // The Maven repository is self-contained. Local build/download caches under
  // the native output directory are not distribution inputs.
  for (const item of ['licenses', 'distribution.json', 'validation.json', 'contract.json']) if (existsSync(resolve(android, item))) cpSync(resolve(android, item), resolve(stage, 'native/android', item), {recursive: true});
  if (!existsSync(resolve(root, '.git'))) throw new Error('Package assembly requires this standalone repository to be committed; a parent repository is never used');
  const sourceCommit = run('git', ['rev-parse', 'HEAD'], root).trim();
  const sourceDirty = Boolean(run('git', ['status', '--porcelain', '--', '.'], root).trim());
  const files = {};
  function inventory(directory, prefix = '') {
    for (const entry of readdirSync(directory, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = `${prefix}${entry.name}`;
      if (entry.isDirectory()) inventory(resolve(directory, entry.name), `${name}/`);
      else if (entry.isFile()) files[name] = createHash('sha256').update(readFileSync(resolve(directory, entry.name))).digest('hex');
      else throw new Error(`Unexpected nonregular package file: ${name}`);
    }
  }
  inventory(stage);
  // Recheck after TypeScript/codegen and staging. A selected manifest cannot
  // drift while a long assembly is running, and every native byte still goes
  // through the same receipt and bounded archive verifier.
  verifyNativePackageInputs({...options, manifestSha256: nativeInputs.manifest.sha256});
  writeFileSync(resolve(stage, 'sdk-artifact.json'), JSON.stringify({schema: 1, ...expectedDistribution, sourceCommit, sourceDirty, nativeInputs, files}, null, 2) + '\n');
  const [pack] = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', out], stage));
  const receipt = {schema: 1, ...expectedDistribution, sourceInventorySha256: reviewedSource.inventorySha256, package: pack.filename, version: pack.version, sha256: createHash('sha256').update(readFileSync(resolve(out, pack.filename))).digest('hex'), integrity: pack.integrity, bytes: pack.size, files: pack.entryCount, sourceCommit, sourceDirty, ...nativeProducerReceipts, nativeInputs, nativeInstallations, checks: {typescript: true, codegen: true}, published: false};
  writeFileSync(resolve(out, 'build.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({package: resolve(out, pack.filename), sha256: receipt.sha256, bytes: receipt.bytes, sourceDirty: receipt.sourceDirty, published: false}, null, 2));
} finally { rmSync(stage, {recursive: true, force: true}); }
