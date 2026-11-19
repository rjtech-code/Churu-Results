// The Panchayat Samiti chip row of screens 1 and 2 (PsStrip): one line that slides when the names
// are too long for the header, and stands still when they fit. Screen 3's strip (ScopeStrip) never
// slides — the DEO asked that it stand still, and that has not changed.
//
// The widths are stubbed, because jsdom lays nothing out: the row is `ROOM` wide and one copy of the
// chips is whatever the test says. They are stubbed as LAYOUT widths (offsetWidth), which is the only
// kind the row may read: the screens are a 1920x1080 stage scaled to the window by a CSS transform,
// so getBoundingClientRect() would report scaled pixels and make everything here depend on the size
// of the window. See the Nov 2026 bugs guarded below.
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PsStrip, SCOPE_CHIP_GAP_PX, SCOPE_SLIDE_PX_PER_S, ScopeStrip } from '../../screens/ScreenParts';
import type { PageGroup } from '../../screens/paging';

/** The room the header leaves the chip row. */
const ROOM = 900;
const GAP = SCOPE_CHIP_GAP_PX;

const LONG: PageGroup[] = [
  { key: 'a', name: 'चांदगोठी मुख्यालय राजगढ़', first: 0 },
  { key: 'b', name: 'तारानगर पश्चिम (भालेरी) मुख्यालय तारानगर', first: 2 },
  { key: 'c', name: 'चूरू उत्तर मुख्यालय चूरू', first: 5 },
];

/**
 * Makes one copy of the chips `chipsWidth` wide and the row ROOM wide, as a browser would lay them
 * out. A copy carries the gap that follows it, so its own box is one chip-run plus one gap.
 */
function stubWidths(chipsWidth: number): (next: number) => void {
  let chips = chipsWidth;
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
    this: HTMLElement,
  ): number {
    if (this.classList.contains('tv-scope-copy')) return chips + GAP;
    if (this.classList.contains('tv-scope-window-line')) return ROOM;
    return 0;
  });
  // Lets a test widen the chips the way a new or corrected name would.
  return (next: number) => {
    chips = next;
  };
}

const strip = () => screen.getByTestId('ps-strip');
const track = () => screen.getByTestId('ps-strip-track');
/** Throws rather than returning null, so a missing row fails the test where it is used. */
function must(root: ParentNode, selector: string): HTMLElement {
  const found = root.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`no ${selector}`);
  return found;
}
const row = () => must(strip(), '.tv-scope-window');
const lap = () => track().style.getPropertyValue('--tv-scope-lap');
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
    expect(row().className).toContain('tv-scope-window-line');
    expect(row().className).toContain('tv-scope-window-sliding');
    // The strip holds one track, and the track holds the copies — no wrapping container between.
    expect(track().parentElement).toBe(row());
  });

  it('the loop is seamless BY GEOMETRY: two equal copies, and no measured distance anywhere', () => {
    stubWidths(1400);
    render(<PsStrip groups={LONG} current="a" onPick={() => undefined} />);
    // Two copies of the same shape, so the track is exactly twice one copy and CSS can move it by
    // half of itself — one copy plus one gap — to land copy 2 exactly where copy 1 began.
    const copies = track().querySelectorAll('.tv-scope-copy');
    expect(copies).toHaveLength(2);
    expect(copies[1]?.className).toBe(copies[0]?.className);
    // The lap distance is NOT a number this component works out. It used to be (--tv-scope-run),
    // and because it was measured in scaled pixels the row snapped backwards once a lap on every
    // window that was not exactly 1920x1080. Nothing here may write a pixel distance again.
    expect(track().style.getPropertyValue('--tv-scope-run')).toBe('');
    expect(track().getAttribute('style') ?? '').not.toMatch(/px/);
  });

  it('never measures with getBoundingClientRect: the stage is scaled, so only layout px are true', () => {
    stubWidths(1400);
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect');
    render(<PsStrip groups={LONG} current="a" onPick={() => undefined} />);
    expect(sliding()).toBe(true);
    expect(rect).not.toHaveBeenCalled();
  });

  it('the same names decide the same way whatever the window scale is', () => {
    // The row's own box is laid out on the 1920 stage, so it is ROOM wide at every scale; a copy
    // that overflows it overflows it on a 1920 TV and on a small laptop window alike.
    stubWidths(ROOM + 50);
    const { unmount } = render(<PsStrip groups={LONG} current="a" onPick={() => undefined} />);
    expect(sliding()).toBe(true);
    unmount();
    vi.restoreAllMocks();
    stubWidths(ROOM - 50);
    render(<PsStrip groups={LONG} current="a" onPick={() => undefined} />);
    expect(sliding()).toBe(false);
  });

  it('the decorative copy is decoration: aria-hidden, no buttons, counted nowhere', () => {
    stubWidths(1400);
    render(<PsStrip groups={LONG} current="a" onPick={() => undefined} />);
    const shadow = screen.getByTestId('ps-strip-shadow');
    expect(shadow.getAttribute('aria-hidden')).toBe('true');
    // It carries the same names, so nothing changes as the seam passes.
    for (const g of LONG) expect(shadow.textContent).toContain(g.name);
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

  it('the gap CSS leaves after a copy is the one this file measures with', () => {
    stubWidths(1400);
    render(<PsStrip groups={LONG} current="a" onPick={() => undefined} />);
    // The row publishes the gap, so the stylesheet cannot drift from the measurement.
    expect(row().style.getPropertyValue('--tv-scope-gap')).toBe(`${String(GAP)}px`);
  });

  it('the chips stay one button per Panchayat Samiti, with one marked, while it slides', () => {
    stubWidths(1400);
    render(<PsStrip groups={LONG} current="c" onPick={() => undefined} />);
    expect(strip().querySelectorAll('button')).toHaveLength(LONG.length);
    expect(strip().querySelectorAll('[aria-current]')).toHaveLength(1);
    // The one name a click would jump to is still reachable by its name alone.
    expect(screen.getByRole('button', { name: 'चांदगोठी मुख्यालय राजगढ़' })).toBeTruthy();
  });

  it('the marked chip is marked by a class of its own, so CSS can give it readable colours', () => {
    stubWidths(1400);
    render(<PsStrip groups={LONG} current="c" onPick={() => undefined} />);
    const on = strip().querySelector('[aria-current="true"]');
    // Both classes: the colour rule is `.tv-scope-chip.tv-scope-chip-on`, which has to outweigh the
    // `color: inherit` of `button.tv-scope-chip`. With only one of them the chip came out white on
    // white — an empty pill in the header (the Nov 2026 bug).
    expect(on?.classList.contains('tv-scope-chip')).toBe(true);
    expect(on?.classList.contains('tv-scope-chip-on')).toBe(true);
    expect(on?.textContent).toContain('चूरू उत्तर मुख्यालय चूरू');
  });
});

