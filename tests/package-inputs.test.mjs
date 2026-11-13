import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { packageOptions, verifyNativePackageInputs } from '../tools/package-inputs.mjs';
import { downloadRuntimeArtifact, SDK_VERSION } from '../tools/runtime-artifacts.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'weapp-rn-package-inputs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const archiveDirectory = join(root, 'archives'); await mkdir(archiveDirectory);
  const artifacts = [];
  for (const platform of ['android', 'ios']) {
    const fileName = `${platform}-sdk.tar.gz`, archive = join(archiveDirectory, fileName);
    const made = spawnSync(process.env.PYTHON ?? 'python3', ['-c',
      'import io,tarfile,sys; t=tarfile.open(sys.argv[1],"w:gz"); b=sys.argv[2].encode(); i=tarfile.TarInfo("native.txt"); i.size=len(b); i.mode=420; t.addfile(i,io.BytesIO(b)); t.close()', archive, platform], { encoding: 'utf8' });
    assert.equal(made.status, 0, made.stderr);
    const bytes = await readFile(archive);
    artifacts.push({component: `${platform}-sdk`, platform, arch: 'universal',
      architectures: platform === 'android' ? ['arm64-v8a', 'x86_64'] : ['arm64-device', 'arm64-simulator', 'x86_64-simulator'],
      fileName, size: bytes.length, sha256: sha(bytes)});
  }
  const manifestPath = join(root, 'preview6.json');
  await writeFile(manifestPath, JSON.stringify({schemaVersion: 1, runtimeVersion: SDK_VERSION, abiVersion: 1,
    source: {repository: 'weapp-container/weapp-container', releaseTag: `runtime-v${SDK_VERSION}`}, artifacts}));
  const options = packageOptions(['--manifest', manifestPath, '--artifact-dir', archiveDirectory], root, {});
  for (const platform of ['android', 'ios']) await downloadRuntimeArtifact({manifestPath, platform, arch: 'universal', component: `${platform}-sdk`,
    outDirectory: join(root, 'downloads', platform), installDirectory: options[platform], artifactDirectory: archiveDirectory});
  return {root, options, artifacts};
}

test('package defaults match native preparation vendor paths without rewriting the historical lock', () => {
  const options = packageOptions([], '/standalone-sdk', {});
  assert.equal(options.ios, '/standalone-sdk/native/ios');
  assert.equal(options.android, '/standalone-sdk/native/android');
  assert.equal(options.manifestPath, '/standalone-sdk/runtime-artifacts.0.1.0-preview.7.1.lock.json');
  assert.equal(options.archiveDirectory, undefined);
  for (const args of [['--manifest'], ['--manifest', 'a', '--manifest', 'b'], ['--unknown', 'x'], ['--artifact-dir', ''], ['--manifest-sha256', 'not-a-digest']]) {
    assert.throws(() => packageOptions(args, '/standalone-sdk', {}));
  }
  assert.throws(() => packageOptions([], '/standalone-sdk', {WEAPP_CONTAINER_RUNTIME_ARTIFACT_DIR: ''}));
});

test('explicit current-version package pins revalidate both real installations and bind the whole manifest', async t => {
  const f = await fixture(t), bytes = await readFile(f.options.manifestPath);
  const verified = verifyNativePackageInputs({...f.options, manifestSha256: sha(bytes)});
  assert.deepEqual(verified.manifest, {sha256: sha(bytes), bytes: bytes.length, runtimeVersion: SDK_VERSION, abiVersion: 1});
  for (const platform of ['android', 'ios']) assert.equal(verified.installations[platform].archiveSha256, f.artifacts.find(a => a.platform === platform).sha256);
  assert.throws(() => verifyNativePackageInputs({...f.options, manifestSha256: '0'.repeat(64)}), /manifest SHA-256/);
  const changed = JSON.parse(bytes); changed.runtimeVersion = '0.1.0-preview.5.3';
  await writeFile(f.options.manifestPath, JSON.stringify(changed));
  assert.throws(() => verifyNativePackageInputs(f.options), {code: 'ERR_RUNTIME_MANIFEST'});
});

test('selecting a new manifest cannot skip archive presence or installed-byte and forged-receipt checks', async t => {
  const f = await fixture(t);
  await writeFile(join(f.options.android, 'native.txt'), 'changed');
  assert.throws(() => verifyNativePackageInputs(f.options), /changed/);
  const receiptPath = join(f.options.android, '.runtime-install.json');
  const receipt = JSON.parse(await readFile(receiptPath));
  receipt.files[0].size = 7; receipt.files[0].sha256 = sha('changed');
  await writeFile(receiptPath, JSON.stringify(receipt));
  assert.throws(() => verifyNativePackageInputs(f.options), /Command failed/);
  await writeFile(join(f.options.android, 'native.txt'), 'android');
  receipt.files[0].size = 7; receipt.files[0].sha256 = sha('android');
  await writeFile(receiptPath, JSON.stringify(receipt));
  await rm(join(f.options.archiveDirectory, 'ios-sdk.tar.gz'));
  assert.throws(() => verifyNativePackageInputs(f.options), /Pinned native archive is required/);
});
