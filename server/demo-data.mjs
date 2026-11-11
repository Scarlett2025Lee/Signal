import { CLASSIFICATION_VERSION } from './funding.mjs';
import { reportingWindow } from './funding-sources.mjs';

// Fictional companies and people for the public demo. Every link points at example.com,
// every email address uses example.com, and none of this comes from the real database.
const COMPANIES = [
  {
    name: 'Ledgerline',
    sector: 'AI + Fintech',
    hq: 'New York, NY',
    round: 'seed',
    amount: '$8M',
    daysAgo: 1,
    summary: 'AI bookkeeping for independent restaurants that reconciles card, delivery-app and supplier payments.',
    founders: [
      ['Maya Okafor', 'CEO and co-founder'],
      ['Daniel Reyes', 'CTO and co-founder'],
    ],
    jobs: [
      ['Product Management Intern', 'PM'],
      ['Growth Analyst Intern', 'Data'],
    ],
    recruiting: 'jobs@example.com',
  },
  {
    name: 'Tallyfern',
    sector: 'AI',
    hq: 'Austin, TX',
    round: 'pre_seed',
    amount: '$2.5M',
    daysAgo: 2,
    summary: 'AI research assistant that turns customer-interview recordings into tagged product insights.',
    founders: [['Priya Natarajan', 'CEO and founder']],
    jobs: [['Go-to-Market Intern', 'GTM']],
    recruiting: '',
  },
  {
    name: 'Corvio Pay',
    sector: 'Fintech',
    hq: 'San Francisco, CA',
    round: 'series_a',
    amount: '$22M',
    daysAgo: 3,
    summary: 'Cross-border payroll for remote teams in Latin America, with same-day local payouts.',
    founders: [
      ['Lucas Moreira', 'CEO and co-founder'],
      ['Hannah Cho', 'COO and co-founder'],
    ],
    jobs: [],
    recruiting: '',
  },
  {
    name: 'Harborlight AI',
    sector: 'AI',
    hq: 'Boston, MA',
    round: 'seed',
    amount: '$6M',
    daysAgo: 4,
    summary: 'AI copilot that drafts prior-authorization requests for outpatient clinics.',
    founders: [['Ethan Brooks', 'CEO and co-founder']],
    jobs: [['Product Analyst Intern', 'Data']],
    recruiting: 'careers@example.com',
  },
  {
    name: 'Mossgate Analytics',
    sector: 'AI + Fintech',
    hq: 'Chicago, IL',
    round: 'series_b',
    amount: '$40M',
    daysAgo: 5,
    summary: 'Credit-risk models for community banks, explained in plain language for loan officers.',
    founders: [['Sofia Lindqvist', 'CEO and co-founder']],
    jobs: [['Strategy and Operations Intern', 'GTM']],
    recruiting: '',
  },
];

const ROUND_LABELS = { pre_seed: 'pre-seed', seed: 'seed', series_a: 'Series A', series_b: 'Series B' };

const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const day = date => date.toISOString().slice(0, 10);

const CLEAR = [
  'report_articles',
  'funding_articles',
  'funding_reports',
  'email_drafts',
  'follow_ups',
  'matches',
  'outreach',
  'company_jobs',
  'contacts',
  'funding_rounds',
  'companies',
];

let defaultTemplate;

