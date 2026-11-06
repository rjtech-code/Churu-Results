// DM: Counting Status Report (English). Read only, refreshed every 30 s. Every number comes from
// GET /api/reports/counting-status, the same report object the PDF and the CSVs are made from.
// Before a ward is declared it shows status only: never a leading candidate.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/api';
import type {
  CountingStatusCode,
  CountingStatusView,
  CsKind,
  CsKindSummary,
  CsPsRow,
  CsWardRow,
} from '../../api/reportTypes';
import { ErrorBox } from '../../components/ErrorBox';
import { useApiData } from '../../components/useApiData';
import { REFRESH_MS } from './ReportsHomePage';
import { Bar, CS_API, CsDownloads, StatusChip, WardFlags, fmt, fmtPct } from './countingStatusParts';
import '../../styles/counting-status.css';

const KIND_LABEL: Readonly<Record<CsKind, string>> = {
  PS: 'Panchayat Samiti',
  ZP: 'Zila Parishad',
};

export function CountingStatusPage() {
  const { data, error, reload } = useApiData(() => api<CountingStatusView>('GET', CS_API), []);
  useEffect(() => {
    const t = setInterval(reload, REFRESH_MS);
    return () => {
      clearInterval(t);
    };
  }, [reload]);

  if (data === null) {
    return error === null ? (
      <p className="cs-loading" role="status">
        Loading the report…
      </p>
    ) : (
      <ErrorBox error="The report could not be loaded. Please refresh the page." />
    );
  }
  return (
    <>
      {error !== null && (
        <ErrorBox
          error={`Refresh failed. Showing the report of ${data.asOfText}; it will retry in 30 seconds.`}
        />
      )}
      <CountingStatusReportView data={data} />
    </>
  );
}

export function CountingStatusReportView({ data }: { data: CountingStatusView }) {
  return (
    <div className="cs-page">
      <header className="cs-head">
        <div>
          <h1>{data.title}</h1>
          <p className="cs-sub">{data.electionName}</p>
          <p className="cs-meta">
            {data.electionDateText}
            <span aria-hidden="true"> · </span>
            <span data-testid="cs-report-time">Last updated {data.asOfText}</span>
            <span aria-hidden="true"> · </span>
            Refreshes every 30 seconds
          </p>
        </div>
        <CsDownloads />
      </header>

      <SummaryBand kind="PS" s={data.summary.PS} stalledMinutes={data.stalledAfterMinutes} />
      <SummaryBand kind="ZP" s={data.summary.ZP} stalledMinutes={data.stalledAfterMinutes} />
      <PsTable rows={data.psTable} ps={data.summary.PS} zp={data.summary.ZP} />
      <WardTable wards={data.wards} />
      <p className="cs-note">
        Stalled = counting in progress and no entry for {data.stalledAfterMinutes} minutes. Winner and margin
        appear only after a ward is declared. Unopposed wards count as Declared and are not part of the booth
        totals.
      </p>
    </div>
  );
}

