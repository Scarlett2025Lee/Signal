export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed. Please try again.');
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
export interface Contact {
  id: number;
  company_id: number;
  company_name: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  profile_url: string | null;
  source_url: string | null;
  notes: string;
  is_founder: number;
  outreach_count: number;
}
export type OutreachStatus =
  | 'research'
  | 'ready'
  | 'contacted'
  | 'in_conversation'
  | 'interviewing'
  | 'offer'
  | 'closed';
export interface Outreach {
  id: number;
  company_id: number;
  company_name: string;
  website: string | null;
  contact_id: number | null;
  contact_name: string | null;
  contact_email: string | null;
  role_title: string | null;
  role_url: string | null;
  status: OutreachStatus;
  last_contacted_at: string | null;
  notes: string;
  created_at: string;
  next_follow_up: string | null;
}
export interface FollowUp {
  id: number;
  outreach_id: number;
  due_at: string;
  status: 'pending' | 'completed' | 'dismissed';
  completed_at: string | null;
  notes: string;
  company_id: number;
  company_name: string;
  role_title: string | null;
  outreach_status: OutreachStatus;
  contact_name: string | null;
  contact_email: string | null;
}
export const outreachStatusLabels: Record<OutreachStatus, string> = {
  research: 'Research',
  ready: 'Ready to reach out',
  contacted: 'Contacted',
  in_conversation: 'In conversation',
  interviewing: 'Interviewing',
  offer: 'Offer',
  closed: 'Closed',
};
export const outreachStatuses = Object.keys(outreachStatusLabels) as OutreachStatus[];
/** Today's date in the browser's time zone, as YYYY-MM-DD. */
export const localToday = () => new Date().toLocaleDateString('en-CA');
export const addDays = (date: string, days: number) => {
  const value = new Date(date + 'T12:00:00Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
export const roundLabels: Record<string, string> = {
  pre_seed: 'Pre-seed',
  seed: 'Seed',
  series_a: 'Series A',
  series_b: 'Series B',
};
