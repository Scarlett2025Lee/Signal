// Contacts, outreach pipeline and follow-up reminders, stored in the local SQLite tables from migration 001.
import { FundingError as HttpError } from './funding.mjs';

export const OUTREACH_STATUSES = [
  'research',
  'ready',
  'contacted',
  'in_conversation',
  'interviewing',
  'offer',
  'closed',
];
const FOLLOW_UP_STATUSES = ['pending', 'completed', 'dismissed'];

function text(value, field, max = 4000) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max) throw new HttpError(`${field} is invalid or too long`);
  return value.trim();
}
function optionalEmail(value) {
  const result = text(value, 'Email', 254);
  if (result && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new HttpError('Invalid email address');
  return result || null;
}
function optionalURL(value, field) {
  const result = text(value, field, 2000);
  if (!result) return null;
  try {
    const url = new URL(result);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error();
    return url.href;
  } catch {
    throw new HttpError(`${field} must be a valid web link`);
  }
}
/** Calendar date YYYY-MM-DD, or null when empty. */
function optionalDate(value, field) {
  const result = text(value, field, 10);
  if (!result) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || new Date(result + 'T00:00:00Z').toISOString().slice(0, 10) !== result)
    throw new HttpError(`${field} must be a date (YYYY-MM-DD)`);
  return result;
}
function id(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new HttpError(`${field} is invalid`);
  return number;
}