describe('a poll leaves the slide alone', () => {
  // The screens poll every 2 seconds. A poll that brings back the same Panchayat Samitis must not
  // re-create the track or rewrite the animation: a CSS animation restarts when its element is
  // replaced, and re-setting animation-duration re-times one that is already running. Either way
  // the row would jump — which is what the hall sees as stuttering.
  const poll = () => LONG.map((g) => ({ ...g })); // a fresh array of fresh objects, as a fetch gives

  it('re-rendering with the same names keeps the very same track and animation', () => {
    stubWidths(1400);
    const { rerender } = render(<PsStrip groups={poll()} current="a" onPick={() => undefined} />);
    const before = track();
    const lapBefore = lap();
    const writes = vi.spyOn(before.style, 'setProperty');

    for (let i = 0; i < 5; i++) rerender(<PsStrip groups={poll()} current="a" onPick={() => undefined} />);

    expect(track()).toBe(before); // same node: the animation was never restarted
    expect(sliding()).toBe(true);
    expect(lap()).toBe(lapBefore);
    expect(writes).not.toHaveBeenCalled(); // nothing re-timed it either
  });

  it('turning the page moves the mark without disturbing the slide', () => {
    stubWidths(1400);
    const { rerender } = render(<PsStrip groups={poll()} current="a" onPick={() => undefined} />);
    const before = track();
    const lapBefore = lap();
    const writes = vi.spyOn(before.style, 'setProperty');

    // The pager moves to the next Panchayat Samiti, then the next: the marker moves from one chip
    // to another, so the row is exactly as wide as it was and must keep sliding undisturbed.
    rerender(<PsStrip groups={poll()} current="b" onPick={() => undefined} />);
    rerender(<PsStrip groups={poll()} current="c" onPick={() => undefined} />);

    expect(track()).toBe(before);
    expect(lap()).toBe(lapBefore);
    expect(writes).not.toHaveBeenCalled();
    expect(strip().querySelector('[aria-current="true"]')?.textContent).toContain('चूरू उत्तर मुख्यालय चूरू');
  });

  it('but a real change of the names is measured again', () => {
    const widen = stubWidths(1400);
    const { rerender } = render(<PsStrip groups={poll()} current="a" onPick={() => undefined} />);
    const lapBefore = lap();
    // A Panchayat Samiti is added to the screen, so the row really is wider now.
    widen(2000);
    rerender(
      <PsStrip
        groups={[...poll(), { key: 'd', name: 'सरदारशहर पूर्व', first: 7 }]}
        current="a"
        onPick={() => undefined}
      />,
    );
    expect(lap()).not.toBe(lapBefore);
    expect(Number(lap().replace('s', ''))).toBeCloseTo((2000 + GAP) / SCOPE_SLIDE_PX_PER_S, 1);
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
    const zp = screen.getByTestId('scope-strip');
    expect(zp.querySelector('.tv-scope-window-line')).toBeNull();
    expect(zp.querySelector('.tv-scope-track-sliding')).toBeNull();
  });
});