function SummaryBand({
  kind,
  s,
  stalledMinutes,
}: {
  kind: CsKind;
  s: CsKindSummary;
  stalledMinutes: number;
}) {
  const statuses: [string, number, CountingStatusCode, string | null][] = [
    ['Not Started', s.notStarted, 'NOT_STARTED', null],
    [
      'Counting In Progress',
      s.inProgress,
      'IN_PROGRESS',
      s.stalled > 0 ? `${fmt(s.stalled)} stalled (${String(stalledMinutes)}+ min)` : null,
    ],
    ['Ready To Declare', s.ready, 'READY', null],
    ['Declared', s.declared, 'DECLARED', s.unopposed > 0 ? `incl. ${fmt(s.unopposed)} unopposed` : null],
  ];
  return (
    <section className="cs-band" aria-labelledby={`cs-band-${kind}`} data-testid={`cs-summary-${kind}`}>
      <h2 id={`cs-band-${kind}`}>
        {KIND_LABEL[kind]} <span className="cs-band-count">{fmt(s.wardsTotal)} wards</span>
      </h2>
      <div className="cs-cards">
        {statuses.map(([label, value, code, note]) => (
          <div key={code} className={`cs-card cs-card-${code}`}>
            <span className="cs-card-label">{label}</span>
            <span className="cs-card-value">{fmt(value)}</span>
            {note !== null && (
              <span className={code === 'IN_PROGRESS' ? 'cs-card-note cs-bad-text' : 'cs-card-note'}>
                {note}
              </span>
            )}
          </div>
        ))}
        <div className="cs-card cs-card-wide">
          <span className="cs-card-label">Booths entered</span>
          <span className="cs-card-value">
            {fmt(s.boothsDone)} <span className="cs-card-of">/ {fmt(s.boothsTotal)}</span>
          </span>
          <Bar percent={s.boothsPercent} label={`${KIND_LABEL[kind]} booths entered`} />
          <span className="cs-card-note">
            {fmt(s.boothsPending)} pending · {fmtPct(s.boothsPercent)}
          </span>
        </div>
        <div className="cs-card">
          <span className="cs-card-label">Postal ballots entered</span>
          <span className="cs-card-value">
            {fmt(s.postalDone)} <span className="cs-card-of">/ {fmt(s.postalTotal)}</span>
          </span>
          <span className="cs-card-note">wards</span>
        </div>
        <div className="cs-card">
          <span className="cs-card-label">Last entry</span>
          <span className="cs-card-time">{s.lastEntryText ?? 'No entry yet'}</span>
          {s.checkData > 0 && (
            <span className="cs-card-note cs-warn-text">{fmt(s.checkData)} ward(s): Check Data</span>
          )}
        </div>
      </div>
    </section>
  );
}

