import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyArticle, SOURCES } from './funding-sources.mjs';
import { parsePage, locationFromText, publicAddress, fetchPublicPage } from './location-research.mjs';
import { profileFromPage, jobTrack, atsEndpoint } from './company-research.mjs';
import { createFundingService, researchCandidate } from './funding.mjs';
import { openDatabase } from './database.mjs';

const raw = {
  source_url: 'https://www.finsmes.com/fixture',
  source_name: 'FinSMEs',
  title: 'FixtureAI Raises $12M in Series A Funding',
  summary: 'FixtureAI announced an AI funding round.',
  published_at: '2026-10-30T12:00:00Z',
};
const documents = {
  'https://www.finsmes.com/fixture':
    '<article><p>FixtureAI raised $12M in Series A funding.</p><p>FixtureAI is headquartered in Pittsburgh, Pennsylvania.</p><a href="https://fixture.example.com">FixtureAI</a></article>',
  'https://fixture.example.com/':
    '<html><head><meta name="description" content="Fictional AI payment automation platform"/></head><body><main><a href="/careers">Careers</a><a href="/team">Team</a></main><footer><a href="https://x.com/fixture">X</a><a href="https://linkedin.com/company/fixture">LinkedIn</a><a href="mailto:jobs@fixture.example.com">Careers</a><a href="tel:+15550100">Phone</a></footer></body></html>',
  'https://fixture.example.com/careers': '<main><a href="https://jobs.lever.co/fixture">Open jobs</a></main>',
  'https://api.lever.co/v0/postings/fixture?mode=json': JSON.stringify([
    { text: 'Product Manager', hostedUrl: 'https://jobs.lever.co/fixture/pm' },
    { text: 'Data Scientist', hostedUrl: 'https://jobs.lever.co/fixture/data' },
    { text: 'Account Executive', hostedUrl: 'https://jobs.lever.co/fixture/gtm' },
    { text: 'Software Engineer', hostedUrl: 'https://jobs.lever.co/fixture/engineering' },
  ]),
  'https://fixture.example.com/team':
    '<main><div><h3>Fixture Founder</h3><p>Co-founder / CEO</p><a href="https://linkedin.com/in/fixture-founder">LinkedIn</a></div></main>',
};
async function page(url) {
  const key = new URL(url).href;
  if (!(key in documents)) throw Error('Missing fixture ' + key);
  return { url: key, html: documents[key] };
}
test('reported false positives are excluded before company research', () => {
  assert.equal(
    classifyArticle(
      {
        ...raw,
        title: 'Global Relay closes compliance gaps in Google Workspace',
        summary: 'Global Relay has extended connectors for financial institutions and banks.',
      },
      SOURCES[1],
    ),
    null,
  );
  assert.equal(
    classifyArticle(
      {
        ...raw,
        title: 'Fronted raises €1.7M to simplify global hiring and business expansion',
        summary: 'Nordic HRtech startup Fronted has raised €1.7 million in a seed funding round.',
      },
      SOURCES[2],
    ),
    null,
  );
  assert.equal(
    classifyArticle(
      {
        ...raw,
        title: 'Fixture raises payment conversion rates',
        summary: 'Fintech company improves payment success.',
      },
      SOURCES[1],
    ),
    null,
  );
  assert.equal(
    classifyArticle({ ...raw, summary: 'A hardware manufacturer raised Series A funding.' }, SOURCES[1]),
    null,
  );
});
test('location evidence is company-specific and excludes investor offices and publisher addresses', () => {
  const result = locationFromText(
    'FixtureAI is headquartered in Pittsburgh, Pennsylvania. Investors are based in London.',
    'FixtureAI',
  );
  assert.equal(result.kind, 'us');
  assert.match(result.location, /Pittsburgh/);
  assert.equal(
    locationFromText('FixtureAI makes software. Its investors are headquartered in New York.', 'FixtureAI').kind,
    'unknown',
  );
  const unrelated = parsePage(
    '<script type="application/ld+json">{"@type":"Organization","name":"Publisher","address":{"addressCountry":"US"}}</script><article>FixtureAI makes AI software.</article>',
    'https://www.finsmes.com/fixture',
    'FixtureAI',
  );
  assert.equal(unrelated.location.kind, 'unknown');
  const address = parsePage(
    '<script type="application/ld+json">{"@type":"Organization","name":"FixtureAI","address":{"addressCountry":"US","addressLocality":"New York"}}</script>',
    'https://fixture.example.com/',
    'FixtureAI',
    { firstParty: true },
  );
  assert.equal(address.location.kind, 'address_only');
  assert.equal(
    locationFromText('FixtureAI is headquartered in Boston, MA. FixtureAI is based in London, UK.', 'FixtureAI').kind,
    'conflict',
  );
});
test('publisher full text and official company pages automatically produce the complete final company', async () => {
  const classified = classifyArticle(raw, SOURCES[0]);
  assert.equal(classified.country_code, null);
  const researched = await researchCandidate(classified, SOURCES[0], {
    fetchPage: page,
    clock: () => new Date('2026-10-31T12:00:00Z'),
  });
  assert.equal(researched.eligibility, 'included');
  assert.match(researched.hq_location, /Pittsburgh/);
  assert.equal(researched.company_profile.x_url, 'https://x.com/fixture');
  assert.equal(researched.company_profile.founders[0].name, 'Fixture Founder');
  assert.equal(researched.company_profile.recruiting_email, 'jobs@fixture.example.com');
  assert.deepEqual(
    researched.company_profile.jobs.map(j => j.track),
    ['PM', 'Data', 'GTM'],
  );
  const db = openDatabase(':memory:');
  const service = createFundingService(db, {
    sources: [{ ...SOURCES[0], pages: 1 }],
    fetchPage: async () => [raw],
    research: (article, source) => researchCandidate(article, source, { fetchPage: page }),
    clock: () => new Date('2026-10-31T12:00:00Z'),
  });
  try {
    await service.generate();
    const state = service.snapshot();
    assert.equal(state.articles.length, 1);
    assert.equal(state.articles[0].company.founders.length, 1);
    assert.equal(state.articles[0].company.jobs.length, 3);
    assert.equal(state.articles[0].review_status, 'approved');
  } finally {
    await service.stop();
    db.close();
  }
});
test('failed or ambiguous research never creates visible companies or manual tasks', async () => {
  const db = openDatabase(':memory:');
  const service = createFundingService(db, {
    sources: [{ ...SOURCES[0], pages: 1 }],
    fetchPage: async () => [raw],
    research: async article => ({ ...article, eligibility: 'research', research_error: 'Official site unavailable' }),
    clock: () => new Date('2026-10-31T12:00:00Z'),
  });
  try {
    await service.generate();
    assert.equal(service.snapshot().articles.length, 0);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM companies').get().n, 0);
  } finally {
    await service.stop();
    db.close();
  }
});
test('public research rejects local addresses and redirects to private networks', async () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '192.168.1.1',
    '172.16.0.1',
    '::1',
    '::ffff:127.0.0.1',
  ])
    assert.equal(publicAddress(address), false);
  await assert.rejects(
    fetchPublicPage('https://private.example.com', {
      resolve: async () => [{ address: '127.0.0.1', family: 4 }],
      request: () => {
        throw Error('Must not request');
      },
    }),
    /private network/,
  );
  await assert.rejects(
    fetchPublicPage('https://public.example.com', {
      resolve: async () => [{ address: '93.184.216.34', family: 4 }],
      request: async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private' } }),
    }),
    /Not a public/,
  );
});
test('official role extraction excludes engineering and recognizes the three requested tracks', () => {
  assert.equal(jobTrack('Senior Product Marketing Manager'), 'GTM');
  assert.equal(jobTrack('Senior Product Manager'), 'PM');
  assert.equal(jobTrack('Data Engineer'), 'Data');
  assert.equal(jobTrack('Software Engineer'), null);
  assert.equal(atsEndpoint('https://jobs.lever.co/fixture').kind, 'lever');
  assert.equal(atsEndpoint('https://job-boards.greenhouse.io/fixture').kind, 'greenhouse');
  const parsed = profileFromPage(
    documents['https://fixture.example.com/'],
    'https://fixture.example.com/',
    'FixtureAI',
  );
  assert.equal(parsed.linkedin_url, 'https://linkedin.com/company/fixture');
});
test('optional website and careers failures do not exclude a company meeting the core funding criteria', async () => {
  const input = classifyArticle(raw, SOURCES[0]);
  const blocked = await researchCandidate(input, SOURCES[0], {
    fetchPage: async url => {
      if (new URL(url).hostname === 'www.finsmes.com') return page(url);
      throw Error('HTTP 403');
    },
  });
  assert.equal(blocked.eligibility, 'included');
  assert.match(blocked.hq_location, /Pittsburgh/);
  assert.equal(blocked.company_profile.founders.length, 0);
  assert.match(blocked.research_error, /Company website unavailable/);
  const partial = await researchCandidate(input, SOURCES[0], {
    fetchPage: async url => {
      if (url.includes('careers')) throw Error('timeout');
      return page(url);
    },
  });
  assert.equal(partial.eligibility, 'included');
  assert.equal(partial.company_profile.founders[0].name, 'Fixture Founder');
});
test('RSS US-base evidence survives a successfully read article that omits the location sentence', async () => {
  const input = classifyArticle(
    { ...raw, summary: 'FixtureAI, a Boston, MA-based AI startup, raised $12M in Series A funding.' },
    SOURCES[0],
  );
  const result = await researchCandidate(input, SOURCES[0], {
    fetchPage: async () => ({
      url: raw.source_url,
      html: '<article>FixtureAI raised $12M in Series A funding.</article>',
    }),
  });
  assert.equal(result.eligibility, 'included');
  assert.match(result.hq_location, /Boston/);
});
test('headquarters and hiring are optional when US country evidence is present', async () => {
  const fetchPage = async () => ({
    url: raw.source_url,
    html: '<article>FixtureAI, an American AI startup, raised $12M in Series A funding.</article>',
  });
  const result = await researchCandidate(classifyArticle(raw, SOURCES[0]), SOURCES[0], { fetchPage });
  assert.equal(result.eligibility, 'included');
  assert.equal(result.country_code, 'US');
  assert.equal(result.hq_location, '');
  const db = openDatabase(':memory:');
  const service = createFundingService(db, {
    sources: [{ ...SOURCES[0], pages: 1 }],
    fetchPage: async () => [raw],
    research: async () => result,
    clock: () => new Date('2026-10-31T12:00:00Z'),
  });
  try {
    await service.generate();
    assert.equal(service.snapshot().articles.length, 1);
    assert.equal(service.snapshot().articles[0].company.country_code, 'US');
    assert.equal(service.snapshot().articles[0].company.jobs.length, 0);
  } finally {
    await service.stop();
    db.close();
  }
});
