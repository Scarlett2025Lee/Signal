import type { ReactElement } from 'react';
import { expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { api, type Outreach as OutreachRecord, type FollowUp } from './lib/api';
import Outreach from './Outreach';
import Contacts from './Contacts';
import FollowUps from './FollowUps';
import ColdEmail from './ColdEmail';

vi.mock('./lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('./lib/api')>()),
  api: vi.fn(),
}));
vi.mock('./lib/database', () => ({ hasLocalServer: () => true }));

const row: OutreachRecord = {
  id: 7,
  company_id: 3,
  company_name: 'Fixture Labs',
  website: 'fixture.example',
  contact_id: 2,
  contact_name: 'Ada Fixture',
  contact_email: 'ada@fixture.example',
  role_title: 'Product intern',
  role_url: null,
  status: 'contacted',
  last_contacted_at: '2026-11-03',
  notes: 'Met at a demo day',
  created_at: '2026-11-01T00:00:00Z',
  next_follow_up: null,
};
const followUp: FollowUp = {
  id: 9,
  outreach_id: 7,
  due_at: '2000-01-01',
  status: 'pending',
  completed_at: null,
  notes: 'Bump the thread',
  company_id: 3,
  company_name: 'Fixture Labs',
  role_title: 'Product intern',
  outreach_status: 'contacted',
  contact_name: 'Ada Fixture',
  contact_email: 'ada@fixture.example',
};
const routes = (overrides: Record<string, unknown> = {}) =>
  vi.mocked(api).mockImplementation(async (path: string) => {
    if (path in overrides) return overrides[path];
    if (path === '/api/outreach') return [row];
    if (path === '/api/companies') return [{ id: 3, name: 'Fixture Labs' }];
    if (path === '/api/contacts') return [];
    if (path === '/api/follow-ups') return [followUp];
    return { ok: true };
  });
const renderPage = (page: ReactElement) => render(<MemoryRouter>{page}</MemoryRouter>);

it('lists outreach, filters by stage and saves a status change', async () => {
  routes();
  const user = userEvent.setup();
  renderPage(<Outreach />);
  expect(await screen.findByText('Fixture Labs', { selector: 'strong' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'ada@fixture.example' })).toHaveAttribute(
    'href',
    'mailto:ada@fixture.example',
  );
  await user.selectOptions(screen.getByRole('combobox', { name: 'Status for Fixture Labs' }), 'interviewing');
  expect(api).toHaveBeenCalledWith('/api/outreach/7', 'PUT', { status: 'interviewing' });
  await user.click(
    within(screen.getByRole('group', { name: 'Filter by status' })).getByRole('button', { name: /Offer/ }),
  );
  expect(await screen.findByText('Nothing in “Offer”')).toBeVisible();
});

it('creates outreach for a new company with a new contact', async () => {
  routes({ '/api/outreach': [] });
  const user = userEvent.setup();
  renderPage(<Outreach />);
  const form = await screen.findByRole('form', { name: 'New outreach' });
  await user.selectOptions(within(form).getByRole('combobox', { name: 'Company' }), '__new');
  await user.type(within(form).getByRole('textbox', { name: 'New company name' }), 'Brand New Co');
  await user.selectOptions(within(form).getByRole('combobox', { name: 'Contact' }), '__new');
  await user.type(within(form).getByRole('textbox', { name: 'Contact name' }), 'Bo Fixture');
  await user.click(within(form).getByRole('button', { name: 'Add outreach' }));
  expect(api).toHaveBeenCalledWith(
    '/api/outreach',
    'POST',
    expect.objectContaining({ company_name: 'Brand New Co', contact: expect.objectContaining({ name: 'Bo Fixture' }) }),
  );
});

it('shows an empty contacts state and an overdue follow-up that can be completed', async () => {
  routes();
  const user = userEvent.setup();
  const view = renderPage(<Contacts />);
  expect(await screen.findByText('No contacts yet')).toBeVisible();
  view.unmount();
  renderPage(<FollowUps />);
  expect(await screen.findByText(/Overdue/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: /Done/ }));
  expect(api).toHaveBeenCalledWith('/api/follow-ups/9', 'PUT', { status: 'completed' });
});

it('generates an editable email draft and records a manual send', async () => {
  routes({
    '/api/email/template': { id: 1, name: 'Default', subject: 'S', body: 'B', updated_at: '' },
    '/api/email/drafts': [],
    '/api/email/generate': {
      outreach_id: 7,
      to: 'ada@fixture.example',
      subject: 'Congrats, Fixture Labs',
      body: 'Hi Ada,\n\n[Your background]',
      context: {},
    },
  });
  const user = userEvent.setup();
  renderPage(<ColdEmail />);
  const composer = await screen.findByRole('region', { name: 'Email composer' });
  await screen.findByRole('option', { name: /Fixture Labs/ });
  await user.selectOptions(within(composer).getByRole('combobox', { name: 'Outreach' }), '7');
  await user.selectOptions(within(composer).getByRole('combobox', { name: 'Lead with' }), 'GTM');
  await user.click(within(composer).getByRole('button', { name: 'Generate draft' }));
  expect(api).toHaveBeenCalledWith('/api/email/generate', 'POST', { outreach_id: 7, track: 'GTM' });
  expect(await within(composer).findByDisplayValue('Congrats, Fixture Labs')).toBeVisible();
  expect(screen.getByText(/Replace the \[bracketed\] parts/)).toBeVisible();
  expect(within(composer).getByRole('link', { name: 'Open in email app' })).toHaveAttribute(
    'href',
    expect.stringMatching(/^mailto:ada%40fixture\.example\?subject=Congrats%2C%20Fixture%20Labs&body=/),
  );
  await user.click(within(composer).getByRole('button', { name: 'I sent it' }));
  expect(api).toHaveBeenCalledWith(
    '/api/email/drafts',
    'POST',
    expect.objectContaining({ outreach_id: 7, status: 'sent_manually', track: 'GTM' }),
  );
});
