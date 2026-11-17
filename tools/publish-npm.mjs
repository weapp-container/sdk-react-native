import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
if (!option('--receipt')) throw Error('Select the verified --receipt build.json [--execute]');
const path = resolve(option('--receipt')), receipt = JSON.parse(readFileSync(path));
const pkg = JSON.parse(readFileSync(join(root, 'package.json')));
if (receipt.sdkVersion !== pkg.version || receipt.sourceDirty !== false || !/^[a-f0-9]{40}$/.test(receipt.sourceCommit ?? '') || !/^[A-Za-z0-9._-]+\.tgz$/.test(receipt.fileName ?? '')) throw Error('Invalid npm publication receipt');
const archive = join(dirname(path), receipt.fileName), bytes = readFileSync(archive);
if (createHash('sha256').update(bytes).digest('hex') !== receipt.sha256 || bytes.length !== receipt.size) throw Error('npm package bytes changed after verification');
for (const [gitArgs, expected] of [[['status', '--porcelain', '--untracked-files=all'], ''], [['rev-parse', 'HEAD'], receipt.sourceCommit]]) {
  const result = spawnSync('git', gitArgs, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0 || result.stdout.trim() !== expected) throw Error('npm publication must use its exact clean producer source');
}
if (args.includes('--execute')) {
  const url = `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}`;
  const prior = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (prior.status !== 404) throw Error(`Version already exists or registry availability cannot be established (${prior.status})`);
  const flags = ['publish', archive, '--access', 'public', '--tag', 'preview'];
  if (process.env.GITHUB_ACTIONS === 'true') flags.push('--provenance');
  const result = spawnSync('npm', flags, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) throw Error('npm publication failed; inspect authentication/namespace status before retrying');
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error('Published version is not yet available for verification; do not republish');
  const metadata = await response.json();
  const expected = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
  if (metadata.dist?.integrity !== expected) throw Error('Registry npm archive differs from the validated package');
  writeFileSync(join(dirname(path), 'publication.json'), JSON.stringify({ name: pkg.name, version: pkg.version, sourceCommit: receipt.sourceCommit, sha256: receipt.sha256, integrity: expected, tag: 'preview', published: true }, null, 2) + '\n');
} else console.log(JSON.stringify({ name: pkg.name, version: pkg.version, sha256: receipt.sha256, published: false }, null, 2));
