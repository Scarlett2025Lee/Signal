// Cold Email Generator: fills an editable template from company, funding, hiring and contact data,
// and keeps drafts. Nothing is ever sent from here; "sent manually" is a record the user sets.
import { FundingError as HttpError } from './funding.mjs';

export const TRACKS = ['PM', 'GTM', 'Data'];
const DRAFT_STATUSES = ['draft', 'reviewed', 'sent_manually'];
const ROUND_LABELS = { pre_seed: 'Pre-seed', seed: 'Seed', series_a: 'Series A', series_b: 'Series B' };
const TRACK_WORDS = { PM: 'product', GTM: 'GTM', Data: 'analytics' };

function text(value, field, max = 20000) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max) throw new HttpError(`${field} is invalid or too long`);
  return value;
}
const firstSentence = value => {
  const clean = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return '';
  const sentence = clean.match(/^.{20,300}?[.!?](?=\s|$)/)?.[0] ?? clean.slice(0, 200);
  return sentence;
};
/** "GTM, product or analytics", led by the chosen track. */
export function trackPhrase(lead) {
  const order = [lead, ...TRACKS.filter(track => track !== lead)].map(track => TRACK_WORDS[track]);
  return `${order[0]}, ${order[1]} or ${order[2]}`;
}
/** Replace {{key}} placeholders; unknown keys are left visible so the user notices them. */
export function renderTemplate(template, values) {
  return template
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, key) => (key in values ? values[key] : whole))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function createEmailService(db, { clock = () => new Date() } = {}) {
  const today = () => clock().toISOString().slice(0, 10);

  function template() {
    const row = db.prepare('SELECT * FROM email_templates ORDER BY id LIMIT 1').get();
    if (!row) throw new HttpError('No email template found', 404);
    return row;
  }
  function saveTemplate(input) {
    const current = template();
    const name = text(input.name ?? current.name, 'Template name', 150).trim();
    const subject = text(input.subject ?? current.subject, 'Subject', 300);
    const body = text(input.body ?? current.body, 'Body');
    if (!name || !subject.trim() || !body.trim()) throw new HttpError('A template needs a name, subject and body');
    db.prepare('UPDATE email_templates SET name=?,subject=?,body=?,updated_at=? WHERE id=?').run(
      name,
      subject,
      body,
      clock().toISOString(),
      current.id,
    );
    return template();
  }

  /** Everything the template can use for one outreach record. */
  function context(outreachId, lead = 'PM') {
    if (!TRACKS.includes(lead)) throw new HttpError('Choose PM, GTM or Data');
    const row = db
      .prepare(
        `SELECT o.id, o.role_title, c.id AS company_id, c.name AS company, c.product_summary, c.headquarters,
          ct.name AS contact_name, ct.email AS contact_email, c.public_email, c.recruiting_email
        FROM outreach o JOIN companies c ON c.id = o.company_id LEFT JOIN contacts ct ON ct.id = o.contact_id
        WHERE o.id = ?`,
      )
      .get(outreachId);
    if (!row) throw new HttpError('Outreach record not found', 404);
    const funding = db
      .prepare(
        `SELECT a.amount_text, coalesce(r.round_type, a.round_type) AS round_type
        FROM funding_articles a LEFT JOIN funding_rounds r ON r.id = a.funding_round_id
        WHERE a.company_id = ? ORDER BY coalesce(a.announced_on, a.published_at) DESC LIMIT 1`,
      )
      .get(row.company_id);
    const jobs = db
      .prepare('SELECT title, track FROM company_jobs WHERE company_id = ? AND active = 1')
      .all(row.company_id);
    const job = jobs.find(j => j.track === lead) ?? jobs[0];
    const role = row.role_title || job?.title || '';
    const fundingText = [funding?.amount_text, ROUND_LABELS[funding?.round_type]].filter(Boolean).join(' ');
    return {
      to: row.contact_email || row.recruiting_email || row.public_email || '',
      values: {
        company: row.company,
        first_name: row.contact_name?.trim().split(/\s+/)[0] || 'there',
        funding: fundingText ? `${fundingText} round` : 'funding',
        what_they_do: firstSentence(row.product_summary) || '[one line on what they build].',
        location: row.headquarters || '',
        role,
        hiring_line: role
          ? `I also noticed you're hiring for ${role}${row.headquarters ? ` in ${row.headquarters}` : ''}.`
          : '',
        tracks: trackPhrase(lead),
        track: lead,
      },
    };
  }
  function generate(input) {
    const outreachId = Number(input.outreach_id);
    if (!Number.isSafeInteger(outreachId) || outreachId < 1) throw new HttpError('Choose an outreach record');
    const { to, values } = context(outreachId, input.track ?? 'PM');
    const current = template();
    return {
      outreach_id: outreachId,
      to,
      subject: renderTemplate(current.subject, values),
      body: renderTemplate(current.body, values),
      context: values,
    };
  }

  // ---- Drafts ----
  const draftSelect = `SELECT d.id, d.outreach_id, d.subject, d.body, d.status, d.created_at, c.name AS company_name,
      ct.email AS contact_email
    FROM email_drafts d JOIN outreach o ON o.id = d.outreach_id JOIN companies c ON c.id = o.company_id
    LEFT JOIN contacts ct ON ct.id = o.contact_id`;
  function listDrafts() {
    return db.prepare(`${draftSelect} ORDER BY d.created_at DESC, d.id DESC`).all();
  }
  function draft(draftId) {
    const row = db.prepare(`${draftSelect} WHERE d.id = ?`).get(draftId);
    if (!row) throw new HttpError('Draft not found', 404);
    return row;
  }
  const draftFields = (input, previous) => {
    const status = input.status ?? previous?.status ?? 'draft';
    if (!DRAFT_STATUSES.includes(status)) throw new HttpError('Choose a valid draft status');
    return {
      subject: input.subject !== undefined ? text(input.subject, 'Subject', 300) : (previous?.subject ?? ''),
      body: input.body !== undefined ? text(input.body, 'Body') : (previous?.body ?? ''),
      status,
    };
  };
  /** Marking a draft as sent by hand moves early-stage outreach to "contacted". */
  const recordManualSend = outreachId =>
    db
      .prepare(
        `UPDATE outreach SET status = 'contacted', last_contacted_at = coalesce(last_contacted_at, ?)
        WHERE id = ? AND status IN ('research', 'ready')`,
      )
      .run(today(), outreachId);
  function createDraft(input) {
    const outreachId = Number(input.outreach_id);
    if (!db.prepare('SELECT id FROM outreach WHERE id = ?').get(outreachId))
      throw new HttpError('Outreach record not found', 404);
    const fields = draftFields(input);
    if (!fields.body.trim()) throw new HttpError('The draft is empty');
    const id = Number(
      db
        .prepare('INSERT INTO email_drafts(outreach_id, subject, body, status, generation_context) VALUES(?,?,?,?,?)')
        .run(outreachId, fields.subject, fields.body, fields.status, JSON.stringify({ track: input.track ?? null }))
        .lastInsertRowid,
    );
    if (fields.status === 'sent_manually') recordManualSend(outreachId);
    return draft(id);
  }
  function updateDraft(draftId, input) {
    const previous = draft(draftId);
    const fields = draftFields(input, previous);
    db.prepare('UPDATE email_drafts SET subject=?, body=?, status=? WHERE id=?').run(
      fields.subject,
      fields.body,
      fields.status,
      draftId,
    );
    if (fields.status === 'sent_manually' && previous.status !== 'sent_manually')
      recordManualSend(previous.outreach_id);
    return draft(draftId);
  }
  function deleteDraft(draftId) {
    draft(draftId);
    db.prepare('DELETE FROM email_drafts WHERE id = ?').run(draftId);
  }

  const routes = [
    ['GET', /^\/api\/email\/template$/, () => template()],
    ['PUT', /^\/api\/email\/template$/, (_m, body) => saveTemplate(body)],
    ['POST', /^\/api\/email\/generate$/, (_m, body) => generate(body)],
    ['GET', /^\/api\/email\/drafts$/, () => listDrafts()],
    ['POST', /^\/api\/email\/drafts$/, (_m, body) => [201, createDraft(body)]],
    ['PUT', /^\/api\/email\/drafts\/(\d+)$/, (m, body) => updateDraft(Number(m[1]), body)],
    ['DELETE', /^\/api\/email\/drafts\/(\d+)$/, m => (deleteDraft(Number(m[1])), { ok: true })],
  ];
  function route(method, pathname) {
    for (const [verb, pattern, handler] of routes) {
      const match = verb === method && pathname.match(pattern);
      if (match) return body => handler(match, body);
    }
    return null;
  }
  return { template, saveTemplate, context, generate, listDrafts, createDraft, updateDraft, deleteDraft, route };
}
