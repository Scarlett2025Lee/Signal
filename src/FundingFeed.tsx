import { useCallback, useEffect, useState } from 'react';
import { Download, ExternalLink, RefreshCw, Building2 } from 'lucide-react';
import { api, roundLabels, type FundingState, type FundingArticle, type Company } from './lib/api';
import { hasLocalServer } from './lib/database';

function SourceLink({ url, label }: { url?: string | null; label: string }) {
  return url ? (
    <a className="text-link" href={url} target="_blank" rel="noreferrer">
      {label}
      <ExternalLink size={13} />
    </a>
  ) : (
    <span className="missing-value">{label}: not found on the checked public pages</span>
  );
}
function CompanyCard({ article }: { article: FundingArticle }) {
  const c = article.company as Company;
  const missing = 'Not found on the checked public pages';
  return (
    <article className="panel result-company">
      <div className="panel-title">
        <div>
          <div className="eyebrow">
            {article.sector}
            {article.country_code === 'US' ? ' · United States' : ''}
          </div>
          <h2>{article.company_name}</h2>
        </div>
        <span className="sector-tag">{roundLabels[article.round_type || ''] || article.round_type}</span>
      </div>
      <div className="funding-facts">
        <strong>{article.amount_text || 'Amount not disclosed'}</strong>
        <span>
          Funding news published:
          {article.announced_on ||
            new Date(article.published_at).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })}
        </span>
        <span>{c.headquarters || article.hq_location || '—'}</span>
      </div>
      <div className="company-links">
        <SourceLink url={c.website} label="Website" />
        <SourceLink url={c.x_url} label="Company X" />
        <SourceLink url={c.linkedin_url} label="Company LinkedIn" />
      </div>
      <div className="result-grid">
        <section>
          <h3>Business and location</h3>
          <p>{c.product_summary || missing}</p>
          <dl>
            <dt>Headquarters / base</dt>
            <dd>{c.headquarters || article.hq_location || '—'}</dd>
            <dt>Offices / public addresses</dt>
            <dd className="preserve-lines">{c.offices || missing}</dd>
            <dt>Public company email</dt>
            <dd>{c.public_email || missing}</dd>
            <dt>Public company phone</dt>
            <dd>{c.public_phone || missing}</dd>
          </dl>
        </section>
        <section>
          <h3>Founders</h3>
          {c.founders?.length ? (
            c.founders.map((f, i) => (
              <div className="founder-card" key={i}>
                <strong>{f.name}</strong>
                <span>{f.title}</span>
                <SourceLink url={f.profile_url} label="Founder LinkedIn" />
                <p>
                  Public email: {f.email || missing}
                  <br />
                  Public phone: {f.phone || missing}
                </p>
                <SourceLink url={f.source_url} label="Source" />
              </div>
            ))
          ) : (
            <p>No citable founder information found on the checked public pages.</p>
          )}
        </section>
        <section>
          <h3>PM / GTM / Data hiring</h3>
          <p>
            {c.jobs?.length
              ? 'The public careers pages list these matching roles:'
              : 'No clear PM, GTM or Data roles were found on the checked public pages.'}
          </p>
          {c.jobs?.map((job, i) => (
            <div className="job-card" key={i}>
              <span className="sector-tag">{job.track}</span>
              <SourceLink url={job.url} label={job.title} />
              <p>Page text: {job.evidence}</p>
              <small>Checked on: {job.checked_on}</small>
            </div>
          ))}
          <SourceLink url={c.hiring_source_url} label="Careers / website page checked" />
        </section>
        <section>
          <h3>Recruiting contacts</h3>
          <dl>
            <dt>Recruiting email</dt>
            <dd>{c.recruiting_email || missing}</dd>
            <dt>Recruiting phone</dt>
            <dd>{c.recruiting_phone || missing}</dd>
          </dl>
          <p className="scope-note">
            Only publicly posted contact details are shown. Roles are a hiring signal from current public pages, not a
            statement of company strategy.
          </p>
        </section>
      </div>
      <details className="result-evidence">
        <summary>Funding and location evidence · {c.info_checked_on}</summary>
        <p>{article.title}</p>
        <SourceLink url={article.source_url} label={article.source_name + ' · funding article'} />
        {article.hq_evidence?.map((e, i) => (
          <div key={i}>
            <p>{e.quote}</p>
            <SourceLink url={e.url} label="Location evidence" />
          </div>
        ))}
      </details>
    </article>
  );
}

