export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败，请重试');
  return data as T;
}

export interface FundingArticle {
  company?: Company;
  hq_location?: string;
  hq_evidence?: { quote: string; url: string }[];
  id: number;
  company_name: string;
  company_key: string;
  source_url: string;
  source_name: string;
  title: string;
  summary: string;
  published_at: string;
  sector: string | null;
  country_code: string | null;
  round_type: string | null;
  amount_text: string;
  announced_on: string | null;
  extraction_notes: string;
  review_status: string;
  company_id: number | null;
  funding_round_id: number | null;
}
export interface FundingReport {
  id: number;
  window_start: string;
  window_end: string;
  generated_at: string;
  status: string;
  sources: { name: string; ok: boolean; covered: boolean; pages: number; candidates: number; error: string | null }[];
}
export interface FundingState {
  diagnostics?: { read: number; candidates: number; included: number; reasons: { reason: string; count: number }[] };
  progress?: { completed: number; total: number };
  omitted?: number;
  running: boolean;
  schedule: { enabled: number; next_due_at: string | null };
  reports: FundingReport[];
  report: FundingReport | null;
  articles: FundingArticle[];
  window: { start: string; end: string };
}
export interface Founder {
  id?: number;
  name: string;
  title: string;
  email: string;
  phone: string;
  profile_url: string;
  source_url: string;
}
export interface CompanyJob {
  title: string;
  track: string;
  url: string;
  evidence: string;
  checked_on: string;
}
export interface Company {
  id: number;
  name: string;
  website: string;
  sector: string;
  headquarters: string;
  product_summary: string;
  notes: string;
  x_url: string;
  linkedin_url: string;
  public_email: string;
  public_phone: string;
  recruiting_email: string;
  recruiting_phone: string;
  offices: string;
  info_source_url: string;
  info_checked_on: string;
  hiring_status: string;
  hiring_source_url: string;
  hiring_checked_on: string;
  latest_funding_date?: string;
  hiring_tracks?: string;
  founders: Founder[];
  jobs: CompanyJob[];
  funding?: { id: number; announced_on: string; round_type: string; source_url: string }[];
}
export const roundLabels: Record<string, string> = {
  pre_seed: 'Pre-seed',
  seed: 'Seed',
  series_a: 'Series A',
  series_b: 'Series B',
};
