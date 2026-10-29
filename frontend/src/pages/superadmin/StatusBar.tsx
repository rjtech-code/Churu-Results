import { useState } from 'react';
import { api } from '../../api/api';
import { fmt } from '../../api/superadminTypes';
import type { Overview } from '../../api/superadminTypes';
import { ConfirmDialog } from './parts';

/** Top of the panel: the Counting Lock switch and what is in the system right now. */
export function StatusBar({ ov, onChanged }: { ov: Overview; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const locked = ov.countingLocked;
  const counts: readonly [string, number][] = [
    ['Booths', ov.counts.booths],
    ['उम्मीदवार', ov.counts.candidates],
    ['Entries', ov.counts.entries],
    ['Declared wards', ov.counts.declaredWards],
  ];
  return (
    <section className="sa-status" aria-label="स्थिति">
      <div className={`sa-lock ${locked ? 'sa-lock-on' : 'sa-lock-off'}`} data-testid="sa-lock">
        <div>
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
      <ul className="sa-counts">
        {counts.map(([label, n]) => (
          <li key={label} className="sa-count">
            <span className="sa-count-n">{fmt(n)}</span>
            <span className="sa-count-l">{label}</span>
          </li>
        ))}
      </ul>
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
