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
        setMessage('更新仍在进行或启动失败，请查看黑色服务窗口中的提示。');
        setRestarting(false);
        setBusy(false);
        return;
      }
      try {
        const health = await api<{ version: string }>('/api/health');
        if (!stopped && health.version && health.version !== state?.current) {
          window.location.reload();
        } else if (!stopped && sawDowntime && health.version === state?.current) {
          setMessage('服务已恢复到原版本；若新版启动失败，启动器会自动回滚。请查看启动窗口中的更新结果。');
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
        setMessage('正在自动更新并重启，程序和数据库会先备份。请保持黑色启动窗口打开，网页稍后自动刷新。');
      } else {
        setMessage('当前已是最新版本');
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
          <span>新版 v{state.latest} 已发布</span>
          {state.managed ? (
            <button className="secondary-button" disabled={busy} onClick={() => void apply()}>
              <Download size={14} />
              {busy ? '正在更新…' : '更新并重启'}
            </button>
          ) : (
            <span>重新打开 Start-Signal.cmd 将自动更新</span>
          )}
        </>
      ) : (
        <span>{state.error || '启动时自动检查更新'}</span>
      )}
      <button className="plain-button" disabled={busy} onClick={() => void check()} aria-label="检查更新">
        <RefreshCw size={13} />
      </button>
      {message && <p>{message}</p>}
    </div>
  );
}
