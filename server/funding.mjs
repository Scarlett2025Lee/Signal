import {
  SOURCES,
  ACTIVE_SOURCES,
  fetchFeedPage,
  reportingWindow,
  easternDay,
  classifyArticle,
} from './funding-sources.mjs';
import { researchArticle } from './location-research.mjs';
import { researchCompany } from './company-research.mjs';

const DAY = 86400000;
// Bump when classification rules change: stored candidates are re-checked and a fresh run is triggered.
export const CLASSIFICATION_VERSION = 6;
// Candidates researched per run (four workers). Raised from 30 when US-focused sources were added.
export const MAX_RESEARCH = 60;
const stages = ['pre_seed', 'seed', 'series_a', 'series_b'];
const sectors = ['AI', 'Fintech', 'AI + Fintech'];
export class FundingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export async function researchCandidate(article, source, { signal, fetchPage, clock = () => new Date() } = {}) {
  let located = await researchArticle(article, source, { signal, fetchPage });
  const classified = classifyArticle({ ...located, summary: located.summary + '\n' + article.summary }, source);
  if (!classified)
    return {
      ...located,
      eligibility: 'excluded',
      research_error: 'Article does not meet the funding or location conditions',
    };
  located = {
    ...classified,
    ...located,
    round_type: classified.round_type,
    sector: classified.sector,
    amount_text: classified.amount_text,
  };
  if (located.location_kind === 'unknown' && classified.country_code === 'US')
    located = {
      ...located,
      location_kind: 'us',
      country_code: 'US',
      hq_location: classified.hq_location,
      hq_evidence: classified.hq_evidence,
    };
  if (located.location_kind === 'foreign')
    return { ...located, eligibility: 'excluded', research_error: 'Source states the company is not US-based' };
  if (located.country_code !== 'US')
    return {
      ...located,
      eligibility: 'research',
      research_error: ['No recognizable evidence of a US company', located.research_error].filter(Boolean).join('; '),
    };
  if (!located.round_type)
    return {
      ...located,
      eligibility: 'research',
      research_error: 'Funding stage could not be extracted, so it is not in the target-stage list',
    };
  const company = await researchCompany(located, { signal, clock, fetchPage });
  return {
    ...located,
    eligibility: company.complete ? 'included' : 'research',
    company_profile: company.profile,
    research_error: company.error || located.research_error,
  };
}
export function createFundingService(
  db,
  {
    sources = ACTIVE_SOURCES,
    fetchPage = fetchFeedPage,
    clock = () => new Date(),
    research = (article, source, signal) => researchCandidate(article, source, { signal, clock }),
  } = {},
) {
  let running = false;
  let timer;
  let active;
  let stopped = false;
  let controller;
  let progress = { completed: 0, total: 0 };
  const V = CLASSIFICATION_VERSION;
  if (db.prepare('SELECT COUNT(*) n FROM funding_articles WHERE classification_version<?').get(V).n)
    db.prepare('UPDATE funding_schedule SET last_success_at=NULL,last_attempt_at=NULL WHERE id=1').run();
  // Repair already-stored false positives without deleting user-confirmed records.
  for (const row of db
    .prepare("SELECT * FROM funding_articles WHERE classification_version<? AND review_status!='approved'")
    .all(V)) {
    const source = [...sources, ...SOURCES].find(s => s.name === row.source_name) || {
      sectorHint: row.source_name === 'FinTech Global' ? 'Fintech' : undefined,
    };
    const valid = classifyArticle(row, source);
    db.prepare('UPDATE funding_articles SET eligibility=?,classification_version=? WHERE id=?').run(
      valid ? 'research' : 'excluded',
      V,
      row.id,
    );
  }
  db.prepare(
    "UPDATE funding_articles SET classification_version=? WHERE review_status='approved' AND classification_version<?",
  ).run(V, V);

  function snapshot(reportId) {
    const schedule = db.prepare('SELECT * FROM funding_schedule WHERE id=1').get();
    const reports = db
      .prepare(
        'SELECT id,window_start,window_end,generated_at,status FROM funding_reports ORDER BY generated_at DESC LIMIT 26',
      )
      .all();
    const report = reportId
      ? db.prepare('SELECT * FROM funding_reports WHERE id=?').get(reportId)
      : db.prepare('SELECT * FROM funding_reports ORDER BY generated_at DESC LIMIT 1').get();
    const rows = report
      ? db
          .prepare(
            `SELECT a.* FROM funding_articles a JOIN report_articles r ON r.article_id=a.id WHERE r.report_id=? ORDER BY a.published_at DESC`,
          )
          .all(report.id)
      : [];
    const seen = new Set();
    const articles = rows
      .filter(
        a =>
          a.eligibility === 'included' &&
          a.review_status === 'approved' &&
          a.classification_version >= 2 &&
          a.researched_at,
      )
      .filter(a => {
        const key = a.company_id + ':' + a.funding_round_id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(a => ({ ...a, hq_evidence: JSON.parse(a.hq_evidence_json), company: detailCompany(a.company_id) }));
    const reasons = Object.entries(
      rows
        .filter(a => a.eligibility !== 'included' && a.researched_at === report?.generated_at)
        .reduce((map, a) => {
          const key = a.research_error || 'Funding, location or stage did not match, or evidence was unavailable';
          map[key] = (map[key] || 0) + 1;
          return map;
        }, {}),
    ).map(([reason, count]) => ({ reason, count }));
    const diagnostics = {
      read: report ? JSON.parse(report.sources_json).reduce((n, s) => n + (s.fetched || 0), 0) : 0,
      candidates: report ? JSON.parse(report.sources_json).reduce((n, s) => n + (s.candidates || 0), 0) : 0,
      included: articles.length,
      reasons,
    };
    return {
      running,
      progress,
      diagnostics,
      omitted: rows.filter(a => a.eligibility !== 'included').length,
      schedule: {
        ...schedule,
        next_due_at: schedule.last_success_at
          ? new Date(Date.parse(schedule.last_success_at) + 7 * DAY).toISOString()
          : null,
      },
      reports,
      report: report ? { ...report, sources: JSON.parse(report.sources_json), sources_json: undefined } : null,
      articles,
      window: reportingWindow(clock()),
    };
  }

  async function generateReport() {
    const now = clock();
    const window = reportingWindow(now);
    db.prepare('UPDATE funding_schedule SET last_attempt_at=? WHERE id=1').run(now.toISOString());
    const results = await Promise.all(
      sources.map(async source => {
        const found = new Map();
        let covered = false;
        let pages = 0;
        let ok = false;
        let error = null;
        try {
          for (let page = 1; page <= source.pages; page++) {
            if (stopped) break;
            const entries = await fetchPage(source, page, undefined, controller.signal);
            pages++;
            ok = true;
            let added = 0;
            for (const article of entries) {
              const day = easternDay(article.published_at);
              if (day < window.start) {
                covered = true;
                continue;
              }
              if (day > window.end || Date.parse(article.published_at) > now.getTime()) continue;
              if (!found.has(article.source_url)) {
                found.set(article.source_url, article);
                added++;
              }
            }
            if (covered || entries.length === 0 || (page > 1 && added === 0)) break;
          }
        } catch (exception) {
          error =
            exception.name === 'TimeoutError'
              ? 'Request timed out'
              : exception.message === 'fetch failed'
                ? 'Could not reach the source; check the network, proxy or the publisher’s access rules'
                : exception.message.slice(0, 200);
        }
        const candidates = [...found.values()].map(article => classifyArticle(article, source)).filter(Boolean);
        return { id: source.id, name: source.name, ok, covered, pages, fetched: found.size, candidates, error };
      }),
    );
    if (stopped) return;
    const jobs = results.flatMap(source => source.candidates.map(article => ({ source, article })));
    progress = { completed: 0, total: Math.min(jobs.length, MAX_RESEARCH) };
    const researched = [];
    let next = 0;
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        while (!stopped && next < progress.total) {
          const job = jobs[next++];
          try {
            const result = await research(job.article, job.source, controller.signal);
            const classified = classifyArticle(
              { ...result, summary: result.summary + '\n' + job.article.summary },
              job.source,
            );
            researched.push(
              classified
                ? { ...classified, ...result }
                : {
                    ...result,
                    eligibility: 'excluded',
                    research_error: 'Article does not meet the funding or location conditions',
                  },
            );
          } catch (error) {
            researched.push({
              ...job.article,
              eligibility: 'research',
              research_error: 'Research failed: ' + error.message,
            });
          } finally {
            progress.completed++;
          }
        }
      }),
    );
    if (stopped) return;
    const metadata = results.map(({ candidates, ...result }) => ({ ...result, candidates: candidates.length }));
    const status = results.every(r => !r.ok)
      ? 'failed'
      : results.every(r => r.ok && r.covered && !r.error) &&
          jobs.length <= progress.total &&
          !researched.some(a => a.eligibility === 'research')
        ? 'complete'
        : 'partial';
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(
        `INSERT INTO funding_reports(window_start,window_end,generated_at,status,sources_json) VALUES(?,?,?,?,?)
        ON CONFLICT(window_start,window_end) DO UPDATE SET generated_at=excluded.generated_at,status=excluded.status,sources_json=excluded.sources_json`,
      ).run(window.start, window.end, now.toISOString(), status, JSON.stringify(metadata));
      const report = db
        .prepare('SELECT id FROM funding_reports WHERE window_start=? AND window_end=?')
        .get(window.start, window.end);
      // Failed refreshes preserve previously retrieved articles instead of erasing them.
      const insert = db.prepare(
        `INSERT INTO funding_articles(source_url,source_name,title,summary,published_at,company_name,company_key,sector,country_code,round_type,amount_text,extraction_notes) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_url) DO NOTHING`,
      );
      for (const article of researched) {
        insert.run(
          article.source_url,
          article.source_name,
          article.title,
          article.summary,
          article.published_at,
          article.company_name,
          article.company_key,
          article.sector,
          article.country_code,
          article.round_type,
          article.amount_text,
          article.extraction_notes,
        );
        const { id } = db.prepare('SELECT id FROM funding_articles WHERE source_url=?').get(article.source_url);
        const prior = db.prepare('SELECT review_status FROM funding_articles WHERE id=?').get(id);
        if (prior.review_status !== 'rejected')
          db.prepare(
            `UPDATE funding_articles SET summary=?,eligibility=?,hq_location=?,hq_evidence_json=?,research_error=?,researched_at=?,company_website=?,classification_version=? WHERE id=?`,
          ).run(
            article.summary,
            article.eligibility || 'research',
            article.hq_location || '',
            JSON.stringify(article.hq_evidence || []),
            article.research_error || '',
            now.toISOString(),
            article.company_website || '',
            V,
            id,
          );
        // Unconfirmed rows take the latest extraction; confirmed rows stay tied to their saved company/round.
        if (prior.review_status === 'pending')
          db.prepare(
            'UPDATE funding_articles SET company_name=?,company_key=?,sector=?,country_code=?,round_type=?,amount_text=?,extraction_notes=? WHERE id=?',
          ).run(
            article.company_name,
            article.company_key,
            article.sector ?? null,
            article.country_code ?? null,
            article.round_type ?? null,
            article.amount_text ?? '',
            article.extraction_notes ?? '',
            id,
          );
        db.prepare('INSERT OR IGNORE INTO report_articles(report_id,article_id) VALUES(?,?)').run(report.id, id);
      }
      if (status !== 'failed')
        db.prepare('UPDATE funding_schedule SET last_success_at=? WHERE id=1').run(now.toISOString());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    // Each completed research result is committed atomically with its company/round.
    for (const article of researched.filter(a => a.eligibility === 'included' && a.company_profile)) {
      const row = db.prepare('SELECT * FROM funding_articles WHERE source_url=?').get(article.source_url);
      if (row.review_status === 'rejected') continue;
      if (row.review_status === 'approved') {
        db.exec('BEGIN IMMEDIATE');
        try {
          saveProfile(row.company_id, article.company_profile);
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          db.prepare("UPDATE funding_articles SET eligibility='research',research_error=? WHERE id=?").run(
            error.message,
            row.id,
          );
        }
        continue;
      }
      try {
        review(row.id, {
          action: 'approve',
          company_name: article.company_name,
          sector: article.sector,
          country_code: article.country_code || null,
          round_type: article.round_type,
          announced_on: easternDay(article.published_at),
          automatic: true,
          profile: article.company_profile,
        });
      } catch (error) {
        db.prepare("UPDATE funding_articles SET eligibility='research',research_error=? WHERE id=?").run(
          error.message,
          row.id,
        );
      }
    }
    return snapshot();
  }

  function generate() {
    if (stopped) throw new FundingError('The website is shutting down', 503);
    if (running) throw new FundingError('A report is already being generated; wait for it to finish', 409);
    running = true;
    controller = new AbortController();
    active = generateReport().finally(() => {
      running = false;
    });
    return active;
  }

  function review(id, input) {
    const article = db.prepare('SELECT * FROM funding_articles WHERE id=?').get(id);
    if (!article) throw new FundingError('Funding article not found', 404);
    if (article.review_status === 'approved')
      throw new FundingError('This record is already confirmed and saved; it cannot be changed again', 409);
    if (input.action === 'reject') {
      db.prepare("UPDATE funding_articles SET review_status='rejected',reviewed_at=? WHERE id=?").run(
        clock().toISOString(),
        id,
      );
      return;
    }
    const name = typeof input.company_name === 'string' ? input.company_name.trim() : '';
    const date = input.announced_on;
    if (
      input.action !== 'approve' ||
      !name ||
      name.length > 150 ||
      (!input.automatic && input.country_code !== 'US') ||
      !stages.includes(input.round_type) ||
      !sectors.includes(input.sector)
    )
      throw new FundingError(
        'Confirm the company name, US headquarters, AI/Fintech sector and a Pre-seed to Series B stage',
      );
    if (
      typeof date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date
    )
      throw new FundingError('Enter a valid funding announcement date from the article');
    const related = db
      .prepare('SELECT r.* FROM funding_reports r JOIN report_articles a ON a.report_id=r.id WHERE a.article_id=?')
      .all(id);
    if (!related.some(report => date >= report.window_start && date <= report.window_end))
      throw new FundingError('The announcement date is outside the 7-day window of every linked report');
    const key = name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    db.exec('BEGIN IMMEDIATE');
    try {
      let company = db
        .prepare(
          `SELECT c.id FROM companies c WHERE lower(c.name)=lower(?) OR c.id IN (SELECT company_id FROM funding_articles WHERE company_key=? AND company_id IS NOT NULL) LIMIT 1`,
        )
        .get(name, key);
      if (!company)
        company = {
          id: Number(
            db
              .prepare('INSERT INTO companies(name,sector,country_code,notes) VALUES(?,?,?,?)')
              .run(name, input.sector, input.country_code || null, `Funding source: ${article.source_url}`)
              .lastInsertRowid,
          ),
        };
      let round = db
        .prepare('SELECT id FROM funding_rounds WHERE company_id=? AND round_type=? AND announced_on=?')
        .get(company.id, input.round_type, date);
      if (!round)
        round = {
          id: Number(
            db
              .prepare(
                'INSERT INTO funding_rounds(company_id,round_type,announced_on,source_url,verified_at,notes) VALUES(?,?,?,?,?,?)',
              )
              .run(
                company.id,
                input.round_type,
                date,
                article.source_url,
                clock().toISOString(),
                `Checked by the user against the article; amount as stated: ${article.amount_text || 'not extracted'}; sector: ${input.sector}`,
              ).lastInsertRowid,
          ),
        };
      db.prepare(
        "UPDATE funding_articles SET company_name=?,company_key=?,sector=?,country_code=?,round_type=?,announced_on=?,review_status='approved',eligibility='included',company_id=?,funding_round_id=?,reviewed_at=? WHERE id=?",
      ).run(
        name,
        key,
        input.sector,
        input.country_code || null,
        input.round_type,
        date,
        company.id,
        round.id,
        clock().toISOString(),
        id,
      );
      if (input.automatic && input.profile) {
        saveProfile(company.id, input.profile);
        db.prepare('UPDATE funding_rounds SET notes=? WHERE id=?').run(
          `Matched automatically against public sources; funding news published ${date} (not a confirmed closing date); amount as stated: ${article.amount_text || 'not disclosed'}; headquarters evidence is in the article.`,
          round.id,
        );
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function saveProfile(id, profile) {
    const columns = [
      'website',
      'headquarters',
      'product_summary',
      'offices',
      'x_url',
      'linkedin_url',
      'public_email',
      'public_phone',
      'recruiting_email',
      'recruiting_phone',
      'info_source_url',
      'info_checked_on',
      'hiring_status',
      'hiring_source_url',
      'hiring_checked_on',
    ];
    for (const column of columns)
      if (profile[column]) db.prepare(`UPDATE companies SET ${column}=? WHERE id=?`).run(profile[column], id);
    db.prepare('UPDATE company_jobs SET active=0 WHERE company_id=?').run(id);
    for (const founder of profile.founders || []) {
      if (!db.prepare('SELECT id FROM contacts WHERE company_id=? AND name=? AND is_founder=1').get(id, founder.name))
        db.prepare(
          'INSERT INTO contacts(company_id,name,title,profile_url,email,phone,source_url,is_founder) VALUES(?,?,?,?,?,?,?,1)',
        ).run(
          id,
          founder.name,
          founder.title,
          founder.profile_url,
          founder.email || null,
          founder.phone,
          founder.source_url,
        );
    }
    for (const job of profile.jobs || [])
      db.prepare(
        `INSERT INTO company_jobs(company_id,title,track,url,evidence,checked_on) VALUES(?,?,?,?,?,?) ON CONFLICT(company_id,url,title) DO UPDATE SET evidence=excluded.evidence,checked_on=excluded.checked_on,active=1`,
      ).run(id, job.title, job.track, job.url, job.evidence, job.checked_on);
  }

  function detailCompany(id) {
    if (!id) return null;
    const company = db.prepare('SELECT * FROM companies WHERE id=?').get(id);
    if (!company) return null;
    return {
      ...company,
      founders: db
        .prepare(
          'SELECT name,title,profile_url,email,phone,source_url FROM contacts WHERE company_id=? AND is_founder=1',
        )
        .all(id),
      jobs: db
        .prepare('SELECT title,track,url,evidence,checked_on FROM company_jobs WHERE company_id=? AND active=1')
        .all(id),
    };
  }

  function markdown(reportId) {
    const state = snapshot(reportId);
    if (!state.report) throw new FundingError('There is no report to export yet', 404);
    const clean = value => String(value ?? '').replace(/[|\r\n]/g, ' ');
    const lines = [
      `# US AI / Fintech companies — weekly report`,
      '',
      `Dates: ${state.report.window_start} to ${state.report.window_end} (US Eastern time, including today)`,
      '',
      'Scope: United States; Pre-seed to Series B. Companies appear after the funding article, US evidence and public company pages are checked. Dates are when the funding news was published, not when funds closed. Amounts are as stated in the source.',
      '',
      `Retrieval status: ${state.report.status}. Public-web coverage is limited and does not represent the whole market.`,
      '',
      '| Company | Sector | Round | Amount (as stated) | News date | Source |',
      '|---|---|---|---|---|---|',
    ];
    const confirmed = state.articles.filter(
      a =>
        a.review_status === 'approved' &&
        a.announced_on >= state.report.window_start &&
        a.announced_on <= state.report.window_end,
    );
    const seen = new Set();
    for (const a of confirmed) {
      const key = `${a.company_id}:${a.funding_round_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(
        `| ${clean(a.company_name)} | ${clean(a.sector)} | ${a.round_type} | ${clean(a.amount_text || 'Not disclosed / not extracted')} | ${a.announced_on} | ${a.source_url} |`,
      );
    }
    if (!seen.size) lines.push('', 'No company met every condition with completed public-page research this time.');
    for (const a of confirmed) {
      const c = a.company;
      lines.push(
        '',
        `## ${clean(a.company_name)}`,
        '',
        `Business: ${clean(c.product_summary)}`,
        `Headquarters: ${clean(c.headquarters)}`,
        `Offices: ${clean(c.offices)}`,
        `Website: ${clean(c.website)}`,
        `X: ${clean(c.x_url) || 'not found on checked pages'}`,
        `LinkedIn: ${clean(c.linkedin_url) || 'not found on checked pages'}`,
        `Public email / phone: ${clean(c.public_email)} / ${clean(c.public_phone)}`,
        `Recruiting email / phone: ${clean(c.recruiting_email)} / ${clean(c.recruiting_phone)}`,
      );
      for (const f of c.founders)
        lines.push(
          `Founder: ${clean(f.name)}; LinkedIn: ${clean(f.profile_url)}; email / phone: ${clean(f.email)} / ${clean(f.phone)}`,
        );
      for (const j of c.jobs) lines.push(`Role: ${j.track} · ${clean(j.title)} · ${j.url}`);
    }
    lines.push('', '## Source checks', '');
    for (const source of state.report.sources)
      lines.push(
        `- ${source.name}: ${source.error || (source.covered ? 'paged back past the start of the window' : 'full 7-day coverage not confirmed')}; ${source.pages} page(s) read.`,
      );
    return lines.join('\n');
  }

  function setSchedule(enabled) {
    if (typeof enabled !== 'boolean') throw new FundingError('enabled must be true or false');
    db.prepare('UPDATE funding_schedule SET enabled=? WHERE id=1').run(enabled ? 1 : 0);
  }
  function diagnosticsExport(reportId) {
    const state = snapshot(reportId);
    const items = state.report
      ? db
          .prepare(
            `SELECT a.source_name,a.source_url,a.title,a.summary,a.published_at,a.company_name,a.country_code,a.round_type,a.hq_location,a.hq_evidence_json,a.research_error,a.eligibility,a.researched_at FROM funding_articles a JOIN report_articles r ON r.article_id=a.id WHERE r.report_id=?`,
          )
          .all(state.report.id)
      : [];
    return { version: '0.3.5', report: state.report, diagnostics: state.diagnostics, items };
  }
  function tick() {
    if (running || stopped) return;
    const row = db.prepare('SELECT * FROM funding_schedule WHERE id=1').get();
    const now = clock().getTime();
    if (!row.enabled || (row.last_attempt_at && now - Date.parse(row.last_attempt_at) < 6 * 3600000)) return;
    if (row.last_success_at && now - Date.parse(row.last_success_at) < 7 * DAY) return;
    generate().catch(error => console.error('Funding report failed:', error.message));
  }
  return {
    snapshot,
    generate,
    review,
    markdown,
    setSchedule,
    diagnosticsExport,
    start() {
      timer = setInterval(tick, 15 * 60000);
      timer.unref();
      tick();
    },
    async stop() {
      stopped = true;
      controller?.abort();
      clearInterval(timer);
      await active?.catch(() => {});
    },
  };
}
