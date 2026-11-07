import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import FundingFeed from './FundingFeed';
import { api, type FundingState, type Company } from './lib/api';
vi.mock('./lib/api', async original => ({ ...(await original<typeof import('./lib/api')>()), api: vi.fn() }));
vi.mock('./lib/database', () => ({ hasLocalServer: () => true }));
const company: Company = {
  id: 1,
  name: 'FixtureAI',
  website: 'https://example.com',
  sector: 'AI',
  headquarters: 'Boston, MA',
  product_summary: 'Fictional company for UI tests',
  notes: '',
  x_url: 'https://x.com/fixture',
  linkedin_url: 'https://linkedin.com/company/fixture',
  public_email: 'hello@example.com',
  public_phone: '',
  recruiting_email: 'jobs@example.com',
  recruiting_phone: '',
  offices: 'Boston, MA',
  info_source_url: 'https://example.com',
  info_checked_on: '2026-10-31',
  hiring_status: 'roles_found',
  hiring_source_url: 'https://example.com/careers',
  hiring_checked_on: '2026-10-31',
  founders: [
    {
      name: 'Fixture Founder',
      title: 'Founder',
      profile_url: 'https://linkedin.com/in/fixture',
      email: '',
      phone: '',
      source_url: 'https://example.com/team',
    },
  ],
  jobs: [
    {
      title: 'Product Manager',
      track: 'PM',
      url: 'https://example.com/careers/pm',
      evidence: 'Product Manager',
      checked_on: '2026-10-31',
    },
  ],
};
const state: FundingState = {
  running: false,
  schedule: { enabled: 1, next_due_at: null },
  window: { start: '2026-10-25', end: '2026-10-31' },
  reports: [],
  report: {
    id: 1,
    window_start: '2026-10-25',
    window_end: '2026-10-31',
    generated_at: '2026-10-31T12:00:00Z',
    status: 'complete',
    sources: [],
  },
  articles: [
    {
      id: 1,
      company_name: 'FixtureAI',
      company_key: 'fixtureai',
      source_url: 'https://example.com/funding',
      source_name: 'Fixture feed',
      title: 'Fictional AI funding fixture',
      summary: 'Fictional',
      published_at: '2026-10-30T12:00:00Z',
      sector: 'AI',
      country_code: 'US',
      round_type: 'seed',
      amount_text: '$10M',
      announced_on: '2026-10-30',
      extraction_notes: '',
      review_status: 'approved',
      company_id: 1,
      funding_round_id: 1,
      company,
      hq_location: 'Boston, MA',
      hq_evidence: [{ quote: 'FixtureAI is based in Boston, MA', url: 'https://example.com/about' }],
    },
  ],
};
beforeEach(() => {
  vi.mocked(api).mockReset();
  vi.mocked(api).mockImplementation(async (_path, method) =>
    method === 'POST' ? { running: true } : structuredClone(state),
  );
});
it('shows one final company with funding, headquarters, socials, founders, contacts and target jobs on one page', async () => {
  render(
    <MemoryRouter>
      <FundingFeed />
    </MemoryRouter>,
  );
  expect(await screen.findByText('FixtureAI')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Companies' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Company X' })).toHaveAttribute('href', 'https://x.com/fixture');
  expect(screen.getByRole('link', { name: 'Fixture Founder' })).toHaveAttribute(
    'href',
    'https://linkedin.com/in/fixture',
  );
  expect(screen.getByText('jobs@example.com')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Product Manager' })).toBeVisible();
  expect(screen.queryByRole('button', { name: /Confirm|Save company/ })).not.toBeInTheDocument();
  expect(screen.queryByText('Headquarters to be confirmed')).not.toBeInTheDocument();
});
it('does not expose incomplete candidates and starts the complete discovery workflow', async () => {
  vi.mocked(api).mockImplementation(async (_path, method) =>
    method === 'POST'
      ? { running: true }
      : {
          ...structuredClone(state),
          articles: state.articles.map(a => ({ ...a, review_status: 'pending', company: undefined })),
        },
  );
  render(
    <MemoryRouter>
      <FundingFeed />
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  expect(await screen.findByText('No company meets every condition yet')).toBeVisible();
  expect(screen.queryByText('FixtureAI')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Generate this week’s list' }));
  expect(api).toHaveBeenCalledWith('/api/funding/generate', 'POST', {});
});
