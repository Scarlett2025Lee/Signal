import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(root, 'dist');
let html = await readFile(resolve(directory, 'index.html'), 'utf8');

// Inline production assets so file:// previews need no server or network.
const scriptTags = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)];
for (const [tag, source] of scriptTags) {
  const code = await readFile(resolve(directory, source.replace(/^\//, '')), 'utf8');
  html = html.replace(tag, () => `<script type="module">${code.replace(/<\/script/gi, '<\\/script')}</script>`);
}
const stylesheets = [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/g)];
for (const [tag, source] of stylesheets) {
  const css = await readFile(resolve(directory, source.replace(/^\//, '')), 'utf8');
  html = html.replace(tag, () => `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`);
}
html = html.replace(/<link\b[^>]*\brel="modulepreload"[^>]*>/g, '');
await writeFile(resolve(directory, 'signal-preview.html'), html);
console.log(
  'Created dist/signal-preview.html. Open this file directly in a browser; SQLite requires the local website server.',
);
