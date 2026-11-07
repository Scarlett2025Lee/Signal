import { useCallback, useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { api } from './lib/api';
import { hasLocalServer } from './lib/database';

interface UpdateState {
  current: string;
  latest: string | null;
  available: boolean;
  managed: boolean;
  error: string | null;
}
export default function UpdateNotice() {
  const [state, setState] = useState<UpdateState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [restarting, setRestarting] = useState(false);
  const check = useCallback(async () => {
    if (!hasLocalServer()) return;
    try {
      const result = await api<UpdateState>('/api/updates');
      if (result?.current) setState(result);
    } catch {
      /* An offline update channel must not block the website. */
    }
  }, []);
  useEffect(() => {
    void check();
    const timer = setInterval(() => void check(), 10 * 60000);
    return () => clearInterval(timer);
  }, [check]);
  useEffect(() => {
    if (!restarting) return;
    let attempts = 0;
    let stopped = false;
    let sawDowntime = false;
    const timer = setInterval(async () => {
      if (++attempts > 180) {
        setMessage('The update is still running or failed to start. Check the launcher window for details.');
        setRestarting(false);
        setBusy(false);
        return;
      }
      try {
        const health = await api<{ version: string }>('/api/health');
        if (!stopped && health.version && health.version !== state?.current) {
          window.location.reload();
        } else if (!stopped && sawDowntime && health.version === state?.current) {
          setMessage(
            'The previous version is running again. If the new version failed to start, the launcher rolled it back; check the launcher window.',
          );
          setRestarting(false);
          setBusy(false);
          void check();
        }
      } catch {
        sawDowntime = true;
      }
    }, 3000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [restarting, state?.current, check]);
  async function apply() {
    setBusy(true);
    setMessage('');
    try {
      const result = await api<{ status: string }>('/api/updates/apply', 'POST', {});
      if (result.status === 'restarting') {
        setRestarting(true);
        setMessage(
          'Updating and restarting. The program and database are backed up first. Keep the launcher window open; this page reloads automatically.',
        );
      } else {
        setMessage('You are on the latest version');
        setBusy(false);
      }
    } catch (e) {
      setMessage((e as Error).message);
      setBusy(false);
    }
  }
  if (!state) return null;
  return (
    <div className={`update-notice ${state.available ? 'update-available' : ''}`} role="status">
      <span>Signal v{state.current}</span>
      {state.available ? (
        <>
          <span>Version v{state.latest} is available</span>
          {state.managed ? (
            <button className="secondary-button" disabled={busy} onClick={() => void apply()}>
              <Download size={14} />
              {busy ? 'Updating…' : 'Update and restart'}
            </button>
          ) : (
            <span>Reopen Start-Signal.cmd to update automatically</span>
          )}
        </>
      ) : (
        <span>{state.error || 'Updates are checked at startup'}</span>
      )}
      <button className="plain-button" disabled={busy} onClick={() => void check()} aria-label="Check for updates">
        <RefreshCw size={13} />
      </button>
      {message && <p>{message}</p>}
    </div>
  );
}
