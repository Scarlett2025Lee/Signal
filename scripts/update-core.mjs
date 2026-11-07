import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, copyFile, lstat, readdir, open } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';

export const CHANNEL =
  'https://raw.githubusercontent.com/Scarlett2025Lee/AI-Fintech-funding-leads/codex/signal-web/downloads/update.json';
const REPO = '/Scarlett2025Lee/AI-Fintech-funding-leads/';
const DIRS = new Set(['src', 'server', 'scripts', 'database', 'dist']);
const FILES = new Set([
  'package.json',
  'package-lock.json',
  'index.html',
  'tsconfig.json',
  'vite.config.ts',
  '.gitignore',
  '.gitattributes',
  'README.md',
  'START_HERE.zh-CN.md',
  'Start-Signal.cmd',
  'Start-Signal.ps1',
  'Open-Signal.cmd',
  'Open-Signal.ps1',
  'release.json',
]);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const exists = async path =>
  !!(await lstat(path).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  }));
export function validPath(path) {
  if (typeof path !== 'string' || path.length > 240 || /[\\\x00-\x1f:<>"|?*]/.test(path))
    throw Error('Unsafe release path');
  const parts = path.split('/');
  if (
    parts.some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(p))
  )
    throw Error('Unsafe release path');
  if (!(parts.length === 1 ? FILES.has(path) : DIRS.has(parts[0])))
    throw Error('Release may not write data, tools, caches, or unknown files');
  return path;
}
function allowedURL(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw Error('Invalid update URL');
  if (
    !['github.com', 'raw.githubusercontent.com', 'codeload.github.com'].includes(url.hostname) ||
    !url.pathname.startsWith(REPO)
  )
    throw Error('Update URL is outside the configured GitHub repository');
  return url;
}
export function versionCompare(a, b) {
  const parse = v => {
    if (!/^\d+\.\d+\.\d+$/.test(v)) throw Error('Invalid release version');
    return v.split('.').map(Number);
  };
  const x = parse(a),
    y = parse(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}
export function validateManifest(m) {
  if (
    !m ||
    m.format !== 1 ||
    !Number.isSafeInteger(m.bytes) ||
    m.bytes < 1 ||
    m.bytes > 20_000_000 ||
    !/^[a-f0-9]{64}$/.test(m.sha256)
  )
    throw Error('Invalid update manifest');
  versionCompare(m.version, '0.0.0');
  allowedURL(m.url);
  return m;
}
export async function download(url, limit, fetcher = fetch) {
  let target = allowedURL(url);
  for (let i = 0; i < 5; i++) {
    const response = await fetcher(target, {
      redirect: 'manual',
      signal: AbortSignal.timeout(60000),
      headers: { Accept: 'application/octet-stream' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      target = allowedURL(new URL(response.headers.get('location'), target).href);
      continue;
    }
    if (!response.ok) throw Error(`GitHub download HTTP ${response.status}`);
    const chunks = [];
    let size = 0;
    if (!response.body) throw Error('Empty update response');
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > limit) throw Error('Update download exceeds size limit');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  throw Error('Too many update redirects');
}
export async function fetchManifest(fetcher = fetch) {
  return validateManifest(
    JSON.parse((await download(CHANNEL + '?check=' + Date.now(), 100000, fetcher)).toString('utf8')),
  );
}
export async function unpackPackage(bytes, manifest) {
  // Recovery must work even if npm ci failed and node_modules is absent.
  const { unzipSync } = await import('fflate');
  validateManifest(manifest);
  if (bytes.length !== manifest.bytes || sha(bytes) !== manifest.sha256) throw Error('Update ZIP checksum mismatch');
  let total = 0,
    count = 0;
  const files = unzipSync(bytes, {
    filter: file => {
      if (++count > 1000) throw Error('Too many archive entries');
      if (!file.name.startsWith('Signal/')) throw Error('Invalid archive root');
      const path = file.name.slice(7);
      if (!path) return false;
      validPath(path.endsWith('/') ? path.slice(0, -1) : path);
      total += file.originalSize;
      if (total > 60_000_000) throw Error('Expanded package exceeds limit');
      return !path.endsWith('/');
    },
  });
  const release = JSON.parse(Buffer.from(files['Signal/release.json'] ?? []).toString('utf8'));
  if (release.version !== manifest.version || !release.files || Array.isArray(release.files))
    throw Error('Invalid release file inventory');
  const result = new Map();
  for (const [path, hash] of Object.entries(release.files)) {
    validPath(path);
    if (path === 'release.json' || !/^[a-f0-9]{64}$/.test(hash)) throw Error('Invalid file inventory');
    const value = files['Signal/' + path];
    if (!value || sha(value) !== hash) throw Error(`Release file checksum mismatch: ${path}`);
    result.set(path, Buffer.from(value));
  }
  if (Object.keys(files).length !== result.size + 1) throw Error('Unexpected archive files');
  result.set('release.json', Buffer.from(files['Signal/release.json']));
  for (const path of [
    'package.json',
    'package-lock.json',
    'server/index.mjs',
    'Start-Signal.ps1',
    'scripts/update-cli.mjs',
    'dist/index.html',
  ])
    if (!result.has(path)) throw Error('Incomplete release package');
  if (JSON.parse(result.get('package.json')).version !== manifest.version) throw Error('Package version mismatch');
  return result;
}

async function safeTarget(root, path) {
  validPath(path);
  const target = resolve(root, ...path.split('/'));
  if (!target.startsWith(resolve(root) + sep)) throw Error('Target escapes installation');
  const parts = path.split('/');
  let cursor = root;
  for (const part of parts) {
    cursor = join(cursor, part);
    const info = await lstat(cursor).catch(e => {
      if (e.code === 'ENOENT') return null;
      throw e;
    });
    if (info?.isSymbolicLink()) throw Error('Refusing to update through a symbolic link');
  }
  return target;
}
async function atomic(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  const temp = path + '.tmp-' + randomUUID();
  try {
    await writeFile(temp, bytes);
    await rename(temp, path);
  } finally {
    await rm(temp, { force: true });
  }
}
async function json(path, value) {
  await atomic(path, JSON.stringify(value, null, 2) + '\n');
}
const statePath = root => join(root, '.cache', 'updates', 'pending.json');
export async function currentVersion(root) {
  return JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
}

export async function withUpdateLock(root, task) {
  const folder = join(root, '.cache', 'updates');
  await mkdir(folder, { recursive: true });
  const path = join(folder, 'update.lock');
  let handle;
  try {
    handle = await open(path, 'wx');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const prior = JSON.parse(await readFile(path, 'utf8').catch(() => '{}'));
    if (!Number.isInteger(prior.pid)) throw Error('Another updater is initializing; retry shortly');
    let alive = true;
    try {
      process.kill(prior.pid, 0);
    } catch (e) {
      if (e.code === 'EPERM') throw Error('Another updater may be running');
      alive = false;
    }
    if (alive) throw Error('Another updater is running');
    await rm(path, { force: true });
    handle = await open(path, 'wx');
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid }));
    return await task();
  } finally {
    await handle.close();
    await rm(path, { force: true });
  }
}

export async function applyPackage(root, bytes, manifest, { afterWrite } = {}) {
  root = resolve(root);
  const files = await unpackPackage(bytes, manifest);
  if ((await exists(join(root, '.git'))) || (await exists(join(root, '..', '.git', 'HEAD'))))
    throw Error('Automatic file replacement is disabled in a Git checkout');
  const current = await currentVersion(root).catch(() => '0.0.0');
  if (versionCompare(manifest.version, current) < 0) throw Error('Refusing to install an older release');
  if (await exists(statePath(root))) throw Error('Unconfirmed update must be recovered first');
  const previous = JSON.parse(await readFile(join(root, 'release.json'), 'utf8').catch(() => '{}'));
  const managed = new Set([...Object.keys(previous.files ?? {}), ...files.keys()]);
  const folder = join(root, '.cache', 'updates', 'backup', Date.now() + '-' + randomUUID());
  await mkdir(join(folder, 'program'), { recursive: true });
  const old = [];
  for (const path of managed) {
    const target = await safeTarget(root, path);
    const present = await exists(target);
    old.push({ path, present });
    if (present) {
      await mkdir(dirname(join(folder, 'program', path)), { recursive: true });
      await copyFile(target, join(folder, 'program', path));
    }
  }
  const database = join(root, 'data', 'signal.sqlite3');
  const hadDatabase = await exists(database);
  if (hadDatabase) {
    const db = new DatabaseSync(database, { readOnly: true });
    try {
      await backup(db, join(folder, 'signal.sqlite3'));
    } finally {
      db.close();
    }
  }
  const stamp = await readFile(join(root, '.cache', 'installed-lock.txt'), 'utf8').catch(() => null);
  const oldLock = await readFile(join(root, 'package-lock.json')).catch(() => null);
  const depsChanged = !oldLock || sha(oldLock) !== sha(files.get('package-lock.json'));
  const record = {
    format: 1,
    folder,
    version: manifest.version,
    previousVersion: current,
    old,
    hadDatabase,
    stamp,
    depsChanged,
  };
  await json(statePath(root), record);
  try {
    if (depsChanged && (await exists(join(root, 'node_modules')))) {
      if ((await lstat(join(root, 'node_modules'))).isSymbolicLink())
        throw Error('Dependency directory must not be a link');
      await rename(join(root, 'node_modules'), join(folder, 'node_modules'));
    }
    for (const [path, value] of files) {
      const target = await safeTarget(root, path);
      const original = await readFile(target).catch(() => null);
      if (!original || sha(original) !== sha(value)) await atomic(target, value);
      await afterWrite?.(path);
    }
    for (const entry of old) if (!files.has(entry.path)) await rm(await safeTarget(root, entry.path), { force: true });
    return { status: 'updated', version: manifest.version, backup: folder };
  } catch (error) {
    await rollback(root);
    throw error;
  }
}

export async function rollback(root) {
  root = resolve(root);
  const path = statePath(root);
  if (!(await exists(path))) return { status: 'no-pending-update' };
  const record = JSON.parse(await readFile(path, 'utf8'));
  const expected = join(root, '.cache', 'updates', 'backup') + sep;
  if (!resolve(record.folder).startsWith(expected)) throw Error('Invalid rollback record');
  for (const entry of record.old) {
    const target = await safeTarget(root, entry.path);
    if (entry.present) await atomic(target, await readFile(join(record.folder, 'program', entry.path)));
    else await rm(target, { force: true });
  }
  const savedDependencies = join(record.folder, 'node_modules');
  if (await exists(savedDependencies)) {
    await rm(join(root, 'node_modules'), { recursive: true, force: true });
    await rename(savedDependencies, join(root, 'node_modules'));
  } else if (record.depsChanged) {
    await rm(join(root, 'node_modules'), { recursive: true, force: true });
  }
  const database = join(root, 'data', 'signal.sqlite3');
  if (record.hadDatabase) await atomic(database, await readFile(join(record.folder, 'signal.sqlite3')));
  else await rm(database, { force: true });
  for (const suffix of ['-wal', '-shm', '-journal']) await rm(database + suffix, { force: true });
  const stamp = join(root, '.cache', 'installed-lock.txt');
  if (record.stamp !== null) await atomic(stamp, record.stamp);
  else await rm(stamp, { force: true });
  // A bad release is not retried automatically on every subsequent launch.
  await json(join(root, '.cache', 'updates', 'blocked.json'), {
    version: record.version,
    reason: 'Previous startup failed; awaiting a newer release',
  });
  await rm(path, { force: true });
  return { status: 'rolled-back', version: record.previousVersion };
}
export async function confirm(root) {
  if (!(await exists(statePath(root)))) return { status: 'current' };
  const record = JSON.parse(await readFile(statePath(root), 'utf8'));
  await json(join(root, '.cache', 'updates', 'installed.json'), {
    version: record.version,
    confirmed_at: new Date().toISOString(),
  });
  await rm(statePath(root), { force: true });
  // Keep the latest two generated rollback folders, including their DB snapshots.
  const base = join(root, '.cache', 'updates', 'backup');
  const folders = (await readdir(base))
    .filter(name => /^\d+-[a-f0-9-]+$/.test(name))
    .sort()
    .reverse();
  for (const folder of folders.slice(2)) await rm(join(base, folder), { recursive: true, force: true });
  return { status: 'confirmed', version: record.version };
}
export async function checkAndApply(root, { fetcher = fetch } = {}) {
  return withUpdateLock(root, async () => {
    if (await exists(statePath(root))) return rollback(root);
    const manifest = await fetchManifest(fetcher);
    const current = await currentVersion(root);
    if (versionCompare(manifest.version, current) <= 0) return { status: 'current', version: current };
    const blocked = JSON.parse(
      await readFile(join(root, '.cache', 'updates', 'blocked.json'), 'utf8').catch(() => '{}'),
    );
    if (blocked.version === manifest.version)
      return {
        status: 'blocked',
        version: current,
        message: 'This release failed previously; continuing the previous version.',
      };
    return applyPackage(root, await download(manifest.url, manifest.bytes, fetcher), manifest);
  });
}
