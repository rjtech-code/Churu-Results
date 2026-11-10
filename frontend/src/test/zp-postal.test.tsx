// Official order: a PS_RO enters the postal sheet of the ZP wards assigned to its PS (from the ZP
// tab, with the usual postal form); the ZP RO's ZP ward page is read-only with progress by PS.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ZpWardPsProgress } from '../api/types';
import { PostalPage } from '../pages/PostalPage';
import { WardDetailPage } from '../pages/WardDetailPage';
import { WardListPage } from '../pages/WardListPage';

const apiMock = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ role: 'PS_RO' }));
vi.mock('../api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/api')>()),
  api: apiMock,
}));
vi.mock('../auth/AuthContext', () => ({ useRole: () => auth.role }));

const BALLOT = [
  { candidateId: 11, ballotPosition: 1, nameHindi: 'कमला देवी', partyShortName: null, isNota: false },
  { candidateId: 13, ballotPosition: 2, nameHindi: 'नोटा', partyShortName: null, isNota: true },
];
const PROGRESS: ZpWardPsProgress = {
  wardId: 201,
  wardNo: 9,
  unopposed: false,
  rows: [
    {
      psId: 1,
      psName: 'RATANGARH',
      boothsDone: 4,
      boothsTotal: 6,
      latestRound: 3,
      lastEntryAt: null,
      lastEntryText: '20 Nov 2026, 11:00 AM IST',
    },
    {
      psId: 2,
      psName: 'SUJANGARH',
      boothsDone: 0,
      boothsTotal: 2,
      latestRound: null,
      lastEntryAt: null,
      lastEntryText: null,
    },
  ],
  postal: {
    assignedPsId: 1,
    assignedPsName: 'RATANGARH',
    label: 'Assigned to RATANGARH',
    entered: false,
    lastEntryAt: null,
    lastEntryText: null,
  },
};
const ZP_WARD_ITEM = {
  id: 201,
  kind: 'ZP',
  wardNo: 9,
  panchayatSamiti: null,
  ballotLocked: true,
  isUnopposed: false,
  status: 'COUNTING',
  boothsEntered: 4,
  boothsTotal: 8,
  postalEntered: false,
  boothsByPs: [],
};
const BOOTH = {
  boothId: 9,
  panchayatSamiti: 'रतनगढ़',
  boothNo: '3',
  nameHindi: 'विद्यालय 3',
  registeredVotersTotal: null,
  entered: true,
  entryId: 77,
  roundNo: 3,
  enteredAt: null,
};

beforeEach(() => {
  apiMock.mockReset();
  apiMock.mockImplementation((method: string, path: string) => {
    if (path === '/api/counting/zp-postal')
      return Promise.resolve({
        wards: [
          {
            id: 201,
            wardNo: 9,
            state: 'OPEN',
            postal: { entered: false, entryId: null, enteredAt: null },
          },
        ],
      });
    if (path === '/api/counting/zp-postal/201')
      return Promise.resolve({
        ward: { id: 201, wardNo: 9, state: 'OPEN' },
        postal: { entered: false, entryId: null, enteredAt: null },
        ballot: BALLOT,
      });
    if (path === '/api/counting/wards/201/postal/preview')
      return Promise.resolve({ summary: { sheetTotal: 5, votes: [] }, warnings: [] }); // no wardAfter
    if (path === '/api/counting/zp-wards') return Promise.resolve({ wards: [] });
    if (path === '/api/counting/wards')
      return Promise.resolve({ wards: auth.role === 'ZP_RO' ? [ZP_WARD_ITEM] : [] });
    if (path === '/api/counting/wards/201/booths')
      return Promise.resolve({
        booths: [BOOTH],
        postal: { entered: false, entryId: null, enteredAt: null },
      });
    if (path === '/api/counting/wards/201/zp-progress') return Promise.resolve({ progress: PROGRESS });
    if (path === '/api/ward-forms/201') return Promise.resolve({ forms: [] });
    return Promise.reject(new Error(`unexpected ${method} ${path}`));
  });
});

function renderAt(url: string) {
  const router = createMemoryRouter(
    [
      { path: '/wards', element: <WardListPage /> },
      { path: '/wards/:wardId', element: <WardDetailPage /> },
      { path: '/zp-postal/:wardId', element: <PostalPage psZp /> },
    ],
    { initialEntries: [url] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('PS_RO: ZP postal ballots assigned to its PS', () => {
  it('the ZP tab lists the assigned ZP ward with a link to the postal form', async () => {
    auth.role = 'PS_RO';
    renderAt('/wards?ballot=ZP');
    const list = await screen.findByTestId('zp-postal-list');
    expect(list.textContent).toContain('वार्ड 9');
    expect(screen.getByRole('link', { name: 'डाक मत दर्ज करें' }).getAttribute('href')).toBe(
      '/zp-postal/201',
    );
  });

  it('the postal form: order note, preview through the ward postal API, no ward totals', async () => {
    auth.role = 'PS_RO';
    renderAt('/zp-postal/201');
    const user = userEvent.setup();
    expect((await screen.findByTestId('postal-order-note')).textContent).toContain(
      'पहले PS Ward का Postal पूरा करें, फिर ZP Ward का',
    );
    await user.type(document.getElementById('postal-c11') as HTMLInputElement, '4');
    await user.type(document.getElementById('postal-c13') as HTMLInputElement, '1');
    await user.type(document.getElementById('postal-total') as HTMLInputElement, '5');
    await user.click(screen.getByRole('button', { name: 'आगे' }));
    expect(await screen.findByText('पुष्टि करें — डाक मत')).toBeTruthy();
    expect(screen.queryByText('सेव के बाद वार्ड का कुल योग')).toBeNull();
    expect(apiMock).toHaveBeenCalledWith(
      'POST',
      '/api/counting/wards/201/postal/preview',
      expect.objectContaining({ sheetTotal: 5 }),
    );
    expect(screen.queryByText(/राउंड/)).toBeNull(); // postal has no round
  });
});

describe('ZP_RO: ZP ward page is read-only', () => {
  it('progress by Panchayat Samiti with each PS round; no entry, edit, void or postal buttons', async () => {
    auth.role = 'ZP_RO';
    renderAt('/wards/201');
    const table = await screen.findByTestId('zp-progress');
    expect(table.textContent).toContain('RATANGARH');
    expect(table.textContent).toContain('4/6');
    expect(table.textContent).toContain('SUJANGARH');
    expect(screen.getByTestId('zp-progress-postal').textContent).toContain('RATANGARH को सौंपा गया');
    for (const name of ['एंट्री करें', 'सुधारें', 'रद्द करें', 'डाक मत दर्ज करें', 'घोषणा करें'])
      expect(screen.queryByRole('link', { name })).toBeNull();
  });
});
