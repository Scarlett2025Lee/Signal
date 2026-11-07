// Contacts, outreach and follow-ups. All names and addresses are fictional fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, dashboardStats } from './database.mjs';
import { createCrmService } from './crm.mjs';
import { createApp } from './app.mjs';

const clock = () => new Date('2026-11-07T15:00:00Z');
const setup = () => {
  const db = openDatabase(':memory:');
  return { db, crm: createCrmService(db, { clock }) };
};

test('outreach can start from a new company name with a new contact, and reuses existing companies', () => {
  const { db, crm } = setup();
  const first = crm.createOutreach({
    company_name: 'Fixture Labs',
    contact: { name: 'Ada Fixture', email: 'ada@fixture.example', title: 'CEO' },
    role_title: 'Product intern',
  });
  assert.equal(first.company_name, 'Fixture Labs');
  assert.equal(first.contact_email, 'ada@fixture.example');
  assert.equal(first.status, 'research');
  const second = crm.createOutreach({ company_name: 'fixture labs', status: 'ready' });
  assert.equal(second.company_id, first.company_id, 'case-insensitive company match');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM companies').get().n, 1);
  assert.deepEqual(
    crm.listOutreach().map(o => o.status),
    ['research', 'ready'],
  );
  db.close();
});

test('moving to contacted records today, and status/date/links are validated', () => {
  const { db, crm } = setup();
  const row = crm.createOutreach({ company_name: 'Fixture Pay' });
  assert.equal(crm.updateOutreach(row.id, { status: 'contacted' }).last_contacted_at, '2026-11-07');
  assert.equal(crm.updateOutreach(row.id, { last_contacted_at: '2026-11-03' }).last_contacted_at, '2026-11-03');
  assert.throws(() => crm.updateOutreach(row.id, { status: 'ghosted' }), /valid outreach status/);
  assert.throws(() => crm.updateOutreach(row.id, { last_contacted_at: '2026-02-30' }), /date/);
  assert.throws(() => crm.updateOutreach(row.id, { role_url: 'javascript:alert(1)' }), /valid web link/);
  assert.throws(() => crm.createOutreach({ company_id: 999 }), /Company not found/);
  assert.equal(dashboardStats(db).active_outreach, 1);
  db.close();
});

test('a contact cannot be attached to another company, deleted while in use, or duplicated by email', () => {
  const { db, crm } = setup();
  const a = crm.createOutreach({ company_name: 'Fixture A', contact: { name: 'Ann', email: 'ann@a.example' } });
  const other = crm.createContact({ company_name: 'Fixture B', name: 'Bo' });
  assert.throws(() => crm.updateOutreach(a.id, { contact_id: other.id }), /another company/);
  assert.throws(() => crm.deleteContact(a.contact_id), /linked to outreach/);
  assert.throws(
    () => crm.createContact({ company_id: a.company_id, name: 'Ann again', email: 'ANN@a.example' }),
    /already has a contact/,
  );
  crm.deleteContact(other.id);
  assert.deepEqual(
    crm.listContacts().map(c => c.name),
    ['Ann'],
  );
  db.close();
});

test('follow-ups become due, complete with a timestamp, and cascade with their outreach', () => {
  const { db, crm } = setup();
  const row = crm.createOutreach({ company_name: 'Fixture Data', status: 'contacted' });
  const due = crm.createFollowUp({ outreach_id: row.id, due_at: '2026-11-05', notes: 'Bump the thread' });
  // Far future: dashboardStats compares against the real current time.
  crm.createFollowUp({ outreach_id: row.id, due_at: '2099-01-01' });
  assert.equal(crm.listOutreach()[0].next_follow_up, '2026-11-05');
  assert.equal(dashboardStats(db).due_follow_ups, 1);
  const done = crm.updateFollowUp(due.id, { status: 'completed' });
  assert.equal(done.completed_at, '2026-11-07T15:00:00.000Z');
  assert.equal(crm.updateFollowUp(due.id, { status: 'pending' }).completed_at, null);
  assert.throws(() => crm.createFollowUp({ outreach_id: row.id }), /due date/);
  crm.deleteOutreach(row.id);
  assert.equal(crm.listFollowUps().length, 0);
  db.close();
});

test('CRM HTTP routes accept same-origin JSON writes, including DELETE, and reject others', async t => {
  const db = openDatabase(':memory:');
  const server = createApp(db, { crm: createCrmService(db, { clock }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (method, path, body, headers = {}) =>
    fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const created = await send('POST', '/api/outreach', { company_name: 'Fixture HTTP' });
  assert.equal(created.status, 201);
  const { id } = await created.json();
  assert.equal(
    (await send('PUT', `/api/outreach/${id}`, { status: 'interviewing' }).then(r => r.json())).status,
    'interviewing',
  );
  assert.equal((await fetch(base + '/api/outreach').then(r => r.json())).length, 1);
  assert.equal((await send('PUT', `/api/outreach/${id}`, { status: 'x' })).status, 400);
  assert.equal((await send('DELETE', `/api/outreach/${id}`, {}, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await fetch(base + `/api/outreach/${id}`, { method: 'DELETE' })).status, 415);
  assert.equal((await send('PATCH', `/api/outreach/${id}`, {})).status, 405);
  assert.equal((await send('DELETE', `/api/outreach/${id}`, {})).status, 200);
  assert.equal((await send('DELETE', `/api/outreach/${id}`, {})).status, 404);
});
