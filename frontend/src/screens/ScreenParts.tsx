import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { fmt, istClock, tickerText } from './format';
import { dotLabel, pageLabel } from './paging';
import type { Page, PageGroup } from './paging';
import type { RecentItem, Summary } from './types';

export const SCREEN_NAMES = { 1: 'स्क्रीन 1', 2: 'स्क्रीन 2', 3: 'ज़िला परिषद' } as const;

/** Copies of the chip row needed so one half of the track is always wider than the strip. */
function scopeRepeats(count: number): number {
  return Math.max(1, Math.ceil(6 / Math.max(1, count)));
}

/**
 * "इस स्क्रीन पर": the PS (or ZP) of this screen, scrolling slowly. CSS-only loop: the track holds
 * the chip row twice and moves by exactly half its width, so the end meets the start seamlessly.
 */
export function ScopeStrip({ names }: { names: readonly string[] }) {
  if (names.length === 0) return <div className="tv-scope" aria-hidden="true" />;
  const row = Array.from({ length: scopeRepeats(names.length) }, () => names).flat();
  const half = (copy: number) =>
    row.map((n, i) => (
      <span key={`${String(copy)}-${String(i)}`} className="tv-scope-chip">
        {n}
      </span>
    ));
  return (
    <div className="tv-scope" data-testid="scope-strip">
      <span className="tv-scope-label">इस स्क्रीन पर</span>
      {/* data-clamp: clipped on purpose (the chips scroll through it), see e2e/layout-check.ts */}
      <div className="tv-scope-window" data-clamp>
        <div className="tv-scope-track" style={{ animationDuration: `${String(row.length * 4)}s` }}>
          <span className="tv-scope-half">{half(0)}</span>
          <span className="tv-scope-half" aria-hidden="true">
            {half(1)}
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * "इस स्क्रीन पर" on the PS screens: the same chips as ScopeStrip, but static buttons. A click jumps to
 * the first page of that PS; the PS on show is marked (▸, underline, light chip). If the names do not
 * fit, the row scrolls sideways inside itself and keeps the marked PS in view.
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
  const row = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = row.current;
    const on = el?.querySelector<HTMLElement>('[aria-current="true"]');
    if (!el || !on) return;
    if (on.offsetLeft < el.scrollLeft) el.scrollLeft = on.offsetLeft;
    else if (on.offsetLeft + on.offsetWidth > el.scrollLeft + el.clientWidth)
      el.scrollLeft = on.offsetLeft + on.offsetWidth - el.clientWidth;
  }, [current]);
  if (groups.length === 0) return <div className="tv-scope" aria-hidden="true" />;
  return (
    <nav className="tv-scope" data-testid="ps-strip" aria-label="इस स्क्रीन पर">
      <span className="tv-scope-label">इस स्क्रीन पर</span>
      {/* data-clamp: may scroll sideways on purpose when the names do not fit, see e2e/layout-check.ts */}
      <div className="tv-scope-window tv-scope-static" data-clamp ref={row}>
        {groups.map((g) => {
          const on = g.key === current;
          return (
            <button
              key={g.key}
              type="button"
              className={on ? 'tv-scope-chip tv-scope-chip-on' : 'tv-scope-chip'}
              aria-current={on ? 'true' : undefined}
              onClick={() => {
                onPick(g.first);
              }}
            >
              {on && <span aria-hidden="true">▸ </span>}
              {g.name}
            </button>
          );
        })}
      </div>
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
