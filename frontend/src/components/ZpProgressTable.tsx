import type { ZpWardPsProgress } from '../api/types';
import { boothProgress } from './format';

/**
 * A ZP ward's progress by Panchayat Samiti (server-built, display only): one row per PS with its
 * booths entered / total (the rows add up to the ward), then the Postal row.
 */
export function ZpProgressTable({ progress }: { progress: ZpWardPsProgress }) {
  const { postal } = progress;
  return (
    <table className="list" data-testid="zp-progress">
      <thead>
        <tr>
          <th>Panchayat Samiti</th>
          <th>Booth दर्ज</th>
          <th>अंतिम Entry</th>
        </tr>
      </thead>
      <tbody>
        {progress.rows.map((r) => (
          <tr key={r.psId}>
            <td>{r.psName}</td>
            <td className="numcell">{boothProgress(r.boothsDone, r.boothsTotal)}</td>
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
          <td>{postal.lastEntryText ?? '—'}</td>
        </tr>
      </tbody>
    </table>
  );
}
