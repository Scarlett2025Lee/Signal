import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { locationFromText } from './location-research.mjs';

// Order matters for tests: indexes 0-2 are the original sources.
// A source marked `disabled` stays documented but is not fetched by default.
export const SOURCES = [
  // FinSMEs answers automated RSS readers with HTTP 403; Signal respects that block.
  {
    id: 'finsmes',
    name: 'FinSMEs',
    url: 'https://www.finsmes.com/feed',
    pages: 6,
    hosts: ['finsmes.com', 'www.finsmes.com'],
    disabled: true,
  },
  {
    id: 'fintechglobal',
    name: 'FinTech Global',
    url: 'https://fintech.global/feed/',
    pages: 4,
    hosts: ['fintech.global', 'www.fintech.global'],
    sectorHint: 'Fintech',
  },
  { id: 'techeu', name: 'Tech.eu', url: 'https://tech.eu/feed/', pages: 3, hosts: ['tech.eu', 'www.tech.eu'] },
  // US-focused feeds, checked reachable with Signal's own User-Agent on 2026-11-07.
  {
    id: 'alleywatch',
    name: 'AlleyWatch',
    url: 'https://www.alleywatch.com/feed/',
    pages: 4,
    hosts: ['alleywatch.com', 'www.alleywatch.com'],
  },
  {
    id: 'geekwire',
    name: 'GeekWire',
    url: 'https://www.geekwire.com/feed/',
    pages: 2,
    hosts: ['geekwire.com', 'www.geekwire.com'],
  },
  {
    id: 'crunchbase',
    name: 'Crunchbase News',
    url: 'https://news.crunchbase.com/feed/',
    pages: 4,
    hosts: ['news.crunchbase.com'],
  },
  {
    id: 'techcrunch',
    name: 'TechCrunch Fundraising',
    url: 'https://techcrunch.com/category/fundraising/feed/',
    pages: 2,
    hosts: ['techcrunch.com'],
  },
  // Press-release feed: no pagination, so one page (about a day) is read per run.
  {
    id: 'prnewswire',
    name: 'PR Newswire VC',
    url: 'https://www.prnewswire.com/rss/financial-services-latest-news/venture-capital-list.rss',
    pages: 1,
    hosts: ['www.prnewswire.com', 'prnewswire.com'],
  },
];
export const ACTIVE_SOURCES = SOURCES.filter(source => !source.disabled);
const array = value => (value === undefined ? [] : Array.isArray(value) ? value : [value]);
const string = value => (typeof value === 'string' ? value : (value?.['#text'] ?? ''));

