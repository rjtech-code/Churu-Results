import type { NameChange } from '../api/adminTypes';
import { api } from '../api/api';
import { ErrorBox } from './ErrorBox';
import { formatDateTime } from './format';
import { Modal } from './Modal';
import { useApiData } from './useApiData';

const ROLE_TEXT: Record<NameChange['changedByRole'], string> = { PS_RO: 'PS RO', ZP_RO: 'ZP RO' };

/** The small "विवरण बदला गया" marker next to a corrected candidate; opens the history. */
export function NameChangedMark({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className="name-mark" title="इस उम्मीदवार का सुधार इतिहास देखें" onClick={onOpen}>
      ⓘ विवरण बदला गया
    </button>
  );
}

/** Which field, old -> new, reason, who and when. Newest first (as the server sends it). */
export function NameHistoryList({
  changes,
  showWard = false,
}: {
  changes: readonly NameChange[];
  showWard?: boolean;
}) {
  if (changes.length === 0) return <p className="muted">अभी तक किसी विवरण में सुधार नहीं हुआ है।</p>;
  return (
    <ol className="name-history" data-testid="name-history">
      {changes.map((c) => (
        <li key={c.id}>
          <p className="name-history-names">
            {showWard && <span className="cw-chip">{c.wardLabel}</span>}
            <span className="muted">बैलेट नंबर {c.ballotPosition}:</span>{' '}
            <span className="cw-chip name-field">{c.fieldLabel}</span>{' '}
            <span className="name-old">{c.oldValue ?? '—'}</span> <span aria-label="से">→</span>{' '}
            <strong className="name-new">{c.newValue ?? '—'}</strong>
          </p>
          <p className="name-history-reason">कारण: {c.reason}</p>
          <p className="muted">
            {c.changedByName} ({ROLE_TEXT[c.changedByRole]}) · {formatDateTime(c.changedAt)}
          </p>
        </li>
      ))}
    </ol>
  );
}

/**
 * One ward's correction history in a dialog (optionally one candidate only). `source` is the endpoint the
 * role may read: /api/candidates/... for the ward's RO, /api/admin/... for the DM.
 */
export function NameHistoryDialog({
  title,
  source,
  candidateId,
  onClose,
}: {
  title: string;
  source: string;
  candidateId?: number;
  onClose: () => void;
}) {
  const { data, error } = useApiData(() => api<{ changes: NameChange[] }>('GET', source), [source]);
  const changes = (data?.changes ?? []).filter(
    (c) => candidateId === undefined || c.candidateId === candidateId,
  );
  return (
    <Modal label={title} onCancel={onClose}>
      <div className="password-dialog">
        <h2>{title}</h2>
        <ErrorBox error={error} />
        {data === null ? <p className="loading">लोड हो रहा है…</p> : <NameHistoryList changes={changes} />}
        <div className="actions">
          <button type="button" className="btn btn-secondary btn-big" onClick={onClose}>
            बंद करें
          </button>
        </div>
      </div>
    </Modal>
  );
}
