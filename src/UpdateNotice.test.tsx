import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import UpdateNotice from './UpdateNotice';
import { api } from './lib/api';
vi.mock('./lib/api', () => ({ api: vi.fn() }));
vi.mock('./lib/database', () => ({ hasLocalServer: () => true }));
it('shows the installed/new version and requests managed restart without sending user data', async () => {
  vi.mocked(api).mockReset();
  vi.mocked(api).mockImplementation(async path =>
    path === '/api/updates/apply'
      ? { status: 'restarting' }
      : { current: '0.3.0', latest: '0.4.0', available: true, managed: true, error: null },
  );
  render(<UpdateNotice />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: '更新并重启' }));
  expect(api).toHaveBeenCalledWith('/api/updates/apply', 'POST', {});
  expect(await screen.findByText(/正在自动更新并重启/)).toBeVisible();
});
