import { fetchManifest, currentVersion, versionCompare } from '../scripts/update-core.mjs';
import { projectRoot } from './database.mjs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export function createUpdateService({ root = projectRoot, fetcher = fetch, requestRestart, managed = false } = {}) {
  let cached = null;
  let checked = 0;
  let checking;
  async function status(force = false) {
    if (!force && cached && Date.now() - checked < 5 * 60000) return cached;
    if (checking) return checking;
    checking = (async () => {
      const current = await currentVersion(root);
      try {
        const latest = await fetchManifest(fetcher);
        const blocked = JSON.parse(
          await readFile(join(root, '.cache', 'updates', 'blocked.json'), 'utf8').catch(() => '{}'),
        );
        const failed = blocked.version === latest.version;
        cached = {
          current,
          latest: latest.version,
          available: !failed && versionCompare(latest.version, current) > 0,
          managed,
          checked_at: new Date().toISOString(),
          error: failed ? '上一轮更新启动失败，已恢复旧版；等待修复版本后会再自动更新' : null,
        };
      } catch {
        cached = {
          current,
          latest: null,
          available: false,
          managed,
          checked_at: new Date().toISOString(),
          error: '暂时无法连接 GitHub，已安装版本可继续使用',
        };
      }
      checked = Date.now();
      return cached;
    })().finally(() => {
      checking = null;
    });
    return checking;
  }
  async function apply() {
    const state = await status();
    if (state.error) throw Error(state.error);
    if (!managed || !requestRestart) throw Error('请关闭服务后重新双击 Start-Signal.cmd，启动器会自动更新');
    if (!state.available) return { status: 'current' };
    requestRestart();
    return { status: 'restarting' };
  }
  return { status, apply };
}
