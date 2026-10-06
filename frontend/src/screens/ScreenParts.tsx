import { STATUS_LABEL, fmt, istClock, partyShort } from './format';
import { pageLabel } from './paging';
import type { Page } from './paging';
import type { RecentItem, Summary } from './types';

export const SCREEN_NAMES = { 1: 'स्क्रीन 1', 2: 'स्क्रीन 2', 3: 'ज़िला परिषद' } as const;

export function ScreenHeader({
  name,
  generatedAt,
  live,
}: {
  name: string;
  generatedAt: string | null;
  live: boolean;
}) {
  return (
    <header className="tv-header">
      <h1 className="tv-title">चूरू पंचायत चुनाव 2026 — परिणाम</h1>
      <span className="tv-screen-name">{name}</span>
      <span className={live ? 'tv-live tv-live-on' : 'tv-live tv-live-off'}>
        <span className="tv-dot" aria-hidden="true">
          ●
        </span>{' '}
        {live ? 'लाइव' : 'लाइव नहीं'}
      </span>
      <span className="tv-updated">अंतिम अपडेट {generatedAt === null ? '—' : istClock(generatedAt)}</span>
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

function recentText(r: RecentItem): string {
  const where = `${r.kind === 'ZP' ? 'ज़िला परिषद' : (r.psName ?? '')} · वार्ड ${r.wardNo}`;
  const who =
    r.leaderOrWinner === null ? '' : ` — ${r.leaderOrWinner.name} (${partyShort(r.leaderOrWinner.party)})`;
  return `${where} · ${STATUS_LABEL[r.status]}${who}`;
}

/** "अभी बदला": a static row of the newest changes (no scrolling text). */
export function Ticker({ items }: { items: RecentItem[] }) {
  return (
    <div className="tv-ticker" data-testid="ticker">
      <span className="tv-ticker-label">अभी बदला</span>
      {items.length === 0 ? (
        <span className="tv-ticker-item">—</span>
      ) : (
        items.slice(0, 3).map((r) => (
          <span key={`${r.wardId}-${r.changedAt}`} className="tv-ticker-item">
            {recentText(r)}
          </span>
        ))
      )}
    </div>
  );
}

export function SummaryChips({ summary }: { summary: Summary }) {
  return (
    <span className="tv-chips">
      <span className="tv-chip">घोषित {fmt(summary.declared)}</span>
      <span className="tv-chip">निर्विरोध {fmt(summary.unopposed)}</span>
      <span className="tv-chip">मतगणना जारी {fmt(summary.counting)}</span>
      <span className="tv-chip">शुरू नहीं {fmt(summary.notStarted)}</span>
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
