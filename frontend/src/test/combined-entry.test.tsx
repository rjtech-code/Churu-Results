// Part 14: the PS desk's combined PS + ZP parchi screen.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/api';
import type { BallotCandidate, BoothsResponse, CombinedBooth, CombinedSection } from '../api/types';
import { CombinedEntryPage } from '../pages/CombinedEntryPage';
import { WardListPage } from '../pages/WardListPage';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('../api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/api')>()),
  api: apiMock,
}));

const cand = (
  candidateId: number,
  ballotPosition: number,
  nameHindi: string,
  isNota = false,
): BallotCandidate => ({
  candidateId,
  ballotPosition,
  nameHindi,
  partyShortName: null,
  isNota,
});
const PS_BALLOT = [cand(1, 1, 'अमर सिंह'), cand(2, 2, 'भरत कुमार'), cand(3, 3, 'नोटा', true)];
const ZP_BALLOT = [cand(11, 1, 'कमला देवी'), cand(12, 2, 'सीता देवी'), cand(13, 3, 'नोटा', true)];

function section(ballotFor: 'PS' | 'ZP', over: Partial<CombinedSection> = {}): CombinedSection {
  return {
    ballotFor,
    wardId: ballotFor === 'PS' ? 100 : 200,
    wardNo: ballotFor === 'PS' ? 4 : 7,
    state: 'OPEN',
    hiddenReason: null,
    ballot: ballotFor === 'PS' ? PS_BALLOT : ZP_BALLOT,
    entry: null,
    ...over,
  };
}
function combined(ps: CombinedSection, zp: CombinedSection): CombinedBooth {
  return {
    booth: {
      boothId: 9,
      boothNo: 3,
      nameHindi: 'विद्यालय 3',
      panchayatSamiti: 'चूरू',
      registeredVotersTotal: 900,
    },
    sections: [ps, zp],
  };
}
const BOOTHS: BoothsResponse = { booths: [], postal: { entered: false, entryId: null, enteredAt: null } };

function serve(view: CombinedBooth) {
  apiMock.mockImplementation((method: string, path: string) => {
    if (method === 'GET' && path === '/api/counting/booths/9/combined') return Promise.resolve(view);
    if (method === 'GET' && path === '/api/counting/wards/100/booths') return Promise.resolve(BOOTHS);
    return Promise.reject(new Error(`unexpected ${method} ${path}`));
  });
}

