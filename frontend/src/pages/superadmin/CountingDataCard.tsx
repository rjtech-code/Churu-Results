// The counting-only reset ("मतगणना डेटा हटाएँ"). Deliberately spelled out side by side with the full
// reset: the only difference that matters to a tired officer is that this one KEEPS the candidate
// lists, the ward locks and the change history, so the confirm dialog always shows both columns with
// real counts. The download that belongs above it is CountingExportButton.tsx.
import { useState } from 'react';
import { api } from '../../api/api';
import { fmt } from '../../api/superadminTypes';
import type { CountingDataDeletes, CountingDataKeeps, Overview } from '../../api/superadminTypes';
import { ActionButton, ConfirmDialog, TaskCard } from './parts';
import type { ImpactRow } from './parts';

function deleteRows(d: CountingDataDeletes): ImpactRow[] {
  return [
    ['booth entries', d.boothEntries],
    ['postal entries', d.postalEntries],
    ['declared wards', d.declaredWards],
    ['declaration versions (सुधार सहित)', d.declarationVersions],
    ['voided entries', d.voidedEntries],
  ];
}

function keepRows(k: CountingDataKeeps): ImpactRow[] {
  return [
    ['उम्मीदवार', k.candidates],
    ['wards की candidate list lock', k.lockedWards],
    ['wards जिनकी list ready है', k.readyWards],
    ['candidate विवरण सुधार (इतिहास)', k.nameChanges],
    ['booths', k.booths],
    ['wards', k.wards],
  ];
}

/**
 * Deletes AND keeps, both with real counts, side by side. The plain `Impact` of parts.tsx shows the
 * kept side as one sentence; here each kept thing carries its own number, so this reset can never be
 * mistaken for the full one.
 */
function DeleteKeepImpact({
  deletes,
  keeps,
}: {
  deletes: readonly ImpactRow[];
  keeps: readonly ImpactRow[];
}) {
  const shown = deletes.filter(([, n]) => n > 0);
  return (
    <div className="sa-impact" data-testid="counting-impact">
      <div className="sa-impact-col sa-impact-del">
        <h4>क्या मिटेगा</h4>
        {shown.length === 0 ? (
          <p className="muted">कुछ नहीं</p>
        ) : (
          <ul>
            {shown.map(([label, n]) => (
              <li key={label}>
                <strong>{fmt(n)}</strong> {label}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="sa-impact-col sa-impact-keep">
        <h4>क्या बचेगा</h4>
        <ul>
          {keeps.map(([label, n]) => (
            <li key={label}>
              <strong>{fmt(n)}</strong> {label}
            </li>
          ))}
        </ul>
        <p className="sa-audit-note">Audit log कभी नहीं मिटता।</p>
      </div>
    </div>
  );
}

/** "मतगणना डेटा हटाएँ": clear the counting, keep the whole setup, so counting can be re-run. */
export function CountingDataCard({ ov, onChanged }: { ov: Overview; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const task = ov.countingData;
  const deletes = deleteRows(task.deletes);
  const keeps = keepRows(task.keeps);
  return (
    <TaskCard
      title="मतगणना डेटा हटाएँ (Clear counting only)"
      icon="🔄"
      danger
      testId="card-counting-data"
      intro={
        <>
          <p className="sa-when">
            <strong>कब:</strong> mock counting के बाद, जब वही counting दोबारा चलानी है। पूरा setup जैसा है
            वैसा रहेगा।
          </p>
          <p>
            सिर्फ़ वह data हटता है जो RO ने भरा — booth और postal entries, घोषणाएँ और void की गई entries।
            उम्मीदवार, उनकी ballot क्रम, ward की candidate list lock और विवरण-सुधार का इतिहास नहीं हटते।
          </p>
        </>
      }
    >
      <DeleteKeepImpact deletes={deletes} keeps={keeps} />
      <ActionButton
        label="मतगणना डेटा हटाएँ"
        kind="danger"
        reason={task.reason}
        onClick={() => {
          setOpen(true);
        }}
      />
      {open && (
        <ConfirmDialog
          title="मतगणना डेटा हटाएँ"
          danger
          summary={
            <>
              <p className="sa-when">
                यह <strong>छोटा</strong> reset है: उम्मीदवार और ward lock बचे रहेंगे। उम्मीदवार भी हटाने हों
                तो &ldquo;परीक्षण डेटा साफ़ करें&rdquo; चुनें।
              </p>
              <DeleteKeepImpact deletes={deletes} keeps={keeps} />
              <p className="sa-hint">पहले अपने-आप backup बनेगा।</p>
            </>
          }
          word="RESET"
          askPassword={ov.confirmedUntil === null}
          confirmLabel="मतगणना डेटा हटाएँ"
          run={async (password) => {
            const r = await api<{
              deleted: CountingDataDeletes;
              kept: CountingDataKeeps;
              backupFile: string;
            }>('POST', '/api/superadmin/counting-data/reset', {
              confirmText: 'RESET',
              ...(password ? { password } : {}),
            });
            return {
              title: 'मतगणना डेटा हट गया',
              lines: [
                ...deleteRows(r.deleted)
                  .filter(([, n]) => n > 0)
                  .map(([label, n]) => `${fmt(n)} ${label} हटाए गए`),
                `${fmt(r.kept.candidates)} उम्मीदवार और ${fmt(r.kept.lockedWards)} ward lock बचे हैं`,
              ],
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
