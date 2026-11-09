// Small building blocks of the Counting Status Report pages (English UI). Display only: every number
// and label comes from the server's one report object; nothing here counts or adds.
import { useRef, useState } from 'react';
import { downloadFile } from '../../api/api';
import type { CountingStatusCode, CsWardRow } from '../../api/reportTypes';
import { ErrorBox } from '../../components/ErrorBox';

export const CS_API = '/api/reports/counting-status';

/** 1359 -> "1,359"; null -> "–". */
export const fmt = (n: number | null): string => (n === null ? '–' : n.toLocaleString('en-US'));
export const fmtPct = (n: number | null): string => (n === null ? '–' : `${n.toFixed(1)}%`);

const TONE: Readonly<Record<CountingStatusCode, string>> = {
  NOT_STARTED: 'cs-chip-muted',
  IN_PROGRESS: 'cs-chip-warn',
  READY: 'cs-chip-info',
  DECLARED: 'cs-chip-ok',
};

export function StatusChip({ ward }: { ward: Pick<CsWardRow, 'status' | 'statusLabel'> }) {
  return <span className={`cs-chip ${TONE[ward.status]}`}>{ward.statusLabel}</span>;
}

/** The ward's flags, each a chip with its text (never colour alone). */
export function WardFlags({ ward }: { ward: CsWardRow }) {
  const flags: [string, string][] = [];
  if (ward.stalled) flags.push(['Stalled', 'cs-chip-bad']);
  if (ward.checkData) flags.push(['Check Data', 'cs-chip-warn']);
  if (ward.unopposed) flags.push(['Unopposed', 'cs-chip-ok']);
  if (ward.noCandidates) flags.push(['No candidates', 'cs-chip-muted']);
  if (ward.tieNeedsLottery) flags.push(['Tie – lottery needed', 'cs-chip-info']);
  if (flags.length === 0) return null;
  return (
    <span className="cs-flags">
      {flags.map(([text, tone]) => (
        <span key={text} className={`cs-chip ${tone}`}>
          {text}
        </span>
      ))}
    </span>
  );
}

/** A thin bar; `percent` is the server's (rounded down) value. */
export function Bar({ percent, label }: { percent: number | null; label: string }) {
  const value = percent ?? 0;
  return (
    <span
      className="cs-bar"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
    >
      <span className="cs-bar-fill" style={{ width: `${String(Math.min(100, value))}%` }} />
    </span>
  );
}

/**
 * "Download PDF" and "Download CSV" of the chosen scope (`query`; null = selection not complete).
 * The CSV is ward-wise, or booth-wise for one ward / one booth. One download at a time: a second
 * click while one runs does nothing.
 */
export function CsDownloads({
  query,
  csv,
  zpByPs = false,
}: {
  query: string | null;
  csv: 'wards' | 'booths';
  /** Also offer the "ZP wards by Panchayat Samiti" CSV (scopes with ZP wards). */
  zpByPs?: boolean;
}) {
  const [busy, setBusy] = useState<'pdf' | 'csv' | 'zp' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false); // set synchronously, so a fast double click cannot start two

  const start = async (kind: 'pdf' | 'csv' | 'zp') => {
    if (running.current || query === null) return;
    running.current = true;
    setBusy(kind);
    setError(null);
    try {
      if (kind === 'pdf') await downloadFile(`${CS_API}.pdf?${query}`, 'counting-status.pdf');
      else if (kind === 'zp')
        await downloadFile(`${CS_API}/zp-by-ps.csv?${query}`, 'counting-status-zp-by-ps.csv');
      else await downloadFile(`${CS_API}/${csv}.csv?${query}`, `counting-status-${csv}.csv`);
    } catch {
      setError('Download failed. Please try again.');
    } finally {
      running.current = false;
      setBusy(null);
    }
  };

  const button = (kind: 'pdf' | 'csv' | 'zp', label: string) => (
    <button
      type="button"
      className="cs-btn"
      disabled={query === null || busy !== null}
      aria-busy={busy === kind}
      onClick={() => {
        void start(kind);
      }}
    >
      {busy === kind ? 'Preparing…' : label}
    </button>
  );

  return (
    <>
      {button('pdf', 'Download PDF')}
      {button('csv', 'Download CSV')}
      {zpByPs && button('zp', 'Download CSV (ZP by PS)')}
      {error !== null && (
        <div className="cs-actions-error">
          <ErrorBox error={error} />
        </div>
      )}
    </>
  );
}
