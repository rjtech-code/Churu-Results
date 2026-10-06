import type { ReactNode } from 'react';
import type { EntryPreview } from '../api/types';

export interface ConfirmRow {
  key: number | string;
  label: string;
  value: number;
  /** For edits: the value before the change. */
  before?: number | undefined;
  isNota?: boolean | undefined;
}

/** Shows exactly what will be saved, one row per candidate, before the operator confirms. */
export function ConfirmPanel({
  title,
  rows,
  total,
  totalBefore,
  children,
}: {
  title: string;
  rows: readonly ConfirmRow[];
  total: number;
  totalBefore?: number | undefined;
  children?: ReactNode;
}) {
  const showBefore = rows.some((r) => r.before !== undefined);
  return (
    <section className="confirm" aria-label="पुष्टि">
      <h2>{title}</h2>
      <div className="confirm-body">
        <table className="confirm-table">
          <thead>
            <tr>
              <th>उम्मीदवार</th>
              {showBefore && <th>पहले</th>}
              <th>मत</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={r.isNota ? 'nota-row' : undefined}>
                <td>{r.label}</td>
                {showBefore && <td className="numcell">{r.before ?? '—'}</td>}
                <td
                  className={`numcell ${r.before !== undefined && r.before !== r.value ? 'changed' : ''}`}
                  data-testid="confirm-votes"
                >
                  {r.value}
                </td>
              </tr>
            ))}
            <tr className="total-row">
              <td>कुल योग</td>
              {showBefore && <td className="numcell">{totalBefore ?? '—'}</td>}
              <td className="numcell" data-testid="confirm-total">
                {total}
              </td>
            </tr>
          </tbody>
        </table>
        {children}
      </div>
    </section>
  );
}

/** The ward totals after this save, as the server previewed them. */
export function WardAfter({ preview }: { preview: EntryPreview }) {
  return (
    <div>
      <h3>सेव के बाद वार्ड का कुल योग</h3>
      <table className="confirm-table">
        <tbody>
          {preview.wardAfter.candidates.map((c) => (
            <tr key={c.id} className={c.isNota ? 'nota-row' : undefined}>
              <td>{c.isNota ? 'नोटा' : c.nameHindi}</td>
              <td className="numcell">{c.totalVotes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
