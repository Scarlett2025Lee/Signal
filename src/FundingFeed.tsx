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
    <span className="missing-value">{label}：本次公开页面未取得</span>
  );
}
function CompanyCard({ article }: { article: FundingArticle }) {
  const c = article.company as Company;
  const missing = '本次公开页面未取得';
  return (
    <article className="panel result-company">
      <div className="panel-title">
        <div>
          <div className="eyebrow">
            {article.sector}
            {article.country_code === 'US' ? ' · 美国' : ''}
          </div>
          <h2>{article.company_name}</h2>
        </div>
        <span className="sector-tag">{roundLabels[article.round_type || ''] || article.round_type}</span>
      </div>
      <div className="funding-facts">
        <strong>{article.amount_text || '来源未披露金额'}</strong>
        <span>
          融资消息发布：
          {article.announced_on ||
            new Date(article.published_at).toLocaleDateString('en-CA', { timeZone: 'America/New_York' })}
        </span>
        <span>{c.headquarters || article.hq_location || '—'}</span>
      </div>
      <div className="company-links">
        <SourceLink url={c.website} label="官网" />
        <SourceLink url={c.x_url} label="公司 X" />
        <SourceLink url={c.linkedin_url} label="公司 LinkedIn" />
      </div>
      <div className="result-grid">
        <section>
          <h3>业务与地点</h3>
          <p>{c.product_summary || missing}</p>
          <dl>
            <dt>总部 / Base</dt>
            <dd>{c.headquarters || article.hq_location || '—'}</dd>
            <dt>办公室 / 公开地址</dt>
            <dd className="preserve-lines">{c.offices || missing}</dd>
            <dt>公司公开邮箱</dt>
            <dd>{c.public_email || missing}</dd>
            <dt>公司公开电话</dt>
            <dd>{c.public_phone || missing}</dd>
          </dl>
        </section>
        <section>
          <h3>创始人</h3>
          {c.founders?.length ? (
            c.founders.map((f, i) => (
              <div className="founder-card" key={i}>
                <strong>{f.name}</strong>
                <span>{f.title}</span>
                <SourceLink url={f.profile_url} label="创始人 LinkedIn" />
                <p>
                  公开邮箱：{f.email || missing}
                  <br />
                  公开电话：{f.phone || missing}
                </p>
                <SourceLink url={f.source_url} label="信息来源" />
              </div>
            ))
          ) : (
            <p>{missing}可引用的创始人信息。</p>
          )}
        </section>
        <section>
          <h3>PM / GTM / Data 招聘</h3>
          <p>
            {c.jobs?.length ? '公开招聘页匹配到以下明确岗位：' : '本次查询的公开页面未匹配到这三个方向的明确岗位。'}
          </p>
          {c.jobs?.map((job, i) => (
            <div className="job-card" key={i}>
              <span className="sector-tag">{job.track}</span>
              <SourceLink url={job.url} label={job.title} />
              <p>网页原文：{job.evidence}</p>
              <small>查询日期：{job.checked_on}</small>
            </div>
          ))}
          <SourceLink url={c.hiring_source_url} label="本次查询的招聘 / 官网页面" />
        </section>
        <section>
          <h3>招聘联系方式</h3>
          <dl>
            <dt>招聘邮箱</dt>
            <dd>{c.recruiting_email || missing}</dd>
            <dt>招聘电话</dt>
            <dd>{c.recruiting_phone || missing}</dd>
          </dl>
          <p className="scope-note">只展示公开联系方式；岗位是当前公开页面的招聘信号，不据此推断公司整体战略。</p>
        </section>
      </div>
      <details className="result-evidence">
        <summary>查看融资与地点依据 · {c.info_checked_on}</summary>
        <p>{article.title}</p>
        <SourceLink url={article.source_url} label={article.source_name + ' · 融资原文'} />
        {article.hq_evidence?.map((e, i) => (
          <div key={i}>
            <p>{e.quote}</p>
            <SourceLink url={e.url} label="地点依据" />
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
          <h1>company</h1>
          <p>过去 7 天 · 美国方向 · AI / Fintech · Pre-seed 至 Series B</p>
        </div>
        <button
          className="primary-button no-top"
          disabled={!available || starting || data?.running}
          onClick={() => void generate()}
        >
          <RefreshCw size={16} />
          {starting || data?.running ? '正在完成检索与公司研究…' : '生成本周公司名单'}
        </button>
      </div>
      <div className="runtime-notice">
        <Building2 size={16} />
        <span>
          入选只看四项：最近 7 天新融资、美国公司、AI 或 Fintech、Pre-seed 至 Series
          B。总部地址、社交链接、联系方式和招聘只作展示，缺失不影响入选。
        </span>
      </div>
      {!available && <p className="runtime-notice notice-error">离线预览无法检索公司，请运行本机网站。</p>}
      {error && (
        <p role="alert" className="runtime-notice notice-error">
          {error}
          <button onClick={() => void load()}>重试</button>
        </p>
      )}
      <div className="feed-controls panel">
        <label className="checkbox-label">
          <input type="checkbox" checked={!!data?.schedule.enabled} disabled={!data} onChange={() => void toggle()} />
          每周自动生成
        </label>
        <span>网站运行期间自动检查；关闭期间下次启动补跑。所有结果在这里集中展示。</span>
      </div>
      {data?.running && (
        <div className="runtime-notice" role="status">
          正在读取原文和公司公开页面
          {data.progress?.total ? `（${data.progress.completed}/${data.progress.total}）` : ''}，完成后自动显示公司。
        </div>
      )}
      <div className="feed-toolbar">
        <label>
          搜索结果
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="名称或业务关键词" />
        </label>
        <label>
          融资周报
          <select value={report} onChange={e => setReport(e.target.value)}>
            <option value="">最新一期</option>
            {data?.reports.map(r => (
              <option key={r.id} value={r.id}>
                {r.window_start} — {r.window_end}
              </option>
            ))}
          </select>
        </label>
        <label>
          行业
          <select value={sector} onChange={e => setSector(e.target.value)}>
            <option value="all">AI + Fintech</option>
            <option>AI</option>
            <option>Fintech</option>
          </select>
        </label>
        {data?.report && (
          <a className="secondary-button export-link" href={`/api/funding/export?report=${data.report.id}`} download>
            <Download size={15} />
            导出公司周报
          </a>
        )}
      </div>
      <div className="result-count">
        {data?.running ? '正在研究，结果尚未发布' : `${filtered.length} 家符合条件的公司`}
        {data?.report && (
          <span>
            {' '}
            · {data.report.window_start} — {data.report.window_end}（美国东部时间）
          </span>
        )}
      </div>
      {data?.report && data.report.status !== 'complete' && (
        <details className="panel source-panel">
          <summary>
            {data.report.status === 'failed' ? '来源连接失败，请查看详情' : '部分来源覆盖有限，当前名单不代表市场全量'}
          </summary>
          {data.report.sources.map(s => (
            <div key={s.name}>
              <strong>{s.name}</strong>
              <span>{s.error || (s.covered ? '已读取所需日期范围' : '未覆盖完整日期范围')}</span>
            </div>
          ))}
        </details>
      )}
      {data?.diagnostics && !data.running && (
        <details className="panel source-panel">
          <summary>
            检索明细：读取 {data.diagnostics.read} 条报道 → {data.diagnostics.candidates} 条融资线索 →{' '}
            {data.diagnostics.included} 家入选（不按招聘状态过滤）
          </summary>
          <a
            className="text-link"
            href={`/api/funding/diagnostics${data.report ? '?report=' + data.report.id : ''}`}
            download
          >
            下载检索诊断（供排查程序问题）
          </a>
          {data.diagnostics.reasons.map((r, i) => (
            <div key={i}>
              <strong>{r.count} 条</strong>
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
              ? '正在完成后台研究'
              : data?.report?.status === 'failed'
                ? '公开来源暂时不可用'
                : '本次尚无符合全部条件的公司'}
          </h2>
          <p>
            {data?.running
              ? '融资信息、总部、官网、创始人和招聘信息会在后台查询，完成后展示。'
              : '点击“生成本周公司名单”检索，后台完成后将在这里集中展示完整公司资料。'}
          </p>
        </div>
      )}
    </>
  );
}
