#!/usr/bin/env node
import { cp, mkdir, rename, rm, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadRuntimeArtifact, SDK_VERSION } from './runtime-artifacts.mjs';
async function replaceDirectory(staged, destination) {
  const previous = `${destination}.previous-${randomUUID()}`; let existed = false;
  try {
    try { await rename(destination, previous); existed = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { await rename(staged, destination); }
    catch (error) { if (existed) await rename(previous, destination); throw error; }
    if (existed) await rm(previous, { recursive: true, force: true });
  } finally { await rm(staged, { recursive: true, force: true }); }
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), at = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const platform = at('--platform'), arch = at('--arch');
if (!['android', 'ios'].includes(platform) || !arch) throw new Error('Usage: node tools/prepare-native.mjs --platform android|ios --arch <exact pinned arch> [--manifest <release lock>] [--artifact-dir <authorized offline archives>]');
const installed = join(root, '.runtime', platform);
const artifact = await downloadRuntimeArtifact({ manifestPath: resolve(at('--manifest') ?? join(root, 'runtime-artifacts.lock.json')),
  version: SDK_VERSION, platform, arch, component: `${platform}-sdk`, abiVersion: 1, outDirectory: join(root, '.runtime/downloads'),
  installDirectory: installed, artifactDirectory: at('--artifact-dir') ?? process.env.WEAPP_CONTAINER_RUNTIME_ARTIFACT_DIR });
const required = platform === 'android' ? `maven/com/sonofmagic/weapp/weapp-container-android/${SDK_VERSION}/weapp-container-android-${SDK_VERSION}.aar`
  : 'Frameworks/WeappContainerNative.xcframework/Info.plist';
if (!(await lstat(join(installed, required))).isFile()) throw new Error(`Downloaded native SDK lacks ${required}`);
await mkdir(join(root, 'native'), { recursive: true });
const staged = join(root, 'native', `.${platform}-${randomUUID()}`), destination = join(root, 'native', platform);
await cp(installed, staged, { recursive: true });
await replaceDirectory(staged, destination);
console.log(JSON.stringify({ status: 'prepared', sdkVersion: SDK_VERSION, platform, arch, nativeBuild: 'not-run',
  artifactSha256: artifact.receipt.sha256, installed: destination }, null, 2));
