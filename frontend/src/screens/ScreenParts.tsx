import { useLayoutEffect, useRef, useState } from 'react';
import { fmt, istClock, tickerText } from './format';
import { pageLabel } from './paging';
import type { Page } from './paging';
import type { RecentItem, Summary } from './types';

export const SCREEN_NAMES = { 1: 'स्क्रीन 1', 2: 'स्क्रीन 2', 3: 'ज़िला परिषद' } as const;

export function ScreenHeader({
  name,
  generatedAt,
  live,
  progress,
}: {
  name: string;
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

export function PagerFooter({ pages, index }: { pages: Page[]; index: number }) {
  const next = pages[(index + 1) % pages.length];
  return (
    <footer className="tv-footer">
      <span className="tv-dots" aria-label={`पेज ${index + 1}/${pages.length}`}>
        {pages.map((p, i) => (
          <span key={p.key} className={i === index ? 'tv-page-dot tv-page-dot-on' : 'tv-page-dot'}>
            ●
          </span>
        ))}
      </span>
      {pages.length > 1 && next !== undefined && <span className="tv-next">अगला: {pageLabel(next)}</span>}
    </footer>
  );
}
