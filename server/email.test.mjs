// Cold Email Generator. Fictional fixtures only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './database.mjs';
import { createCrmService } from './crm.mjs';
import { createEmailService, renderTemplate, trackPhrase } from './email.mjs';
import { createApp } from './app.mjs';

const clock = () => new Date('2026-11-07T15:00:00Z');
function setup() {
  const db = openDatabase(':memory:');
  const crm = createCrmService(db, { clock });
  const email = createEmailService(db, { clock });
  const outreach = crm.createOutreach({
    company_name: 'Fixtura',
    contact: { name: 'Ada Lovelace Fixture', email: 'ada@fixtura.example' },
  });
  db.prepare("UPDATE companies SET product_summary=?, headquarters='Seattle, WA' WHERE id=?").run(
    'Fixtura builds AI agents for insurance underwriting. It also does other things.',
    outreach.company_id,
  );
  db.prepare(
    `INSERT INTO funding_articles(source_url,source_name,title,summary,published_at,company_name,company_key,round_type,amount_text,extraction_notes,company_id,announced_on)
     VALUES('https://fixture.example/a','Fixture','t','s','2026-11-05T00:00:00Z','Fixtura','fixtura','series_a','$30m','',?, '2026-11-05')`,
  ).run(outreach.company_id);
  db.prepare(
    "INSERT INTO company_jobs(company_id,title,track,url,evidence,checked_on) VALUES(?,'Growth Marketing Manager','GTM','https://fixture.example/jobs/1','x','2026-11-06')",
  ).run(outreach.company_id);
  return { db, crm, email, outreach };
}

test('templates fill company, funding, contact and hiring details; unknown placeholders stay visible', () => {
  assert.equal(renderTemplate('Hi {{first_name}}, {{nope}}', { first_name: 'Ada' }), 'Hi Ada, {{nope}}');
  assert.equal(trackPhrase('GTM'), 'GTM, product or analytics');
  const { db, email, outreach } = setup();
  const draft = email.generate({ outreach_id: outreach.id, track: 'GTM' });
  assert.equal(draft.to, 'ada@fixtura.example');
  assert.match(draft.subject, /contributing to Fixtura/);
  assert.match(draft.body, /^Hi Ada,/);
  assert.match(draft.body, /\$30m Series A round announcement/);
  assert.match(draft.body, /Fixtura builds AI agents for insurance underwriting\./);
  assert.doesNotMatch(draft.body, /It also does other things/, 'only the first sentence of the summary');
  assert.match(draft.body, /hiring for Growth Marketing Manager in Seattle, WA\./);
  assert.match(draft.body, /across GTM, product or analytics/);
  assert.doesNotMatch(draft.body, /\{\{/);
  assert.throws(() => email.generate({ outreach_id: outreach.id, track: 'SWE' }), /PM, GTM or Data/);
  db.close();
});

test('missing data falls back to neutral wording, and the template can be edited', () => {
  const { db, crm, email } = setup();
  const bare = crm.createOutreach({ company_name: 'Bare Co' });
  const draft = email.generate({ outreach_id: bare.id });
  assert.match(draft.body, /^Hi there,/);
  assert.match(draft.body, /recent funding announcement/);
  assert.doesNotMatch(draft.body, /hiring for/);
  assert.equal(draft.to, '');
  const saved = email.saveTemplate({ subject: 'Hello {{company}}', body: 'Hi {{first_name}} at {{company}}' });
  assert.equal(saved.subject, 'Hello {{company}}');
  assert.equal(email.generate({ outreach_id: bare.id }).body, 'Hi there at Bare Co');
  assert.throws(() => email.saveTemplate({ body: '   ' }), /name, subject and body/);
  db.close();
});

test('drafts are saved per outreach, and marking one sent manually moves early outreach to contacted', () => {
  const { db, crm, email, outreach } = setup();
  const draft = email.createDraft({ outreach_id: outreach.id, subject: 'S', body: 'B', track: 'PM' });
  assert.equal(draft.status, 'draft');
  assert.equal(crm.listOutreach()[0].status, 'research');
  email.updateDraft(draft.id, { status: 'sent_manually' });
  const row = crm.listOutreach()[0];
  assert.equal(row.status, 'contacted');
  assert.equal(row.last_contacted_at, '2026-11-07');
  crm.updateOutreach(outreach.id, { status: 'interviewing' });
  email.createDraft({ outreach_id: outreach.id, body: 'Follow-up', status: 'sent_manually' });
  assert.equal(crm.listOutreach()[0].status, 'interviewing', 'later stages are not moved backwards');
  assert.throws(() => email.createDraft({ outreach_id: outreach.id, body: '' }), /empty/);
  crm.deleteOutreach(outreach.id);
  assert.equal(email.listDrafts().length, 0, 'drafts cascade with outreach');
  db.close();
});

test('email HTTP routes use the same JSON and origin checks', async t => {
  const { db, outreach } = setup();
  const server = createApp(db, { crm: createCrmService(db, { clock }), email: createEmailService(db, { clock }) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    db.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = {}) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const generated = await post('/api/email/generate', { outreach_id: outreach.id, track: 'Data' });
  assert.equal(generated.status, 200);
  assert.match((await generated.json()).body, /analytics, product or GTM/);
  assert.equal(
    (await post('/api/email/drafts', { outreach_id: outreach.id, body: 'x' }, { Origin: 'https://evil.example' }))
      .status,
    403,
  );
  assert.equal((await post('/api/email/drafts', { outreach_id: outreach.id, body: 'x' })).status, 201);
  assert.equal((await fetch(base + '/api/email/template').then(r => r.json())).name, 'Funding congrats — internship');
});
