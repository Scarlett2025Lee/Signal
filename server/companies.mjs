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
  if (typeof value !== 'string' || value.length > max) throw new FundingError('资料字段格式无效或过长');
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
    throw new FundingError('请填写有效的 HTTPS 链接；社交资料须使用对应平台链接');
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
    throw new FundingError('核查日期格式无效');
  return date;
}
function email(value) {
  const result = text(value, 254);
  if (result && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new FundingError('邮箱格式无效');
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
    if (!company) throw new FundingError('未找到该公司', 404);
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
    if (!name) throw new FundingError('请输入公司名称');
    const id = Number(db.prepare("INSERT INTO companies(name,country_code) VALUES(?,'US')").run(name).lastInsertRowid);
    return detail(id);
  }
  function save(id, input) {
    const existing = detail(id);
    const values = Object.fromEntries(strings.map(key => [key, text(input[key])]));
    if (!values.name || values.name.length > 150) throw new FundingError('请填写公司名称（最多 150 字符）');
    for (const key of ['website', 'info_source_url', 'hiring_source_url']) values[key] = safeURL(values[key]);
    values.x_url = safeURL(values.x_url, ['x.com', 'twitter.com']);
    values.linkedin_url = safeURL(values.linkedin_url, ['linkedin.com']);
    for (const key of ['public_email', 'recruiting_email']) values[key] = email(values[key]);
    values.info_checked_on = validDate(values.info_checked_on);
    values.hiring_checked_on = validDate(values.hiring_checked_on);
    if (!['unknown', 'roles_found', 'no_relevant_roles'].includes(values.hiring_status))
      throw new FundingError('请选择招聘核查状态');
    if (values.hiring_status !== 'unknown' && (!values.hiring_source_url || !values.hiring_checked_on))
      throw new FundingError('判断招聘状态需要官网/官网链接的招聘页以及核查日期');
    if (
      !Array.isArray(input.founders) ||
      input.founders.length > 20 ||
      !Array.isArray(input.jobs) ||
      input.jobs.length > 50
    )
      throw new FundingError('创始人或招聘岗位列表无效');
    const founders = input.founders.map(row => {
      const name = text(row.name, 150);
      const profile = safeURL(row.profile_url, ['linkedin.com']);
      const source = safeURL(row.source_url);
      const mail = email(row.email);
      const phone = text(row.phone, 100);
      if (!name) throw new FundingError('创始人姓名不能为空');
      if ((mail || phone) && !source) throw new FundingError('创始人公开邮箱/电话需要来源链接');
      if (row.id && !existing.founders.some(founder => founder.id === row.id))
        throw new FundingError('创始人记录不属于该公司');
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
        throw new FundingError('岗位需要名称、PM/GTM/Data 方向、官网岗位链接、原文依据和核查日期');
      return { title, url, evidence, checked_on: checked, track: row.track };
    });
    if (values.hiring_status === 'roles_found' && jobs.length === 0)
      throw new FundingError('发现相关招聘时请至少记录一个明确岗位');
    if (values.hiring_status !== 'roles_found' && jobs.length)
      throw new FundingError('有岗位时请将招聘状态设为“有明确相关岗位”');
    const hasPublicDetails =
      values.public_email || values.public_phone || values.recruiting_email || values.recruiting_phone;
    if (hasPublicDetails && (!values.info_source_url || !values.info_checked_on))
      throw new FundingError('公司/招聘联系方式需要公开来源及核查日期');
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
      if (error.code?.includes('SQLITE')) throw new FundingError('联系方式或岗位重复，请检查输入');
      throw error;
    }
    return detail(id);
  }
  return { list, detail, create, save };
}