export default function FundingFeed() {
  const available = hasLocalServer();
  const [data, setData] = useState<FundingState | null>(null);
  const [report, setReport] = useState('');
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [search, setSearch] = useState('');
  const [sector, setSector] = useState('all');
  const load = useCallback(async () => {
    if (!available) return;
    try {
      setData(await api<FundingState>('/api/funding' + (report ? '?report=' + report : '')));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [available, report]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [load]);
  async function generate() {
    setStarting(true);
    setError('');
    setReport('');
    try {
      await api('/api/funding/generate', 'POST', {});
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  }
  async function toggle() {
    try {
      setData(await api<FundingState>('/api/funding/schedule', 'PUT', { enabled: !data?.schedule.enabled }));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const results = (data?.articles || []).filter(a => a.company && a.review_status === 'approved');
  const filtered = results.filter(
    a =>
      (sector === 'all' || a.sector?.includes(sector)) &&
      (a.company_name + ' ' + a.company?.product_summary).toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">DISCOVER · RESEARCHED COMPANIES</div>
          <h1>Companies</h1>
          <p>Last 7 days · United States · AI / Fintech · Pre-seed to Series B</p>
        </div>
        <button
          className="primary-button no-top"
          disabled={!available || starting || data?.running}
          onClick={() => void generate()}
        >
          <RefreshCw size={16} />
          {starting || data?.running ? 'Searching and researching companies…' : 'Generate this week’s list'}
        </button>
      </div>
      <div className="runtime-notice">
        <Building2 size={16} />
        <span>
          A company is included on four conditions only: new funding in the last 7 days, a US company, AI or Fintech,
          and Pre-seed to Series B. Headquarters, social links, contacts and hiring are shown for reference; missing
          details never exclude a company.
        </span>
      </div>
      {!available && (
        <p className="runtime-notice notice-error">
          The offline preview cannot search for companies. Start the local website.
        </p>
      )}
      {error && (
        <p role="alert" className="runtime-notice notice-error">
          {error}
          <button onClick={() => void load()}>Retry</button>
        </p>
      )}
      <div className="feed-controls panel">
        <label className="checkbox-label">
          <input type="checkbox" checked={!!data?.schedule.enabled} disabled={!data} onChange={() => void toggle()} />
          Generate weekly
        </label>
        <span>
          Checked automatically while the website runs; a missed week runs at next start. All results appear here.
        </span>
      </div>
      {data?.running && (
        <div className="runtime-notice" role="status">
          Reading articles and public company pages
          {data.progress?.total ? ` (${data.progress.completed}/${data.progress.total})` : ''}. Companies appear when it
          finishes.
        </div>
      )}
      <div className="feed-toolbar">
        <label>
          Search results
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Name or business keyword" />
        </label>
        <label>
          Weekly report
          <select value={report} onChange={e => setReport(e.target.value)}>
            <option value="">Latest</option>
            {data?.reports.map(r => (
              <option key={r.id} value={r.id}>
                {r.window_start} — {r.window_end}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sector
          <select value={sector} onChange={e => setSector(e.target.value)}>
            <option value="all">AI + Fintech</option>
            <option>AI</option>
            <option>Fintech</option>
          </select>
        </label>
        {data?.report && (
          <a className="secondary-button export-link" href={`/api/funding/export?report=${data.report.id}`} download>
            <Download size={15} />
            Export report
          </a>
        )}
      </div>
      <div className="result-count">
        {data?.running
          ? 'Research in progress; results not published yet'
          : `${filtered.length} eligible ${filtered.length === 1 ? 'company' : 'companies'}`}
        {data?.report && (
          <span>
            {' '}
            · {data.report.window_start} — {data.report.window_end} (US Eastern time)
          </span>
        )}
      </div>
      {data?.report && data.report.status !== 'complete' && (
        <details className="panel source-panel">
          <summary>
            {data.report.status === 'failed'
              ? 'Sources could not be reached; see details'
              : 'Some sources had limited coverage; this list is not the whole market'}
          </summary>
          {data.report.sources.map(s => (
            <div key={s.name}>
              <strong>{s.name}</strong>
              <span>{s.error || (s.covered ? 'Read the full date range' : 'Did not cover the full date range')}</span>
            </div>
          ))}
        </details>
      )}
      {data?.diagnostics && !data.running && (
        <details className="panel source-panel">
          <summary>
            Search details: {data.diagnostics.read} articles read → {data.diagnostics.candidates} funding leads →{' '}
            {data.diagnostics.included} included (not filtered by hiring status)
          </summary>
          <a
            className="text-link"
            href={`/api/funding/diagnostics${data.report ? '?report=' + data.report.id : ''}`}
            download
          >
            Download search diagnostics (for troubleshooting)
          </a>
          {data.diagnostics.reasons.map((r, i) => (
            <div key={i}>
              <strong>{r.count}</strong>
              <span>{r.reason}</span>
            </div>
          ))}
        </details>
      )}
      <div className="funding-list">
        {filtered.map(a => (
          <CompanyCard key={a.id} article={a} />
        ))}
      </div>
      {!filtered.length && (
        <div className="panel empty-feed">
          <Building2 size={30} />
          <h2>
            {data?.running
              ? 'Finishing background research'
              : data?.report?.status === 'failed'
                ? 'Public sources are unavailable right now'
                : 'No company meets every condition yet'}
          </h2>
          <p>
            {data?.running
              ? 'Funding, headquarters, website, founder and hiring details are researched in the background and shown when ready.'
              : 'Click “Generate this week’s list” to search. Complete company profiles appear here when research finishes.'}
          </p>
        </div>
      )}
    </>
  );
}
