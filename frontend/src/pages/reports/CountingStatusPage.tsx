// DM (and ZP RO, Zila Parishad wards only — the server enforces it): Counting Status Report as a
// simple report builder (English). Nothing is loaded or refreshed on
// its own: the DM picks a scope (whole district … one booth, optional status), then "View Report",
// "Download PDF" or "Download CSV". Every number comes from GET /api/reports/counting-status with
// that scope: the same report object the PDF and the CSV are made from. Before a ward is declared it
// shows status only, never a leading candidate.
import { useEffect, useState } from 'react';
import { api } from '../../api/api';
import type {
  CountingStatusBoothOptions,
  CountingStatusCode,
  CountingStatusOptions,
  CountingStatusView,
  CsBoothRow,
  CsKind,
  CsKindSummary,
  CsLevel,
  CsPsRow,
  CsStatusFilter,
  CsWardRow,
} from '../../api/reportTypes';
import type { ZpWardPsProgress } from '../../api/types';
import { useRole } from '../../auth/AuthContext';
import { ErrorBox } from '../../components/ErrorBox';
import { useApiData } from '../../components/useApiData';
import { Bar, CS_API, CsDownloads, StatusChip, WardFlags, fmt, fmtPct } from './countingStatusParts';
import '../../styles/counting-status.css';

const KIND_LABEL: Readonly<Record<CsKind, string>> = {
  PS: 'Panchayat Samiti',
  ZP: 'Zila Parishad',
};
const LEVELS: readonly [CsLevel, string][] = [
  ['DISTRICT', 'Whole District'],
  ['ALL_PS', 'All Panchayat Samiti wards'],
  ['ALL_ZP', 'All Zila Parishad wards'],
  ['PS', 'One Panchayat Samiti'],
  ['WARD', 'One Ward'],
  ['BOOTH', 'One Booth'],
];
/** The ZP RO: Zila Parishad only (a booth is picked through its ZP ward). */
const ZP_LEVELS: readonly [CsLevel, string][] = [
  ['ALL_ZP', 'All Zila Parishad wards'],
  ['WARD', 'One Zila Parishad ward'],
  ['BOOTH', 'One Booth'],
];
const STATUSES: readonly [CsStatusFilter, string][] = [
  ['ALL', 'All'],
  ['NOT_STARTED', 'Not Started'],
  ['IN_PROGRESS', 'Counting In Progress'],
  ['READY', 'Ready To Declare'],
  ['DECLARED', 'Declared'],
  ['STALLED', 'Stalled'],
];

export interface Selection {
  level: CsLevel | '';
  psId: string;
  wardKind: CsKind | '';
  wardId: string;
  boothId: string;
  status: CsStatusFilter;
}
export const EMPTY_SELECTION: Selection = {
  level: '',
  psId: '',
  wardKind: '',
  wardId: '',
  boothId: '',
  status: 'ALL',
};

const hasStatus = (level: CsLevel | '') => level !== '' && level !== 'WARD' && level !== 'BOOTH';

/** The query string of a complete selection; null while something required is still missing. */
export function scopeQuery(s: Selection): string | null {
  const q = new URLSearchParams();
  if (s.level === '') return null;
  q.set('level', s.level);
  if (s.level === 'PS') {
    if (s.psId === '') return null;
    q.set('psId', s.psId);
  }
  if (s.level === 'WARD') {
    if (s.wardId === '') return null;
    q.set('wardId', s.wardId);
  }
  if (s.level === 'BOOTH') {
    if (s.boothId === '') return null;
    q.set('boothId', s.boothId);
  }
  if (hasStatus(s.level) && s.status !== 'ALL') q.set('status', s.status);
  return q.toString();
}

interface Shown {
  query: string;
  data: CountingStatusView;
}

