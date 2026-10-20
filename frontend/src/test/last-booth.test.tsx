// The information popup on a new entry for the last booth of a ward still to be entered.
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BallotCandidate, BoothItem, PsZpWardBooths, WardItem } from '../api/types';
import { BoothEntryPage } from '../pages/BoothEntryPage';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('../api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/api')>()),
  api: apiMock,
}));

const TITLE = 'अंतिम बूथ — सूचना';
const TEXT =
  'यह इस वार्ड का अंतिम बूथ है। विवरण दर्ज करने से पहले कृपया सुनिश्चित करें कि डाक मतपत्रों की परिणाम पर्ची आपको प्राप्त हो चुकी है।';

const ward = (id: number, kind: 'PS' | 'ZP'): WardItem => ({
  id,
  kind,
  wardNo: 4,
  panchayatSamiti: kind === 'PS' ? { id: 1, name: 'चूरू' } : null,
  ballotLocked: true,
  isUnopposed: false,
  status: 'COUNTING',
  boothsEntered: 0,
  boothsTotal: 0,
  postalEntered: false,
  boothsByPs: [],
});

const booth = (boothId: number, entered: boolean): BoothItem => ({
  boothId,
  panchayatSamiti: 'चूरू',
  boothNo: boothId,
  nameHindi: `विद्यालय ${String(boothId)}`,
  registeredVotersTotal: 900,
  entered,
  entryId: entered ? boothId * 10 : null,
  roundNo: entered ? 1 : null,
  enteredAt: entered ? '2026-11-20T10:00:00+05:30' : null,
});

const BALLOT: BallotCandidate[] = [
  { candidateId: 11, ballotPosition: 1, nameHindi: 'कमला देवी', partyShortName: null, isNota: false },
  { candidateId: 13, ballotPosition: 2, nameHindi: 'नोटा', partyShortName: null, isNota: true },
];

/** Ward 100 (PS) and 200 (ZP, as the ZP_RO sees it) with these booths; 300 is the PS_RO's ZP tab. */
function serve(booths: BoothItem[], psZpBooths: BoothItem[] = booths) {
  const zpTab: PsZpWardBooths = {
    ward: { id: 300, wardNo: 7, state: 'OPEN' },
    booths: psZpBooths,
    ballot: BALLOT,
  };
  apiMock.mockImplementation((method: string, path: string) => {
    if (path === '/api/counting/wards') return Promise.resolve({ wards: [ward(100, 'PS'), ward(200, 'ZP')] });
    if (/^\/api\/counting\/wards\/\d+\/booths$/.test(path))
      return Promise.resolve({ booths, postal: { entered: false, entryId: null, enteredAt: null } });
    if (/^\/api\/counting\/wards\/\d+\/ballot$/.test(path)) return Promise.resolve({ candidates: BALLOT });
    if (path === '/api/counting/zp-wards/300/ps-booths') return Promise.resolve(zpTab);
    return Promise.reject(new Error(`unexpected ${method} ${path}`));
  });
}

function renderAt(url: string) {
  const router = createMemoryRouter(
    [
      { path: '/wards/:wardId/booths/:boothId/entry', element: <BoothEntryPage /> },
      { path: '/zp/:wardId/booths/:boothId/entry', element: <BoothEntryPage psZp /> },
    ],
    { initialEntries: [url] },
  );
  render(<RouterProvider router={router} />);
}

/** Waits for the entry form (the page has loaded). */
const formReady = () => screen.findByLabelText('कमला देवी के मत');

// jsdom has no <dialog>.showModal(); a minimal stand-in (the real one is covered by Playwright).
beforeAll(() => {
  for (const [name, open] of [
    ['showModal', true],
    ['close', false],
  ] as const) {
    Object.defineProperty(HTMLDialogElement.prototype, name, {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.toggleAttribute('open', open);
      },
    });
  }
});
beforeEach(() => {
  apiMock.mockReset();
});

describe('last-booth information popup', () => {
  it('PS ballot: shows the exact text with one "ठीक है" button for the last remaining booth', async () => {
    serve([booth(1, true), booth(2, false), booth(3, true)]);
    renderAt('/wards/100/booths/2/entry');
    const dialog = await screen.findByRole('alertdialog', { name: TITLE });
    expect(dialog.querySelector('h2')?.textContent).toBe(TITLE);
    expect(dialog.querySelector('p')?.textContent).toBe(TEXT);
    const buttons = dialog.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toBe('ठीक है');
    expect(dialog.querySelector('input')).toBeNull(); // no checkbox
  });

  it('ZP ballot (ZP_RO, whole ZP ward listed): shows for the last remaining booth', async () => {
    serve([booth(1, true), booth(2, false)]);
    renderAt('/wards/200/booths/2/entry');
    expect(await screen.findByRole('alertdialog', { name: TITLE })).toBeTruthy();
  });

  it('a single-booth ward counts', async () => {
    serve([booth(5, false)]);
    renderAt('/wards/100/booths/5/entry');
    expect(await screen.findByRole('alertdialog', { name: TITLE })).toBeTruthy();
  });

  it('"ठीक है" closes it; the form then works as before', async () => {
    serve([booth(1, true), booth(2, false)]);
    renderAt('/wards/100/booths/2/entry');
    await userEvent.click(await screen.findByRole('button', { name: 'ठीक है' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    const votes = screen.getByLabelText('कमला देवी के मत');
    await userEvent.type(votes, '42');
    expect((votes as HTMLInputElement).value).toBe('42');
    expect(screen.getByRole('button', { name: 'आगे' })).toBeTruthy();
    expect(apiMock).not.toHaveBeenCalledWith('POST', expect.anything(), expect.anything()); // no audit/API call
  });

  it('Esc closes it', async () => {
    serve([booth(1, true), booth(2, false)]);
    renderAt('/wards/100/booths/2/entry');
    fireEvent(await screen.findByRole('alertdialog'), new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByLabelText('कमला देवी के मत')).toBeTruthy();
  });

  it('not for other booths while more than one is left', async () => {
    serve([booth(1, false), booth(2, false), booth(3, true)]);
    renderAt('/wards/100/booths/2/entry');
    await formReady();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('not for a booth that is already entered (edits are a separate page)', async () => {
    serve([booth(1, true), booth(2, true)]);
    renderAt('/wards/100/booths/2/entry');
    await formReady();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it("not on the PS_RO's ZP tab: it sees only its own PS's booths of the ZP ward", async () => {
    serve([], [booth(9, false)]);
    renderAt('/zp/300/booths/9/entry');
    await formReady();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
