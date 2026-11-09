import type { ZpWardPsProgress } from '../api/types';

/**
 * A ZP ward's progress by Panchayat Samiti (server-built, display only): one row per PS with its own
 * latest round, then the Postal row. Rounds of different PS are never merged into one number.
 */
export function ZpProgressTable({ progress }: { progress: ZpWardPsProgress }) {
  const { postal } = progress;
  return (
    <table className="list" data-testid="zp-progress">
      <thead>
        <tr>
          <th>Panchayat Samiti</th>
          <th>Booth दर्ज</th>
          <th>Latest Round</th>
          <th>अंतिम Entry</th>
        </tr>
      </thead>
      <tbody>
        {progress.rows.map((r) => (
          <tr key={r.psId}>
            <td>{r.psName}</td>
            <td className="numcell">
              {r.boothsDone}/{r.boothsTotal}
            </td>
            <td className="numcell">{r.latestRound ?? '-'}</td>
            <td>{r.lastEntryText ?? '—'}</td>
          </tr>
        ))}
        <tr data-testid="zp-progress-postal">
          <td>
            Postal ·{' '}
            {postal.assignedPsName === null
              ? 'किसी PS को नहीं सौंपा गया'
              : `${postal.assignedPsName} को सौंपा गया`}
          </td>
          <td>{postal.entered === null ? '—' : postal.entered ? '✓ दर्ज' : 'बाकी'}</td>
          <td className="numcell">-</td>
          <td>{postal.lastEntryText ?? '—'}</td>
        </tr>
      </tbody>
    </table>
  );
}
