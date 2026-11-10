// "प्रारूप–14 डाउनलोड" on the booth lists: only on entered (दर्ज) rows, on both pages that show the
// list (PS_RO ward page / ZP_RO read-only ZP ward page, and the PS_RO's ZP tab).
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoothItem, PsZpWardBooths, WardItem } from '../api/types';
import { WardDetailPage } from '../pages/WardDetailPage';
import { ZpWardPage } from '../pages/ZpWardPage';

const apiMock = vi.hoisted(() => vi.fn());
const downloadMock = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const role = vi.hoisted(() => ({ current: 'PS_RO' }));
vi.mock('../api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/api')>()),
  api: apiMock,
  downloadFile: downloadMock,
}));
vi.mock('../auth/AuthContext', () => ({ useRole: () => role.current }));

const booth = (boothId: number, boothNo: string, entered: boolean): BoothItem => ({
  boothId,
  panchayatSamiti: 'चूरू',
  boothNo,
  nameHindi: `विद्यालय ${boothNo}`,
  registeredVotersTotal: null,
  entered,
  entryId: entered ? boothId * 10 : null,
  enteredAt: entered ? '2026-11-20T05:00:00.000Z' : null,
});
const BOOTHS = [booth(1, '12', true), booth(2, '12A', false), booth(3, '13', true)];

const ward = (kind: 'PS' | 'ZP'): WardItem => ({
  id: 100,
  kind,
  wardNo: 4,
  panchayatSamiti: kind === 'PS' ? { id: 1, name: 'चूरू' } : null,
  ballotLocked: true,
  isUnopposed: false,
  status: 'COUNTING',
  boothsEntered: 2,
  boothsTotal: 3,
  postalEntered: false,
  boothsByPs: [],
});

function serve(kind: 'PS' | 'ZP') {
  apiMock.mockImplementation((_method: string, path: string) => {
    if (path === '/api/counting/wards') return Promise.resolve({ wards: [ward(kind)] });
    if (path === '/api/counting/wards/100/booths')
      return Promise.resolve({ booths: BOOTHS, postal: { entered: false, entryId: null, enteredAt: null } });
    if (path === '/api/counting/wards/100/zp-progress')
      return Promise.resolve({
        progress: {
          wardId: 100,
          wardNo: 4,
          unopposed: false,
          rows: [],
          postal: {
            assignedPsId: null,
            assignedPsName: null,
            label: '—',
            entered: null,
            lastEntryAt: null,
            lastEntryText: null,
          },
        },
      });
    if (path === '/api/ward-forms/100')
      return Promise.resolve({
        forms: {
          part2: { available: false, reason: 'NOT_DECLARED' },
          prarup7: { available: false, reason: 'NOT_DECLARED' },
        },
      });
    if (path === '/api/counting/zp-wards/100/ps-booths')
      return Promise.resolve({
        ward: { id: 100, wardNo: 4, state: 'OPEN' },
        progress: null,
        booths: BOOTHS,
        ballot: [],
      } satisfies PsZpWardBooths);
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

function renderAt(url: string) {
  const router = createMemoryRouter(
    [
      { path: '/wards/:wardId', element: <WardDetailPage /> },
      { path: '/zp/:wardId', element: <ZpWardPage /> },
    ],
    { initialEntries: [url] },
  );
  render(<RouterProvider router={router} />);
}

const rowOf = async (boothNo: string) =>
  (await screen.findByText(`विद्यालय ${boothNo}`)).closest('tr') as HTMLElement;
const buttonIn = (row: HTMLElement) => within(row).queryByRole('button', { name: /प्रारूप–14 डाउनलोड/ });

beforeEach(() => {
  apiMock.mockReset();
  downloadMock.mockClear();
});

describe('प्रारूप–14 button on the booth list', () => {
  it.each([
    ['PS_RO', 'PS', '/wards/100'],
    ['ZP_RO', 'ZP', '/wards/100'],
    ['PS_RO', 'ZP', '/zp/100'],
  ] as const)('%s, %s ward (%s): only entered rows have it', async (r, kind, url) => {
    role.current = r;
    serve(kind);
    renderAt(url);
    expect(buttonIn(await rowOf('12'))).not.toBeNull();
    expect(buttonIn(await rowOf('13'))).not.toBeNull();
    expect(buttonIn(await rowOf('12A'))).toBeNull();
    expect(screen.getAllByRole('button', { name: /प्रारूप–14 डाउनलोड/ })).toHaveLength(2);
  });

  it('downloads the booth sheet of the ward ballot with a clear file name', async () => {
    role.current = 'PS_RO';
    serve('ZP');
    renderAt('/zp/100');
    const button = buttonIn(await rowOf('12'));
    if (button === null) throw new Error('no button');
    await userEvent.setup().click(button);
    expect(downloadMock).toHaveBeenCalledWith(
      '/api/ward-forms/booths/1/ZP/prarup14.pdf',
      'Prarup14_ZP_4_Booth12.pdf',
    );
  });
});
