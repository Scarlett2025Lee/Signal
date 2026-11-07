// Regression tests for source coverage and extraction fixes found in live runs on 2026-11-07.
// All company names and article text are fictional fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SOURCES, ACTIVE_SOURCES, classifyArticle } from './funding-sources.mjs';
import { locationFromText, parsePage } from './location-research.mjs';
import { openDatabase } from './database.mjs';
import { createFundingService, CLASSIFICATION_VERSION } from './funding.mjs';

const source = SOURCES.find(s => s.id === 'geekwire');
const raw = (overrides = {}) => ({ source_url: 'https://www.geekwire.com/2026/fixture/', source_name: 'GeekWire', title: 'Fixtura raises $10M Series A for AI agents', summary: 'Fixtura raised $10 million in a Series A round for its AI platform. Fictional fixture.', published_at: '2026-11-05T12:00:00Z', ...overrides });

test('blocked FinSMEs stays documented but is not fetched; US-focused feeds are active', () => {
  assert.equal(SOURCES[0].id, 'finsmes');
  assert.ok(!ACTIVE_SOURCES.some(s => s.id === 'finsmes'));
  for (const id of ['alleywatch', 'geekwire', 'crunchbase', 'techcrunch', 'prnewswire']) assert.ok(ACTIVE_SOURCES.some(s => s.id === id), id);
  for (const s of ACTIVE_SOURCES) assert.ok(new URL(s.url).protocol === 'https:' && s.hosts.includes(new URL(s.url).hostname), s.id);
});

test('US evidence: "<city> startup <Name>", AP state abbreviations and press-release datelines', () => {
  const startup = locationFromText('(Fixtura Photo) Seattle startup Fixtura, which builds AI agents, raised $10 million.', 'Fixtura');
  assert.equal(startup.kind, 'us'); assert.equal(startup.location, 'Seattle');
  const ap = locationFromText('Shield Fixture agreed to fund Kirkland, Wash.-based Radarix, a radar maker.', 'Radarix');
  assert.equal(ap.kind, 'us'); assert.equal(ap.location, 'Kirkland, Wash.');
  const dateline = locationFromText('Seed round co-led by Fixture Ventures REDWOOD CITY, Calif., Nov. 5, 2026 /PRNewswire/ -- Perovix, formerly Fixture Solar, today announced $9 million.', 'Perovix');
  assert.equal(dateline.kind, 'us'); assert.equal(dateline.location, 'REDWOOD CITY, Calif.');
  // A dateline only counts when the release is about the named company.
  assert.equal(locationFromText('NEW YORK, Nov. 4, 2026 /PRNewswire/ -- Other Fixture Inc. announced a product.', 'Perovix').kind, 'unknown');
});

test('captured locations are trimmed to the place and the pronoun "us" is not the United States', () => {
  assert.equal(locationFromText('FinTech News Company News Funding Rounds InsurTech Seattle-based Avantix has raised $30m.', 'Avantix').location, 'Seattle');
  assert.equal(locationFromText('Kalshix, the New York-based exchange, raised funding.', 'Kalshix').location, 'New York');
  const berlin = locationFromText('Fixtura is based in Berlin and wants to hear from us.', 'Fixtura');
  assert.equal(berlin.kind, 'foreign');
});

test('roundups, investor announcements and acquisitions are not company rounds', () => {
  for (const title of ['The New York Tech Daily Funding Report: 11/6/2026', 'The Week’s 10 Biggest Funding Rounds: AI Leads', 'Sector Snapshot: Robotics Funding Soars To $1.6B', 'Fixture Partners Announces Investment in Fathomix to Advance AI Discovery', 'Shield Fixture to buy AI radar maker Radarix in $5B deal']) {
    assert.equal(classifyArticle(raw({ title, summary: 'Fixture raised $10 million in seed funding for its AI platform.' }), source), null, title);
  }
  // "invest in" inside an ordinary company headline must not exclude it.
  assert.ok(classifyArticle(raw({ title: 'Fixtura raises $4M seed so firms can invest in AI safely' }), source));
});

test('company names come from correction notices and from the lead when the headline names people', () => {
  const correction = classifyArticle(raw({ title: '/C O R R E C T I O N - Shackletix AI/', summary: 'In the news release, Shackletix AI Raises $5 Million Seed Led by Fixture Ventures for its AI platform. NEW YORK, Nov. 4, 2026 /PRNewswire/ -- Shackletix AI, a provider of agentic AI.' }), source);
  assert.equal(correction.company_name, 'Shackletix AI'); assert.equal(correction.country_code, 'US'); assert.equal(correction.round_type, 'seed');
  const people = classifyArticle(raw({ title: 'Exclusive: Fixture And Example Health Co-Founders Raise $6M For AI Mental Health Startup Siggix', summary: 'Mary Fixture 2 Shares Email Facebook X LinkedIn Siggix has raised $6 million in pre-seed funding to build an AI mental health service.' }), source);
  assert.equal(people.company_name, 'Siggix'); assert.equal(people.round_type, 'pre_seed');
  // A plain headline keeps its own subject.
  assert.equal(classifyArticle(raw(), source).company_name, 'Fixtura');
});

test('a publisher subdomain link is not taken as the company website', () => {
  const html = '<article><p><a href="https://funding.alleywatch.com/companies/kalepix">Kalepix</a> builds AI for insurers.</p><p><a href="https://www.kalepix.example">Kalepix</a></p></article>';
  assert.equal(parsePage(html, 'https://www.alleywatch.com/2026/11/kalepix/', 'Kalepix').website, 'https://www.kalepix.example/');
  assert.equal(parsePage(html.replace('<p><a href="https://www.kalepix.example">Kalepix</a></p>', ''), 'https://www.alleywatch.com/2026/11/kalepix/', 'Kalepix').website, '');
});

test('re-researched unconfirmed articles take the latest extraction instead of keeping stale fields', async () => {
  const db = openDatabase(':memory:');
  let round = 'series_a';
  const service = createFundingService(db, { sources: [{ ...source, pages: 1 }], clock: () => new Date('2026-11-06T12:00:00Z'), fetchPage: async () => [raw()],
    research: async article => ({ ...article, round_type: round, eligibility: 'research', research_error: 'Fixture: no US evidence' }) });
  await service.generate();
  round = 'seed';
  await service.generate();
  const row = db.prepare('SELECT round_type, classification_version FROM funding_articles').get();
  assert.equal(row.round_type, 'seed'); assert.equal(row.classification_version, CLASSIFICATION_VERSION);
  await service.stop(); db.close();
});
