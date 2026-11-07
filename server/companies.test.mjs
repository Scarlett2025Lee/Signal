import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './database.mjs';
import { createCompaniesService } from './companies.mjs';

test('company research keeps social/founder/contact/office details and sourced PM/GTM/Data jobs', () => {
  const db = openDatabase(':memory:');
  const service = createCompaniesService(db);
  try {
    let company = service.create({ name: 'Fixture Company' });
    assert.equal(company.hiring_status, 'unknown');
    company = {
      ...company,
      website: 'https://example.com',
      x_url: 'https://x.com/fixture',
      linkedin_url: 'https://linkedin.com/company/fixture',
      product_summary: 'Fictional payment API fixture',
      offices: 'New York, NY\nAustin, TX',
      public_email: 'hello@example.com',
      recruiting_email: 'careers@example.com',
      recruiting_phone: '+1 555 0100',
      info_source_url: 'https://example.com/contact',
      info_checked_on: '2026-10-31',
      hiring_status: 'roles_found',
      hiring_source_url: 'https://example.com/careers',
      hiring_checked_on: '2026-10-31',
      founders: [
        {
          name: 'Test Founder',
          title: 'CEO',
          profile_url: 'https://linkedin.com/in/fixture',
          email: 'founder@example.com',
          phone: '',
          source_url: 'https://example.com/team',
        },
      ],
      jobs: [
        {
          title: 'Product Manager',
          track: 'PM',
          url: 'https://example.com/careers/pm',
          evidence: 'Official page lists Product Manager',
          checked_on: '2026-10-31',
        },
      ],
    };
    const saved = service.save(company.id, company);
    assert.equal(saved.jobs[0].track, 'PM');
    assert.equal(saved.founders[0].profile_url, 'https://linkedin.com/in/fixture');
    assert.equal(service.list()[0].hiring_tracks, 'PM');
    assert.equal(saved.offices, company.offices);
    const founderId = saved.founders[0].id;
    db.prepare('INSERT INTO outreach(company_id,contact_id) VALUES(?,?)').run(saved.id, founderId);
    service.save(company.id, { ...saved, founders: [], jobs: [], hiring_status: 'no_relevant_roles' });
    assert.equal(service.detail(company.id).founders.length, 0);
    assert.equal(db.prepare('SELECT count(*) n FROM contacts WHERE id=?').get(founderId).n, 1);
    assert.equal(service.list()[0].hiring_tracks, null);
  } finally {
    db.close();
  }
});
test('rejects unsafe socials, guessed jobs without evidence, and unsupported hiring tracks', () => {
  const db = openDatabase(':memory:');
  const service = createCompaniesService(db);
  try {
    const c = service.create({ name: 'Fixture' });
    assert.throws(() => service.save(c.id, { ...c, x_url: 'javascript:alert(1)' }), /HTTPS/);
    assert.throws(() => service.save(c.id, { ...c, linkedin_url: 'https://unrelated.example/person' }), /HTTPS/);
    assert.throws(() => service.save(c.id, { ...c, hiring_status: 'no_relevant_roles' }), /核查日期/);
    assert.throws(() => service.save(c.id, { ...c, public_email: 'hello@example.com' }), /来源/);
    assert.throws(
      () =>
        service.save(c.id, {
          ...c,
          hiring_status: 'roles_found',
          hiring_source_url: 'https://example.com/jobs',
          hiring_checked_on: '2026-10-31',
          jobs: [
            {
              title: 'Software Engineer',
              track: 'Engineering',
              url: 'https://example.com/jobs/1',
              evidence: 'Engineering',
              checked_on: '2026-10-31',
            },
          ],
        }),
      /PM\/GTM\/Data/,
    );
  } finally {
    db.close();
  }
});
