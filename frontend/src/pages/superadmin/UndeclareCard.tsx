// "घोषित ZP ward वापस खोलें" (DEO, Nov 2026). A Zila Parishad ward declared by mistake goes back to
// "गिनती चल रही है", so the ZP RO can declare it again.
//
// Nothing is lost: the server copies EVERY declaration version of that ward into an append-only
// archive (with who, when and why) in the same transaction that removes it, and writes an audit row.
// The panel asks for the typed word UNDECLARE, a reason, and the Super Admin's own password.
import { useState } from 'react';
import { api } from '../../api/api';
import type { DeclaredZpWard, Overview } from '../../api/superadminTypes';
import { formatDateTime } from '../../components/format';
import { useApiData } from '../../components/useApiData';
import { ActionButton, ConfirmDialog, TaskCard } from './parts';

const MIN_REASON = 10;

export function UndeclareCard({ ov, onChanged }: { ov: Overview; onChanged: () => void }) {
  const list = useApiData(
    () => api<{ wards: DeclaredZpWard[] }>('GET', '/api/superadmin/declared-zp-wards'),
    [],
  );
  const [picked, setPicked] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(false);
  const wards = list.data?.wards ?? [];
  const ward = wards.find((w) => w.wardId === picked) ?? null;
  const reasonOk = reason.trim().length >= MIN_REASON;

  const refresh = () => {
    setPicked(null);
    setReason('');
    list.reload();
    onChanged();
  };

  return (
    <TaskCard
      title="घोषित ZP ward वापस खोलें (Undeclare)"
      icon="↩️"
      danger
      badge="ZP only"
      testId="card-undeclare"
      when="जब कोई ज़िला परिषद ward गलती से घोषित हो गया हो और उसे दोबारा घोषित करना पड़े।"
      intro={
        <p>
          ward वापस &ldquo;गिनती चल रही है&rdquo; पर आ जाएगा और ZP RO उसे फिर घोषित कर सकेगा। पुरानी
          घोषणा <strong>मिटती नहीं</strong> — उसका हर version, किसने और क्यों वापस खोला, सब स्थायी
          रूप से record में रहता है। पंचायत समिति के ward यहाँ से नहीं खुलते।
        </p>
      }
    >
      {list.error !== null && <p className="sa-error">सूची नहीं आई। page दोबारा load करें।</p>}
      {list.data === null ? (
        <p className="loading">लोड हो रहा है…</p>
      ) : wards.length === 0 ? (
        <p className="muted" data-testid="undeclare-none">
          अभी कोई ज़िला परिषद ward घोषित नहीं है।
        </p>
      ) : (
        <>
          <ul className="sa-booth-list" data-testid="undeclare-wards">
            {wards.map((w) => (
              <li key={w.wardId}>
                <button
                  type="button"
                  className={`sa-booth${w.wardId === picked ? ' sa-booth-on' : ''}`}
                  aria-pressed={w.wardId === picked}
                  onClick={() => {
                    setPicked(w.wardId);
                  }}
                >
                  <strong>ZP ward {w.wardNo}</strong>
                  <span className="sa-booth-meta">
                    {w.winnerName} · अंतर {w.margin}
                    {w.versions > 1 ? ` · ${w.versions} versions` : ''} ·{' '}
                    {formatDateTime(w.declaredAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <label className="sa-key-field">
            कारण (कम से कम {MIN_REASON} अक्षर — record में जाएगा)
            <textarea
              value={reason}
              rows={2}
              maxLength={500}
              onChange={(e) => {
                setReason(e.target.value);
              }}
            />
          </label>
          <ActionButton
            label="यह ward वापस खोलें"
            kind="danger"
            reason={
              ward === null
                ? 'पहले ward चुनें'
                : reasonOk
                  ? null
                  : `कारण कम से कम ${MIN_REASON} अक्षर का लिखें`
            }
            onClick={() => {
              setOpen(true);
            }}
          />
        </>
      )}
      {open && ward !== null && (
        <ConfirmDialog
          title={`ZP ward ${ward.wardNo} वापस खोलें`}
          danger
          summary={
            <>
              <p className="sa-when">
                <strong>ZP ward {ward.wardNo}</strong> की घोषणा हट जाएगी ({ward.versions} version
                {ward.versions > 1 ? 's' : ''}, विजेता {ward.winnerName})। ward फिर &ldquo;गिनती चल
                रही है&rdquo; पर आ जाएगा और TV screens तुरंत बदल जाएँगी।
              </p>
              <p className="sa-hint">
                पुरानी घोषणा स्थायी record में सुरक्षित रहेगी। पहले अपने-आप backup बनेगा।
              </p>
            </>
          }
          word="UNDECLARE"
          askPassword={ov.confirmedUntil === null}
          confirmLabel="वापस खोलें"
          run={async (password) => {
            const r = await api<{
              wardNo: number;
              versionsArchived: number;
              backupFile: string;
            }>('POST', `/api/superadmin/wards/${String(ward.wardId)}/undeclare`, {
              confirmText: 'UNDECLARE',
              reason: reason.trim(),
              ...(password ? { password } : {}),
            });
            return {
              title: `ZP ward ${r.wardNo} वापस खुल गया`,
              lines: [
                `${r.versionsArchived} पुरानी घोषणा record में सुरक्षित रखी गई`,
                'ZP RO अब इस ward को दोबारा घोषित कर सकता है',
              ],
              backupFile: r.backupFile,
            };
          }}
          onClose={(changed) => {
            setOpen(false);
            if (changed) refresh();
          }}
        />
      )}
    </TaskCard>
  );
}
