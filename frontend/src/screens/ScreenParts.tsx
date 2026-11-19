import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { fmt, istClock, tickerText } from './format';
import { dotLabel, pageLabel } from './paging';
import type { Page, PageGroup } from './paging';
import type { RecentItem, Summary } from './types';

export const SCREEN_NAMES = { 1: 'स्क्रीन 1', 2: 'स्क्रीन 2', 3: 'ज़िला परिषद' } as const;

/**
 * "इस स्क्रीन पर": the PS (or ZP) of this screen. It stands still (DEO, Nov 2026 — a moving strip is
 * hard to read across a hall) and wraps onto a second line when the names do not fit on one, so no
 * name is ever cut off.
 */
export function ScopeStrip({ names }: { names: readonly string[] }) {
  if (names.length === 0) return <div className="tv-scope" aria-hidden="true" />;
  return (
    <div className="tv-scope" data-testid="scope-strip">
      <span className="tv-scope-label">इस स्क्रीन पर</span>
      <div className="tv-scope-window">
        {names.map((n) => (
          <span key={n} className="tv-scope-chip">
            {n}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * How fast the Panchayat Samiti row slides, in pixels per second. The pace is what matters, not the
 * duration: these are TVs read from across a hall, so a longer row takes longer rather than moving
 * faster. At 70 px/s a name needs about 13 seconds to cross the row.
 */
export const SCOPE_SLIDE_PX_PER_S = 70;

/** The gap between two chips — and so between the last chip of one copy and the first of the next. */
const SCOPE_CHIP_GAP_PX = 12;

/** The seconds a lap takes at the reading pace, for a run of `runPx` pixels. */
export function scopeSlideSeconds(runPx: number): number {
  return Math.max(1, runPx) / SCOPE_SLIDE_PX_PER_S;
}

/**
 * One line of chips that slides leftwards without end — or stands still while the chips already fit
 * in the row, because a still row is easier to read and short names need no help.
 *
 * Seamless: the chips are rendered twice (the second copy is decoration — plain spans, aria-hidden,
 * never focusable, never counted) and one lap moves the track by exactly one copy plus one gap, so
 * the instant the animation restarts, copy 2 is standing where copy 1 began. Nothing jumps and no
 * blank gap passes the screen.
 *
 * CSS does all the animating: no JS timer, nothing that can fight the 2-second poll or the live
 * feed. The only thing measured is width, and it is measured again whenever the chips change (a
 * screen switching Panchayat Samitis, a name corrected) or the row is resized — which is also when
 * the fonts finish loading.
 *
 * No prefers-reduced-motion fallback on purpose: with these names the only alternative is a line
 * the hall cannot read to the end.
 */
function ScopeSlider({
  chips,
  shadow,
  signature,
}: {
  /** The real chips (buttons). */
  chips: ReactNode;
  /** The same chips as decoration, for the seam. */
  shadow: ReactNode;
  /** Changes whenever the chips do, so the width is measured again. */
  signature: string;
}) {
  const windowRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const copyRef = useRef<HTMLDivElement | null>(null);
  const [sliding, setSliding] = useState(false);

  useLayoutEffect(() => {
    const row = windowRef.current;
    const track = trackRef.current;
    const copy = copyRef.current;
    if (row === null || track === null || copy === null) return;
    const measure = () => {
      const chipsWidth = copy.getBoundingClientRect().width;
      const run = chipsWidth + SCOPE_CHIP_GAP_PX;
      // CSSOM, like useStageScale: the screens set their variables this way, never inline.
      track.style.setProperty('--tv-scope-run', `${String(Math.round(run))}px`);
      track.style.setProperty('--tv-scope-lap', `${scopeSlideSeconds(run).toFixed(2)}s`);
      setSliding(chipsWidth > row.clientWidth + 1);
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(row);
    observer?.observe(copy);
    return () => {
      observer?.disconnect();
    };
  }, [signature]);

  return (
    <div
      className={`tv-scope-window tv-scope-window-line${sliding ? ' tv-scope-window-sliding' : ''}`}
      /* The row is wider than its window ON PURPOSE while it slides: the layout check skips it,
         the way it skips a name clamped to two lines. A row that does NOT slide is still checked. */
      data-slides={sliding ? 'true' : undefined}
      ref={windowRef}
    >
      <div
        className={`tv-scope-track${sliding ? ' tv-scope-track-sliding' : ''}`}
        data-testid="ps-strip-track"
        ref={trackRef}
      >
        <div className="tv-scope-copy" ref={copyRef}>
          {chips}
        </div>
        {sliding && (
          <div className="tv-scope-copy" aria-hidden="true" data-testid="ps-strip-shadow">
            {shadow}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * "इस स्क्रीन पर" on the PS screens: one chip per Panchayat Samiti of this screen, as buttons. A
 * click jumps to the first page of that PS; the PS on show is marked (▸, underline, light chip).
 *
 * The row is ONE line that slides when it is too long for the header (ScopeSlider). The Nov 2026
 * names are long enough that it no longer fitted — it wrapped onto a second line and the header cut
 * that line off. Screen 3's single chip (ScopeStrip) still stands still, as the DEO asked.
 */
export function PsStrip({
  groups,
  current,
  onPick,
}: {
  groups: readonly PageGroup[];
  current: string | null;
  onPick: (page: number) => void;
}) {
  if (groups.length === 0) return <div className="tv-scope" aria-hidden="true" />;
  const chipClass = (on: boolean) => (on ? 'tv-scope-chip tv-scope-chip-on' : 'tv-scope-chip');
  const marker = (on: boolean) => (on ? <span aria-hidden="true">▸ </span> : null);
  return (
    <nav className="tv-scope" data-testid="ps-strip" aria-label="इस स्क्रीन पर">
      <span className="tv-scope-label">इस स्क्रीन पर</span>
      <ScopeSlider
        signature={groups.map((g) => g.name).join('|') + (current ?? '')}
        chips={groups.map((g) => {
          const on = g.key === current;
          return (
            <button
              key={g.key}
              type="button"
              className={chipClass(on)}
              aria-current={on ? 'true' : undefined}
              onClick={() => {
                onPick(g.first);
              }}
            >
              {marker(on)}
              {g.name}
            </button>
          );
        })}
        shadow={groups.map((g) => (
          <span key={g.key} className={chipClass(g.key === current)}>
            {marker(g.key === current)}
            {g.name}
          </span>
        ))}
      />
    </nav>
  );
}

export function ScreenHeader({
  name,
  scope,
  generatedAt,
  live,
  progress,
}: {
  name: string;
  /** The middle of the header: PsStrip on the PS screens, ScopeStrip on the ZP screen. */
  scope: ReactNode;
  generatedAt: string | null;
  live: boolean;
  progress: { declared: number; total: number } | null;
}) {
  return (
    <header className="tv-header">
      <div className="tv-header-group tv-header-left">
        <h1 className="tv-title">चूरू पंचायत चुनाव 2026 — परिणाम</h1>
        <span className="tv-screen-name">{name}</span>
      </div>
      {scope}
      <div className="tv-header-group tv-header-right">
        {progress !== null && (
          <span className="tv-progress" data-testid="progress">
            घोषित {fmt(progress.declared)} / {fmt(progress.total)}
          </span>
        )}
        <span className={live ? 'tv-live tv-live-on' : 'tv-live tv-live-off'}>
          <span className="tv-dot" aria-hidden="true">
            ●
          </span>{' '}
          {live ? 'लाइव' : 'लाइव नहीं'}
        </span>
        <span className="tv-updated">अंतिम अपडेट {generatedAt === null ? '—' : istClock(generatedAt)}</span>
      </div>
    </header>
  );
}

export function StaleBanner({ generatedAt }: { generatedAt: string | null }) {
  return (
    <div className="tv-stale" role="alert" data-testid="stale-banner">
      ✗ कनेक्शन टूटा — अंतिम अपडेट {generatedAt === null ? '—' : istClock(generatedAt)} (पुराना डेटा)
    </div>
  );
}

/**
 * "अभी बदला": a static row of the 3 newest changes, each a whole short sentence (cut only between
 * words). If they do not fit in the row, the last item is dropped (never cut mid-word).
 */
export function Ticker({ items }: { items: RecentItem[] }) {
  const texts = items.slice(0, 3).map(tickerText);
  const key = texts.join('|');
  const [fit, setFit] = useState({ key, count: texts.length });
  const count = fit.key === key ? fit.count : texts.length;
  const row = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = row.current;
    if (el !== null && el.scrollWidth > el.clientWidth && count > 1) setFit({ key, count: count - 1 });
  }, [key, count]);
  return (
    <div className="tv-ticker" data-testid="ticker" ref={row}>
      <span className="tv-ticker-label">अभी बदला</span>
      {texts.length === 0 ? (
        <span className="tv-ticker-item">—</span>
      ) : (
        texts.slice(0, count).map((t, i) => (
          <span key={`${String(i)}-${t}`} className="tv-ticker-item">
            {t}
          </span>
        ))
      )}
    </div>
  );
}

export function SummaryChips({ summary }: { summary: Summary }) {
  return (
    <span className="tv-chips">
      <span className="tv-chip tone-green">घोषित {fmt(summary.declared)}</span>
      <span className="tv-chip tone-teal">निर्विरोध {fmt(summary.unopposed)}</span>
      <span className="tv-chip tone-blue">मतगणना जारी {fmt(summary.counting)}</span>
      <span className="tv-chip tone-grey">शुरू नहीं {fmt(summary.notStarted)}</span>
    </span>
  );
}

export function PageHeader({ page }: { page: Page }) {
  return (
    <div className="tv-page-head">
      <h2 className="tv-page-title" data-testid="page-title">
        {pageLabel(page)}
      </h2>
      <SummaryChips summary={page.summary} />
    </div>
  );
}

/** One dot per page; each is a button that jumps to its page (the hit area fills the footer height). */
export function PageDots({
  pages,
  index,
  onPick,
}: {
  pages: readonly Page[];
  index: number;
  onPick: (page: number) => void;
}) {
  return (
    <span className="tv-dots" data-testid="page-dots">
      {pages.map((p, i) => {
        const label = dotLabel(p, i, pages.length);
        return (
          <button
            key={p.key}
            type="button"
            className={i === index ? 'tv-page-dot tv-page-dot-on' : 'tv-page-dot'}
            aria-label={label}
            title={label}
            aria-current={i === index ? 'page' : undefined}
            onClick={() => {
              onPick(i);
            }}
          >
            ●
          </button>
        );
      })}
    </span>
  );
}

export function PagerFooter({
  pages,
  index,
  onPick,
}: {
  pages: Page[];
  index: number;
  onPick: (page: number) => void;
}) {
  const next = pages[(index + 1) % pages.length];
  return (
    <footer className="tv-footer">
      <PageDots pages={pages} index={index} onPick={onPick} />
      {pages.length > 1 && next !== undefined && <span className="tv-next">अगला: {pageLabel(next)}</span>}
    </footer>
  );
}
