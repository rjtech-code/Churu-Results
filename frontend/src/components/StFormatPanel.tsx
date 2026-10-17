import { useState } from 'react';
import { api } from '../api/api';
import type { MissingDetail, OtherBlank, StFormatWarnings } from '../api/reportTypes';
import { ErrorBox } from './ErrorBox';
import { useApiData } from './useApiData';
import '../styles/reports.css';

type Ward = number | string;
interface WardRow {
  ps: string | null;
  wardNo: number;
}

const wards = (n: number) => `${String(n)} ${n === 1 ? 'ward' : 'wards'}`;

const MISSING_LABEL: Record<MissingDetail, string> = {
  AGE: 'Age',
  EDUCATION: 'Edu',
  MOBILE: 'Mobile',
  CATEGORY: 'Category',
};
const BLANK_LABEL: Record<OtherBlank, string> = {
  REJECTED: 'Rejected',
  ELECTORATE: 'Electorate',
  RESERVATION: 'Reservation',
};

/** Rows grouped by PS, in their order (ZP: one group without a name). */
function byPs<T extends WardRow>(rows: readonly T[]): [string | null, T[]][] {
  const groups = new Map<string | null, T[]>();
  for (const r of rows) groups.set(r.ps, [...(groups.get(r.ps) ?? []), r]);
  return [...groups];
}

/** One row per ward: Ward | items; a PS heading row before each PS's wards. */
function WardTable<T extends WardRow>({
  rows,
  items,
  caption,
}: {
  rows: readonly T[];
  items: (r: T) => string;
  caption: string;
}) {
  return (
    <div className="st-table-wrap">
      <table className="rp-table st-table">
        <thead>
          <tr>
            <th scope="col">Ward / वार्ड</th>
            <th scope="col">{caption}</th>
          </tr>
        </thead>
        <tbody>
          {byPs(rows).map(([ps, list]) => [
            ps !== null && (
              <tr key={`ps-${ps}`} className="st-group">
                <th scope="colgroup" colSpan={2}>
                  {ps}
                </th>
              </tr>
            ),
            ...list.map((r) => (
              <tr key={`${ps ?? ''}-${String(r.wardNo)}`}>
                <td>Ward {r.wardNo}</td>
                <td>{items(r)}</td>
              </tr>
            )),
          ])}
        </tbody>
      </table>
    </div>
  );
}

function Toggle({ children }: { children: React.ReactNode }) {
  return (
    <details className="st-details">
      <summary>Show wards / वार्ड देखें</summary>
      {children}
    </details>
  );
}