export function CountingStatusPage() {
  const zpOnly = useRole() === 'ZP_RO';
  const options = useApiData(() => api<CountingStatusOptions>('GET', `${CS_API}/options`), []);
  const [sel, setSel] = useState<Selection>(EMPTY_SELECTION);
  const [shown, setShown] = useState<Shown | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async (query: string) => {
    setLoading(true);
    setError(null);
    try {
      setShown({ query, data: await api<CountingStatusView>('GET', `${CS_API}?${query}`) });
    } catch {
      setError('The report could not be loaded. Please try again.');
    } finally {
      setLoading(false);
    }
  };
  const change = (next: Selection) => {
    setSel(next);
    setShown(null); // a report on screen always matches the selection
    setError(null);
  };

  if (options.data === null) {
    return options.error === null ? (
      <p className="cs-loading" role="status">
        Loading…
      </p>
    ) : (
      <ErrorBox error="The report options could not be loaded. Please refresh the page." />
    );
  }
  const query = scopeQuery(sel);
  return (
    <div className="cs-page">
      <header className="cs-page-head">
        <h1>Counting Status Report</h1>
        <p>Choose what to see. Nothing loads until you ask for it.</p>
      </header>
      <SelectCard
        options={options.data}
        zpOnly={zpOnly}
        sel={sel}
        onChange={change}
        query={query}
        loading={loading}
        onView={() => {
          if (query !== null) void load(query);
        }}
      />
      <ErrorBox error={error} />
      {shown !== null && (
        <ScopedReportView
          data={shown.data}
          refreshing={loading}
          onRefresh={() => {
            void load(shown.query);
          }}
          onOpenWard={(w) => {
            const next: Selection = {
              ...EMPTY_SELECTION,
              level: 'WARD',
              wardKind: w.kind,
              psId: w.psId === null ? '' : String(w.psId),
              wardId: String(w.wardId),
            };
            setSel(next);
            const q = scopeQuery(next);
            if (q !== null) void load(q);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- selection

function Select({
  label,
  value,
  onChange,
  disabled = false,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="cs-select">
      <span>{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      >
        {children}
      </select>
    </label>
  );
}

export function SelectCard({
  options,
  zpOnly = false,
  sel,
  onChange,
  query,
  loading,
  onView,
}: {
  options: CountingStatusOptions;
  /** ZP RO: only ZP levels and ZP wards; no Panchayat Samiti choice. */
  zpOnly?: boolean;
  sel: Selection;
  onChange: (s: Selection) => void;
  query: string | null;
  loading: boolean;
  onView: () => void;
}) {
  // The booths of the chosen ward, kept with the ward they belong to (a stale list is never shown).
  const [loaded, setLoaded] = useState<{
    wardId: string;
    booths: CountingStatusBoothOptions['booths'];
  } | null>(null);
  const boothWard = sel.level === 'BOOTH' ? sel.wardId : '';
  const booths = loaded !== null && loaded.wardId === boothWard ? loaded.booths : null;
  useEffect(() => {
    if (boothWard === '') return;
    let cancelled = false;
    api<CountingStatusBoothOptions>('GET', `${CS_API}/options/wards/${boothWard}/booths`).then(
      (r) => {
        if (!cancelled) setLoaded({ wardId: boothWard, booths: r.booths });
      },
      () => {
        if (!cancelled) setLoaded({ wardId: boothWard, booths: [] });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [boothWard]);

  const set = (patch: Partial<Selection>) => {
    onChange({ ...sel, ...patch });
  };
  const needsPs =
    !zpOnly &&
    (sel.level === 'PS' || sel.level === 'BOOTH' || (sel.level === 'WARD' && sel.wardKind === 'PS'));
  const wardKind: CsKind | '' = zpOnly
    ? sel.level === 'WARD' || sel.level === 'BOOTH'
      ? 'ZP'
      : ''
    : sel.level === 'BOOTH'
      ? 'PS'
      : sel.level === 'WARD'
        ? sel.wardKind
        : '';
  const wardList = options.wards.filter(
    (w) => w.kind === wardKind && (wardKind === 'ZP' || String(w.psId) === sel.psId),
  );
  const showWard = wardKind === 'ZP' || (wardKind === 'PS' && sel.psId !== '');

  return (
    <section className="cs-builder" aria-labelledby="cs-builder-title">
      <div className="cs-builder-head">
        <h2 id="cs-builder-title">Select report</h2>
        <p>Pick a level, then view the report or download it directly.</p>
      </div>
      <div className="cs-builder-fields">
        <Select
          label="Level"
          value={sel.level}
          onChange={(v) => {
            const level = v as CsLevel | '';
            onChange({ ...EMPTY_SELECTION, level, wardKind: zpOnly && level === 'WARD' ? 'ZP' : '' });
          }}
        >
          <option value="">Select…</option>
          {(zpOnly ? ZP_LEVELS : LEVELS).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        {sel.level === 'WARD' && !zpOnly && (
          <Select
            label="Ward type"
            value={sel.wardKind}
            onChange={(v) => {
              set({ wardKind: v as CsKind | '', psId: '', wardId: '' });
            }}
          >
            <option value="">Select…</option>
            <option value="PS">Panchayat Samiti ward</option>
            <option value="ZP">Zila Parishad ward</option>
          </Select>
        )}
        {needsPs && (
          <Select
            label="Panchayat Samiti"
            value={sel.psId}
            onChange={(v) => {
              set({ psId: v, wardId: '', boothId: '' });
            }}
          >
            <option value="">Select…</option>
            {options.ps.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        )}
        {showWard && (
          <Select
            label={wardKind === 'ZP' ? 'Zila Parishad ward' : 'Ward'}
            value={sel.wardId}
            onChange={(v) => {
              set({ wardId: v, boothId: '' });
            }}
          >
            <option value="">Select…</option>
            {wardList.map((w) => (
              <option key={w.id} value={w.id}>
                Ward {w.wardNo}
              </option>
            ))}
          </Select>
        )}
        {sel.level === 'BOOTH' && sel.wardId !== '' && (
          <Select
            label="Booth"
            value={sel.boothId}
            disabled={booths === null}
            onChange={(v) => {
              set({ boothId: v });
            }}
          >
            <option value="">{booths === null ? 'Loading…' : 'Select…'}</option>
            {(booths ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {wardKind === 'ZP' ? `${b.psName} · ` : ''}
                {b.boothNo} – {b.name}
              </option>
            ))}
          </Select>
        )}
        {hasStatus(sel.level) && (
          <Select
            label="Status (optional)"
            value={sel.status}
            onChange={(v) => {
              set({ status: v as CsStatusFilter });
            }}
          >
            {STATUSES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        )}
      </div>
      <div className="cs-builder-actions">
        <button
          type="button"
          className="cs-btn cs-btn-primary"
          disabled={query === null || loading}
          onClick={onView}
        >
          {loading ? 'Loading…' : 'View Report'}
        </button>
        <span className="cs-export">
          <CsDownloads
            query={query}
            csv={sel.level === 'WARD' || sel.level === 'BOOTH' ? 'booths' : 'wards'}
            zpByPs={
              sel.level === 'DISTRICT' ||
              sel.level === 'ALL_ZP' ||
              (sel.level === 'WARD' && wardKind === 'ZP')
            }
          />
        </span>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- report
// Tables carry data-label on every cell: on small screens CSS turns each row into a card
// (label left, value right) instead of a table you must scroll sideways.

export function ScopedReportView({
  data,
  refreshing,
  onRefresh,
  onOpenWard,
}: {
  data: CountingStatusView;
  refreshing: boolean;
  onRefresh: () => void;
  onOpenWard: (w: CsWardRow) => void;
}) {
  const level = data.scope.level;
  const oneWard = level === 'WARD' ? data.wards[0] : undefined;
  return (
    <section className="cs-report" aria-label="Report">
      <header className="cs-report-head">
        <div className="cs-report-title">
          <p className="cs-scope" data-testid="cs-scope">
            <strong>Scope: {data.scope.label}</strong>
            <span className="cs-scope-sep" aria-hidden="true">
              {' '}
              ·{' '}
            </span>
            <span className="cs-asof">As of {data.asOfText}</span>
          </p>
          <p className="cs-meta">
            {data.electionName} · {data.countingDateText} · {data.electionDateText}
          </p>
        </div>
        <button type="button" className="cs-btn" disabled={refreshing} onClick={onRefresh}>
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {level !== 'WARD' &&
        data.kinds.map((k) => (
          <SummaryBand
            key={k}
            kind={k}
            title={level === 'PS' ? (data.psTable[0]?.psName ?? KIND_LABEL[k]) : KIND_LABEL[k]}
            s={data.summary[k]}
            stalledMinutes={data.stalledAfterMinutes}
          />
        ))}
      {data.psTable.length > 0 && <PsTable rows={data.psTable} ps={data.summary.PS} zp={data.summary.ZP} />}
      {level !== 'WARD' && level !== 'BOOTH' && <WardTable wards={data.wards} onOpenWard={onOpenWard} />}
      {oneWard !== undefined && (
        <WardDetail ward={oneWard} booths={data.booths} byPs={data.zpPsProgress[0]} />
      )}
      {level === 'BOOTH' && <BoothTable booths={data.booths} withBallot />}
      <p className="cs-note">
        Stalled = counting in progress and no entry for {data.stalledAfterMinutes} minutes. Winner and margin
        appear only after a ward is declared. Unopposed wards count as Declared and are not part of the booth
        totals.
      </p>
    </section>
  );
}

function SummaryBand({
  kind,
  title,
  s,
  stalledMinutes,
}: {
  kind: CsKind;
  title: string;
  s: CsKindSummary;
  stalledMinutes: number;
}) {
  const tiles: [string, number, CountingStatusCode, string | null][] = [
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
    <section
      className="cs-panel cs-band"
      aria-labelledby={`cs-band-${kind}`}
      data-testid={`cs-summary-${kind}`}
    >
      <header className="cs-panel-head">
        <h2 id={`cs-band-${kind}`}>
          {title} <span className="cs-count">{fmt(s.wardsTotal)} wards</span>
        </h2>
        <span className="cs-last">
          Last entry <strong>{s.lastEntryText ?? 'No entry yet'}</strong>
        </span>
      </header>
      {/* Ward status mix: the widths are drawn by CSS from the counts; no number is computed. */}
      <div className="cs-mix" aria-hidden="true">
        {tiles.map(([, value, code]) =>
          value > 0 ? (
            <span key={code} className={`cs-mix-seg cs-tone-${code}`} style={{ flexGrow: value }} />
          ) : null,
        )}
      </div>
      <div className="cs-tiles">
        {tiles.map(([label, value, code, note]) => (
          <div key={code} className="cs-tile">
            <span className="cs-tile-label">
              <span className={`cs-dot cs-tone-${code}`} aria-hidden="true" />
              {label}
            </span>
            <span className="cs-tile-value">{fmt(value)}</span>
            {note !== null && (
              <span className={code === 'IN_PROGRESS' ? 'cs-tile-note cs-bad-text' : 'cs-tile-note'}>
                {note}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="cs-metrics">
        <div className="cs-metric cs-metric-wide">
          <span className="cs-tile-label">Booths entered</span>
          <span className="cs-metric-value">
            {fmt(s.boothsDone)} <span className="cs-of">/ {fmt(s.boothsTotal)}</span>
            <span className="cs-metric-pct">{fmtPct(s.boothsPercent)}</span>
          </span>
          <Bar percent={s.boothsPercent} label={`${title} booths entered`} />
          <span className="cs-tile-note">{fmt(s.boothsPending)} pending</span>
        </div>
        <div className="cs-metric">
          <span className="cs-tile-label">Postal ballots entered</span>
          <span className="cs-metric-value">
            {fmt(s.postalDone)} <span className="cs-of">/ {fmt(s.postalTotal)} wards</span>
          </span>
        </div>
      </div>
      {s.checkData > 0 && (
        <p className="cs-alert" role="note">
          {fmt(s.checkData)} ward(s) marked Check Data: their data needs a look.
        </p>
      )}
    </section>
  );
}

function PsTable({ rows, ps, zp }: { rows: CsPsRow[]; ps: CsKindSummary; zp: CsKindSummary }) {
  return (
    <section className="cs-section" aria-labelledby="cs-ps-title">
      <h2 id="cs-ps-title">Panchayat Samiti-wise Progress</h2>
      <div className="cs-table-wrap cs-wrap-sm">
        <table className="cs-table cs-cards-sm" data-testid="cs-ps-table">
          <thead>
            <tr>
              <th scope="col">Panchayat Samiti</th>
              <th scope="col" className="cs-num">
                PS Wards
              </th>
              <th scope="col" className="cs-num">
                Declared
              </th>
              <th scope="col" className="cs-num">
                PS Booths Done / Total
              </th>
              <th scope="col" className="cs-num">
                Pending
              </th>
              <th scope="col" className="cs-bar-col">
                Progress
              </th>
              <th scope="col" className="cs-num">
                ZP Booths Done / Total
              </th>
              <th scope="col" className="cs-num">
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
                <td className="cs-num" data-label="PS wards">
                  {fmt(p.wardsTotal)}
                </td>
                <td className="cs-num" data-label="Declared">
                  {fmt(p.declared)}
                </td>
                <td className="cs-num" data-label="PS booths">
                  {fmt(p.psBoothsDone)} / {fmt(p.psBoothsTotal)}
                </td>
                <td className="cs-num" data-label="PS pending">
                  {fmt(p.psBoothsPending)}
                </td>
                <td className="cs-bar-col" data-label="Progress">
                  <span className="cs-bar-cell">
                    <Bar percent={p.psBoothsPercent} label={`${p.psName} PS booths entered`} />
                    <span className="cs-pct">{fmtPct(p.psBoothsPercent)}</span>
                  </span>
                </td>
                <td className="cs-num" data-label="ZP booths">
                  {fmt(p.zpBoothsDone)} / {fmt(p.zpBoothsTotal)}
                </td>
                <td className="cs-num" data-label="ZP pending">
                  {fmt(p.zpBoothsPending)}
                </td>
              </tr>
            ))}
          </tbody>
          {rows.length > 1 && (
            <tfoot>
              <tr>
                <th scope="row">All Panchayat Samitis</th>
                <td className="cs-num" data-label="PS wards">
                  {fmt(ps.wardsTotal)}
                </td>
                <td className="cs-num" data-label="Declared">
                  {fmt(ps.declared)}
                </td>
                <td className="cs-num" data-label="PS booths">
                  {fmt(ps.boothsDone)} / {fmt(ps.boothsTotal)}
                </td>
                <td className="cs-num" data-label="PS pending">
                  {fmt(ps.boothsPending)}
                </td>
                <td className="cs-bar-col" data-label="Progress">
                  <span className="cs-bar-cell">
                    <Bar percent={ps.boothsPercent} label="All PS booths entered" />
                    <span className="cs-pct">{fmtPct(ps.boothsPercent)}</span>
                  </span>
                </td>
                <td className="cs-num" data-label="ZP booths">
                  {fmt(zp.boothsDone)} / {fmt(zp.boothsTotal)}
                </td>
                <td className="cs-num" data-label="ZP pending">
                  {fmt(zp.boothsPending)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}

function WardTable({ wards, onOpenWard }: { wards: CsWardRow[]; onOpenWard: (w: CsWardRow) => void }) {
  const mixed = new Set(wards.map((w) => w.kind)).size > 1;
  const withPs = wards.some((w) => w.kind === 'PS');
  return (
    <section className="cs-section" aria-labelledby="cs-ward-title">
      <h2 id="cs-ward-title">
        Ward-wise Status <span className="cs-count">{fmt(wards.length)} wards</span>
      </h2>
      {wards.length === 0 ? (
        <p className="cs-empty">No ward matches this scope.</p>
      ) : (
        <div className="cs-table-wrap cs-table-tall cs-wrap-md">
          <table className="cs-table cs-cards-md" data-testid="cs-ward-table">
            <thead>
              <tr>
                <th scope="col">Ward</th>
                {mixed && <th scope="col">Type</th>}
                {withPs && <th scope="col">Panchayat Samiti</th>}
                <th scope="col">Status</th>
                <th scope="col" className="cs-num">
                  Booths Done / Total
                </th>
                <th scope="col" className="cs-num">
                  Pending
                </th>
                <th scope="col" className="cs-num">
                  Round
                </th>
                <th scope="col">Postal</th>
                <th scope="col">Last Entry</th>
                <th scope="col">Winner (Party)</th>
                <th scope="col" className="cs-num">
                  Margin
                </th>
              </tr>
            </thead>
            <tbody>
              {wards.map((w) => (
                <tr
                  key={w.wardId}
                  data-ward-id={w.wardId}
                  className={w.stalled ? 'cs-row-stalled' : undefined}
                >
                  <th scope="row">
                    <button
                      type="button"
                      className="cs-link"
                      title="View this ward's booths"
                      onClick={() => {
                        onOpenWard(w);
                      }}
                    >
                      {w.kind === 'ZP' && withPs ? 'ZP ' : ''}Ward {w.wardNo}
                    </button>
                    <span className="cs-card-sub">{w.kind === 'PS' ? w.psName : 'Zila Parishad'}</span>
                  </th>
                  {mixed && (
                    <td className="cs-hide-card" data-label="Type">
                      {w.kind}
                    </td>
                  )}
                  {withPs && (
                    <td className="cs-hide-card" data-label="Panchayat Samiti">
                      {w.psName ?? '–'}
                    </td>
                  )}
                  <td data-label="Status">
                    <span className="cs-flags">
                      <StatusChip ward={w} />
                      <WardFlags ward={w} />
                    </span>
                  </td>
                  <td className="cs-num" data-label="Booths done / total">
                    {w.boothsTotal === null ? '–' : `${fmt(w.boothsDone)} / ${fmt(w.boothsTotal)}`}
                  </td>
                  <td className="cs-num" data-label="Pending">
                    {fmt(w.boothsPending)}
                  </td>
                  <td className="cs-num" data-label="Round">
                    {fmt(w.latestRound)}
                  </td>
                  <td data-label="Postal">
                    {w.postalDone === null ? 'n/a' : w.postalDone ? 'Done' : 'Pending'}
                  </td>
                  <td className="cs-nowrap" data-label="Last entry">
                    {w.lastEntryText ?? '–'}
                  </td>
                  <td className={w.winner === null ? 'cs-hide-card' : undefined} data-label="Winner (party)">
                    {w.winner === null ? '–' : `${w.winner.name} (${w.winner.party})`}
                  </td>
                  <td className={w.margin === null ? 'cs-num cs-hide-card' : 'cs-num'} data-label="Margin">
                    {fmt(w.margin)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function WardDetail({
  ward: w,
  booths,
  byPs,
}: {
  ward: CsWardRow;
  booths: CsBoothRow[];
  /** ZP ward only. */
  byPs: ZpWardPsProgress | undefined;
}) {
  const pending = booths.filter((b) => b.entered === 'NO');
  const multiPs = new Set(booths.map((b) => b.psId)).size > 1;
  return (
    <>
      <section className="cs-panel" aria-label="Ward summary" data-testid="cs-ward-detail">
        <div className="cs-tiles cs-ward-tiles">
          <div className="cs-tile cs-tile-wide">
            <span className="cs-tile-label">Booths entered</span>
            {w.boothsTotal === null ? (
              <span className="cs-tile-text">Unopposed – no counting</span>
            ) : (
              <>
                <span className="cs-metric-value">
                  {fmt(w.boothsDone)} <span className="cs-of">/ {fmt(w.boothsTotal)}</span>
                  <span className="cs-metric-pct">{fmtPct(w.boothsPercent)}</span>
                </span>
                <Bar percent={w.boothsPercent} label="Booths entered" />
                <span className="cs-tile-note">{fmt(w.boothsPending)} pending</span>
              </>
            )}
          </div>
          <div className="cs-tile">
            <span className="cs-tile-label">Status</span>
            <span className="cs-flags">
              <StatusChip ward={w} />
              <WardFlags ward={w} />
            </span>
          </div>
          <div className="cs-tile">
            <span className="cs-tile-label">Postal ballots</span>
            <span className="cs-tile-text">
              {w.postalDone === null ? 'n/a' : w.postalDone ? 'Entered' : 'Pending'}
            </span>
          </div>
          {w.kind === 'PS' && (
            <div className="cs-tile">
              <span className="cs-tile-label">Latest round</span>
              <span className="cs-tile-text">
                {w.latestRound === null ? '–' : `Round ${String(w.latestRound)}`}
              </span>
            </div>
          )}
          <div className="cs-tile">
            <span className="cs-tile-label">Last entry</span>
            <span className="cs-tile-text">{w.lastEntryText ?? 'No entry yet'}</span>
          </div>
          {w.winner !== null && (
            <div className="cs-tile cs-tile-wide">
              <span className="cs-tile-label">Winner (declared)</span>
              <span className="cs-tile-text">
                {w.winner.name} ({w.winner.party}){w.margin === null ? '' : ` · margin ${fmt(w.margin)}`}
              </span>
            </div>
          )}
        </div>
      </section>
      {byPs !== undefined && <ByPsSection progress={byPs} />}
      {w.boothsTotal !== null && (
        <section className="cs-section" aria-labelledby="cs-pending-title">
          <h2 id="cs-pending-title">
            Pending Booths <span className="cs-count">{fmt(w.boothsPending)}</span>
          </h2>
          {pending.length === 0 ? (
            <p className="cs-empty">Every booth of this ward is entered.</p>
          ) : (
            <ul className="cs-pending" data-testid="cs-pending">
              {pending.map((b) => (
                <li key={b.boothId} title={b.boothName}>
                  {multiPs ? `${b.psName} ` : ''}#{b.boothNo}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <BoothTable booths={booths} withPs={multiPs} />
    </>
  );
}

/** A ZP ward by Panchayat Samiti: each PS with its own round (never merged), then the Postal row. */
function ByPsSection({ progress }: { progress: ZpWardPsProgress }) {
  const { postal } = progress;
  return (
    <section className="cs-section" aria-labelledby="cs-byps-title">
      <h2 id="cs-byps-title">By Panchayat Samiti</h2>
      <div className="cs-table-wrap cs-wrap-sm">
        <table className="cs-table cs-cards-sm" data-testid="cs-by-ps">
          <thead>
            <tr>
              <th scope="col">Panchayat Samiti</th>
              <th scope="col" className="cs-num">
                Booths Done / Total
              </th>
              <th scope="col" className="cs-num">
                Latest Round
              </th>
              <th scope="col">Last Entry</th>
            </tr>
          </thead>
          <tbody>
            {progress.rows.map((r) => (
              <tr key={r.psId}>
                <td data-label="Panchayat Samiti">{r.psName}</td>
                <td data-label="Booths Done / Total" className="cs-num">
                  {fmt(r.boothsDone)} / {fmt(r.boothsTotal)}
                </td>
                <td data-label="Latest Round" className="cs-num">
                  {r.latestRound ?? '-'}
                </td>
                <td data-label="Last Entry">{r.lastEntryText ?? '–'}</td>
              </tr>
            ))}
            <tr>
              <td data-label="Panchayat Samiti">Postal – {postal.label}</td>
              <td data-label="Status" className="cs-num">
                {postal.entered === null ? 'n/a' : postal.entered ? 'Entered' : 'Pending'}
              </td>
              <td data-label="Latest Round" className="cs-num">
                –
              </td>
              <td data-label="Last Entry">{postal.lastEntryText ?? '–'}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

function BoothTable({
  booths,
  withBallot = false,
  withPs = false,
}: {
  booths: CsBoothRow[];
  withBallot?: boolean;
  withPs?: boolean;
}) {
  return (
    <section className="cs-section" aria-labelledby="cs-booths-title">
      <h2 id="cs-booths-title">Booth-wise Status</h2>
      {booths.length === 0 ? (
        <p className="cs-empty">No booths found.</p>
      ) : (
        <div className="cs-table-wrap cs-table-tall cs-wrap-md">
          <table className="cs-table cs-cards-md" data-testid="cs-booth-table">
            <thead>
              <tr>
                <th scope="col">Booth</th>
                {withBallot && <th scope="col">Ballot</th>}
                {withBallot && (
                  <th scope="col" className="cs-num">
                    Ward
                  </th>
                )}
                {(withPs || withBallot) && <th scope="col">Panchayat Samiti</th>}
                <th scope="col">Booth Name</th>
                <th scope="col">Entry</th>
                <th scope="col" className="cs-num">
                  Round
                </th>
                <th scope="col">Entered By</th>
                <th scope="col">Entered At</th>
                <th scope="col">Last Edited</th>
                <th scope="col" className="cs-num">
                  Total Votes
                </th>
              </tr>
            </thead>
            <tbody>
              {booths.map((b) => (
                <tr key={`${b.kind}-${String(b.boothId)}`}>
                  <th scope="row">
                    Booth {b.boothNo}
                    {withBallot && <span className="cs-card-sub">{KIND_LABEL[b.kind]} ballot</span>}
                  </th>
                  {withBallot && <td data-label="Ballot">{KIND_LABEL[b.kind]}</td>}
                  {withBallot && (
                    <td className="cs-num" data-label="Ward">
                      {b.wardNo}
                    </td>
                  )}
                  {(withPs || withBallot) && <td data-label="Panchayat Samiti">{b.psName}</td>}
                  <td className="cs-booth-name" data-label="Booth name">
                    {b.boothName}
                  </td>
                  <td data-label="Entry">
                    {b.entered === 'YES' ? (
                      <span className="cs-chip cs-chip-ok">Entered</span>
                    ) : b.entered === 'NO' ? (
                      <span className="cs-chip cs-chip-muted">Pending</span>
                    ) : (
                      'n/a'
                    )}
                  </td>
                  <td className="cs-num" data-label="Round">
                    {fmt(b.round)}
                  </td>
                  <td className="cs-nowrap" data-label="Entered by">
                    {b.enteredBy ?? '–'}
                  </td>
                  <td className="cs-nowrap" data-label="Entered at">
                    {b.enteredAtText ?? '–'}
                  </td>
                  <td className="cs-nowrap" data-label="Last edited">
                    {b.lastEditedAtText ?? '–'}
                  </td>
                  <td className="cs-num" data-label="Total votes">
                    {fmt(b.totalVotes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
