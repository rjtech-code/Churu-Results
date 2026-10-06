import { INDEPENDENT, fmt, partyShort } from './format';
import { partyColour } from './partyColours';
import { pieSlices } from './pie';
import type { SeatRow, WinnerItem } from './types';

const keyOf = (row: SeatRow) => row.party.shortName ?? INDEPENDENT;

function Swatch({ colour }: { colour: string }) {
  return (
    <svg className="tv-swatch" viewBox="0 0 10 10" aria-hidden="true">
      <rect width="10" height="10" fill={colour} />
    </svg>
  );
}

/** Pie of ZP seats WON by party, with a legend (name + seats). Empty state when nothing is won. */
export function SeatPie({ rows, allShortNames }: { rows: SeatRow[]; allShortNames: readonly string[] }) {
  const won = rows.filter((r) => r.won > 0);
  if (won.length === 0) {
    return (
      <p className="tv-empty" data-testid="pie-empty">
        अभी कोई परिणाम घोषित नहीं
      </p>
    );
  }
  const slices = pieSlices(
    won.map((r) => ({
      key: keyOf(r),
      label: r.party.nameHindi,
      value: r.won,
      colour: partyColour(r.party.shortName, allShortNames),
    })),
    100,
    100,
    96,
  );
  return (
    <div className="tv-pie-box">
      <svg
        className="tv-pie"
        viewBox="0 0 200 200"
        role="img"
        aria-label="जीती सीटें, पार्टी के अनुसार"
        data-testid="pie"
      >
        {slices.map((s) =>
          s.full ? (
            <circle key={s.key} cx="100" cy="100" r="96" fill={s.colour} stroke="#fff" strokeWidth="2" />
          ) : (
            <path key={s.key} d={s.path} fill={s.colour} stroke="#fff" strokeWidth="2" />
          ),
        )}
      </svg>
      <ul className="tv-legend" data-testid="legend">
        {slices.map((s) => (
          <li key={s.key}>
            <Swatch colour={s.colour} /> <span className="tv-legend-name">{s.label}</span>{' '}
            <strong className="tv-legend-value">{fmt(s.value)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SeatTable({
  rows,
  allShortNames,
  withTotal,
  testId,
}: {
  rows: SeatRow[];
  allShortNames: readonly string[];
  withTotal: boolean;
  testId: string;
}) {
  const shown = rows.filter((r) => r.won + r.leading > 0);
  return (
    <table className="tv-seats" data-testid={testId}>
      <thead>
        <tr>
          <th>पार्टी</th>
          <th>जीते</th>
          <th>आगे</th>
          {withTotal && <th>कुल</th>}
        </tr>
      </thead>
      <tbody>
        {shown.length === 0 ? (
          <tr>
            <td colSpan={withTotal ? 4 : 3}>—</td>
          </tr>
        ) : (
          shown.map((r) => (
            <tr key={keyOf(r)}>
              <td>
                <Swatch colour={partyColour(r.party.shortName, allShortNames)} /> {r.party.nameHindi}
              </td>
              <td className="tv-num">{fmt(r.won)}</td>
              <td className="tv-num">{fmt(r.leading)}</td>
              {withTotal && <td className="tv-num">{fmt(r.total)}</td>}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

export function LatestWinners({ items }: { items: WinnerItem[] }) {
  return (
    <ol className="tv-winners" data-testid="latest-winners">
      {items.length === 0 ? (
        <li>—</li>
      ) : (
        items.slice(0, 5).map((w) => (
          <li key={`${w.wardId}-${w.version}`}>
            {w.kind === 'ZP' ? 'ज़िला परिषद' : (w.psName ?? '')} · वार्ड {w.wardNo}:{' '}
            <strong>{w.winner.name}</strong> ({partyShort(w.winner.party)})
            {w.status === 'TIE_RESOLVED' ? ' · लॉटरी' : ''}
            {w.isCorrection ? ' · संशोधित' : ''}
          </li>
        ))
      )}
    </ol>
  );
}
