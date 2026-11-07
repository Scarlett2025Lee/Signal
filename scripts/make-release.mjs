import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { validPath } from './update-core.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = resolve(root, '../downloads');
await mkdir(out, { recursive: true });
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const files = {};
const hashes = {};
async function walk(folder = '') {
  for (const entry of await readdir(join(root, folder), { withFileTypes: true })) {
    const path = folder ? folder + '/' + entry.name : entry.name;
    if (
      ['node_modules', 'data', '.cache', '.tools', '.git', '__pycache__'].includes(entry.name) ||
      path === 'release.json'
    )
      continue;
    if (entry.isDirectory()) {
      if (['src', 'server', 'scripts', 'database', 'dist'].includes(path.split('/')[0])) await walk(path);
      continue;
    }
    if (!entry.isFile()) throw Error('Release may not include symlinks');
    try {
      validPath(path);
    } catch {
      continue;
    }
    const bytes = await readFile(join(root, path));
    files['Signal/' + path] = bytes;
    hashes[path] = sha(bytes);
  }
}
await walk();
const inventory = Buffer.from(JSON.stringify({ format: 1, version: pkg.version, files: hashes }, null, 2) + '\n');
await writeFile(join(root, 'release.json'), inventory);
files['Signal/release.json'] = inventory;
const bytes = Buffer.from(zipSync(files, { level: 6 }));
await writeFile(join(out, 'Signal.zip'), bytes);
await writeFile(join(out, 'Signal.zip.sha256'), sha(bytes) + '  Signal.zip\n');
await writeFile(
  join(out, 'update.json'),
  JSON.stringify(
    {
      format: 1,
      version: pkg.version,
      sha256: sha(bytes),
      bytes: bytes.length,
      url: `https://github.com/Scarlett2025Lee/AI-Fintech-funding-leads/raw/refs/heads/codex/signal-web/downloads/Signal.zip?version=${pkg.version}&sha256=${sha(bytes)}`,
    },
    null,
    2,
  ) + '\n',
);
// Bootstrap contains a pinned checksum for the installer, never evals downloaded text.
const installer = await readFile(join(out, 'Install-Signal.ps1'));
const ps = `$ErrorActionPreference='Stop'; $p='D:\\Signal\\.cache\\installer'; New-Item -ItemType Directory -Force -Path $p | Out-Null; $env:TEMP=$p; $env:TMP=$p; $f=Join-Path $p 'Install-Signal.ps1'; Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/Scarlett2025Lee/AI-Fintech-funding-leads/codex/signal-web/downloads/Install-Signal.ps1' -OutFile $f -TimeoutSec 120; if ((Get-FileHash $f -Algorithm SHA256).Hash -ine '${sha(installer)}') { throw 'Installer checksum mismatch. Download the latest Install-Signal.cmd.' }; & $f; if (!$?) { exit 1 }`;
const command = [
  '@echo off',
  'echo Signal: install automatic updates on D:',
  'echo Close any running Signal website server first.',
  'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "' + ps + '"',
  'if errorlevel 1 pause',
  '',
].join('\r\n');
await writeFile(join(out, 'Install-Signal.cmd'), command);
await writeFile(
  join(out, 'Install-Signal.zip'),
  Buffer.from(zipSync({ 'Install-Signal.cmd': Buffer.from(command) }, { level: 6 })),
);
console.log(
  `Release ${pkg.version}: ${Object.keys(files).length} files; ${bytes.length} bytes; checksummed ZIP, channel and one-time installer created.`,
);
