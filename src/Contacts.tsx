import { useState, type FormEvent } from 'react';
import { Pencil, Plus, Trash2, Users } from 'lucide-react';
import { api, type Contact } from './lib/api';
import {
  CompanyField,
  companyPayload,
  ErrorNotice,
  ExternalLink,
  OfflineNotice,
  useResource,
  type CompanyOption,
} from './crm';

const emptyForm = {
  companyId: '',
  companyName: '',
  name: '',
  title: '',
  email: '',
  phone: '',
  profileUrl: '',
  notes: '',
};

export default function Contacts() {
  const contacts = useResource<Contact[]>('/api/contacts', []);
  const companies = useResource<CompanyOption[]>('/api/companies', []);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<typeof emptyForm>) => setForm(current => ({ ...current, ...patch }));
  const reloadAll = async () => {
    await Promise.all([contacts.reload(), companies.reload()]);
  };

  function edit(contact: Contact) {
    setEditing(contact.id);
    setError('');
    setForm({
      companyId: String(contact.company_id),
      companyName: '',
      name: contact.name,
      title: contact.title ?? '',
      email: contact.email ?? '',
      phone: contact.phone ?? '',
      profileUrl: contact.profile_url ?? '',
      notes: contact.notes,
    });
  }
  function cancel() {
    setEditing(null);
    setForm(emptyForm);
    setError('');
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    const fields = {
      name: form.name,
      title: form.title,
      email: form.email,
      phone: form.phone,
      profile_url: form.profileUrl,
      notes: form.notes,
    };
    try {
      if (editing) await api(`/api/contacts/${editing}`, 'PUT', fields);
      else await api('/api/contacts', 'POST', { ...companyPayload(form.companyId, form.companyName), ...fields });
      cancel();
      await reloadAll();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function remove(contact: Contact) {
    if (!window.confirm(`Delete ${contact.name} (${contact.company_name})?`)) return;
    try {
      await api(`/api/contacts/${contact.id}`, 'DELETE', {});
      await reloadAll();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const query = search.trim().toLowerCase();
  const rows = contacts.data.filter(c =>
    [c.name, c.company_name, c.title, c.email].some(value => value?.toLowerCase().includes(query)),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">DISCOVER</div>
          <h1>Contacts</h1>
          <p>The people closest to the work you want to do. Founders found by company research appear here too.</p>
        </div>
      </div>
      {!contacts.available && <OfflineNotice />}
      <ErrorNotice message={contacts.error} onRetry={() => void reloadAll()} />
      {contacts.available && (
        <form
          className="panel crm-form"
          onSubmit={e => void submit(e)}
          aria-label={editing ? 'Edit contact' : 'New contact'}
        >
          <div className="panel-title">
            <h2>{editing ? 'Edit contact' : 'New contact'}</h2>
          </div>
          <div className="form-grid">
            {editing ? (
              <label>
                Company
                <input value={contacts.data.find(c => c.id === editing)?.company_name ?? ''} disabled />
              </label>
            ) : (
              <CompanyField
                companies={companies.data}
                companyId={form.companyId}
                companyName={form.companyName}
                onChange={value => set(value)}
              />
            )}
            <label>
              Name
              <input value={form.name} required maxLength={150} onChange={e => set({ name: e.target.value })} />
            </label>
            <label>
              Title
              <input value={form.title} maxLength={150} onChange={e => set({ title: e.target.value })} />
            </label>
            <label>
              Email
              <input type="email" value={form.email} onChange={e => set({ email: e.target.value })} />
            </label>
            <label>
              Phone
              <input value={form.phone} maxLength={100} onChange={e => set({ phone: e.target.value })} />
            </label>
            <label>
              Profile link
              <input
                type="url"
                value={form.profileUrl}
                placeholder="https://linkedin.com/in/…"
                onChange={e => set({ profileUrl: e.target.value })}
              />
            </label>
            <label className="span-two">
              Notes
              <textarea value={form.notes} rows={2} onChange={e => set({ notes: e.target.value })} />
            </label>
          </div>
          <ErrorNotice message={error} />
          <div className="card-actions">
            <button className="primary-button no-top" disabled={saving}>
              <Plus size={16} />
              {saving ? 'Saving…' : editing ? 'Save contact' : 'Add contact'}
            </button>
            {editing && (
              <button type="button" className="secondary-button" onClick={cancel}>
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
      <div className="feed-toolbar">
        <label>
          Search contacts
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, company, title or email" />
        </label>
      </div>
      {rows.length ? (
        <div className="panel table-panel">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Company</th>
                <th>Title</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Profile</th>
                <th>Outreach</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.id}>
                  <td>
                    <strong>{c.name}</strong>
                    {c.is_founder ? <span className="sector-tag founder-tag">Founder</span> : null}
                  </td>
                  <td>{c.company_name}</td>
                  <td>{c.title || '—'}</td>
                  <td>
                    {c.email ? (
                      <a className="text-link" href={`mailto:${c.email}`}>
                        {c.email}
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{c.phone || '—'}</td>
                  <td>
                    <ExternalLink href={c.profile_url}>Profile</ExternalLink>
                    {!c.profile_url && '—'}
                  </td>
                  <td>{c.outreach_count || '—'}</td>
                  <td className="row-actions">
                    <button className="icon-button" aria-label={`Edit ${c.name}`} onClick={() => edit(c)}>
                      <Pencil size={15} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Delete ${c.name}`}
                      disabled={c.outreach_count > 0}
                      title={c.outreach_count > 0 ? 'Linked to outreach' : undefined}
                      onClick={() => void remove(c)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        contacts.loaded && (
          <div className="panel empty-feed">
            <Users size={30} />
            <h2>{query ? 'No matching contacts' : 'No contacts yet'}</h2>
            <p>Add someone above. Founders found during company research are added automatically.</p>
          </div>
        )
      )}
    </>
  );
}
