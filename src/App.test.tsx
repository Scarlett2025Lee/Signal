import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { getDashboardStats, hasLocalServer } from './lib/database';

vi.mock('./lib/database', () => ({ getDashboardStats: vi.fn(), hasLocalServer: vi.fn() }));

function renderApp(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(hasLocalServer).mockReturnValue(false);
  vi.mocked(getDashboardStats).mockReset();
});

describe('workspace navigation', () => {
  it('navigates the seven sections and marks the current destination', async () => {
    renderApp();
    const user = userEvent.setup();
    const navigation = screen.getByRole('navigation', { name: 'Main navigation' });
    const links = within(navigation).getAllByRole('link');
    expect(links).toHaveLength(7);
    for (const link of links.slice(1)) {
      await user.click(link);
      expect(link).toHaveAttribute('aria-current', 'page');
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(link.textContent!);
      // Pages that are built show their own content; the rest show the scaffold note.
      const built = ['Companies', 'Contacts', 'Outreach CRM', 'Follow-up tracker'];
      if (!built.includes(link.textContent!)) expect(screen.getByText(/This section is scaffolded/)).toBeVisible();
    }
    await user.click(within(navigation).getByRole('link', { name: 'Dashboard' }));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('A little focus.');
  });

  it('supports direct section routes and recovers unknown routes', () => {
    const view = renderApp('/companies');
    expect(screen.getByRole('heading', { level: 1, name: 'Companies' })).toBeVisible();
    view.unmount();
    renderApp('/missing');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('A little focus.');
  });
});

describe('database state', () => {
  it('does not call the server or invent counts in an offline HTML preview', () => {
    renderApp();
    expect(screen.getByRole('status')).toHaveTextContent('Offline layout preview');
    expect(getDashboardStats).not.toHaveBeenCalled();
    expect(screen.getAllByText('—')).toHaveLength(4);
  });

  it('renders actual counts returned by the local website', async () => {
    vi.mocked(hasLocalServer).mockReturnValue(true);
    vi.mocked(getDashboardStats).mockResolvedValue({
      companies: 12,
      funding_rounds: 15,
      contacts: 4,
      active_outreach: 3,
      due_follow_ups: 2,
    });
    renderApp();
    expect(await screen.findByText('Connected to your local SQLite database.')).toBeVisible();
    for (const value of ['12', '15', '3', '2']) expect(screen.getByText(value, { selector: 'strong' })).toBeVisible();
  });

  it('allows retrying a failed database read', async () => {
    vi.mocked(hasLocalServer).mockReturnValue(true);
    vi.mocked(getDashboardStats)
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce({ companies: 0, funding_rounds: 0, contacts: 0, active_outreach: 0, due_follow_ups: 0 });
    renderApp();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Connected to your local SQLite database.'),
    );
    expect(getDashboardStats).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText('0', { selector: 'strong' })).toHaveLength(4);
  });
});
