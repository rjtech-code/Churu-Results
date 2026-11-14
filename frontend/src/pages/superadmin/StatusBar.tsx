// The top of the panel: the Counting Lock, then what is in the system right now. The lock is a
// full-width band of its own — glyph, the word ON / OFF and what it means, never colour alone — so
// its state cannot be missed on any screen.
import { useState } from 'react';
import { api } from '../../api/api';
import { fmt } from '../../api/superadminTypes';
import type { Overview } from '../../api/superadminTypes';
import { ConfirmDialog } from './parts';

/**
 * The system's state at a glance: geography first, then what the election data holds. `span` keeps
 * both rows of tiles on one 12-column rhythm, so their edges line up on a wide screen.
 */
function stateGroups(
  ov: Overview,
): readonly { title: string; span: 'wide' | 'narrow'; counts: readonly [string, number][] }[] {
  const c = ov.counts;
  return [
    {
      title: 'Geography',
      span: 'wide',
      counts: [
        ['Panchayat Samitis', c.panchayatSamitis],
        ['PS wards', c.psWards],
        ['ZP wards', c.zpWards],
        ['Booths', c.booths],
      ],
    },
    {
      title: 'Election data',
      span: 'narrow',
      counts: [
        ['उम्मीदवार', c.candidates],
        ['Parties', c.parties],
        ['RO logins', c.roAccounts],
        ['Entries', c.entries],
        ['Declared wards', c.declaredWards],
        ['कुल voters', c.voters],
      ],
    },
  ];
}

/** Top of the panel: the Counting Lock switch and what is in the system right now. */
export function StatusBar({ ov, onChanged }: { ov: Overview; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const locked = ov.countingLocked;
  return (
    <section className="sa-status" aria-label="स्थिति">
      <div className={`sa-lock ${locked ? 'sa-lock-on' : 'sa-lock-off'}`} data-testid="sa-lock">
        <div className="sa-lock-text-col">
          <p className="sa-lock-label">Counting Lock</p>
          <p className="sa-lock-state">{locked ? '🔒 ON' : '🔓 OFF'}</p>
          <p className="sa-lock-text">
            {locked
              ? 'Reset और booth बदलाव बंद हैं'
              : 'Counting day से पहले ON करें — फिर कोई reset नहीं हो सकेगा'}
          </p>
        </div>
        <button
          type="button"
          className={`btn sa-btn ${locked ? 'btn-secondary' : 'btn-primary'}`}
          onClick={() => {
            setOpen(true);
          }}
        >
          {locked ? 'Lock OFF करें' : 'Lock ON करें'}
        </button>
      </div>
      {stateGroups(ov).map((group) => (
        <div className="sa-count-group" key={group.title}>
          <h3 className="sa-count-group-title">{group.title}</h3>
          <ul className={`sa-counts sa-counts-${group.span}`}>
            {group.counts.map(([label, n]) => (
              <li key={label} className="sa-count">
                <span className="sa-count-n">{fmt(n)}</span>
                <span className="sa-count-l">{label}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {open && (
        <ConfirmDialog
          title={locked ? 'Counting Lock OFF करें' : 'Counting Lock ON करें'}
          summary={
            locked ? (
              <p>Lock OFF होते ही test data reset, master data और booth बदलाव फिर से हो सकेंगे।</p>
            ) : (
              <p>
                Lock ON होने के बाद reset, master data और booth बदलाव किसी से नहीं होंगे। Counting पहले जैसी
                चलेगी।
              </p>
            )
          }
          confirmLabel={locked ? 'Lock OFF करें' : 'Lock ON करें'}
          word={locked ? 'UNLOCK' : undefined}
          askPassword={locked && ov.confirmedUntil === null}
          danger={locked}
          run={async (password) => {
            await api(
              'POST',
              '/api/superadmin/counting-lock',
              locked ? { on: false, confirmText: 'UNLOCK', ...(password ? { password } : {}) } : { on: true },
            );
            return { title: locked ? 'Counting Lock OFF हो गया' : 'Counting Lock ON हो गया', lines: [] };
          }}
          onClose={(changed) => {
            setOpen(false);
            if (changed) onChanged();
          }}
        />
      )}
    </section>
  );
}