export function plainText(value) {
  return string(value)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, (whole, decimal, hex, named) => {
      if (decimal || hex) {
        const n = parseInt(decimal || hex, decimal ? 10 : 16);
        return n <= 0x10ffff ? String.fromCodePoint(n) : '';
      }
      return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[named.toLowerCase()] ?? whole;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

export function canonicalURL(raw, source) {
  try {
    const url = new URL(raw);
    if (
      url.protocol !== 'https:' ||
      !source.hosts.includes(url.hostname) ||
      url.username ||
      url.password ||
      (url.port && url.port !== '443')
    )
      return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(key)) url.searchParams.delete(key);
    return url.href;
  } catch {
    return null;
  }
}

export function parseFeed(xml, source) {
  if (/<!DOCTYPE/i.test(xml) || XMLValidator.validate(xml) !== true)
    throw new Error('Invalid or unsupported RSS/Atom response');
  const parsed = new XMLParser({ ignoreAttributes: false, parseTagValue: false }).parse(xml);
  const entries = parsed.rss?.channel?.item ?? parsed.feed?.entry;
  if (entries === undefined && !parsed.rss?.channel && !parsed.feed) throw new Error('Response is not RSS or Atom');
  return array(entries).flatMap(item => {
    const link =
      typeof item.link === 'string'
        ? item.link
        : array(item.link).find(link => !link['@_rel'] || link['@_rel'] === 'alternate')?.['@_href'];
    const url = canonicalURL(link, source);
    const date = new Date(string(item.pubDate ?? item.published ?? item.updated ?? item['dc:date']));
    if (!url || !Number.isFinite(date.getTime())) return [];
    return [
      {
        source_url: url,
        source_name: source.name,
        title: plainText(item.title).slice(0, 500),
        summary: plainText(item['content:encoded'] ?? item.content ?? item.description ?? item.summary).slice(0, 16000),
        published_at: date.toISOString(),
      },
    ];
  });
}

async function boundedText(response) {
  if (!response.body) throw new Error('Empty response');
  let total = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > 2_000_000) throw new Error('Feed exceeds 2 MB limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function fetchFeedPage(source, page, fetcher = fetch, stopSignal) {
  let url = new URL(source.url);
  url.searchParams.set('paged', String(page));
  for (let redirects = 0; redirects < 4; redirects++) {
    const signal = stopSignal ? AbortSignal.any([stopSignal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000);
    const response = await fetcher(url, {
      redirect: 'manual',
      signal,
      headers: {
        'User-Agent': 'SignalFundingReader/0.2 (personal RSS reader)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
      },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const target = new URL(response.headers.get('location'), url);
      const safe = canonicalURL(target.href, source);
      if (!safe) throw new Error('Feed redirected outside its configured HTTPS host');
      url = new URL(safe);
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parseFeed(await boundedText(response), source);
  }
  throw new Error('Too many feed redirects');
}

export function easternDay(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(date));
}

export function reportingWindow(now = new Date()) {
  const end = easternDay(now);
  const start = new Date(end + 'T12:00:00Z');
  start.setUTCDate(start.getUTCDate() - 6);
  return { start: start.toISOString().slice(0, 10), end, asOf: now.toISOString() };
}

// "/C O R R E C T I O N - Shackleton AI/" republishes a release about the named company.
const CORRECTION = /^\/?\s*C\s?O\s?R\s?R\s?E\s?C\s?T\s?I\s?O\s?N\s*[-–—]+\s*(.+?)\s*\/?\s*$/i;
// Multi-company roundups, market statistics and investor-side announcements are not one company's round.
const NOT_A_COMPANY_ROUND =
  /\b(?:funding report|funding roundup|funding recap|biggest (?:funding )?rounds|sector snapshot|week in review|this week in|funding (?:soars|surges|slows|climbs|falls|drops)|investment surged|most venture capital|announces? (?:an? )?(?:\w+\s+)?investment in|invests in|leads? (?:\w+\s+){0,3}(?:round|investment) (?:in|for))\b/i;
const ACQUISITION = /\b(?:to (?:buy|acquire)|acquir(?:es?|ed|ing)|buys|merges? with|merger)\b/i;

/** The subject of "Name has raised ..." in the lead, if those words also appear in the headline. */
function leadSubject(lead, title) {
  const match = lead.match(/((?:[A-Z][\w.&'’-]*\s+){1,4})(?:has\s+|have\s+)?(?:raised|secured|closed|landed)\b/);
  if (!match) return '';
  const tokens = match[1].trim().split(/\s+/);
  for (let k = tokens.length; k >= 1; k--) {
    const candidate = tokens
      .slice(-k)
      .join(' ')
      .replace(/[,'’]+$/, '');
    if (
      candidate.length > 1 &&
      new RegExp(
        `(?:^|[^\\p{L}\\p{N}])${candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^\\p{L}\\p{N}])`,
        'u',
      ).test(title)
    )
      return candidate;
  }
  return '';
}

export function classifyArticle(article, source) {
  const correction = article.title.match(CORRECTION);
  // Drop "Exclusive:"-style labels so they are not read as part of the company name.
  const title = (correction ? correction[1] : article.title).replace(
    /^(?:exclusive|scoop|breaking|report)\s*:\s*/i,
    '',
  );
  const text = title + '. ' + article.summary;
  const fundingEvent =
    /\b(?:raises?|raised|secures?|secured|closes?|closed|lands?|receives?|completes?|announces?)\s+(?:(?:a|an|its|new|over|approximately|more than|another|additional|about|of)\s+){0,4}(?:(?:US\$|USD|EUR|GBP|\$|€|£)\s*[\d.]|[\d.]+\s*(?:million|billion)|pre[- ]?seed|seed|series\s+[a-z]|(?:strategic\s+)?(?:funding|financing|investment|venture)\b)/i;
  // Headlines can describe the use of proceeds; the lead still states the funding event.
  const lead = article.summary.slice(0, 1000);
  if (!fundingEvent.test(title) && !fundingEvent.test(lead)) return null;
  if (NOT_A_COMPANY_ROUND.test(title) || ACQUISITION.test(title)) return null;
  // A VC fund raising money is not a portfolio company's financing round.
  if (
    /\b(?:first|second|third|fourth|new|next|[IVX]+)\s+(?:[\w-]+\s+){0,3}fund\b|\bfund\s+(?:[IVX]+|\d+)\b/i.test(title)
  )
    return null;
  if (
    /\b(series\s+[c-z]|ipo|acqui(?:res?|red|sition)|debt[- ]only|debt financ(?:ing|e)|debt funding|credit facility|fund\s+[IVX]+|venture fund)\b/i.test(
      title,
    )
  )
    return null;
  const ai = /\b(AI|artificial intelligence|machine learning|generative AI|agentic)\b/i.test(text);
  const fintech =
    /\b(fintech|fin tech|payments?|wealthtech|insurtech|banking|lending|financial infrastructure|financial technology|credit underwriting|ledger|reconciliation)\b/i.test(
      text,
    );
  if (!ai && !fintech) return null;
  const fromTitle = correction
    ? title.trim()
    : (
        title.match(
          /^(.+?)\s+(?:Raises?|Raised|Secures?|Secured|Closes?|Closed|Lands?|Bags?|Receives?|Completes?|Announces?|Targets?|Hits?)\b/i,
        )?.[1] ?? ''
      )
        .replace(/\s*[,–—:]\s*$/, '')
        .trim();
  // Headlines such as "Nurx And Journey Clinical Co-Founders Raise $6M For ... Siggy" name people, not the company.
  const fromLead = leadSubject(lead, title);
  const company = (
    fromLead && fromLead !== fromTitle && (!fromTitle || fromTitle.split(/\s+/).length > 3) ? fromLead : fromTitle
  ).slice(0, 150);
  const stageText = /\b(?:pre[- ]?seed|seed|series\s+[a-z]\d*)\b/i.test(title) ? title : lead;
  const stageMatch = stageText.match(/\b(pre[-–— ]?seed|seed|series\s+[a-z]\d*)\b/i);
  const stage = stageMatch
    ? { preseed: 'pre_seed', seed: 'seed', seriesa: 'series_a', seriesb: 'series_b' }[
        stageMatch[1].toLowerCase().replace(/[-–—\s\d]/g, '')
      ] || null
    : null;
  const opening = article.summary.slice(0, 1000);
  const geography = locationFromText(article.summary, company || title);
  const american = geography.kind === 'us' || geography.country_code === 'US';
  if (geography.kind === 'foreign') return null;
  if (/\bseries\s+[c-z]\b/i.test(opening) || /\b(?:debt financing|debt funding|credit facility)\b/i.test(opening))
    return null;
  const notes = ['后台公开来源研究'];
  if (!company) notes.push('未可靠提取公司名称');
  if (!american) notes.push('来源尚未说明公司所属国家');
  if (!stage) notes.push('融资阶段待核实');
  const name = company || title;
  return {
    ...article,
    company_name: name,
    company_key: name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''),
    sector: ai && fintech ? 'AI + Fintech' : ai ? 'AI' : 'Fintech',
    country_code: american ? 'US' : null,
    hq_location: geography.location,
    location_kind: geography.kind,
    hq_evidence: geography.evidence.map(item => ({ ...item, url: article.source_url })),
    round_type: stage,
    amount_text:
      text.match(/(?:US\$|USD\s*|\$|€|£|EUR\s*|GBP\s*)\s*[\d,.]+\s*(?:billion|million|[MBK]\b)?/i)?.[0]?.trim() ?? '',
    extraction_notes: notes.join('；'),
  };
}
