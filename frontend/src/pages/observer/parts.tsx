// Small presentational pieces of the observer dashboard. Pure SVG/CSS visuals — no chart library.
// Colour is never the only signal: every status also has a label (and shape).
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { CountingPhase, ObserverWardStatus, SeatRow } from '../../api/observerTypes';
import { formatNumber, useLang } from './i18n';
import type { DictKey } from './i18n';

// ---------------------------------------------------------------- numbers

const reducedMotion = (): boolean =>
  typeof window.requestAnimationFrame !== 'function' ||
  (typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);

/** A big tabular number that counts up once on first appearance (skipped under reduced motion). */
export function Num({ value, countUp = false }: { value: number; countUp?: boolean }) {
  const [animating, setAnimating] = useState(() => countUp && !reducedMotion());
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!animating) return;
    const start = performance.now();
    const duration = 600;
    let frame = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setShown(Math.round(value * (1 - (1 - p) ** 3)));
      if (p < 1) frame = requestAnimationFrame(step);
      else setAnimating(false);
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [animating, value]);
  return <span className="obs-num">{formatNumber(animating ? shown : value)}</span>;
}

// ---------------------------------------------------------------- status

export function PhasePill({ phase }: { phase: CountingPhase }) {
  const { t } = useLang();
  const key: DictKey =
    phase === 'COMPLETED'
      ? 'countingCompleted'
      : phase === 'IN_PROGRESS'
        ? 'countingInProgress'
        : 'countingNotStarted';
  return (
    <span className={`obs-pill obs-pill-${phase.toLowerCase().replace('_', '-')}`}>
      <span className="obs-pill-dot" aria-hidden="true" />
      {t(key)}
    </span>
  );
}

export function statusKey(row: {
  status: ObserverWardStatus;
  unopposed: boolean;
  noCandidates: boolean;
  tieNeedsLottery: boolean;
}): DictKey {
  if (row.unopposed) return 'unopposed';
  if (row.noCandidates) return 'noCandidates';
  if (row.tieNeedsLottery) return 'tie';
  if (row.status === 'DECLARED') return 'declared';
  if (row.status === 'READY') return 'ready';
  if (row.status === 'IN_PROGRESS') return 'inProgress';
  return 'notStarted';
}

export function StatusChip({
  row,
}: {
  row: { status: ObserverWardStatus; unopposed: boolean; noCandidates: boolean; tieNeedsLottery: boolean };
}) {
  const { t } = useLang();
  const key = statusKey(row);
  return <span className={`obs-chip obs-chip-${key}`}>{t(key)}</span>;
}

// ---------------------------------------------------------------- progress

/** A thin determinate bar with the count beside it ("48 / 106"). */
export function ProgressBar({
  done,
  total,
  label,
}: {
  done: number | null;
  total: number | null;
  label?: string;
}) {
  if (done === null || total === null) return <span className="obs-muted">—</span>;
  const pct = total === 0 ? 0 : Math.floor((done / total) * 1000) / 10;
  return (
    <span className="obs-progress" title={label}>
      <span
        className="obs-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-label={label}
      >
        <span className="obs-progress-fill" style={{ width: `${String(pct)}%` }} />
      </span>
      <span className="obs-progress-count">
        {formatNumber(done)} / {formatNumber(total)}
      </span>
    </span>
  );
}

/** A quiet SVG ring for the PS cards. */
export function ProgressRing({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : done / total;
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <svg className="obs-ring" viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
      <circle cx="32" cy="32" r={r} className="obs-ring-track" strokeWidth="5" fill="none" />
      <circle
        cx="32"
        cy="32"
        r={r}
        className="obs-ring-fill"
        strokeWidth="5"
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${String(c * pct)} ${String(c)}`}
        transform="rotate(-90 32 32)"
      />
      <text x="32" y="37" textAnchor="middle" className="obs-ring-text">
        {total === 0 ? '0' : String(Math.floor(pct * 100))}%
      </text>
    </svg>
  );
}

// ---------------------------------------------------------------- party seats

/** Horizontal seat bars: solid = won, outlined extension = leading. */
export function SeatBars({ rows }: { rows: SeatRow[] }) {
  const { t } = useLang();
  if (rows.length === 0) return <p className="obs-muted">{t('noDeclarationsYet')}</p>;
  const max = Math.max(...rows.map((r) => r.total), 1);
  return (
    <div className="obs-seats">
      {rows.map((r) => (
        <div key={r.party.shortName ?? r.party.nameHindi} className="obs-seat-row">
          <span className="obs-seat-party" title={r.party.nameHindi}>
            {r.party.shortName ?? t('independent')}
          </span>
          <span className="obs-seat-track" aria-hidden="true">
            <span className="obs-seat-won" style={{ width: `${String((r.won / max) * 100)}%` }} />
            <span
              className="obs-seat-leading"
              style={{ width: `${String((r.leading / max) * 100)}%` }}
            />
          </span>
          <span className="obs-seat-nums">
            <span className="obs-seat-won-num">{formatNumber(r.won)}</span>
            <span className="obs-seat-lead-num">
              {r.leading > 0 ? `+${formatNumber(r.leading)}` : ''}
            </span>
          </span>
        </div>
      ))}
      <p className="obs-legend">
        <span className="obs-legend-won" aria-hidden="true" /> {t('won')}
        <span className="obs-legend-leading" aria-hidden="true" /> {t('leading')}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- framing

export function Panel({
  title,
  children,
  actions,
}: {
  title?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="obs-panel">
      {(title !== undefined || actions !== undefined) && (
        <header className="obs-panel-head">
          {title !== undefined && <h2 className="obs-panel-title">{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="obs-skeleton" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="obs-skeleton-line" />
      ))}
    </div>
  );
}

/** Calm inline note while a refresh fails; the last good data stays on screen. */
export function StaleNote() {
  const { t } = useLang();
  return (
    <p className="obs-stale" role="status">
      {t('loadError')}
    </p>
  );
}