function renderPage() {
  const router = createMemoryRouter(
    [
      { path: '/booths/:boothId/entry', element: <CombinedEntryPage /> },
      { path: '/wards/:wardId', element: <p>वार्ड पेज</p> },
    ],
    { initialEntries: ['/booths/9/entry'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

async function fill(prefix: string, ballot: BallotCandidate[], votes: number[], total: number) {
  const user = userEvent.setup();
  for (const [i, c] of ballot.entries()) {
    const input = document.getElementById(`${prefix}-c${c.candidateId}`) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, String(votes[i]));
  }
  const totalInput = document.getElementById(`${prefix}-total`) as HTMLInputElement;
  await user.clear(totalInput);
  await user.type(totalInput, String(total));
}

beforeEach(() => {
  apiMock.mockReset();
});

describe('CombinedEntryPage', () => {
  it('shows both parts with their ward numbers and one "आगे"', async () => {
    serve(combined(section('PS'), section('ZP')));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'पंचायत समिति — वार्ड 4' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'जिला परिषद — वार्ड 7' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'आगे' })).toHaveLength(1);
    expect(screen.getByLabelText('राउंड संख्या')).toBeTruthy(); // once, in the first part
  });

  it('a ZP mismatch is caught on the screen; nothing is sent', async () => {
    serve(combined(section('PS'), section('ZP')));
    renderPage();
    await screen.findByRole('heading', { name: 'जिला परिषद — वार्ड 7' });
    await fill('entry', PS_BALLOT, [10, 5, 1], 16);
    await fill('zp', ZP_BALLOT, [8, 4, 1], 14);
    await userEvent.setup().click(screen.getByRole('button', { name: 'आगे' }));
    expect((await screen.findByRole('alert')).textContent).toContain('जिला परिषद: आपका जोड़ 13');
    expect(apiMock).not.toHaveBeenCalledWith('POST', expect.anything(), expect.anything());
  });

  it('sends both parts in ONE request after the confirm step', async () => {
    serve(combined(section('PS'), section('ZP')));
    const router = renderPage();
    await screen.findByRole('heading', { name: 'जिला परिषद — वार्ड 7' });
    await fill('entry', PS_BALLOT, [10, 5, 1], 16);
    await fill('zp', ZP_BALLOT, [8, 4, 1], 13);
    const posts: unknown[] = [];
    const get = apiMock.getMockImplementation();
    apiMock.mockImplementation((method: string, path: string, body?: unknown) => {
      if (method === 'POST') {
        posts.push([path, body]);
        return Promise.resolve(
          path.endsWith('/preview')
            ? {
                roundNo: 1,
                warnings: [],
                sections: [
                  { ballotFor: 'PS', wardId: 100, sheetTotal: 16, sum: 16, votes: [] },
                  { ballotFor: 'ZP', wardId: 200, sheetTotal: 13, sum: 13, votes: [] },
                ],
              }
            : { entries: [], warnings: [] },
        );
      }
      return get?.(method, path, body) as Promise<unknown>;
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'आगे' }));
    await user.click(await screen.findByRole('button', { name: 'पुष्टि करें और सेव करें' }));
    await screen.findByText('वार्ड पेज');
    expect(router.state.location.pathname).toBe('/wards/100');
    const votes = (ids: number[], n: number[]) => ids.map((candidateId, i) => ({ candidateId, votes: n[i] }));
    const expected = {
      boothId: 9,
      roundNo: 1,
      ps: { sheetTotal: 16, votes: votes([1, 2, 3], [10, 5, 1]) },
      zp: { sheetTotal: 13, votes: votes([11, 12, 13], [8, 4, 1]) },
    };
    expect(posts).toEqual([
      ['/api/counting/entries/combined/preview', expected],
      ['/api/counting/entries/combined', expected],
    ]);
  });

  it('a part saved by the ZP RO shows its numbers with edit/void; only the open part is sent', async () => {
    const entry = {
      id: 55,
      kind: 'BOOTH' as const,
      wardId: 200,
      boothId: 9,
      ballotFor: 'ZP' as const,
      roundNo: 2,
      sheetTotal: 13,
      rowVersion: 1,
      enteredBy: null,
      enteredAt: '2026-11-20T05:00:00.000Z',
      updatedBy: null,
      updatedAt: null,
      votes: [
        { candidateId: 11, votes: 8 },
        { candidateId: 12, votes: 4 },
        { candidateId: 13, votes: 1 },
      ],
    };
    serve(combined(section('PS'), section('ZP', { state: 'SAVED', entry })));
    renderPage();
    const zpPart = await screen.findByRole('region', { name: 'जिला परिषद — वार्ड 7' });
    expect(zpPart.textContent).toContain('✓ दर्ज — राउंड 2');
    expect(screen.getByRole('link', { name: 'सुधारें' }).getAttribute('href')).toBe('/entries/55/edit');
    expect(screen.getByRole('link', { name: 'रद्द करें' }).getAttribute('href')).toBe('/entries/55/void');
    expect(document.getElementById('zp-total')).toBeNull();
    expect(screen.getAllByTestId('confirm-votes').map((e) => e.textContent)).toEqual(['8', '4', '1']);
  });

  it.each([
    ['UNOPPOSED', 'निर्विरोध'],
    ['NO_CANDIDATES', 'उम्मीदवार सूची नहीं'],
    ['NOT_LOCKED', 'लॉक नहीं'],
    ['DECLARED', 'परिणाम घोषित'],
  ] as const)('hides a %s ZP part (no fields, a short note)', async (reason, text) => {
    serve(combined(section('PS'), section('ZP', { state: 'HIDDEN', hiddenReason: reason, ballot: [] })));
    renderPage();
    const zpPart = await screen.findByRole('region', { name: 'जिला परिषद — वार्ड 7' });
    expect(zpPart.textContent).toContain(text);
    expect(document.getElementById('zp-total')).toBeNull();
    expect(document.getElementById('entry-total')).not.toBeNull();
  });

  it('a server refusal names the part it is about', async () => {
    serve(combined(section('PS'), section('ZP')));
    renderPage();
    await screen.findByRole('heading', { name: 'जिला परिषद — वार्ड 7' });
    await fill('entry', PS_BALLOT, [10, 5, 1], 16);
    await fill('zp', ZP_BALLOT, [800, 100, 1], 901);
    const get = apiMock.getMockImplementation();
    apiMock.mockImplementation((method: string, path: string, body?: unknown) =>
      method === 'POST'
        ? Promise.reject(new ApiError(400, 'EXCEEDS_REGISTERED_VOTERS', { section: 'ZP' }))
        : (get?.(method, path, body) as Promise<unknown>),
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'आगे' }));
    expect((await screen.findByRole('alert')).textContent).toContain('जिला परिषद:');
  });
});

describe('WardListPage (ZP_RO): booths entered per PS', () => {
  it('shows "चूरू 30/33, चूरू उत्तर 12/40" under the ward total', async () => {
    apiMock.mockImplementation((method: string, path: string) =>
      method === 'GET' && path === '/api/counting/wards'
        ? Promise.resolve({
            wards: [
              {
                id: 200,
                kind: 'ZP',
                wardNo: 7,
                panchayatSamiti: null,
                ballotLocked: true,
                isUnopposed: false,
                status: 'COUNTING',
                boothsEntered: 42,
                boothsTotal: 73,
                postalEntered: false,
                boothsByPs: [
                  { psId: 1, psName: 'चूरू', entered: 30, total: 33 },
                  { psId: 2, psName: 'चूरू उत्तर', entered: 12, total: 40 },
                ],
              },
            ],
          })
        : Promise.reject(new Error(`unexpected ${method} ${path}`)),
    );
    const router = createMemoryRouter([{ path: '/wards', element: <WardListPage /> }], {
      initialEntries: ['/wards'],
    });
    render(<RouterProvider router={router} />);
    expect((await screen.findByTestId('booths-by-ps')).textContent).toBe('चूरू 30/33, चूरू उत्तर 12/40');
  });
});
