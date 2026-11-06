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

const DOWNLOADS = [
  { key: 'pdf', label: 'PDF download', path: `${CS_API}.pdf`, fallback: 'counting-status.pdf' },
  {
    key: 'wards',
    label: 'CSV download (ward-wise)',
    path: `${CS_API}/wards.csv`,
    fallback: 'counting-status-wards.csv',
  },
  {
    key: 'booths',
    label: 'CSV download (booth-wise)',
    path: `${CS_API}/booths.csv`,
    fallback: 'counting-status-booths.csv',
  },
] as const;

/** The three downloads. One at a time: a second click while one runs does nothing. */
export function CsDownloads() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false); // set synchronously, so a fast double click cannot start two

  const start = async (d: (typeof DOWNLOADS)[number]) => {
    if (running.current) return;
    running.current = true;
    setBusy(d.key);
    setError(null);
    try {
      await downloadFile(d.path, d.fallback);
    } catch {
      setError('Download failed. Please try again.');
    } finally {
      running.current = false;
      setBusy(null);
    }
  };

  return (
    <div className="cs-downloads">
      <div className="cs-download-row">
        {DOWNLOADS.map((d) => (
          <button
            key={d.key}
            type="button"
            className="cs-btn"
            disabled={busy !== null}
            aria-busy={busy === d.key}
            onClick={() => {
              void start(d);
            }}
          >
            {busy === d.key ? 'Preparing…' : d.label}
          </button>
        ))}
      </div>
      <ErrorBox error={error} />
    </div>
  );
}
