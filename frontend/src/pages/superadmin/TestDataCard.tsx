import { useState } from 'react';
import { api } from '../../api/api';
import { fmt } from '../../api/superadminTypes';
import type { Overview, TestDataDeletes } from '../../api/superadminTypes';
import { ActionButton, ConfirmDialog, Impact, TaskCard } from './parts';
import type { ImpactRow } from './parts';

const KEEPS = 'Booths, wards, Panchayat Samitis, voters, parties, users (logins) और settings।';

function rows(d: TestDataDeletes): ImpactRow[] {
  return [
    ['उम्मीदवार', d.candidates],
    ['booth entries', d.boothEntries],
    ['postal entries', d.postalEntries],
    ['declared wards (घोषणाएँ और versions)', d.declaredWards],
    ['voided entries', d.voidedEntries],
    ['wards की candidate list lock / ready', d.lockedWards],
  ];
}

/** "परीक्षण डेटा साफ़ करें": the most common reset (after training / mock counting). */
export function TestDataCard({ ov, onChanged }: { ov: Overview; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const task = ov.testData;
  return (
    <TaskCard
      title="परीक्षण डेटा साफ़ करें (Test data reset)"
      icon="🧹"
      danger
      testId="card-test-data"
      intro={
        <p>
          Training या mock counting के बाद सब counting data हटाएँ। कोई file upload नहीं चाहिए। Declared wards
          होने पर भी चलेगा।
        </p>
      }
    >
      <Impact deletes={rows(task.deletes)} keeps={KEEPS} />
      <ActionButton
        label="परीक्षण डेटा साफ़ करें"
        kind="danger"
        reason={task.reason}
        onClick={() => {
          setOpen(true);
        }}
      />
      {open && (
        <ConfirmDialog
          title="परीक्षण डेटा साफ़ करें"
          danger
          summary={
            <>
              <Impact deletes={rows(task.deletes)} keeps={KEEPS} />
              <p className="sa-hint">पहले अपने-आप backup बनेगा।</p>
            </>
          }
          word="RESET"
          askPassword={ov.confirmedUntil === null}
          confirmLabel="डेटा साफ़ करें"
          run={async (password) => {
            const r = await api<{ deleted: TestDataDeletes; backupFile: string }>(
              'POST',
              '/api/superadmin/test-data/reset',
              { confirmText: 'RESET', ...(password ? { password } : {}) },
            );
            return {
              title: 'परीक्षण डेटा साफ़ हो गया',
              lines: rows(r.deleted)
                .filter(([, n]) => n > 0)
                .map(([label, n]) => `${fmt(n)} ${label} हटाए गए`),
              backupFile: r.backupFile,
            };
          }}
          onClose={(changed) => {
            setOpen(false);
            if (changed) onChanged();
          }}
        />
      )}
    </TaskCard>
  );
}
