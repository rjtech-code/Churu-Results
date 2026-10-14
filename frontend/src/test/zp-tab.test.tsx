// Part 14.1: the PS_RO's "जिला परिषद" tab and the single-ballot entry form for a ZP ballot.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PsZpWardBooths } from '../api/types';
import { BoothEntryPage } from '../pages/BoothEntryPage';
import { WardListPage } from '../pages/WardListPage';
import { ZpWardPage } from '../pages/ZpWardPage';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('../api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/api')>()),
  api: apiMock,
}));
vi.mock('../auth/AuthContext', () => ({ useRole: () => 'PS_RO' }));

const ZP_WARD: PsZpWardBooths = {
  ward: { id: 200, wardNo: 7, state: 'OPEN' },
  booths: [
    {
      boothId: 9,
      panchayatSamiti: 'चूरू',
      boothNo: 3,
      nameHindi: 'विद्यालय 3',
      registeredVotersTotal: 900,
      entered: false,
      entryId: null,
      roundNo: null,
      enteredAt: null,
    },
  ],
  ballot: [
    { candidateId: 11, ballotPosition: 1, nameHindi: 'कमला देवी', partyShortName: null, isNota: false },
    { candidateId: 13, ballotPosition: 2, nameHindi: 'नोटा', partyShortName: null, isNota: true },
  ],
};

function serve() {
  apiMock.mockImplementation((method: string, path: string, body?: unknown) => {
    if (path === '/api/counting/wards') return Promise.resolve({ wards: [] });
    if (path === '/api/counting/zp-wards')
      return Promise.resolve({
        wards: [{ id: 200, wardNo: 7, state: 'OPEN', boothsEntered: 1, boothsTotal: 4 }],
      });
    if (path === '/api/counting/zp-wards/200/ps-booths') return Promise.resolve(ZP_WARD);
    if (path === '/api/counting/entries/preview')
      return Promise.resolve({
        summary: { roundNo: 1, sheetTotal: 5, votes: [] },
        warnings: [],
        body,
      }); // no wardAfter: a PS_RO never gets ZP totals
    return Promise.reject(new Error(`unexpected ${method} ${path}`));
  });
}

function renderAt(url: string) {
  const router = createMemoryRouter(
    [
      { path: '/wards', element: <WardListPage /> },
      { path: '/zp/:wardId', element: <ZpWardPage /> },
      { path: '/zp/:wardId/booths/:boothId/entry', element: <BoothEntryPage psZp /> },
    ],
    { initialEntries: [url] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  apiMock.mockReset();
  serve();
});

describe('PS_RO tabs', () => {
  it('PS tab is the default; the ZP tab is kept in the URL and lists own-PS progress', async () => {
    const router = renderAt('/wards');
    expect((await screen.findByRole('tab', { name: 'पंचायत समिति' })).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(apiMock).not.toHaveBeenCalledWith('GET', '/api/counting/zp-wards');
    await userEvent.setup().click(screen.getByRole('tab', { name: 'जिला परिषद' }));
    expect(router.state.location.search).toBe('?ballot=ZP');
    expect(await screen.findByText('1/4')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'जिला परिषद' }).getAttribute('aria-selected')).toBe('true');
  });

  it('opens straight on the ZP tab from ?ballot=ZP (refresh / back)', async () => {
    renderAt('/wards?ballot=ZP');
    expect(await screen.findByText('वार्ड 7')).toBeTruthy();
  });
});

describe('ZP ward page and entry form for a PS_RO', () => {
  it('shows only own-PS booths and no postal / declare / correction / totals', async () => {
    renderAt('/zp/200');
    expect(await screen.findByText('विद्यालय 3')).toBeTruthy();
    for (const hidden of ['डाक मत', 'घोषणा', 'संशोधन', 'लॉटरी', 'कुल योग'])
      expect(screen.queryByText(new RegExp(hidden))).toBeNull();
  });

  it('the confirm screen shows no ward totals and the save sends ballotFor ZP', async () => {
    renderAt('/zp/200/booths/9/entry');
    const user = userEvent.setup();
    await screen.findByText(/बूथ संख्या 3/);
    await user.type(document.getElementById('entry-c11') as HTMLInputElement, '4');
    await user.type(document.getElementById('entry-c13') as HTMLInputElement, '1');
    await user.type(document.getElementById('entry-total') as HTMLInputElement, '5');
    await user.click(screen.getByRole('button', { name: 'आगे' }));
    expect(await screen.findByText(/पुष्टि करें — बूथ 3/)).toBeTruthy();
    expect(screen.queryByText('सेव के बाद वार्ड का कुल योग')).toBeNull();
    expect(apiMock).toHaveBeenCalledWith(
      'POST',
      '/api/counting/entries/preview',
      expect.objectContaining({ wardId: 200, boothId: 9, ballotFor: 'ZP' }),
    );
  });
});
