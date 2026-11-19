// The Panchayat Samiti chip row of screens 1 and 2 (PsStrip): one line that slides when the names
// are too long for the header, and stands still when they fit. Screen 3's strip (ScopeStrip) never
// slides — the DEO asked that it stand still, and that has not changed.
//
// The widths are stubbed, because jsdom lays nothing out: the row is `ROOM` wide and one copy of the
// chips is whatever the test says.
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PsStrip, SCOPE_SLIDE_PX_PER_S, ScopeStrip } from '../../screens/ScreenParts';
import type { PageGroup } from '../../screens/paging';

/** The room the header leaves the chip row. */
const ROOM = 900;
const GAP = 12;

const LONG: PageGroup[] = [
  { key: 'a', name: 'चांदगोठी मुख्यालय राजगढ़', first: 0 },
  { key: 'b', name: 'तारानगर पश्चिम (भालेरी) मुख्यालय तारानगर', first: 2 },
  { key: 'c', name: 'चूरू उत्तर मुख्यालय चूरू', first: 5 },
];

/**
 * Makes one copy of the chips `copyWidth` wide and the row ROOM wide, as a browser would report
 * them. Everything else keeps jsdom's zeros.
 */
function stubWidths(copyWidth: number) {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element): DOMRect {
    // Everything but the copy keeps jsdom's own answer, which is all zeros.
    const width = this.classList.contains('tv-scope-copy') ? copyWidth : 0;
    return { width, height: width === 0 ? 0 : 40 } as DOMRect;
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ): number {
    return this.classList.contains('tv-scope-window-line') ? ROOM : 0;
  });
}

const track = () => screen.getByTestId('ps-strip-track');
const lap = () => track().style.getPropertyValue('--tv-scope-lap');
const run = () => track().style.getPropertyValue('--tv-scope-run');
const sliding = () => track().classList.contains('tv-scope-track-sliding');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the Panchayat Samiti row slides when the names do not fit', () => {
  it('one line, no wrapping, nothing clipped, no scrollbar', () => {
    stubWidths(1400);
    render(<PsStrip groups={LONG} current="b" onPick={() => undefined} />);
    expect(sliding()).toBe(true);
    // The row shows one line and hides what is outside it; it never wraps and never scrolls.
    const row = screen.getByTestId('ps-strip').querySelector('.tv-scope-window');
    expect(row?.className).toContain('tv-scope-window-line');
    expect(row?.className).toContain('tv-scope-window-sliding');
    // Every chip stays on its own line (the chips themselves are nowrap in CSS); the strip holds one
    // track, and the track holds the copies — no wrapping container anywhere in between.
    expect(track().parentElement).toBe(row);
  });

  it('the loop is seamless: a second, decorative copy, moved by exactly one copy plus one gap', () => {
    stubWidths(1400);
    render(<PsStrip groups={LONG} current="a" onPick={() => undefined} />);
    // One lap = one copy + one gap, so copy 2 lands exactly where copy 1 began.
    expect(run()).toBe(`${String(1400 + GAP)}px`);
    const shadow = screen.getByTestId('ps-strip-shadow');
    expect(shadow.getAttribute('aria-hidden')).toBe('true');
    // It carries the same names, so nothing changes as the seam passes.
    for (const g of LONG) expect(shadow.textContent).toContain(g.name);
    // Decoration only: not a button, not focusable, not counted anywhere.
    expect(shadow.querySelectorAll('button')).toHaveLength(0);
    expect(shadow.querySelectorAll('[aria-current]')).toHaveLength(0);
  });

  it('the pace is the same however long the row is (speed from the width, not a fixed duration)', () => {
    stubWidths(1400);
    const { unmount } = render(<PsStrip groups={LONG} current="a" onPick={() => undefined} />);
    const short = Number(lap().replace('s', ''));
    expect(short).toBeCloseTo((1400 + GAP) / SCOPE_SLIDE_PX_PER_S, 1);
    unmount();

    vi.restoreAllMocks();
    stubWidths(2800);
    render(<PsStrip groups={LONG} current="a" onPick={() => undefined} />);
    const long = Number(lap().replace('s', ''));
    // Twice the row takes twice the time: the names pass the eye at one reading speed.
    expect(long / short).toBeCloseTo(2, 1);
    // And that speed is slow enough for a hall: well under 100 px/s.
    expect((2800 + GAP) / long).toBeLessThan(100);
  });

  it('the chips stay one button per Panchayat Samiti, with one marked, while it slides', () => {
    stubWidths(1400);
    render(<PsStrip groups={LONG} current="c" onPick={() => undefined} />);
    const strip = screen.getByTestId('ps-strip');
    expect(strip.querySelectorAll('button')).toHaveLength(LONG.length);
    expect(strip.querySelectorAll('[aria-current]')).toHaveLength(1);
    // The one name a click would jump to is still reachable by its name alone.
    expect(screen.getByRole('button', { name: 'चांदगोठी मुख्यालय राजगढ़' })).toBeTruthy();
  });
});

describe('a row that already fits stands still', () => {
  it('no animation and no second copy', () => {
    stubWidths(ROOM - 100);
    render(<PsStrip groups={[{ key: 'a', name: 'चूरू', first: 0 }]} current="a" onPick={() => undefined} />);
    expect(sliding()).toBe(false);
    expect(screen.queryByTestId('ps-strip-shadow')).toBeNull();
  });
});

describe('screen 3 is untouched', () => {
  it('its strip has no track, no animation and no copy — it stands still', () => {
    stubWidths(4000); // even absurdly wide
    render(<ScopeStrip names={['ज़िला परिषद']} />);
    expect(screen.queryByTestId('ps-strip-track')).toBeNull();
    expect(screen.queryByTestId('ps-strip-shadow')).toBeNull();
    const strip = screen.getByTestId('scope-strip');
    expect(strip.querySelector('.tv-scope-window-line')).toBeNull();
    expect(strip.querySelector('.tv-scope-track-sliding')).toBeNull();
  });
});
