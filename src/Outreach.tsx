import { useMemo, useState, type FormEvent } from 'react';
import { Plus, Send, Trash2 } from 'lucide-react';
import {
  addDays,
  api,
  localToday,
  outreachStatusLabels,
  outreachStatuses,
  type Contact,
  type Outreach as OutreachRecord,
  type OutreachStatus,
} from './lib/api';
import {
  CompanyField,
  companyPayload,
  ErrorNotice,
  ExternalLink,
  NEW_OPTION,
  OfflineNotice,
  useResource,
  type CompanyOption,
} from './crm';

const emptyForm = {
  companyId: '',
  companyName: '',
  contactId: '',
  contactName: '',
  contactEmail: '',
  contactTitle: '',
  role: '',
  roleUrl: '',
  status: 'research' as OutreachStatus,
  notes: '',
};

function NewOutreachForm({
  companies,
  contacts,
  onSaved,
}: {
  companies: CompanyOption[];
  contacts: Contact[];
  onSaved: () => Promise<void>;
}) {
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<typeof emptyForm>) => setForm(current => ({ ...current, ...patch }));
  const companyContacts = contacts.filter(c => String(c.company_id) === form.companyId);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await api('/api/outreach', 'POST', {
        ...companyPayload(form.companyId, form.companyName),
        ...(form.contactId === NEW_OPTION
          ? { contact: { name: form.contactName, email: form.contactEmail, title: form.contactTitle } }
          : { contact_id: form.contactId ? Number(form.contactId) : null }),
        role_title: form.role,
        role_url: form.roleUrl,
        status: form.status,
        notes: form.notes,
      });
      setForm(emptyForm);
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <form className="panel crm-form" onSubmit={e => void submit(e)} aria-label="New outreach">
      <div className="panel-title">
        <h2>New outreach</h2>
      </div>
      <div className="form-grid">
        <CompanyField
          companies={companies}
          companyId={form.companyId}
          companyName={form.companyName}
          onChange={value => set({ ...value, contactId: '' })}
        />
        <label>
          Contact
          <select value={form.contactId} onChange={e => set({ contactId: e.target.value })} disabled={!form.companyId}>
            <option value="">No specific person</option>
            {companyContacts.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.email ? ` · ${c.email}` : ''}
              </option>
            ))}
            <option value={NEW_OPTION}>+ New contact</option>
          </select>
        </label>
        {form.contactId === NEW_OPTION && (
          <>
            <label>
              Contact name
              <input
                value={form.contactName}
                required
                maxLength={150}
                onChange={e => set({ contactName: e.target.value })}
              />
            </label>
            <label>
              Contact email
              <input type="email" value={form.contactEmail} onChange={e => set({ contactEmail: e.target.value })} />
            </label>
            <label>
              Contact title
              <input value={form.contactTitle} maxLength={150} onChange={e => set({ contactTitle: e.target.value })} />
            </label>
          </>
        )}
        <label>
          Role
          <input
            value={form.role}
            maxLength={200}
            placeholder="e.g. Product intern"
            onChange={e => set({ role: e.target.value })}
          />
        </label>
        <label>
          Role link
          <input
            type="url"
            value={form.roleUrl}
            placeholder="https://"
            onChange={e => set({ roleUrl: e.target.value })}
          />
        </label>
        <label>
          Status
          <select value={form.status} onChange={e => set({ status: e.target.value as OutreachStatus })}>
            {outreachStatuses.map(s => (
              <option key={s} value={s}>
                {outreachStatusLabels[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="span-two">
          Notes
          <textarea value={form.notes} rows={2} onChange={e => set({ notes: e.target.value })} />
        </label>
      </div>
      <ErrorNotice message={error} />
      <button className="primary-button no-top" disabled={saving}>
        <Plus size={16} />
        {saving ? 'Saving…' : 'Add outreach'}
      </button>
    </form>
  );
}

function OutreachRow({
  row,
  onChanged,
  onError,
}: {
  row: OutreachRecord;
  onChanged: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [notes, setNotes] = useState(row.notes);
  async function update(patch: Record<string, unknown>) {
    try {
      await api(`/api/outreach/${row.id}`, 'PUT', patch);
      await onChanged();
    } catch (e) {
      onError((e as Error).message);
    }
  }
  async function scheduleFollowUp() {
    try {
      await api('/api/follow-ups', 'POST', { outreach_id: row.id, due_at: addDays(localToday(), 3) });
      await onChanged();
    } catch (e) {
      onError((e as Error).message);
    }
  }
  async function remove() {
    if (!window.confirm(`Delete outreach to ${row.company_name}? Its follow-ups and drafts are deleted too.`)) return;
    try {
      await api(`/api/outreach/${row.id}`, 'DELETE', {});
      await onChanged();
    } catch (e) {
      onError((e as Error).message);
    }
  }
  const overdue = row.next_follow_up && row.next_follow_up <= localToday();
  return (
    <tr>
      <td>
        <strong>{row.company_name}</strong>
        <br />
        <ExternalLink href={row.website}>Website</ExternalLink>
      </td>
      <td>
        {row.contact_name || <span className="missing-value">No contact</span>}
        {row.contact_email && (
          <>
            <br />
            <a className="text-link" href={`mailto:${row.contact_email}`}>
              {row.contact_email}
            </a>
          </>
        )}
      </td>
      <td>
        {row.role_url ? (
          <ExternalLink href={row.role_url}>{row.role_title || 'Role link'}</ExternalLink>
        ) : (
          row.role_title || '—'
        )}
      </td>
      <td>
        <select
          aria-label={`Status for ${row.company_name}`}
          value={row.status}
          onChange={e => void update({ status: e.target.value })}
        >
          {outreachStatuses.map(s => (
            <option key={s} value={s}>
              {outreachStatusLabels[s]}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input
          type="date"
          aria-label={`Last contacted for ${row.company_name}`}
          value={row.last_contacted_at ?? ''}
          onChange={e => void update({ last_contacted_at: e.target.value })}
        />
      </td>
      <td>
        {row.next_follow_up ? (
          <span className={overdue ? 'due-tag overdue' : 'due-tag'}>{row.next_follow_up}</span>
        ) : (
          <button className="plain-button" onClick={() => void scheduleFollowUp()}>
            + in 3 days
          </button>
        )}
      </td>
      <td>
        <textarea
          aria-label={`Notes for ${row.company_name}`}
          className="notes-cell"
          rows={1}
          value={notes}
          onChange={e => setNotes(e.target.value)}
          onBlur={() => notes !== row.notes && void update({ notes })}
        />
      </td>
      <td>
        <button
          className="icon-button"
          aria-label={`Delete outreach to ${row.company_name}`}
          onClick={() => void remove()}
        >
          <Trash2 size={15} />
        </button>
      </td>
    </tr>
  );
}

export default function Outreach() {
  const outreach = useResource<OutreachRecord[]>('/api/outreach', []);
  const companies = useResource<CompanyOption[]>('/api/companies', []);
  const contacts = useResource<Contact[]>('/api/contacts', []);
  const [filter, setFilter] = useState<OutreachStatus | 'all'>('all');
  const [error, setError] = useState('');
  const counts = useMemo(
    () => Object.fromEntries(outreachStatuses.map(s => [s, outreach.data.filter(o => o.status === s).length])),
    [outreach.data],
  );
  const rows = filter === 'all' ? outreach.data : outreach.data.filter(o => o.status === filter);
  const reloadAll = async () => {
    setError('');
    await Promise.all([outreach.reload(), companies.reload(), contacts.reload()]);
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">CONNECT</div>
          <h1>Outreach CRM</h1>
          <p>Keep every conversation and next step in one place. Nothing is sent automatically.</p>
        </div>
      </div>
      {!outreach.available && <OfflineNotice />}
      <ErrorNotice message={outreach.error || error} onRetry={() => void reloadAll()} />
      <div className="stage-filter" role="group" aria-label="Filter by status">
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
          All <span>{outreach.data.length}</span>
        </button>
        {outreachStatuses.map(s => (
          <button key={s} className={filter === s ? 'active' : ''} onClick={() => setFilter(s)}>
            {outreachStatusLabels[s]} <span>{counts[s]}</span>
          </button>
        ))}
      </div>
      {outreach.available && (
        <NewOutreachForm companies={companies.data} contacts={contacts.data} onSaved={reloadAll} />
      )}
      {rows.length ? (
        <div className="panel table-panel">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Contact</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last contacted</th>
                <th>Next follow-up</th>
                <th>Notes</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <OutreachRow key={`${row.id}:${row.notes}`} row={row} onChanged={reloadAll} onError={setError} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        outreach.loaded && (
          <div className="panel empty-feed">
            <Send size={30} />
            <h2>{filter === 'all' ? 'No outreach yet' : `Nothing in “${outreachStatusLabels[filter]}”`}</h2>
            <p>Add a company above, or use “Add to outreach” on a company in Companies.</p>
          </div>
        )
      )}
    </>
  );
}
