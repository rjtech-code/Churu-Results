// The counting-data download: row counts beside the button, the .zip request, and its place ABOVE
// both reset buttons in the danger zone.
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CountingExportButton } from '../pages/superadmin/CountingExportButton';
import { SuperAdminPage } from '../pages/superadmin/SuperAdminPage';
import { OV, overview } from './superadminFixture';

const apiMock = vi.hoisted(() => vi.fn());
const downloadMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('../api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/api')>()),
  api: apiMock,
  downloadFile: downloadMock,
}));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ login: vi.fn(), notice: null }),
  useRole: () => 'SUPER_ADMIN',
}));

beforeEach(() => {
  apiMock.mockReset();
  downloadMock.mockClear();
});

describe('counting-data download', () => {
  it('shows the row counts and downloads the .zip', async () => {
    render(<CountingExportButton rows={OV.countingExport.rows} />);
    const box = screen.getByTestId('counting-export');
    expect(box.textContent).toContain('पहले यह download करें');
    for (const count of ['4,120', '150', '9', '11']) {
      expect(within(box).getByText(count)).toBeTruthy();
    }
    await userEvent.setup().click(screen.getByRole('button', { name: /मतगणना डेटा download/ }));
    expect(downloadMock).toHaveBeenCalledWith(
      '/api/superadmin/counting-data/export.zip',
      'churu-counting-data.zip',
    );
    expect(await screen.findByText(/डाउनलोड हो गई/)).toBeTruthy();
  });

  it('nothing to download: disabled, with a reason', () => {
    render(
      <CountingExportButton
        rows={{ boothEntries: 0, postalEntries: 0, declarations: 0, voidedEntries: 0 }}
      />,
    );
    const button = screen.getByRole('button', { name: /मतगणना डेटा download/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/download करने को कुछ नहीं/)).toBeTruthy();
  });
});

describe('its place in the danger zone', () => {
  it('sits ABOVE both reset buttons, with the "download first" line', async () => {
    apiMock.mockImplementation((_m: string, path: string) =>
      path === '/api/superadmin/overview'
        ? Promise.resolve(overview())
        : Promise.reject(new Error(`unexpected ${path}`)),
    );
    render(
      <MemoryRouter>
        <SuperAdminPage />
      </MemoryRouter>,
    );
    const narrow = await screen.findByTestId('card-counting-data');
    const full = screen.getByTestId('card-test-data');
    const exportBox = screen.getByTestId('counting-export');
    const order = (el: Element) => [...document.querySelectorAll('[data-testid]')].indexOf(el);
    expect(order(exportBox)).toBeLessThan(order(narrow));
    expect(order(exportBox)).toBeLessThan(order(full));
    expect(exportBox.textContent).toContain('पहले यह download करें');
  });
});
