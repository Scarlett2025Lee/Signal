import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, SCHEMA_VERSION } from './database.mjs';
import { completedResearchFixture } from './research.fixture.mjs';
import { createFundingService } from './funding.mjs';
import { SOURCES, reportingWindow, parseFeed, classifyArticle, fetchFeedPage } from './funding-sources.mjs';

const now = new Date('2026-10-31T16:00:00Z');
const source = { ...SOURCES[0], pages: 2 };
const article = (overrides = {}) => ({
  source_url: 'https://www.finsmes.com/2026/10/test-ai.html',
  source_name: 'FinSMEs',
  title: 'FixtureAI Raises $12M in Series A Funding',
  summary:
    'FixtureAI, a San Francisco, CA-based artificial intelligence platform, raised $12M in Series A funding. This is a fictional test fixture.',
  published_at: '2026-10-30T13:00:00Z',
  ...overrides,
});

test('seven calendar days include today in New York, including DST boundaries', () => {
  assert.deepEqual(reportingWindow(now), { start: '2026-10-25', end: '2026-10-31', asOf: now.toISOString() });
  assert.equal(reportingWindow(new Date('2026-11-01T03:30:00Z')).end, '2026-10-31');
  assert.equal(reportingWindow(new Date('2026-11-02T04:30:00Z')).end, '2026-11-01');
});
test('RSS/Atom parse source dates, canonical links and text without executing markup', () => {
  const xml =
    '<rss><channel><item><title>FixtureAI Raises $12M</title><link>https://www.finsmes.com/example?utm_source=x</link><pubDate>Fri, 30 Oct 2026 13:00:00 GMT</pubDate><description><![CDATA[<p>AI funding</p><script>bad()</script>]]></description></item></channel></rss>';
  const rows = parseFeed(xml, source);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source_url, 'https://www.finsmes.com/example');
  assert.equal(rows[0].summary, 'AI funding');
  const atom =
    '<feed><entry><title>Fintech Raises Seed</title><link href="https://www.finsmes.com/atom" rel="alternate"/><published>2026-10-30T12:00:00Z</published><summary>Payments</summary></entry></feed>';
  assert.equal(parseFeed(atom, source).length, 1);
  assert.throws(() => parseFeed('<!DOCTYPE x [<!ENTITY bad "x">]><rss/>', source));
  assert.throws(() => parseFeed('<html>blocked</html>', source));
  assert.equal(parseFeed(xml.replace('https://www.finsmes.com/example', 'javascript:alert(1)'), source).length, 0);
});
test('classifier excludes non-US evidence, acquisitions, late-stage and debt; unknown HQ stays unverified', () => {
  const result = classifyArticle(article(), source);
  assert.equal(result.country_code, 'US');
  assert.equal(result.round_type, 'series_a');
  assert.equal(result.company_name, 'FixtureAI');
  assert.equal(result.amount_text, '$12M');
  for (const title of [
    'FixtureAI Raises $100M in Series C Funding',
    'FixtureAI Acquires Another Startup',
    'FixtureAI Raises $12M in Debt Financing',
  ])
    assert.equal(classifyArticle(article({ title }), source), null);
  assert.equal(
    classifyArticle(article({ summary: 'FixtureAI, a London-based AI startup, raised Series A funding.' }), source),
    null,
  );
  assert.equal(
    classifyArticle(
      article({ summary: 'An AI startup raised Series A funding. Investors have offices in San Francisco.' }),
      source,
    ).country_code,
    null,
  );
});
test('fetcher rejects off-host redirect and HTTP failures', async () => {
  await assert.rejects(
    fetchFeedPage(
      source,
      1,
      async () => new Response(null, { status: 302, headers: { location: 'https://private.example/feed' } }),
    ),
    /outside/,
  );
  await assert.rejects(
    fetchFeedPage(source, 1, async () => new Response('blocked', { status: 403 })),
    /403/,
  );
});
test('generation filters exact window, deduplicates sources, automatically completes research before exposing results', async () => {
  const db = openDatabase(':memory:');
  let fail = false;
  const fetchPage = async (s, page) => {
    if (fail) throw Error('blocked');
    return page === 1
      ? [
          article(),
          article(),
          article({ source_url: 'https://www.finsmes.com/old', published_at: '2026-10-24T10:00:00Z' }),
          article({ source_url: 'https://www.finsmes.com/future', published_at: '2026-11-01T10:00:00Z' }),
        ]
      : [];
  };
  const service = createFundingService(db, {
    sources: [source],
    fetchPage,
    clock: () => now,
    research: completedResearchFixture,
  });
  try {
    const active = service.generate();
    assert.throws(() => service.generate(), /already being generated/);
    await active;
    let state = service.snapshot();
    assert.equal(state.articles.length, 1);
    assert.equal(state.report.status, 'complete');
    assert.equal(db.prepare('SELECT count(*) n FROM companies').get().n, 1);
    const id = state.articles[0].id;
    assert.equal(state.articles[0].review_status, 'approved');
    assert.equal(state.articles[0].company.headquarters, 'San Francisco, CA');
    await service.generate();
    assert.equal(service.snapshot().articles[0].review_status, 'approved');
    assert.equal(db.prepare('SELECT count(*) n FROM funding_rounds').get().n, 1);
    assert.match(service.markdown(), /FixtureAI/);
    assert.match(service.markdown(), /2026-10-30/);
    fail = true;
    await service.generate();
    state = service.snapshot();
    assert.equal(state.report.status, 'failed');
    assert.equal(state.articles.length, 1);
    assert.equal(state.report.sources[0].error, 'blocked');
  } finally {
    await service.stop();
    db.close();
  }
});
test('different publishers for the same round do not create duplicate companies or rounds', async () => {
  const db = openDatabase(':memory:');
  const second = { ...source, id: 'other', name: 'Other fixture' };
  const service = createFundingService(db, {
    sources: [source, second],
    clock: () => now,
    research: completedResearchFixture,
    fetchPage: async (s, page) =>
      page === 1 ? [article({ source_url: `https://www.finsmes.com/${s.id}`, source_name: s.name })] : [],
  });
  try {
    await service.generate();
    assert.equal(db.prepare('SELECT count(*) n FROM companies').get().n, 1);
    assert.equal(db.prepare('SELECT count(*) n FROM funding_rounds').get().n, 1);
    assert.equal(service.markdown().split('| FixtureAI |').length - 1, 1);
  } finally {
    await service.stop();
    db.close();
  }
});
test('version 1 user database upgrades without losing existing companies', () => {
  const dir = mkdtempSync(join(tmpdir(), 'signal-upgrade-'));
  const path = join(dir, 'signal.sqlite3');
  try {
    const old = new DatabaseSync(path);
    old.exec(readFileSync(new URL('../database/migrations/001_initial.sql', import.meta.url), 'utf8'));
    old.exec("INSERT INTO companies(name) VALUES('Keep me');PRAGMA user_version=1");
    old.close();
    const db = openDatabase(path);
    assert.equal(db.prepare('SELECT name FROM companies').get().name, 'Keep me');
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
    assert.equal(db.prepare('SELECT enabled FROM funding_schedule').get().enabled, 1);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