export function createCrmService(db, { clock = () => new Date() } = {}) {
  const today = () => clock().toISOString().slice(0, 10);
  const transaction = work => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
  const requireCompany = companyId => {
    if (!db.prepare('SELECT id FROM companies WHERE id=?').get(companyId))
      throw new HttpError('Company not found', 404);
    return companyId;
  };
  /** Find a company by exact (case-insensitive) name, or create it. */
  const companyByName = name => {
    const clean = text(name, 'Company name', 150);
    if (!clean) throw new HttpError('Choose a company or enter a company name');
    const existing = db.prepare('SELECT id FROM companies WHERE lower(name)=lower(?)').get(clean);
    return existing
      ? existing.id
      : Number(db.prepare('INSERT INTO companies(name) VALUES(?)').run(clean).lastInsertRowid);
  };
  const contactFields = input => {
    const name = text(input.name, 'Name', 150);
    if (!name) throw new HttpError('Contact name is required');
    return {
      name,
      title: text(input.title, 'Title', 150) || null,
      email: optionalEmail(input.email),
      phone: text(input.phone, 'Phone', 100) || null,
      profile_url: optionalURL(input.profile_url, 'Profile link'),
      notes: text(input.notes, 'Notes'),
    };
  };
  const saveContact = (companyId, fields, contactId) => {
    try {
      if (contactId) {
        db.prepare('UPDATE contacts SET name=?,title=?,email=?,phone=?,profile_url=?,notes=? WHERE id=?').run(
          fields.name,
          fields.title,
          fields.email,
          fields.phone,
          fields.profile_url,
          fields.notes,
          contactId,
        );
        return contactId;
      }
      return Number(
        db
          .prepare('INSERT INTO contacts(company_id,name,title,email,phone,profile_url,notes) VALUES(?,?,?,?,?,?,?)')
          .run(companyId, fields.name, fields.title, fields.email, fields.phone, fields.profile_url, fields.notes)
          .lastInsertRowid,
      );
    } catch (error) {
      if (String(error.message).includes('UNIQUE'))
        throw new HttpError('This company already has a contact with that email', 409);
      throw error;
    }
  };

  // ---- Contacts ----
  const contactSelect = `SELECT ct.id, ct.company_id, c.name AS company_name, ct.name, ct.title, ct.email, ct.phone,
      ct.profile_url, ct.source_url, ct.notes, ct.is_founder,
      (SELECT COUNT(*) FROM outreach o WHERE o.contact_id = ct.id) AS outreach_count
    FROM contacts ct JOIN companies c ON c.id = ct.company_id`;
  function listContacts() {
    return db.prepare(`${contactSelect} ORDER BY lower(c.name), lower(ct.name)`).all();
  }
  function contact(contactId) {
    const row = db.prepare(`${contactSelect} WHERE ct.id=?`).get(contactId);
    if (!row) throw new HttpError('Contact not found', 404);
    return row;
  }
  function createContact(input) {
    const companyId = id(input.company_id, 'Company') ? requireCompany(id(input.company_id, 'Company')) : null;
    const fields = contactFields(input);
    return contact(transaction(() => saveContact(companyId ?? companyByName(input.company_name), fields)));
  }
  function updateContact(contactId, input) {
    contact(contactId);
    return contact(saveContact(null, contactFields(input), contactId));
  }
  function deleteContact(contactId) {
    const row = contact(contactId);
    if (row.outreach_count)
      throw new HttpError('This contact is linked to outreach. Change or delete that outreach first.', 409);
    db.prepare('DELETE FROM contacts WHERE id=?').run(contactId);
  }

  // ---- Outreach ----
  const outreachSelect = `SELECT o.id, o.company_id, c.name AS company_name, c.website, o.contact_id,
      ct.name AS contact_name, ct.email AS contact_email, o.role_title, o.role_url, o.status, o.last_contacted_at,
      o.notes, o.created_at,
      (SELECT min(due_at) FROM follow_ups f WHERE f.outreach_id = o.id AND f.status = 'pending') AS next_follow_up
    FROM outreach o JOIN companies c ON c.id = o.company_id LEFT JOIN contacts ct ON ct.id = o.contact_id`;
  function listOutreach() {
    const order = OUTREACH_STATUSES.map((status, index) => `WHEN '${status}' THEN ${index}`).join(' ');
    return db
      .prepare(
        `${outreachSelect} ORDER BY CASE o.status ${order} END, coalesce(o.last_contacted_at, o.created_at) DESC, o.id DESC`,
      )
      .all();
  }
  function outreach(outreachId) {
    const row = db.prepare(`${outreachSelect} WHERE o.id=?`).get(outreachId);
    if (!row) throw new HttpError('Outreach record not found', 404);
    return row;
  }
  const outreachFields = (input, previous) => {
    const status = input.status ?? previous?.status ?? 'research';
    if (!OUTREACH_STATUSES.includes(status)) throw new HttpError('Choose a valid outreach status');
    let lastContacted =
      input.last_contacted_at !== undefined
        ? optionalDate(input.last_contacted_at, 'Last contacted')
        : (previous?.last_contacted_at ?? null);
    // Moving to "contacted" records today unless a date was given.
    if (status === 'contacted' && !lastContacted) lastContacted = today();
    return {
      status,
      role_title:
        input.role_title !== undefined ? text(input.role_title, 'Role', 200) || null : (previous?.role_title ?? null),
      role_url: input.role_url !== undefined ? optionalURL(input.role_url, 'Role link') : (previous?.role_url ?? null),
      notes: input.notes !== undefined ? text(input.notes, 'Notes') : (previous?.notes ?? ''),
      last_contacted_at: lastContacted,
    };
  };
  /** contact_id, or a new contact { name, email, title } for the same company, or none. */
  const resolveContact = (companyId, input, previous) => {
    if (input.contact && typeof input.contact === 'object' && text(input.contact.name, 'Name', 150))
      return saveContact(companyId, contactFields(input.contact));
    if (input.contact_id === undefined) return previous?.contact_id ?? null;
    const contactId = id(input.contact_id, 'Contact');
    if (contactId && !db.prepare('SELECT id FROM contacts WHERE id=? AND company_id=?').get(contactId, companyId))
      throw new HttpError('That contact belongs to another company');
    return contactId;
  };
  function createOutreach(input) {
    const fields = outreachFields(input);
    return outreach(
      transaction(() => {
        const companyId = id(input.company_id, 'Company')
          ? requireCompany(id(input.company_id, 'Company'))
          : companyByName(input.company_name);
        const contactId = resolveContact(companyId, input);
        return Number(
          db
            .prepare(
              'INSERT INTO outreach(company_id,contact_id,role_title,role_url,status,last_contacted_at,notes) VALUES(?,?,?,?,?,?,?)',
            )
            .run(
              companyId,
              contactId,
              fields.role_title,
              fields.role_url,
              fields.status,
              fields.last_contacted_at,
              fields.notes,
            ).lastInsertRowid,
        );
      }),
    );
  }
  function updateOutreach(outreachId, input) {
    const previous = outreach(outreachId);
    const fields = outreachFields(input, previous);
    transaction(() => {
      const contactId = resolveContact(previous.company_id, input, previous);
      db.prepare(
        'UPDATE outreach SET contact_id=?,role_title=?,role_url=?,status=?,last_contacted_at=?,notes=? WHERE id=?',
      ).run(
        contactId,
        fields.role_title,
        fields.role_url,
        fields.status,
        fields.last_contacted_at,
        fields.notes,
        outreachId,
      );
    });
    return outreach(outreachId);
  }
  function deleteOutreach(outreachId) {
    outreach(outreachId);
    // Drafts, matches and follow-ups cascade with the outreach record.
    db.prepare('DELETE FROM outreach WHERE id=?').run(outreachId);
  }

  // ---- Follow-ups ----
  const followUpSelect = `SELECT f.id, f.outreach_id, f.due_at, f.status, f.completed_at, f.notes,
      o.company_id, c.name AS company_name, o.role_title, o.status AS outreach_status, ct.name AS contact_name, ct.email AS contact_email
    FROM follow_ups f JOIN outreach o ON o.id = f.outreach_id JOIN companies c ON c.id = o.company_id
    LEFT JOIN contacts ct ON ct.id = o.contact_id`;
  function listFollowUps() {
    return db
      .prepare(`${followUpSelect} ORDER BY CASE f.status WHEN 'pending' THEN 0 ELSE 1 END, f.due_at, f.id`)
      .all();
  }
  function followUp(followUpId) {
    const row = db.prepare(`${followUpSelect} WHERE f.id=?`).get(followUpId);
    if (!row) throw new HttpError('Follow-up not found', 404);
    return row;
  }
  function createFollowUp(input) {
    const outreachId = id(input.outreach_id, 'Outreach');
    if (!outreachId) throw new HttpError('Choose the outreach this follow-up belongs to');
    outreach(outreachId);
    const due = optionalDate(input.due_at, 'Due date');
    if (!due) throw new HttpError('Choose a due date');
    return followUp(
      Number(
        db
          .prepare('INSERT INTO follow_ups(outreach_id,due_at,notes) VALUES(?,?,?)')
          .run(outreachId, due, text(input.notes, 'Notes')).lastInsertRowid,
      ),
    );
  }
  function updateFollowUp(followUpId, input) {
    const previous = followUp(followUpId);
    const status = input.status ?? previous.status;
    if (!FOLLOW_UP_STATUSES.includes(status)) throw new HttpError('Choose a valid follow-up status');
    const due = input.due_at !== undefined ? optionalDate(input.due_at, 'Due date') : previous.due_at;
    if (!due) throw new HttpError('Choose a due date');
    const notes = input.notes !== undefined ? text(input.notes, 'Notes') : previous.notes;
    const completedAt = status === 'completed' ? (previous.completed_at ?? clock().toISOString()) : null;
    db.prepare('UPDATE follow_ups SET status=?,due_at=?,notes=?,completed_at=? WHERE id=?').run(
      status,
      due,
      notes,
      completedAt,
      followUpId,
    );
    return followUp(followUpId);
  }
  function deleteFollowUp(followUpId) {
    followUp(followUpId);
    db.prepare('DELETE FROM follow_ups WHERE id=?').run(followUpId);
  }

  /** [method, pattern, handler(match, body)] — used by the HTTP layer for routing and the mutation allowlist. */
  const routes = [
    ['GET', /^\/api\/contacts$/, () => listContacts()],
    ['POST', /^\/api\/contacts$/, (_m, body) => [201, createContact(body)]],
    ['PUT', /^\/api\/contacts\/(\d+)$/, (m, body) => updateContact(Number(m[1]), body)],
    ['DELETE', /^\/api\/contacts\/(\d+)$/, m => (deleteContact(Number(m[1])), { ok: true })],
    ['GET', /^\/api\/outreach$/, () => listOutreach()],
    ['POST', /^\/api\/outreach$/, (_m, body) => [201, createOutreach(body)]],
    ['PUT', /^\/api\/outreach\/(\d+)$/, (m, body) => updateOutreach(Number(m[1]), body)],
    ['DELETE', /^\/api\/outreach\/(\d+)$/, m => (deleteOutreach(Number(m[1])), { ok: true })],
    ['GET', /^\/api\/follow-ups$/, () => listFollowUps()],
    ['POST', /^\/api\/follow-ups$/, (_m, body) => [201, createFollowUp(body)]],
    ['PUT', /^\/api\/follow-ups\/(\d+)$/, (m, body) => updateFollowUp(Number(m[1]), body)],
    ['DELETE', /^\/api\/follow-ups\/(\d+)$/, m => (deleteFollowUp(Number(m[1])), { ok: true })],
  ];
  function route(method, pathname) {
    for (const [verb, pattern, handler] of routes) {
      const match = verb === method && pathname.match(pattern);
      if (match) return body => handler(match, body);
    }
    return null;
  }

  return {
    listContacts,
    createContact,
    updateContact,
    deleteContact,
    listOutreach,
    createOutreach,
    updateOutreach,
    deleteOutreach,
    listFollowUps,
    createFollowUp,
    updateFollowUp,
    deleteFollowUp,
    route,
  };
}
