import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, link, lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BASELINE_SHA256, patchThree, prepareThreePatch } from './patch-three.mjs';

const schema = 1;
// Complete 1,263-file npm three@0.186.1 inventory, including imported core,
// shaders and addons. A changed installation requires a reviewed new baseline.
const baselinePackageSha256 = 'd4ede7ce0ec90acaa8e978cd321b5ba71cf35a9234cc9e48069ac71d5386ea77';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digestObject = (value) => digest(JSON.stringify(value));

async function plainDirectory(directory) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`Recovery cache requires a plain directory: ${directory}`);
  }
}

async function ensureDirectory(directory) {
  try { await mkdir(directory); } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  await plainDirectory(directory);
}

/** Exact package inventory; no symlinks, special files or case aliases. */
async function inventory(directory, { independent = false } = {}) {
  await plainDirectory(directory);
  const files = [];
  const seen = new Set();
  async function walk(current, prefix = '') {
    await Promise.all((await readdir(current, { withFileTypes: true })).map(async (entry) => {
      const name = entry.name;
      const relative = prefix ? `${prefix}/${name}` : name;
      const folded = relative.toLowerCase();
      if (seen.has(folded)) throw new Error(`Recovery package has a case collision: ${relative}`);
      seen.add(folded);
      const filename = path.join(current, name);
      if (entry.isSymbolicLink()) throw new Error(`Recovery package contains a linked path: ${relative}`);
      if (entry.isDirectory()) await walk(filename, relative);
      else if (entry.isFile()) files.push([relative, filename]);
      else throw new Error(`Recovery package requires independent regular files: ${relative}`);
    }));
  }
  await walk(directory);
  const hashes = [];
  // Bound simultaneous reads even if a future package contains many files.
  for (let start = 0; start < files.length; start += 32) {
    hashes.push(...await Promise.all(files.slice(start, start + 32).map(async ([relative, filename]) => {
      const info = await lstat(filename);
      if (!info.isFile() || info.isSymbolicLink() || (independent && info.nlink !== 1)) {
        throw new Error(`Recovery package requires independent regular files: ${relative}`);
      }
      return [relative, digest(await readFile(filename))];
    })));
  }
  return Object.fromEntries(hashes.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}

async function copyPackage(source, destination, baseline) {
  const files = Object.keys(baseline);
  const directories = [...new Set(files.map((relative) => path.dirname(relative)))];
  await Promise.all(directories.map((relative) => mkdir(path.join(destination, relative), { recursive: true })));
  for (let start = 0; start < files.length; start += 32) {
    await Promise.all(files.slice(start, start + 32).map((relative) => copyFile(
      path.join(source, relative), path.join(destination, relative), constants.COPYFILE_EXCL,
    )));
  }
}

async function validatePackage(directory, expected) {
  const actual = await inventory(directory, { independent: true });
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Recovery cache is corrupt; package hashes differ: ${directory}`);
  }
}

async function readIndex(indexPath, cacheRoot, key, expected) {
  let info;
  try { info = await lstat(indexPath); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Recovery cache index is corrupt: ${indexPath}`);
  let index;
  try { index = JSON.parse(await readFile(indexPath, 'utf8')); } catch (error) {
    throw new Error(`Recovery cache index is corrupt: ${indexPath}`, { cause: error });
  }
  const directoryPattern = new RegExp(`^${key}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`);
  if (index.schema !== schema || index.key !== key || typeof index.packageDirectory !== 'string'
      || !directoryPattern.test(index.packageDirectory)) {
    throw new Error(`Recovery cache index is corrupt: ${indexPath}`);
  }
  const packageRoot = path.join(cacheRoot, index.packageDirectory);
  await validatePackage(packageRoot, expected);
  return path.join(packageRoot, 'build', 'three.module.js');
}

/**
 * Return the verified patched ESM entry, preserving the installed npm package.
 * Published cache entries are immutable: corruption fails instead of repairing
 * or deleting evidence. Concurrent callers publish through an exclusive link.
 */
export async function prepareRecoveryThree(root) {
  const projectRoot = await realpath(root);
  const nodeModules = path.join(projectRoot, 'node_modules');
  await plainDirectory(nodeModules);
  const baselineRoot = path.join(nodeModules, 'three');
  const baseline = await inventory(baselineRoot);
  if (digestObject(baseline) !== baselinePackageSha256) {
    throw new Error('Installed Three.js package identity differs from the pinned recovery baseline');
  }
  const pinned = Object.fromEntries(await Promise.all(Object.keys(BASELINE_SHA256).map(async (relative) => [
    relative, await readFile(path.join(baselineRoot, relative)),
  ])));
  const { changes } = prepareThreePatch(pinned);
  const expected = Object.fromEntries(Object.entries({
    ...baseline,
    ...Object.fromEntries(Object.entries(changes).map(([relative, source]) => [relative, digest(source)])),
  }).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
  const implementation = Object.fromEntries(await Promise.all([
    'lifetime-scope.mjs', 'patch-three.mjs', 'prepare.mjs',
  ].map(async (relative) => [relative, digest(await readFile(new URL(relative, import.meta.url)))])));
  const key = digestObject({ schema, baseline, implementation });
  const cacheParent = path.join(nodeModules, '.cache');
  await ensureDirectory(cacheParent);
  const cacheRoot = path.join(cacheParent, 'gse-three-recovery');
  await ensureDirectory(cacheRoot);
  const indexPath = path.join(cacheRoot, `${key}.json`);
  const existing = await readIndex(indexPath, cacheRoot, key, expected);
  if (existing !== null) return existing;

  const unique = randomUUID();
  const packageDirectory = `${key}-${unique}`;
  const packageRoot = path.join(cacheRoot, packageDirectory);
  await mkdir(packageRoot);
  await copyPackage(baselineRoot, packageRoot, baseline);
  // Catch dependency changes during copying, before patching or publishing.
  await validatePackage(packageRoot, baseline);
  await patchThree(packageRoot, { baselineRoot });
  await validatePackage(packageRoot, expected);

  const temporaryIndex = path.join(cacheRoot, `.index-${key}-${unique}.tmp`);
  await writeFile(temporaryIndex, `${JSON.stringify({ schema, key, packageDirectory })}\n`, { flag: 'wx' });
  try {
    // Same-filesystem hard-link publication exposes a complete index atomically
    // and fails if another caller already published the same immutable key.
    await link(temporaryIndex, indexPath);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  // Validate even a concurrent winner. Unreferenced unique copies/temp indices
  // are retained; there is no deletion, destructive cleanup or cache overwrite.
  const published = await readIndex(indexPath, cacheRoot, key, expected);
  if (published === null) throw new Error('Recovery cache publication disappeared');
  return published;
}
