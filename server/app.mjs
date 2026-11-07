import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { dashboardStats, projectRoot } from './database.mjs';
import { FundingError } from './funding.mjs';

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export function createApp(
  db,
  { staticRoot = join(projectRoot, 'dist'), funding, companies, updates, applicationVersion = 'unknown' } = {},
) {
  const root = resolve(staticRoot);
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    // This service is private to this computer. Reject DNS-rebinding hostnames.
    const authority = req.headers.host ?? '';
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(authority)) {
      res.writeHead(403);
      res.end('Invalid local hostname');
      return;
    }
    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(body));
    };
    try {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (!['GET', 'HEAD'].includes(req.method)) {
        const knownMutation =
          (updates && req.method === 'POST' && url.pathname === '/api/updates/apply') ||
          (funding &&
            ((req.method === 'POST' && url.pathname === '/api/funding/generate') ||
              (req.method === 'PUT' &&
                (url.pathname === '/api/funding/schedule' || /^\/api\/funding\/articles\/\d+$/.test(url.pathname))))) ||
          (companies &&
            ((req.method === 'POST' && url.pathname === '/api/companies') ||
              (req.method === 'PUT' && /^\/api\/companies\/\d+$/.test(url.pathname))));
        if (!knownMutation) {
          res.setHeader('Allow', 'GET, HEAD');
          json(405, { error: 'Method not allowed' });
          return;
        }
        if (
          req.headers.origin &&
          ![`http://${authority}`, 'http://127.0.0.1:1420', 'http://localhost:1420'].includes(req.headers.origin)
        ) {
          json(403, { error: 'Invalid request origin' });
          return;
        }
        if (req.headers['content-type']?.split(';')[0] !== 'application/json') {
          json(415, { error: 'Use application/json' });
          return;
        }
      }
      const body = async () => {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 65536) throw new FundingError('Request body is too large', 413);
          chunks.push(chunk);
        }
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          const value = JSON.parse(text);
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
          return value;
        } catch {
          throw new FundingError('Invalid JSON request');
        }
      };
      if (updates && url.pathname === '/api/updates' && req.method === 'GET') {
        json(200, await updates.status());
        return;
      }
      if (updates && url.pathname === '/api/updates/apply' && req.method === 'POST') {
        await body();
        try {
          json(202, await updates.apply());
        } catch (error) {
          throw new FundingError(error.message, 409);
        }
        return;
      }
      if (funding && url.pathname === '/api/funding' && req.method === 'GET') {
        json(200, funding.snapshot(Number(url.searchParams.get('report')) || undefined));
        return;
      }
      if (funding && url.pathname === '/api/funding/generate' && req.method === 'POST') {
        await body();
        const task = funding.generate();
        task.catch(error => console.error('Funding generation:', error.message));
        json(202, { running: true });
        return;
      }
      if (funding && url.pathname === '/api/funding/schedule' && req.method === 'PUT') {
        const input = await body();
        funding.setSchedule(input.enabled);
        json(200, funding.snapshot());
        return;
      }
      const review = url.pathname.match(/^\/api\/funding\/articles\/(\d+)$/);
      if (funding && review && req.method === 'PUT') {
        funding.review(Number(review[1]), await body());
        json(200, { ok: true });
        return;
      }
      if (funding && url.pathname === '/api/funding/export' && req.method === 'GET') {
        const text = funding.markdown(Number(url.searchParams.get('report')) || undefined);
        res.writeHead(200, {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': 'attachment; filename="signal-funding-weekly.md"',
        });
        res.end(text);
        return;
      }
      if (funding && url.pathname === '/api/funding/diagnostics' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': 'attachment; filename="signal-retrieval-diagnostics.json"',
        });
        res.end(
          JSON.stringify(funding.diagnosticsExport(Number(url.searchParams.get('report')) || undefined), null, 2),
        );
        return;
      }
      if (companies && url.pathname === '/api/companies' && req.method === 'GET') {
        json(200, companies.list());
        return;
      }
      if (companies && url.pathname === '/api/companies' && req.method === 'POST') {
        json(201, companies.create(await body()));
        return;
      }
      const company = url.pathname.match(/^\/api\/companies\/(\d+)$/);
      if (companies && company && req.method === 'GET') {
        json(200, companies.detail(Number(company[1])));
        return;
      }
      if (companies && company && req.method === 'PUT') {
        json(200, companies.save(Number(company[1]), await body()));
        return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        json(405, { error: 'Method not allowed' });
        return;
      }
      if (url.pathname === '/api/health') {
        json(200, { status: 'ok', database: 'connected', version: applicationVersion });
        return;
      }
      if (url.pathname === '/api/dashboard') {
        json(200, dashboardStats(db));
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        json(404, { error: 'API route not found' });
        return;
      }
      let pathname;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        json(400, { error: 'Invalid URL' });
        return;
      }
      if (pathname.includes('\\') || pathname.includes('\0')) {
        json(400, { error: 'Invalid path' });
        return;
      }
      const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!file.startsWith(root + sep)) {
        json(403, { error: 'Forbidden' });
        return;
      }
      try {
        const body = await readFile(file);
        res.setHeader(
          'Content-Security-Policy',
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        );
        res.writeHead(200, { 'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream' });
        res.end(req.method === 'HEAD' ? undefined : body);
      } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'EISDIR')
          json(404, { error: 'Page not found. Run npm run build first.' });
        else throw error;
      }
    } catch (error) {
      if (error instanceof FundingError) {
        json(error.status, { error: error.message });
        return;
      }
      console.error('Local request failed:', error.message);
      json(500, { error: 'Unable to read local workspace' });
    }
  });
}
