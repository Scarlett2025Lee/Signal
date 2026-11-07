import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, dashboardStats, dataDirectory, projectRoot } from './database.mjs';
import { createApp } from './app.mjs';
import { request } from 'node:http';
import { completedResearchFixture } from './research.fixture.mjs';
import { createFundingService } from './funding.mjs';
import { createCompaniesService } from './companies.mjs';

test('migration retains data after restart and counts only due and active records', () => {
  const directory = mkdtempSync(join(tmpdir(), 'signal-db-'));
  const filename = join(directory, 'data/signal.sqlite3');
  let db;
  try {
    db = openDatabase(filename);
    db.exec(`INSERT INTO companies(id,name) VALUES (1,'Example');
      INSERT INTO contacts(id,company_id,name) VALUES (1,1,'Founder');
      INSERT INTO outreach(id,company_id,contact_id,status) VALUES (1,1,1,'contacted'), (2,1,1,'closed');
      INSERT INTO follow_ups(outreach_id,due_at) VALUES (1,'2000-01-01T00:00:00Z'), (1,'2999-01-01T00:00:00Z');`);
    assert.throws(() => db.exec("INSERT INTO contacts(company_id,name) VALUES (99,'Orphan')"));
    assert.throws(() => db.exec("UPDATE outreach SET status='invalid' WHERE id=1"));
    db.close();
    db = openDatabase(filename);
    assert.deepEqual(
      { ...dashboardStats(db) },
      { companies: 1, funding_rounds: 0, contacts: 1, active_outreach: 1, due_follow_ups: 1 },
    );
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 4);
  } finally {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('funding and company HTTP workflow returns completed company research and blocks foreign origins', async t => {
  const db = openDatabase(':memory:');
  const fixture = {
    source_url: 'https://www.finsmes.com/fixture',
    source_name: 'Fixture feed',
    title: 'Fixture Raises $2M in Seed Funding',
    summary: 'Fixture, a Boston, MA-based AI startup, raised seed funding. Fictional fixture.',
    published_at: '2026-10-30T12:00:00Z',
  };
  const funding = createFundingService(db, {
    sources: [{ id: 'fixture', name: 'Fixture feed', pages: 1 }],
    clock: () => new Date('2026-10-31T12:00:00Z'),
    fetchPage: async () => [fixture],
    research: completedResearchFixture,
  });
  const server = createApp(db, { funding, companies: createCompaniesService(db) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await funding.stop();
    await new Promise(resolve => server.close(resolve));
    db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (path, method, body, origin) =>
    fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
      body: JSON.stringify(body),
    });
  assert.equal((await send('/api/companies', 'POST', { name: 'Injected' }, 'https://untrusted.example')).status, 403);
  assert.equal((await send('/api/funding/generate', 'POST', {})).status, 202);
  let snapshot;
  for (let i = 0; i < 20; i++) {
    snapshot = await fetch(base + '/api/funding').then(r => r.json());
    if (!snapshot.running) break;
    await new Promise(r => setTimeout(r, 5));
  }
  assert.equal(snapshot.articles.length, 1);
  assert.equal(snapshot.articles[0].review_status, 'approved');
  const companies = await fetch(base + '/api/companies').then(r => r.json());
  assert.equal(companies.length, 1);
  const company = await fetch(base + `/api/companies/${companies[0].id}`).then(r => r.json());
  assert.equal(company.hiring_status, 'no_relevant_roles');
  assert.equal(
    (await send(`/api/companies/${company.id}`, 'PUT', { ...company, product_summary: 'Fictional API fixture' }))
      .status,
    200,
  );
  assert.match(await fetch(base + '/api/funding/export').then(r => r.text()), /\| Fixture \|/);
  const disabled = await send('/api/funding/schedule', 'PUT', { enabled: false });
  assert.equal((await disabled.json()).schedule.enabled, 0);
});

test('future database versions and relative data paths are rejected', () => {
  const directory = mkdtempSync(join(tmpdir(), 'signal-newer-'));
  const filename = join(directory, 'signal.sqlite3');
  try {
    const db = new DatabaseSync(filename);
    db.exec('PRAGMA user_version=5');
    db.close();
    assert.throws(() => openDatabase(filename), /newer/);
    assert.equal(dataDirectory(undefined), join(projectRoot, 'data'));
    assert.equal(dataDirectory(directory), directory);
    for (const relative of ['', 'data', '../data']) assert.throws(() => dataDirectory(relative), /absolute/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('HTTP serves the site and SQLite counts, without exposing the database or source', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'signal-http-'));
  writeFileSync(join(directory, 'index.html'), '<!doctype html><h1>Signal</h1>');
  const db = openDatabase(':memory:');
  const server = createApp(db, { staticRoot: directory });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(base);
  assert.match(await page.text(), /Signal/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await fetch(base + '/api/health')).status, 200);
  db.exec("INSERT INTO companies(name) VALUES ('Saved company')");
  assert.equal((await fetch(base + '/api/dashboard').then(r => r.json())).companies, 1);
  for (const path of ['/data/signal.sqlite3', '/server/database.mjs', '/api/unknown', '/%2e%2e%2fpackage.json']) {
    const response = await fetch(base + path);
    assert.ok([403, 404].includes(response.status), path);
  }
  assert.equal((await fetch(base, { method: 'POST' })).status, 405);
  const untrustedStatus = await new Promise((resolve, reject) => {
    const req = request(base + '/api/dashboard', { headers: { Host: 'untrusted.example' } }, res => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(untrustedStatus, 403);
});
