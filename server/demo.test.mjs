import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { openDatabase, dashboardStats } from './database.mjs';
import { createApp } from './app.mjs';
import { createFundingService } from './funding.mjs';
import { createCompaniesService } from './companies.mjs';
import { createCrmService } from './crm.mjs';
import { createEmailService } from './email.mjs';
import { seedDemo } from './demo-data.mjs';

function call(base, path, { method = 'GET', host, origin, body } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (host) headers.Host = host;
    if (origin) headers.Origin = origin;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const req = request(base + path, { method, headers }, res => {
      let text = '';
      res.on('data', chunk => (text += chunk));
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

test('demo seed fills every page and can be reset to the same state', () => {
  const db = openDatabase(':memory:');
  try {
    seedDemo(db);
    const first = { ...dashboardStats(db) };
    assert.equal(first.companies, 5);
    assert.equal(first.funding_rounds, 5);
    assert.ok(first.contacts >= 5);
    assert.equal(first.active_outreach, 2);
    assert.equal(first.due_follow_ups, 1);
    const funding = createFundingService(db);
    assert.equal(funding.snapshot().articles.length, 5);
    assert.equal(funding.snapshot().schedule.enabled, 0);
    // Visitors' edits disappear on the next reset.
    db.exec("UPDATE companies SET name='Changed' WHERE id=(SELECT min(id) FROM companies)");
    db.exec("UPDATE email_templates SET subject='Changed'");
    seedDemo(db);
    assert.deepEqual({ ...dashboardStats(db) }, first);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM companies WHERE name='Changed'").get().n, 0);
    assert.notEqual(db.prepare('SELECT subject FROM email_templates').get().subject, 'Changed');
    // Sample data never points at real addresses.
    for (const row of db.prepare('SELECT email FROM contacts').all()) assert.match(row.email, /@example\.com$/);
    for (const row of db.prepare('SELECT website FROM companies').all())
      assert.match(row.website, /^https:\/\/example\.com\//);
  } finally {
    db.close();
  }
});

test('demo server answers on a public hostname but blocks news fetching and file writes', async () => {
  const db = openDatabase(':memory:');
  seedDemo(db);
  const server = createApp(db, {
    funding: createFundingService(db),
    companies: createCompaniesService(db),
    crm: createCrmService(db),
    email: createEmailService(db),
    demo: true,
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const host = 'signal-demo.example';
  try {
    const health = await call(base, '/api/health', { host });
    assert.equal(health.status, 200);
    assert.equal(JSON.parse(health.text).demo, true);
    assert.equal(JSON.parse((await call(base, '/api/dashboard', { host })).text).companies, 5);
    for (const [method, path] of [
      ['POST', '/api/funding/generate'],
      ['PUT', '/api/funding/schedule'],
      ['POST', '/api/resume-pdf'],
    ]) {
      const blocked = await call(base, path, { method, host, origin: `https://${host}`, body: {} });
      assert.equal(blocked.status, 403, path);
    }
    // Ordinary edits from the demo's own HTTPS page work, and other sites are still refused.
    const created = await call(base, '/api/companies', {
      method: 'POST',
      host,
      origin: `https://${host}`,
      body: { name: 'Visitor Co' },
    });
    assert.equal(created.status, 201);
    const foreign = await call(base, '/api/companies', {
      method: 'POST',
      host,
      origin: 'https://attacker.example',
      body: { name: 'X' },
    });
    assert.equal(foreign.status, 403);
    // The updater is not part of the demo.
    assert.equal((await call(base, '/api/updates', { host })).status, 404);
  } finally {
    server.close();
    db.close();
  }
});

test('the private app still refuses public hostnames', async () => {
  const db = openDatabase(':memory:');
  const server = createApp(db, {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await call(`http://127.0.0.1:${server.address().port}`, '/api/health', {
      host: 'signal-demo.example',
    });
    assert.equal(response.status, 403);
  } finally {
    server.close();
    db.close();
  }
});