function PsTable({ rows, ps, zp }: { rows: CsPsRow[]; ps: CsKindSummary; zp: CsKindSummary }) {
  return (
    <section className="cs-section" aria-labelledby="cs-ps-title">
      <h2 id="cs-ps-title">Panchayat Samiti-wise Progress</h2>
      <div className="cs-table-wrap">
        <table className="cs-table" data-testid="cs-ps-table">
          <thead>
            <tr>
              <th scope="col">Panchayat Samiti</th>
              <th scope="col" className="num">
                PS Wards
              </th>
              <th scope="col" className="num">
                Declared
              </th>
              <th scope="col" className="num">
                PS Booths Done / Total
              </th>
              <th scope="col" className="num">
                Pending
              </th>
              <th scope="col" className="cs-bar-col">
                Progress
              </th>
              <th scope="col" className="num">
                ZP Booths Done / Total
              </th>
              <th scope="col" className="num">
                ZP Pending
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.psId}>
                <th scope="row" title={p.psNameFull}>
                  {p.psName}
                </th>
                <td className="num">{fmt(p.wardsTotal)}</td>
                <td className="num">{fmt(p.declared)}</td>
                <td className="num">
                  {fmt(p.psBoothsDone)} / {fmt(p.psBoothsTotal)}
                </td>
                <td className="num">{fmt(p.psBoothsPending)}</td>
                <td className="cs-bar-col">
                  <span className="cs-bar-cell">
                    <Bar percent={p.psBoothsPercent} label={`${p.psName} PS booths entered`} />
                    <span className="cs-pct">{fmtPct(p.psBoothsPercent)}</span>
                  </span>
                </td>
                <td className="num">
                  {fmt(p.zpBoothsDone)} / {fmt(p.zpBoothsTotal)}
                </td>
                <td className="num">{fmt(p.zpBoothsPending)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">All Panchayat Samitis</th>
              <td className="num">{fmt(ps.wardsTotal)}</td>
              <td className="num">{fmt(ps.declared)}</td>
              <td className="num">
                {fmt(ps.boothsDone)} / {fmt(ps.boothsTotal)}
              </td>
              <td className="num">{fmt(ps.boothsPending)}</td>
              <td className="cs-bar-col">
                <span className="cs-bar-cell">
                  <Bar percent={ps.boothsPercent} label="All PS booths entered" />
                  <span className="cs-pct">{fmtPct(ps.boothsPercent)}</span>
                </span>
              </td>
              <td className="num">
                {fmt(zp.boothsDone)} / {fmt(zp.boothsTotal)}
              </td>
              <td className="num">{fmt(zp.boothsPending)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

type StatusFilter = 'ALL' | CountingStatusCode | 'STALLED' | 'CHECK';
const STATUS_FILTERS: readonly [StatusFilter, string][] = [
  ['ALL', 'All statuses'],
  ['NOT_STARTED', 'Not Started'],
  ['IN_PROGRESS', 'Counting In Progress'],
  ['STALLED', 'Stalled only'],
  ['READY', 'Ready To Declare'],
  ['DECLARED', 'Declared'],
  ['CHECK', 'Check Data'],
];

function matches(w: CsWardRow, f: StatusFilter): boolean {
  if (f === 'ALL') return true;
  if (f === 'STALLED') return w.stalled;
  if (f === 'CHECK') return w.checkData;
  return w.status === f;
}

function WardTable({ wards }: { wards: CsWardRow[] }) {
  const [kind, setKind] = useState<CsKind>('PS');
  const [psId, setPsId] = useState<number | 'ALL'>('ALL');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const psOptions = useMemo(() => {
    const seen = new Map<number, string>();
    for (const w of wards) if (w.psId !== null && w.psName !== null) seen.set(w.psId, w.psName);
    return [...seen.entries()];
  }, [wards]);
  const ofKind = wards.filter((w) => w.kind === kind);
  const shown = ofKind.filter(
    (w) => (kind === 'ZP' || psId === 'ALL' || w.psId === psId) && matches(w, status),
  );

  return (
    <section className="cs-section" aria-labelledby="cs-ward-title">
      <h2 id="cs-ward-title">Ward-wise Status</h2>
      <div className="cs-filters">
        <div className="cs-seg" role="group" aria-label="Ward type">
          {(['PS', 'ZP'] as const).map((k) => (
            <button
              key={k}
              type="button"
              className={k === kind ? 'cs-seg-btn cs-seg-on' : 'cs-seg-btn'}
              aria-pressed={k === kind}
              onClick={() => {
                setKind(k);
              }}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        {kind === 'PS' && (
          <label className="cs-select">
            <span>Panchayat Samiti</span>
            <select
              value={psId}
              onChange={(e) => {
                setPsId(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value));
              }}
            >
              <option value="ALL">All</option>
              {psOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="cs-select">
          <span>Status</span>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as StatusFilter);
            }}
          >
            {STATUS_FILTERS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <span className="cs-count" aria-live="polite">
          Showing {fmt(shown.length)} of {fmt(ofKind.length)} wards
        </span>
      </div>
      {shown.length === 0 ? (
        <p className="cs-empty">{ofKind.length === 0 ? 'No wards found.' : 'No wards match this filter.'}</p>
      ) : (
        <div className="cs-table-wrap cs-table-tall">
          <table className="cs-table" data-testid="cs-ward-table">
            <thead>
              <tr>
                {kind === 'PS' && <th scope="col">Panchayat Samiti</th>}
                <th scope="col">Ward</th>
                <th scope="col">Status</th>
                <th scope="col" className="num">
                  Booths Done / Total
                </th>
                <th scope="col" className="num">
                  Pending
                </th>
                <th scope="col" className="num">
                  Round
                </th>
                <th scope="col">Postal</th>
                <th scope="col">Last Entry</th>
                <th scope="col">Winner (Party)</th>
                <th scope="col" className="num">
                  Margin
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((w) => (
                <tr
                  key={w.wardId}
                  data-ward-id={w.wardId}
                  className={w.stalled ? 'cs-row-stalled' : undefined}
                >
                  {kind === 'PS' && <td>{w.psName}</td>}
                  <th scope="row">
                    <Link to={`/reports/counting-status/wards/${String(w.wardId)}`}>Ward {w.wardNo}</Link>
                  </th>
                  <td>
                    <span className="cs-flags">
                      <StatusChip ward={w} />
                      <WardFlags ward={w} />
                    </span>
                  </td>
                  <td className="num">
                    {w.boothsTotal === null ? '–' : `${fmt(w.boothsDone)} / ${fmt(w.boothsTotal)}`}
                  </td>
                  <td className="num">{fmt(w.boothsPending)}</td>
                  <td className="num">{fmt(w.latestRound)}</td>
                  <td>{w.postalDone === null ? 'n/a' : w.postalDone ? 'Done' : 'Pending'}</td>
                  <td className="cs-nowrap">{w.lastEntryText ?? '–'}</td>
                  <td>{w.winner === null ? '–' : `${w.winner.name} (${w.winner.party})`}</td>
                  <td className="num">{fmt(w.margin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
