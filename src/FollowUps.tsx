import { useState, type FormEvent } from 'react';
import { Bell, Check, Clock, Plus, X } from 'lucide-react';
import { addDays, api, localToday, outreachStatusLabels, type FollowUp, type Outreach } from './lib/api';
import { ErrorNotice, OfflineNotice, useResource } from './crm';

export default function FollowUps() {
  const followUps = useResource<FollowUp[]>('/api/follow-ups', []);
  const outreach = useResource<Outreach[]>('/api/outreach', []);
  const [form, setForm] = useState({ outreachId: '', due: addDays(localToday(), 3), notes: '' });
  const [error, setError] = useState('');
  const [showDone, setShowDone] = useState(false);
  const reloadAll = async () => {
    await Promise.all([followUps.reload(), outreach.reload()]);
  };
  async function run(action: () => Promise<unknown>) {
    setError('');
    try {
      await action();
      await reloadAll();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      await api('/api/follow-ups', 'POST', {
        outreach_id: Number(form.outreachId),
        due_at: form.due,
        notes: form.notes,
      });
      setForm({ outreachId: '', due: addDays(localToday(), 3), notes: '' });
    });
  }
  const today = localToday();
  const pending = followUps.data.filter(f => f.status === 'pending');
  const finished = followUps.data.filter(f => f.status !== 'pending');
  const card = (f: FollowUp) => {
    const due = f.due_at.slice(0, 10);
    const state = f.status !== 'pending' ? f.status : due < today ? 'overdue' : due === today ? 'today' : 'upcoming';
    return (
      <div className={`panel follow-card ${state}`} key={f.id}>
        <div>
          <span className={`due-tag ${state === 'overdue' ? 'overdue' : ''}`}>
            {state === 'overdue' ? 'Overdue · ' : state === 'today' ? 'Today · ' : ''}
            {due}
          </span>
          <h3>{f.company_name}</h3>
          <p>
            {[f.contact_name, f.contact_email, f.role_title].filter(Boolean).join(' · ') || 'No contact recorded'} ·{' '}
            {outreachStatusLabels[f.outreach_status]}
          </p>
          {f.notes && <p className="preserve-lines">{f.notes}</p>}
        </div>
        {f.status === 'pending' ? (
          <div className="row-actions">
            <button
              className="secondary-button"
              onClick={() => void run(() => api(`/api/follow-ups/${f.id}`, 'PUT', { status: 'completed' }))}
            >
              <Check size={14} /> Done
            </button>
            <button
              className="secondary-button"
              onClick={() =>
                void run(() => api(`/api/follow-ups/${f.id}`, 'PUT', { due_at: addDays(due < today ? today : due, 3) }))
              }
            >
              <Clock size={14} /> +3 days
            </button>
            <button
              className="plain-button"
              onClick={() => void run(() => api(`/api/follow-ups/${f.id}`, 'PUT', { status: 'dismissed' }))}
            >
              <X size={14} /> Dismiss
            </button>
          </div>
        ) : (
          <div className="row-actions">
            <span className="muted-badge">{f.status.toUpperCase()}</span>
            <button
              className="plain-button"
              onClick={() => void run(() => api(`/api/follow-ups/${f.id}`, 'PUT', { status: 'pending' }))}
            >
              Reopen
            </button>
          </div>
        )}
      </div>
    );
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">CONNECT</div>
          <h1>Follow-up tracker</h1>
          <p>Make the next touchpoint a deliberate one.</p>
        </div>
      </div>
      {!followUps.available && <OfflineNotice />}
      <ErrorNotice message={followUps.error || error} onRetry={() => void reloadAll()} />
      {followUps.available && (
        <form className="panel crm-form" onSubmit={submit} aria-label="New follow-up">
          <div className="panel-title">
            <h2>Schedule a follow-up</h2>
          </div>
          <div className="form-grid">
            <label>
              Outreach
              <select value={form.outreachId} required onChange={e => setForm({ ...form, outreachId: e.target.value })}>
                <option value="">Choose…</option>
                {outreach.data.map(o => (
                  <option key={o.id} value={o.id}>
                    {o.company_name}
                    {o.contact_name ? ` · ${o.contact_name}` : ''}
                    {o.role_title ? ` · ${o.role_title}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Due date
              <input type="date" value={form.due} required onChange={e => setForm({ ...form, due: e.target.value })} />
            </label>
            <label className="span-two">
              Notes
              <textarea value={form.notes} rows={2} onChange={e => setForm({ ...form, notes: e.target.value })} />
            </label>
          </div>
          <button className="primary-button no-top" disabled={!outreach.data.length}>
            <Plus size={16} /> Add follow-up
          </button>
          {!outreach.data.length && outreach.loaded && <p className="form-hint">Add an outreach record first.</p>}
        </form>
      )}
      <div className="result-count">
        {pending.length} pending · {pending.filter(f => f.due_at.slice(0, 10) <= today).length} due now
      </div>
      <div className="follow-list">{pending.map(card)}</div>
      {!pending.length && followUps.loaded && (
        <div className="panel empty-feed">
          <Bell size={30} />
          <h2>No pending follow-ups</h2>
          <p>Schedule one above, or use “+ in 3 days” on an outreach record.</p>
        </div>
      )}
      {finished.length > 0 && (
        <details
          className="panel source-panel"
          open={showDone}
          onToggle={e => setShowDone((e.target as HTMLDetailsElement).open)}
        >
          <summary>Completed and dismissed ({finished.length})</summary>
          <div className="follow-list">{finished.map(card)}</div>
        </details>
      )}
    </>
  );
}
