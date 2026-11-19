// Screens 1 and 2 are the same screen with different Panchayat Samitis on them, so their header
// chip row must be the SAME component and behave identically — same slide, same pace, same marked
// chip, same edge fade. Nothing may be wired up per screen: a screen that quietly got a different
// row is how screen 2 came to sit there clipped while screen 1 slid (Nov 2026).
//
// Screen 3 is the one that differs, and on purpose: its strip stands still, as the DEO asked.
import { render, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PsBlock, ScreenBundle, WardCard } from '../../screens/types';

const ROOM = 900;
const CHIPS = 1800; // far too wide for the row, on either screen

const ward = (wardId: number): WardCard => ({
  wardId,
  wardNo: wardId,
  status: 'COUNTING',
  boothsEntered: 1,
  boothsTotal: 2,
  postalEntered: false,
  top3: [],
  margin: null,
  topTied: false,
  notaVotes: 0,
  winner: null,
  declarationVersion: null,
  isCorrected: false,
  isUnopposed: false,
  reservationCategory: null,
});

const block = (id: number, name: string): PsBlock => ({
  panchayatSamiti: { id, name },
  summary: { wardsTotal: 2, declared: 0, unopposed: 0, counting: 2, notStarted: 0 },
  wards: [ward(id * 100), ward(id * 100 + 1)],
});

/** The same Panchayat Samitis on both screens, so any difference in the row is the row's own. */
const BLOCKS: PsBlock[] = [
  block(1, 'चांदगोठी मुख्यालय राजगढ़'),
  block(2, 'तारानगर पश्चिम (भालेरी) मुख्यालय तारानगर'),
  block(3, 'चूरू उत्तर मुख्यालय चूरू'),
];

const bundle: ScreenBundle = {
  version: 1,
  generatedAt: '2026-11-20T10:00:00.000Z',
  off: false,
  ps: { version: 1, generatedAt: '2026-11-20T10:00:00.000Z', panchayatSamitis: BLOCKS },
  zp: {
    version: 1,
    generatedAt: '2026-11-20T10:00:00.000Z',
    zp: {
      summary: { wardsTotal: 2, declared: 0, unopposed: 0, counting: 2, notStarted: 0 },
      wards: [ward(9)],
    },
    partySeats: [],
    psPartySeats: [],
  },
  recent: [],
  winners: [],
};

vi.mock('../../screens/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../screens/hooks')>();
  return {
    ...actual,
    useLiveFeed: () => ({
      bundle,
      stale: false,
      unavailable: false,
      failed: false,
      changed: new Set<number>(),
      locked: false,
      off: false,
    }),
  };
});

const { ScreenApp } = await import('../../screens/ScreenApp');

/** The chip row of one screen, exactly as that screen renders it (throws if the screen has none). */
function stripOf(n: 1 | 2): HTMLElement {
  const { container } = render(
    <MemoryRouter initialEntries={[`/screen/${String(n)}?interval=120`]}>
      <Routes>
        <Route path="/screen/:n" element={<ScreenApp />} />
      </Routes>
    </MemoryRouter>,
  );
  const strip = container.querySelector<HTMLElement>('[data-testid="ps-strip"]');
  if (strip === null) throw new Error(`screen ${String(n)} rendered no chip row`);
  return strip;
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ): number {
    if (this.classList.contains('tv-scope-copy')) return CHIPS;
    if (this.classList.contains('tv-scope-window-line')) return ROOM;
    return 0;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('screens 1 and 2 share one chip row', () => {
  it('given the same Panchayat Samitis they render exactly the same markup', () => {
    // Byte for byte: one component, one set of classes, one marked chip, one decorative copy.
    expect(stripOf(2).outerHTML).toBe(stripOf(1).outerHTML);
  });

  it('both slide, both carry the edge fade, both mark the Panchayat Samiti on show', () => {
    for (const n of [1, 2] as const) {
      const s = stripOf(n);
      const where = `screen ${String(n)}`;
      expect(s.querySelector('.tv-scope-track-sliding'), where).not.toBeNull();
      expect(s.querySelector('.tv-scope-window-sliding'), where).not.toBeNull();
      expect(s.querySelector('[data-testid="ps-strip-shadow"]'), where).not.toBeNull();
      expect(s.querySelectorAll('button.tv-scope-chip'), where).toHaveLength(BLOCKS.length);
      const on = s.querySelector('[aria-current="true"]');
      expect(on?.className, where).toContain('tv-scope-chip-on');
      expect(on?.textContent, where).toContain('चांदगोठी मुख्यालय राजगढ़');
      // Every Panchayat Samiti of the screen is there to click, with its full name.
      for (const b of BLOCKS)
        expect(within(s).getByRole('button', { name: b.panchayatSamiti.name }), where).toBeTruthy();
    }
  });

  it('and both run at the same pace for the same names', () => {
    const lapOf = (n: 1 | 2) =>
      stripOf(n)
        .querySelector<HTMLElement>('[data-testid="ps-strip-track"]')
        ?.style.getPropertyValue('--tv-scope-lap');
    expect(lapOf(2)).toBe(lapOf(1));
    expect(lapOf(1)).not.toBe('');
  });
});

describe('screen 3 keeps its still strip', () => {
  it('no sliding row, no track, no second copy', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/screen/3?interval=120']}>
        <Routes>
          <Route path="/screen/:n" element={<ScreenApp />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(container.querySelector('[data-testid="ps-strip"]')).toBeNull();
    expect(container.querySelector('[data-testid="ps-strip-track"]')).toBeNull();
    expect(container.querySelector('.tv-scope-track-sliding')).toBeNull();
    expect(container.querySelector('[data-testid="scope-strip"]')).not.toBeNull();
  });
});