/** Replace everything in the demo database with fresh sample data dated relative to `now`. */
export function seedDemo(db, now = new Date()) {
  defaultTemplate ??= db.prepare('SELECT id,subject,body FROM email_templates ORDER BY id LIMIT 1').get();
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const table of CLEAR) db.exec(`DELETE FROM ${table}`);
    if (defaultTemplate)
      db.prepare('UPDATE email_templates SET subject=?,body=? WHERE id=?').run(
        defaultTemplate.subject,
        defaultTemplate.body,
        defaultTemplate.id,
      );
    // The demo never fetches the news, so the weekly schedule stays off.
    db.prepare('UPDATE funding_schedule SET enabled=0,last_attempt_at=?,last_success_at=? WHERE id=1').run(
      now.toISOString(),
      now.toISOString(),
    );

    const window = reportingWindow(now);
    const reportId = Number(
      db
        .prepare(
          "INSERT INTO funding_reports(window_start,window_end,generated_at,status,sources_json) VALUES(?,?,?,'complete',?)",
        )
        .run(
          window.start,
          window.end,
          now.toISOString(),
          JSON.stringify([
            {
              id: 'sample',
              name: 'Sample News',
              ok: true,
              covered: true,
              pages: 3,
              fetched: 48,
              error: null,
              candidates: 9,
            },
          ]),
        ).lastInsertRowid,
    );

    const ids = {};
    for (const c of COMPANIES) {
      const s = slug(c.name);
      const website = `https://example.com/${s}`;
      const published = new Date(now.getTime() - c.daysAgo * 86400000);
      const companyId = Number(
        db
          .prepare(
            `INSERT INTO companies(name,website,sector,headquarters,country_code,product_summary,linkedin_url,recruiting_email,
              info_source_url,info_checked_on,hiring_status,hiring_source_url,hiring_checked_on)
             VALUES(?,?,?,?,'US',?,NULL,?,?,?,?,?,?)`,
          )
          .run(
            c.name,
            website,
            c.sector,
            c.hq,
            c.summary,
            c.recruiting || null,
            website,
            day(now),
            c.jobs.length ? 'roles_found' : 'no_relevant_roles',
            `${website}/careers`,
            day(now),
          ).lastInsertRowid,
      );
      ids[c.name] = companyId;
      const sourceUrl = `https://example.com/news/${s}-${c.round.replace('_', '-')}`;
      const roundId = Number(
        db
          .prepare(
            'INSERT INTO funding_rounds(company_id,round_type,announced_on,source_url,verified_at) VALUES(?,?,?,?,?)',
          )
          .run(companyId, c.round, day(published), sourceUrl, now.toISOString()).lastInsertRowid,
      );
      const lead = `${c.hq.split(',')[0]}-based ${c.name} has raised ${c.amount} in ${ROUND_LABELS[c.round]} funding.`;
      const articleId = Number(
        db
          .prepare(
            `INSERT INTO funding_articles(source_url,source_name,title,summary,published_at,company_name,company_key,sector,
              country_code,round_type,amount_text,announced_on,extraction_notes,review_status,company_id,funding_round_id,
              reviewed_at,eligibility,hq_location,hq_evidence_json,research_error,researched_at,company_website,classification_version)
             VALUES(?,'Sample News',?,?,?,?,?,?,'US',?,?,?,'Sample data for the demo','approved',?,?,?,'included',?,?,'',?,?,?)`,
          )
          .run(
            sourceUrl,
            `${c.name} raises ${c.amount} ${ROUND_LABELS[c.round]}`,
            `${lead} ${c.summary}`,
            published.toISOString(),
            c.name,
            s,
            c.sector,
            c.round,
            c.amount,
            day(published),
            companyId,
            roundId,
            now.toISOString(),
            c.hq,
            JSON.stringify([{ location: c.hq, kind: 'us', quote: lead, url: sourceUrl }]),
            now.toISOString(),
            website,
            CLASSIFICATION_VERSION,
          ).lastInsertRowid,
      );
      db.prepare('INSERT INTO report_articles(report_id,article_id) VALUES(?,?)').run(reportId, articleId);
      for (const [name, title] of c.founders)
        db.prepare('INSERT INTO contacts(company_id,name,title,email,source_url,is_founder) VALUES(?,?,?,?,?,1)').run(
          companyId,
          name,
          title,
          `${name.split(' ')[0].toLowerCase()}@example.com`,
          website,
        );
      for (const [title, track] of c.jobs)
        db.prepare('INSERT INTO company_jobs(company_id,title,track,url,evidence,checked_on) VALUES(?,?,?,?,?,?)').run(
          companyId,
          title,
          track,
          `${website}/careers`,
          `Listed on the ${c.name} careers page`,
          day(now),
        );
    }

    // A few outreach records at different stages, so the CRM, follow-ups and email pages have something to show.
    const contact = name => db.prepare('SELECT id,company_id FROM contacts WHERE name=?').get(name);
    const outreach = (person, role, status, contactedDaysAgo, notes) => {
      const c = contact(person);
      return Number(
        db
          .prepare(
            'INSERT INTO outreach(company_id,contact_id,role_title,role_url,status,last_contacted_at,notes) VALUES(?,?,?,?,?,?,?)',
          )
          .run(
            c.company_id,
            c.id,
            role,
            null,
            status,
            contactedDaysAgo === null ? null : day(new Date(now.getTime() - contactedDaysAgo * 86400000)),
            notes,
          ).lastInsertRowid,
      );
    };
    const ledgerline = outreach(
      'Maya Okafor',
      'Product Management Intern',
      'in_conversation',
      6,
      'Replied; intro call booked.',
    );
    const harborlight = outreach(
      'Ethan Brooks',
      'Product Analyst Intern',
      'contacted',
      3,
      'Sent a note about the funding.',
    );
    outreach('Priya Natarajan', 'Go-to-Market Intern', 'ready', null, 'Draft ready to send.');
    outreach('Sofia Lindqvist', 'Strategy and Operations Intern', 'research', null, '');

    const due = (outreachId, daysFromNow, notes) =>
      db
        .prepare('INSERT INTO follow_ups(outreach_id,due_at,notes) VALUES(?,?,?)')
        .run(outreachId, day(new Date(now.getTime() + daysFromNow * 86400000)), notes);
    due(harborlight, -1, 'Follow up if no reply.');
    due(ledgerline, 2, 'Send a thank-you note after the call.');

    db.prepare("INSERT INTO email_drafts(outreach_id,subject,body,status) VALUES(?,?,?,'draft')").run(
      ledgerline,
      'Congrats on the seed round — interested in contributing to Ledgerline',
      'Hi Maya,\n\nI came across Ledgerline’s recent seed announcement and was excited by what you’re building.\n\n(Sample draft for the demo.)\n\nBest,\nSample User',
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
