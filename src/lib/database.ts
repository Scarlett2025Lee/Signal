export interface DashboardStats {
  companies: number;
  funding_rounds: number;
  contacts: number;
  active_outreach: number;
  due_follow_ups: number;
}

export function hasLocalServer(): boolean {
  return window.location.protocol !== 'file:';
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const response = await fetch('/api/dashboard', { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('Unable to read the local database');
  const value: unknown = await response.json();
  const keys = ['companies', 'funding_rounds', 'contacts', 'active_outreach', 'due_follow_ups'] as const;
  if (!value || typeof value !== 'object' || !keys.every(key => key in value && Number.isSafeInteger((value as DashboardStats)[key]) && (value as DashboardStats)[key] >= 0)) {
    throw new Error('Invalid database response');
  }
  return value as DashboardStats;
}