function Warnings({ w, kind }: { w: StFormatWarnings<Ward>; kind: 'ZP' | 'PS' }) {
  const missing = w.missingByWard;
  const other = w.otherByWard;
  const noMembers = w.psWithoutMembers ?? [];
  const otherCounts = [
    ['Rejected', w.rejectedUnknown.length],
    ['Electorate', w.electorateUnknown.length],
    ['Reservation', w.reservationUnknown.length],
    ['Counted as IND', w.partiesAsInd.length],
  ] as const;
  const anyOther = otherCounts.some(([, n]) => n > 0);
  const allGood =
    w.excludedByWard.length === 0 && missing.length === 0 && !anyOther && noMembers.length === 0;
  return (
    <div className="st-warnings" data-testid={`st-format-warnings-${kind.toLowerCase()}`}>
      <p className="st-summary">
        <strong>
          {w.declaredWards}/{w.totalWards} wards declared / वार्ड घोषित
        </strong>
      </p>

      {w.excludedByWard.length > 0 && (
        <div className="msg msg-error" role="alert">
          ✖ {wards(w.excludedByWard.length)} excluded, report incomplete
          {byPs(w.excludedByWard).map(([ps, list]) => (
            <div key={ps ?? 'zp'} className="st-excluded">
              {ps !== null && <span>{ps}: </span>}
              {list
                .map(
                  (x) =>
                    `Ward ${String(x.wardNo)}${x.reason === 'UNAVAILABLE' ? ' (result unavailable)' : ' (results mismatch)'}`,
                )
                .join(', ')}
            </div>
          ))}
        </div>
      )}

      {w.unopposedWards.length > 0 && (
        <p className="st-line st-info">
          ⓘ {wards(w.unopposedWards.length)} uncontested: counting columns blank by design
        </p>
      )}

      {missing.length > 0 && (
        <div className="st-line st-amber">
          ⚠ Missing winner details: Age {w.missing.age.length} · Education {w.missing.education.length} ·
          Mobile {w.missing.mobile.length} · Category {w.missing.category.length}
          <Toggle>
            <WardTable
              rows={missing}
              caption="Missing / बाकी"
              items={(r) => r.missing.map((m) => MISSING_LABEL[m]).join(', ')}
            />
          </Toggle>
        </div>
      )}

      {noMembers.length > 0 && (
        <div className="st-line st-info">
          ⓘ {noMembers.length} PS with no declared or uncontested ward yet (not counted in TOTAL NO. OF
          PANCHAYAT SAMITI)
          <details className="st-details">
            <summary>Show PS / पंचायत समिति देखें</summary>
            <p className="st-names">{noMembers.join(', ')}</p>
          </details>
        </div>
      )}

      {anyOther && (
        <div className="st-line st-info">
          ⓘ Other blank cells: {otherCounts.map(([label, n]) => `${label} ${String(n)}`).join(' · ')}
          <Toggle>
            {other.length > 0 && (
              <WardTable
                rows={other}
                caption="Blank / खाली"
                items={(r) => r.blank.map((b) => BLANK_LABEL[b]).join(', ')}
              />
            )}
            {w.partiesAsInd.length > 0 && (
              <p className="st-names">Counted as IND: {w.partiesAsInd.join(', ')}</p>
            )}
          </Toggle>
        </div>
      )}

      {allGood && <p className="st-line st-ok">✔ All details complete / सभी विवरण पूर्ण</p>}
    </div>
  );
}

/**
 * State Election Commission "ST. FORMAT" returns, in the official template, with the warnings
 * first. The warnings never block the download (the server decides what goes in).
 * ZP: one file. PS: the DM may pick one PS (`psSelector`); a PS_RO always gets their own PS (the
 * server enforces it).
 */
export function StFormatPanel({
  kind = 'ZP',
  psSelector = false,
}: {
  kind?: 'ZP' | 'PS';
  psSelector?: boolean;
}) {
  const [ps, setPs] = useState('');
  const query = kind === 'PS' && ps !== '' ? `?ps=${encodeURIComponent(ps)}` : '';
  const base = `/api/st-format/${kind.toLowerCase()}`;
  const { data, error } = useApiData(
    () => api<{ warnings: StFormatWarnings<Ward> }>('GET', `${base}/summary${query}`),
    [kind, query],
  );
  const list = useApiData(
    () =>
      psSelector
        ? api<{ ps: { id: number; nameEnglish: string }[] }>('GET', '/api/st-format/ps/list')
        : Promise.resolve({ ps: [] }),
    [psSelector],
  );
  const w = data?.warnings;
  const titleId = `st-format-title-${kind.toLowerCase()}`;
  return (
    <section
      className="rp-panel no-print"
      aria-labelledby={titleId}
      data-testid={`section-st-format-${kind.toLowerCase()}`}
    >
      <header className="rp-panel-head st-head">
        <h2 id={titleId}>{kind} ST Format — State Election Commission / राज्य निर्वाचन आयोग प्रारूप</h2>
        <div className="st-actions">
          {psSelector && (
            <label className="st-ps-picker">
              Panchayat Samiti / पंचायत समिति{' '}
              <select
                value={ps}
                onChange={(e) => {
                  setPs(e.target.value);
                }}
              >
                <option value="">All PS / सभी</option>
                {(list.data?.ps ?? []).map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.nameEnglish}
                  </option>
                ))}
              </select>
            </label>
          )}
          <a className="btn btn-secondary rp-csv" href={`${base}.xlsx${query}`} download>
            {kind} format (Excel)
          </a>
        </div>
      </header>
      {error !== null && !data && <ErrorBox error={error} />}
      {!w && error === null && <p className="loading">Loading… / लोड हो रहा है…</p>}
      {w && <Warnings w={w} kind={kind} />}
    </section>
  );
}
