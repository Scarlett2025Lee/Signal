import { useEffect, useState } from 'react';
import { Copy, ExternalLink as ExternalIcon, Save, Send, Sparkles, Trash2 } from 'lucide-react';
import {
  api,
  draftStatusLabels,
  type EmailDraft,
  type EmailTemplate,
  type GeneratedEmail,
  type Outreach,
  type Track,
} from './lib/api';
import { ErrorNotice, OfflineNotice, useResource } from './crm';

const PLACEHOLDERS = [
  'company',
  'first_name',
  'funding',
  'what_they_do',
  'location',
  'role',
  'hiring_line',
  'tracks',
  'track',
];
const emptyEditor = { outreachId: '', to: '', subject: '', body: '', draftId: null as number | null };

function TemplateEditor({ onSaved }: { onSaved: () => void }) {
  const template = useResource<EmailTemplate | null>('/api/email/template', null);
  const [form, setForm] = useState({ name: '', subject: '', body: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (template.data) setForm({ name: template.data.name, subject: template.data.subject, body: template.data.body });
  }, [template.data]);
  async function save() {
    setError('');
    setMessage('');
    try {
      await api('/api/email/template', 'PUT', form);
      await template.reload();
      setMessage('Template saved.');
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <details className="panel source-panel template-editor">
      <summary>Edit template{template.data ? ` · ${template.data.name}` : ''}</summary>
      <p className="form-hint">
        Placeholders: {PLACEHOLDERS.map(p => `{{${p}}}`).join(' ')}. Replace the [bracketed] lines with your own
        background once; they are kept for every draft.
      </p>
      <div className="form-grid">
        <label className="span-two">
          Name
          <input value={form.name} maxLength={150} onChange={e => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="span-two">
          Subject
          <input value={form.subject} maxLength={300} onChange={e => setForm({ ...form, subject: e.target.value })} />
        </label>
        <label className="span-two">
          Body
          <textarea value={form.body} rows={14} onChange={e => setForm({ ...form, body: e.target.value })} />
        </label>
      </div>
      <ErrorNotice message={error || template.error} />
      {message && <p className="form-hint">{message}</p>}
      <button className="secondary-button" onClick={() => void save()}>
        <Save size={14} /> Save template
      </button>
    </details>
  );
}

export default function ColdEmail() {
  const outreach = useResource<Outreach[]>('/api/outreach', []);
  const drafts = useResource<EmailDraft[]>('/api/email/drafts', []);
  const [track, setTrack] = useState<Track>('PM');
  const [editor, setEditor] = useState(emptyEditor);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const set = (patch: Partial<typeof emptyEditor>) => setEditor(current => ({ ...current, ...patch }));
  const selected = outreach.data.find(o => String(o.id) === editor.outreachId);

  async function generate() {
    if (!editor.outreachId) return;
    setError('');
    setNotice('');
    try {
      const result = await api<GeneratedEmail>('/api/email/generate', 'POST', {
        outreach_id: Number(editor.outreachId),
        track,
      });
      set({ to: result.to, subject: result.subject, body: result.body, draftId: null });
      if (/\[[^\]]+\]/.test(result.body))
        setNotice('Replace the [bracketed] parts before sending, or fill them in the template.');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function save(status: EmailDraft['status'] = 'draft') {
    setError('');
    try {
      const payload = { subject: editor.subject, body: editor.body, status };
      const saved = editor.draftId
        ? await api<EmailDraft>(`/api/email/drafts/${editor.draftId}`, 'PUT', payload)
        : await api<EmailDraft>('/api/email/drafts', 'POST', {
            ...payload,
            outreach_id: Number(editor.outreachId),
            track,
          });
      set({ draftId: saved.id });
      setNotice(
        status === 'sent_manually'
          ? 'Marked as sent manually. Early-stage outreach was moved to “Contacted”.'
          : 'Draft saved.',
      );
      await Promise.all([drafts.reload(), outreach.reload()]);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(`Subject: ${editor.subject}\n\n${editor.body}`);
      setNotice('Copied to the clipboard.');
    } catch {
      setError('The browser blocked clipboard access. Select the text and copy it instead.');
    }
  }
  async function removeDraft(draft: EmailDraft) {
    if (!window.confirm(`Delete this draft for ${draft.company_name}?`)) return;
    try {
      await api(`/api/email/drafts/${draft.id}`, 'DELETE', {});
      if (editor.draftId === draft.id) set({ draftId: null });
      await drafts.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const mailto = `mailto:${encodeURIComponent(editor.to)}?subject=${encodeURIComponent(editor.subject)}&body=${encodeURIComponent(editor.body)}`;

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">CONNECT</div>
          <h1>Cold Email Generator</h1>
          <p>Turn company research into a thoughtful introduction. Drafts only — nothing is sent from Signal.</p>
        </div>
      </div>
      {!outreach.available && <OfflineNotice />}
      <ErrorNotice message={outreach.error || drafts.error || error} />
      {outreach.available && (
        <section className="panel crm-form" aria-label="Email composer">
          <div className="form-grid">
            <label>
              Outreach
              <select
                value={editor.outreachId}
                onChange={e => setEditor({ ...emptyEditor, outreachId: e.target.value })}
              >
                <option value="">Choose a company in your outreach…</option>
                {outreach.data.map(o => (
                  <option key={o.id} value={o.id}>
                    {o.company_name}
                    {o.contact_name ? ` · ${o.contact_name}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Lead with
              <select value={track} onChange={e => setTrack(e.target.value as Track)}>
                <option value="PM">Product (PM)</option>
                <option value="GTM">Go-to-market (GTM)</option>
                <option value="Data">Analytics (Data)</option>
              </select>
            </label>
          </div>
          {!outreach.data.length && outreach.loaded && (
            <p className="form-hint">Add a company to Outreach CRM first; drafts are linked to an outreach record.</p>
          )}
          <button className="primary-button no-top" disabled={!editor.outreachId} onClick={() => void generate()}>
            <Sparkles size={16} /> Generate draft
          </button>
          {(editor.body || editor.draftId) && (
            <div className="form-grid email-editor">
              <label className="span-two">
                To
                <input type="email" value={editor.to} onChange={e => set({ to: e.target.value })} />
              </label>
              <label className="span-two">
                Subject
                <input value={editor.subject} maxLength={300} onChange={e => set({ subject: e.target.value })} />
              </label>
              <label className="span-two">
                Body
                <textarea value={editor.body} rows={16} onChange={e => set({ body: e.target.value })} />
              </label>
              <div className="span-two row-actions">
                <button className="secondary-button" onClick={() => void save('draft')}>
                  <Save size={14} /> {editor.draftId ? 'Update draft' : 'Save draft'}
                </button>
                <button className="secondary-button" onClick={() => void copy()}>
                  <Copy size={14} /> Copy
                </button>
                <a className="secondary-button" href={mailto}>
                  <ExternalIcon size={14} /> Open in email app
                </a>
                <button className="secondary-button" onClick={() => void save('sent_manually')}>
                  <Send size={14} /> I sent it
                </button>
              </div>
              {notice && <p className="form-hint span-two">{notice}</p>}
              {selected && !editor.to && (
                <p className="form-hint span-two">
                  No email address on record for {selected.company_name}; add one in Contacts.
                </p>
              )}
            </div>
          )}
        </section>
      )}
      {outreach.available && <TemplateEditor onSaved={() => setNotice('Template saved. Generate again to use it.')} />}
      <div className="result-count">{drafts.data.length} saved drafts</div>
      {drafts.data.length > 0 && (
        <div className="panel table-panel">
          <table className="crm-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Subject</th>
                <th>Status</th>
                <th>Saved</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {drafts.data.map(d => (
                <tr key={d.id}>
                  <td>
                    <strong>{d.company_name}</strong>
                  </td>
                  <td>{d.subject || '—'}</td>
                  <td>
                    <span className={`due-tag ${d.status === 'sent_manually' ? 'sent' : ''}`}>
                      {draftStatusLabels[d.status]}
                    </span>
                  </td>
                  <td>{d.created_at.slice(0, 10)}</td>
                  <td className="row-actions">
                    <button
                      className="plain-button"
                      onClick={() =>
                        setEditor({
                          outreachId: String(d.outreach_id),
                          to: d.contact_email ?? '',
                          subject: d.subject,
                          body: d.body,
                          draftId: d.id,
                        })
                      }
                    >
                      Open
                    </button>
                    <button
                      className="icon-button"
                      aria-label={`Delete draft for ${d.company_name}`}
                      onClick={() => void removeDraft(d)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
