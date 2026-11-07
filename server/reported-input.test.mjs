import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyArticle, SOURCES } from './funding-sources.mjs';
import { researchCandidate, createFundingService } from './funding.mjs';
import { openDatabase } from './database.mjs';
const rows = JSON.parse(readFileSync(new URL('./fixtures/reported-funding-2026-10-31.json', import.meta.url), 'utf8'));
const blocked = async () => {
  throw Error('HTTP 403');
};
test('actual uploaded Avante report reaches visible company results even when all extra pages fail', async () => {
  const avante = rows.find(a => a.title.startsWith('Avante'));
  const result = classifyArticle(avante, SOURCES[1]);
  assert.ok(result);
  assert.equal(result.company_name, 'Avante');
  assert.equal(result.country_code, 'US');
  assert.equal(result.round_type, 'series_a');
  const db = openDatabase(':memory:');
  const service = createFundingService(db, {
    sources: [{ ...SOURCES[1], pages: 1 }],
    clock: () => new Date('2026-10-31T17:57:06.121Z'),
    fetchPage: async () => [avante],
    research: (a, s) => researchCandidate(a, s, { fetchPage: blocked }),
  });
  try {
    await service.generate();
    const state = service.snapshot();
    assert.equal(state.articles.length, 1);
    assert.equal(state.articles[0].company.name, 'Avante');
    assert.equal(state.articles[0].company.jobs.length, 0);
    assert.equal(state.diagnostics.included, 1);
  } finally {
    await service.stop();
    db.close();
  }
});
test('actual fund raises and product releases stay excluded; prior Series A is not the current Series B1', () => {
  for (const row of rows.filter(a => /Global Relay|Fronted|Entourage|Auriga/.test(a.title)))
    assert.equal(
      classifyArticle(
        row,
        SOURCES.find(s => s.name === row.source_name),
      ),
      null,
      row.title,
    );
  const covergo = classifyArticle(
    rows.find(a => a.title.startsWith('CoverGo')),
    SOURCES[1],
  );
  assert.equal(covergo.round_type, 'series_b');
});
test('missing country diagnostic preserves the underlying page-fetch error', async () => {
  const raw = {
    ...rows.find(a => a.title.startsWith('Avante')),
    title: 'Example raises $30m in Series A',
    summary: 'Example has raised $30m in Series A for its AI platform.',
  };
  const result = await researchCandidate(classifyArticle(raw, SOURCES[1]), SOURCES[1], { fetchPage: blocked });
  assert.equal(result.eligibility, 'research');
  assert.match(result.research_error, /HTTP 403/);
});
