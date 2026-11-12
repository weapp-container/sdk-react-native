import { distributionOptions, installationDistribution } from './distribution-identity.mjs';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SDK_VERSION } from './runtime-artifacts.mjs';
import { verifyNativeInstallation } from './verify-native.mjs';

export function packageOptions(args, root, environment = process.env) {
  const allowed = ['--ios', '--android', '--out', '--manifest', '--manifest-sha256', '--artifact-dir', '--distribution-profile', '--showcase-policy-sha256'];
  const values = new Map();
  for (let index = 0; index < args.length; index++) {
    const name = args[index], value = args[++index];
    if (!allowed.includes(name) || values.has(name) || !value || value.startsWith('--')) throw new Error(`Unknown, duplicate or missing package option: ${name}`);
    values.set(name, value);
  }
  const manifestSha256 = values.get('--manifest-sha256');
  if (manifestSha256 !== undefined && !/^[a-f0-9]{64}$/.test(manifestSha256)) throw new Error('--manifest-sha256 requires a lowercase SHA-256');
  const archiveDirectory = values.get('--artifact-dir') ?? environment.WEAPP_CONTAINER_RUNTIME_ARTIFACT_DIR;
  if (archiveDirectory === '') throw new Error('The explicit offline artifact directory cannot be empty');
  return {
    ...distributionOptions(args),
    ios: resolve(values.get('--ios') ?? join(root, 'native/ios')),
    android: resolve(values.get('--android') ?? join(root, 'native/android')),
    out: resolve(values.get('--out') ?? join(root, '.build/packages')),
    manifestPath: resolve(values.get('--manifest') ?? join(root, 'runtime-artifacts.0.1.0-preview.7.0.lock.json')),
    manifestSha256,
    archiveDirectory: archiveDirectory === undefined ? undefined : resolve(archiveDirectory),
  };
}

/** Explicit manifest selection never changes archive or installed-byte checks. */
export function verifyNativePackageInputs(options) {
  const status = lstatSync(options.manifestPath);
  if (!status.isFile() || status.isSymbolicLink() || status.size > 1024 ** 2) throw new Error('Release manifest must be a bounded regular file');
  const bytes = readFileSync(options.manifestPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (options.manifestSha256 !== undefined && options.manifestSha256 !== sha256) throw new Error('Release manifest SHA-256 differs from the independently selected digest');
  const installations = Object.fromEntries(['ios', 'android'].map(platform =>
    [platform, verifyNativeInstallation(options[platform], platform, options.manifestPath, options.archiveDirectory, options)]));
  if (createHash('sha256').update(readFileSync(options.manifestPath)).digest('hex') !== sha256) throw new Error('Release manifest changed during package verification');
  return { manifest: { ...installationDistribution(options), sha256, bytes: bytes.length, runtimeVersion: SDK_VERSION, abiVersion: 1 }, installations };
}
