import type { DiffItem } from './historyDiff';

/** A small list of an entry's values; changed ones are bold, highlighted and marked ▲ (not colour alone). */
export function DiffList({ items }: { items: DiffItem[] | null }) {
  if (items === null) return <>—</>;
  return (
    <ul className="diff-list">
      {items.map((i) => (
        <li key={i.key} className={i.changed ? 'diff-changed' : undefined}>
          <span className="diff-label">{i.label}:</span> <span className="diff-value">{i.value}</span>
          {i.changed && <span aria-label="बदला"> ▲</span>}
        </li>
      ))}
    </ul>
  );
}

/** The two history columns for one audit event. */
export function DiffCells({
  diff,
}: {
  diff: {
    before: DiffItem[] | null;
    after: DiffItem[] | null;
    voided: boolean;
    correctionVersion: number | null;
  };
}) {
  return (
    <>
      <td>
        <DiffList items={diff.before} />
      </td>
      <td>
        {diff.voided ? (
          <strong>रद्द</strong>
        ) : (
          <>
            <DiffList items={diff.after} />
            {diff.correctionVersion !== null && <small>(संशोधन संस्करण {diff.correctionVersion})</small>}
          </>
        )}
      </td>
    </>
  );
}
