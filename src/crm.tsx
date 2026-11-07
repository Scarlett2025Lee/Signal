// Shared helpers for the Contacts, Outreach CRM and Follow-up pages.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api } from './lib/api';
import { hasLocalServer } from './lib/database';

export interface CompanyOption {
  id: number;
  name: string;
}

/** Load JSON from the local API, with an error message and a reload function. */
export function useResource<T>(path: string, initial: T) {
  const available = hasLocalServer();
  const [data, setData] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    if (!available) return;
    try {
      setData(await api<T>(path));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [available, path]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, loaded, error, setError, reload, available };
}

export function OfflineNotice() {
  return (
    <p className="runtime-notice notice-error">
      The offline preview cannot read or save records. Start the local website.
    </p>
  );
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  if (!message) return null;
  return (
    <p role="alert" className="runtime-notice notice-error">
      {message}
      {onRetry && <button onClick={onRetry}>Retry</button>}
    </p>
  );
}

const NEW = '__new';
/** A company picker that also allows typing a company that is not saved yet. */
export function CompanyField({
  companies,
  companyId,
  companyName,
  onChange,
}: {
  companies: CompanyOption[];
  companyId: string;
  companyName: string;
  onChange: (value: { companyId: string; companyName: string }) => void;
}) {
  return (
    <>
      <label>
        Company
        <select value={companyId} required onChange={e => onChange({ companyId: e.target.value, companyName: '' })}>
          <option value="">Choose a company…</option>
          {companies.map(c => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value={NEW}>+ New company</option>
        </select>
      </label>
      {companyId === NEW && (
        <label>
          New company name
          <input
            value={companyName}
            required
            maxLength={150}
            onChange={e => onChange({ companyId, companyName: e.target.value })}
          />
        </label>
      )}
    </>
  );
}
/** Body fields for the API: an existing company id, or a new company name. */
export const companyPayload = (companyId: string, companyName: string) =>
  companyId === NEW ? { company_name: companyName } : { company_id: Number(companyId) };
export const NEW_OPTION = NEW;

export function ExternalLink({ href, children }: { href: string | null; children: ReactNode }) {
  if (!href) return null;
  const url = /^https?:\/\//i.test(href) ? href : 'https://' + href;
  return (
    <a className="text-link" href={url} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}
