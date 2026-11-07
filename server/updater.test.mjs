import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { zipSync } from 'fflate';
import {
  validPath,
  unpackPackage,
  applyPackage,
  rollback,
  confirm,
  checkAndApply,
  withUpdateLock,
  versionCompare,
} from '../scripts/update-core.mjs';
import { createUpdateService } from './updates.mjs';
import { createApp } from './app.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function release(version, extra = {}) {
  const files = {
    'package.json': JSON.stringify({ version }),
    'package-lock.json': JSON.stringify({ version }),
    'server/index.mjs': '// ' + version,
    'Start-Signal.ps1': '# ' + version,
    'scripts/update-cli.mjs': '// ' + version,
    'dist/index.html': '<h1>' + version + '</h1>',
    ...extra,
  };
  const inventory = {
    format: 1,
    version,
    files: Object.fromEntries(Object.entries(files).map(([p, v]) => [p, sha(v)])),
  };
  const archive = Object.fromEntries(Object.entries(files).map(([p, v]) => ['Signal/' + p, Buffer.from(v)]));
  archive['Signal/release.json'] = Buffer.from(JSON.stringify(inventory));
  const bytes = Buffer.from(zipSync(archive));
  return {
    files,
    inventory,
    bytes,
    manifest: {
      format: 1,
      version,
      sha256: sha(bytes),
      bytes: bytes.length,
      url: 'https://github.com/Scarlett2025Lee/AI-Fintech-funding-leads/raw/refs/heads/codex/signal-web/downloads/Signal.zip',
    },
  };
}
async function installation(t) {
  const root = await mkdtemp(join(tmpdir(), 'signal-update-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const old = release('0.3.0', { 'server/obsolete.mjs': 'old managed file' });
  for (const [path, value] of Object.entries(old.files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), value);
  }
  await writeFile(join(root, 'release.json'), JSON.stringify(old.inventory));
  for (const [path, value] of Object.entries({
    'data/personal.txt': 'private user file',
    '.tools/node.txt': 'portable runtime',
    '.cache/browser/profile.txt': 'browser state',
    'node_modules/old.txt': 'previous dependencies',
    '.cache/installed-lock.txt': 'previous lock stamp',
    'my-notes.txt': 'unmanaged notes',
  })) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), value);
  }
  const db = new DatabaseSync(join(root, 'data/signal.sqlite3'));
  db.exec("CREATE TABLE records(value TEXT);INSERT INTO records VALUES('keep me');PRAGMA user_version=1");
  db.close();
  return root;
}
const missing = async path => assert.rejects(access(path));

