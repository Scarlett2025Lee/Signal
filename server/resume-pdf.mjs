import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { projectRoot } from './database.mjs';

/** Résumé PDFs from the "Print / Save as PDF" button land here. */
export const resumeFolder = join(projectRoot, 'resumes');

const MAX_BYTES = 512 * 1024;

// The résumé page is opened from disk (Origin "null") or from a local dev server.
export function allowedResumeOrigin(origin) {
  return !origin || origin === 'null' || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
}

function browserPath() {
  const candidates = [
    process.env.SIGNAL_CHROME,
    join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
    join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
    join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
    join(process.env.PROGRAMFILES ?? 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe'),
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return candidates.find(path => path && existsSync(path)) ?? null;
}

export function safeFileName(value) {
  const name = String(value ?? '')
    .replace(/\.pdf$/i, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return (name || 'Resume') + '.pdf';
}

function run(command, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', windowsHide: true });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('The browser took too long to make the PDF'));
    }, timeoutMs);
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('exit', code => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`The browser exited with code ${code}`));
    });
  });
}

/** Reads the request, renders the HTML with headless Chrome/Edge, and saves the PDF in resumeFolder. */
export async function saveResumePdf(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES) throw Object.assign(new Error('Résumé is too large'), { status: 413 });
    chunks.push(chunk);
  }
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid request'), { status: 400 });
  }
  if (!input || typeof input.html !== 'string' || !input.html.trim())
    throw Object.assign(new Error('Missing résumé HTML'), { status: 400 });
  const browser = browserPath();
  if (!browser) throw Object.assign(new Error('Chrome or Edge is needed to make PDFs'), { status: 500 });

  // Scripts are never needed to print the résumé.
  const html = input.html.replace(/<script[\s\S]*?<\/script>/gi, '');
  const fileName = safeFileName(input.fileName);
  const work = await mkdtemp(join(tmpdir(), 'signal-resume-'));
  try {
    const page = join(work, 'resume.html');
    const out = join(work, 'resume.pdf');
    await writeFile(page, html, 'utf8');
    await run(
      browser,
      [
        '--headless=new',
        '--disable-gpu',
        `--user-data-dir=${join(work, 'profile')}`,
        '--no-pdf-header-footer',
        `--print-to-pdf=${out}`,
        pathToFileURL(page).href,
      ],
      60000,
    );
    if (!(await stat(out)).size) throw new Error('The PDF came out empty');
    await mkdir(resumeFolder, { recursive: true });
    const target = join(resumeFolder, fileName);
    await copyFile(out, target);
    return { path: target, fileName };
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}
