import { FundingError } from './funding.mjs';

const strings = [
  'name',
  'website',
  'sector',
  'headquarters',
  'product_summary',
  'notes',
  'x_url',
  'linkedin_url',
  'public_email',
  'public_phone',
  'recruiting_email',
  'recruiting_phone',
  'offices',
  'info_source_url',
  'info_checked_on',
  'hiring_status',
  'hiring_source_url',
  'hiring_checked_on',
];
function text(value, max = 4000) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max) throw new FundingError('A profile field is invalid or too long');
  return value.trim();
}
function safeURL(value, hosts) {
  const result = text(value, 2000);
  if (!result) return '';
  try {
    const url = new URL(result);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      (hosts && !hosts.some(host => url.hostname === host || url.hostname.endsWith('.' + host)))
    )
      throw new Error();
    return url.href;
  } catch {
    throw new FundingError('Enter a valid HTTPS link; social profiles must use that platform’s domain');
  }
}
function validDate(value) {
  const date = text(value, 10);
  if (
    date &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date)
  )
    throw new FundingError('Invalid checked date');
  return date;
}
function email(value) {
  const result = text(value, 254);
  if (result && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new FundingError('Invalid email address');
  return result;
}

export function createCompaniesService(db) {
  function list() {
    return db
      .prepare(
        `SELECT c.*, (SELECT max(announced_on) FROM funding_rounds f WHERE f.company_id=c.id) AS latest_funding_date,
      (SELECT group_concat(DISTINCT track) FROM company_jobs j WHERE j.company_id=c.id AND j.active=1 AND c.hiring_status='roles_found') AS hiring_tracks
      FROM companies c ORDER BY c.created_at DESC,c.id DESC LIMIT 500`,
      )
      .all();
  }
  function detail(id) {
    const company = db.prepare('SELECT * FROM companies WHERE id=?').get(id);
    if (!company) throw new FundingError('Company not found', 404);
    return {
      ...company,
      founders: db
        .prepare(
          'SELECT id,name,title,email,phone,profile_url,source_url FROM contacts WHERE company_id=? AND is_founder=1',
        )
        .all(id),
      jobs: db
        .prepare('SELECT id,title,track,url,evidence,checked_on FROM company_jobs WHERE company_id=? AND active=1')
        .all(id),
      funding: db.prepare('SELECT * FROM funding_rounds WHERE company_id=? ORDER BY announced_on DESC').all(id),
    };
  }
  function create(input) {
    const name = text(input.name, 150);
    if (!name) throw new FundingError('Enter a company name');
    const id = Number(db.prepare("INSERT INTO companies(name,country_code) VALUES(?,'US')").run(name).lastInsertRowid);
    return detail(id);
  }
  function save(id, input) {
    const existing = detail(id);
    const values = Object.fromEntries(strings.map(key => [key, text(input[key])]));
    if (!values.name || values.name.length > 150) throw new FundingError('Enter a company name (up to 150 characters)');
    for (const key of ['website', 'info_source_url', 'hiring_source_url']) values[key] = safeURL(values[key]);
    values.x_url = safeURL(values.x_url, ['x.com', 'twitter.com']);
    values.linkedin_url = safeURL(values.linkedin_url, ['linkedin.com']);
    for (const key of ['public_email', 'recruiting_email']) values[key] = email(values[key]);
    values.info_checked_on = validDate(values.info_checked_on);
    values.hiring_checked_on = validDate(values.hiring_checked_on);
    if (!['unknown', 'roles_found', 'no_relevant_roles'].includes(values.hiring_status))
      throw new FundingError('Choose a hiring status');
    if (values.hiring_status !== 'unknown' && (!values.hiring_source_url || !values.hiring_checked_on))
      throw new FundingError('A hiring status needs the official careers page and a checked date');
    if (
      !Array.isArray(input.founders) ||
      input.founders.length > 20 ||
      !Array.isArray(input.jobs) ||
      input.jobs.length > 50
    )
      throw new FundingError('Invalid founder or job list');
    const founders = input.founders.map(row => {
      const name = text(row.name, 150);
      const profile = safeURL(row.profile_url, ['linkedin.com']);
      const source = safeURL(row.source_url);
      const mail = email(row.email);
      const phone = text(row.phone, 100);
      if (!name) throw new FundingError('Founder name is required');
      if ((mail || phone) && !source) throw new FundingError('A founder’s public email or phone needs a source link');
      if (row.id && !existing.founders.some(founder => founder.id === row.id))
        throw new FundingError('That founder record belongs to another company');
      return {
        ...row,
        name,
        profile_url: profile,
        source_url: source,
        email: mail,
        phone,
        title: text(row.title, 150),
      };
    });
    const jobs = input.jobs.map(row => {
      const title = text(row.title, 200);
      const url = safeURL(row.url);
      const evidence = text(row.evidence, 2000);
      const checked = validDate(row.checked_on);
      if (!title || !['PM', 'GTM', 'Data'].includes(row.track) || !url || !evidence || !checked)
        throw new FundingError(
          'Each role needs a title, a PM/GTM/Data track, an official job link, quoted evidence and a checked date',
        );
      return { title, url, evidence, checked_on: checked, track: row.track };
    });
    if (values.hiring_status === 'roles_found' && jobs.length === 0)
      throw new FundingError('Record at least one specific role when relevant roles were found');
    if (values.hiring_status !== 'roles_found' && jobs.length)
      throw new FundingError('Set the hiring status to “roles found” when roles are listed');
    const hasPublicDetails =
      values.public_email || values.public_phone || values.recruiting_email || values.recruiting_phone;
    if (hasPublicDetails && (!values.info_source_url || !values.info_checked_on))
      throw new FundingError('Company or recruiting contact details need a public source and a checked date');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`UPDATE companies SET ${strings.map(key => key + '=?').join(',')} WHERE id=?`).run(
        ...strings.map(key => values[key]),
        id,
      );
      db.prepare('UPDATE contacts SET is_founder=0 WHERE company_id=? AND is_founder=1').run(id);
      for (const founder of founders) {
        if (founder.id)
          db.prepare(
            'UPDATE contacts SET name=?,title=?,email=?,phone=?,profile_url=?,source_url=?,is_founder=1 WHERE id=? AND company_id=?',
          ).run(
            founder.name,
            founder.title,
            founder.email || null,
            founder.phone,
            founder.profile_url,
            founder.source_url,
            founder.id,
            id,
          );
        else
          db.prepare(
            'INSERT INTO contacts(company_id,name,title,email,phone,profile_url,source_url,is_founder) VALUES(?,?,?,?,?,?,?,1)',
          ).run(
            id,
            founder.name,
            founder.title,
            founder.email || null,
            founder.phone,
            founder.profile_url,
            founder.source_url,
          );
      }
      db.prepare('UPDATE company_jobs SET active=0 WHERE company_id=?').run(id);
      for (const job of jobs)
        db.prepare(
          `INSERT INTO company_jobs(company_id,title,track,url,evidence,checked_on,active) VALUES(?,?,?,?,?,?,1) ON CONFLICT(company_id,url,title) DO UPDATE SET track=excluded.track,evidence=excluded.evidence,checked_on=excluded.checked_on,active=1`,
        ).run(id, job.title, job.track, job.url, job.evidence, job.checked_on);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      if (error.code?.includes('SQLITE')) throw new FundingError('Duplicate contact or role; check the input');
      throw error;
    }
    return detail(id);
  }
  return { list, detail, create, save };
}