test('release paths cannot address mutable data, other drives, traversal, or Windows aliases', () => {
  for (const path of [
    '../outside',
    'data/signal.sqlite3',
    '.tools/node.exe',
    '.cache/config',
    'node_modules/x',
    'C:/temp/x',
    'src/../data/x',
    'src\\x',
    'src/CON.txt',
    'src/file.',
    '/server/a',
  ])
    assert.throws(() => validPath(path), path);
  assert.equal(validPath('server/new.mjs'), 'server/new.mjs');
  assert.equal(versionCompare('0.10.0', '0.9.9'), 1);
  assert.throws(() => versionCompare('latest', '0.3.0'));
});
test('ZIP and individual file checksums are enforced before any write', async () => {
  const pkg = release('0.4.0');
  await assert.rejects(unpackPackage(pkg.bytes, { ...pkg.manifest, sha256: '0'.repeat(64) }), /checksum/);
  const files = { 'Signal/data/signal.sqlite3': Buffer.from('overwrite') };
  const bytes = Buffer.from(zipSync(files));
  await assert.rejects(
    unpackPackage(bytes, { ...pkg.manifest, bytes: bytes.length, sha256: sha(bytes) }),
    /may not write/,
  );
  const original = release('0.4.0');
  const entries = Object.fromEntries(Object.entries(original.files).map(([p, v]) => ['Signal/' + p, Buffer.from(v)]));
  entries['Signal/release.json'] = Buffer.from(JSON.stringify(original.inventory));
  entries['Signal/server/index.mjs'] = Buffer.from('tampered');
  const bad = Buffer.from(zipSync(entries));
  await assert.rejects(
    unpackPackage(bad, { ...original.manifest, bytes: bad.length, sha256: sha(bad) }),
    /file checksum/,
  );
});
test('verified update preserves private files, snapshots SQLite, retains dependencies and removes only old managed files', async t => {
  const root = await installation(t);
  const pkg = release('0.4.0');
  const result = await applyPackage(root, pkg.bytes, pkg.manifest);
  assert.equal(result.status, 'updated');
  assert.equal(JSON.parse(await readFile(join(root, 'package.json'))).version, '0.4.0');
  for (const [path, value] of Object.entries({
    'data/personal.txt': 'private user file',
    '.tools/node.txt': 'portable runtime',
    '.cache/browser/profile.txt': 'browser state',
    'my-notes.txt': 'unmanaged notes',
  }))
    assert.equal(await readFile(join(root, path), 'utf8'), value);
  await missing(join(root, 'server/obsolete.mjs'));
  assert.equal(await readFile(join(result.backup, 'node_modules/old.txt'), 'utf8'), 'previous dependencies');
  const db = new DatabaseSync(join(result.backup, 'signal.sqlite3'));
  assert.equal(db.prepare('SELECT value FROM records').get().value, 'keep me');
  db.close();
  await confirm(root);
  await missing(join(root, '.cache/updates/pending.json'));
  assert.equal((await rollback(root)).status, 'no-pending-update');
});
test('failure halfway through file replacement rolls back code, dependencies, stamp and data', async t => {
  const root = await installation(t);
  const pkg = release('0.4.0');
  await assert.rejects(
    applyPackage(root, pkg.bytes, pkg.manifest, {
      afterWrite: path => {
        if (path === 'server/index.mjs') throw Error('simulated interrupted copy');
      },
    }),
    /simulated/,
  );
  assert.equal(JSON.parse(await readFile(join(root, 'package.json'))).version, '0.3.0');
  assert.equal(await readFile(join(root, 'node_modules/old.txt'), 'utf8'), 'previous dependencies');
  assert.equal(await readFile(join(root, '.cache/installed-lock.txt'), 'utf8'), 'previous lock stamp');
  assert.equal(await readFile(join(root, 'server/obsolete.mjs'), 'utf8'), 'old managed file');
  await missing(join(root, '.cache/updates/pending.json'));
});
test('failed new schema/startup can restore pre-update SQLite and dependency tree', async t => {
  const root = await installation(t);
  const pkg = release('0.4.0');
  await applyPackage(root, pkg.bytes, pkg.manifest);
  const db = new DatabaseSync(join(root, 'data/signal.sqlite3'));
  db.exec(
    "ALTER TABLE records ADD COLUMN extra TEXT;UPDATE records SET value='unconfirmed change';PRAGMA user_version=2",
  );
  db.close();
  await mkdir(join(root, 'node_modules'), { recursive: true });
  await writeFile(join(root, 'node_modules/broken.txt'), 'incomplete npm install');
  await rollback(root);
  const restored = new DatabaseSync(join(root, 'data/signal.sqlite3'));
  assert.equal(restored.prepare('SELECT value FROM records').get().value, 'keep me');
  assert.equal(restored.prepare('PRAGMA user_version').get().user_version, 1);
  restored.close();
  assert.equal(await readFile(join(root, 'node_modules/old.txt'), 'utf8'), 'previous dependencies');
  await missing(join(root, 'node_modules/broken.txt'));
});
test('unconfirmed interrupted update is recovered before connecting to GitHub, and broken release is not retried', async t => {
  const root = await installation(t);
  const pkg = release('0.4.0');
  await applyPackage(root, pkg.bytes, pkg.manifest);
  assert.equal(
    (
      await checkAndApply(root, {
        fetcher: () => {
          throw Error('must not fetch before recovery');
        },
      })
    ).status,
    'rolled-back',
  );
  const fetcher = async () => new Response(JSON.stringify(pkg.manifest));
  assert.equal((await checkAndApply(root, { fetcher })).status, 'blocked');
});
test('offline checks leave current installation intact and a live update lock blocks concurrent writers', async t => {
  const root = await installation(t);
  await assert.rejects(
    checkAndApply(root, {
      fetcher: async () => {
        throw Error('offline');
      },
    }),
    /offline/,
  );
  assert.equal(JSON.parse(await readFile(join(root, 'package.json'))).version, '0.3.0');
  let entered;
  const ready = new Promise(r => {
    entered = r;
  });
  let releaseLock;
  const wait = new Promise(r => {
    releaseLock = r;
  });
  const task = withUpdateLock(root, async () => {
    entered();
    await wait;
  });
  await ready;
  await assert.rejects(
    withUpdateLock(root, async () => {}),
    /Another updater/,
  );
  releaseLock();
  await task;
});
test('update status caches manifest and restart is requested only for an available managed update', async t => {
  const root = await installation(t);
  const pkg = release('0.4.0');
  let calls = 0,
    restarts = 0;
  const service = createUpdateService({
    root,
    managed: true,
    requestRestart: () => restarts++,
    fetcher: async () => {
      calls++;
      return new Response(JSON.stringify(pkg.manifest));
    },
  });
  assert.equal((await service.status()).available, true);
  await service.status();
  assert.equal(calls, 1);
  assert.equal((await service.apply()).status, 'restarting');
  assert.equal(restarts, 1);
  const unmanaged = createUpdateService({
    root,
    managed: false,
    fetcher: async () => new Response(JSON.stringify(pkg.manifest)),
  });
  await assert.rejects(unmanaged.apply(), /launcher/);
});
test('update HTTP endpoint reports the version and accepts only same-origin JSON restart requests', async t => {
  const root = await installation(t);
  const pkg = release('0.4.0');
  let restarts = 0;
  const updates = createUpdateService({
    root,
    managed: true,
    requestRestart: () => restarts++,
    fetcher: async () => new Response(JSON.stringify(pkg.manifest)),
  });
  const db = new DatabaseSync(':memory:');
  const server = createApp(db, { updates, applicationVersion: '0.3.0' });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => {
    await new Promise(r => server.close(r));
    db.close();
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(url + '/api/updates').then(r => r.json())).latest, '0.4.0');
  assert.equal((await fetch(url + '/api/health').then(r => r.json())).version, '0.3.0');
  const send = origin =>
    fetch(url + '/api/updates/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: '{}',
    });
  assert.equal((await send('https://other.example')).status, 403);
  assert.equal(restarts, 0);
  assert.equal((await send(url)).status, 202);
  assert.equal(restarts, 1);
});
