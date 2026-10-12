import { useEffect, useState } from 'react';
import type { LockPreview } from '../../api/adminTypes';
import { api } from '../../api/api';
import { ErrorBox } from '../../components/ErrorBox';
import { Modal } from '../../components/Modal';
import { PasswordDialog } from '../../components/PasswordDialog';

/**
 * "लॉक करें" for one PS, all PS, or the ZP. Shows what will be locked; wards without candidates
 * are listed and the lock is refused (the existing rule); wards nobody marked ready are a warning.
 * Needs "LOCK" typed and the DM's password.
 */
export function LockDialog({
  area,
  areaName,
  onDone,
  onCancel,
}: {
  area: string;
  areaName: string;
  onDone: (locked: number) => void;
  onCancel: () => void;
}) {
  const [preview, setPreview] = useState<LockPreview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [typed, setTyped] = useState('');
  useEffect(() => {
    api<LockPreview>('GET', `/api/admin/lock/preview?area=${encodeURIComponent(area)}`).then(
      setPreview,
      setError,
    );
  }, [area]);

  if (preview === null) {
    return (
      <Modal label="लॉक" onCancel={onCancel}>
        {error ? <ErrorBox error={error} /> : <p>लोड हो रहा है…</p>}
        <button type="button" className="btn btn-secondary btn-big" onClick={onCancel}>
          रुकें
        </button>
      </Modal>
    );
  }

  if (!preview.canLock) {
    return (
      <Modal label="लॉक नहीं हो सकता" onCancel={onCancel}>
        <h2>लॉक नहीं हो सकता</h2>
        {preview.toLock.length === 0 ? (
          <p className="big-explain">{areaName} के सभी वार्ड पहले से लॉक हैं।</p>
        ) : (
          <>
            <p className="msg msg-error">
              ✗ इन वार्डों में उम्मीदवार नहीं हैं — पहले सूची भरवाएँ, तब लॉक करें:
            </p>
            <ul data-testid="lock-refused">
              {preview.noCandidates.map((w) => (
                <li key={w.id}>{w.label}</li>
              ))}
            </ul>
          </>
        )}
        <button type="button" className="btn btn-secondary btn-big" onClick={onCancel}>
          ठीक है
        </button>
      </Modal>
    );
  }

  return (
    <PasswordDialog
      title={`${areaName} लॉक करें?`}
      explain={`${areaName} के ${preview.toLock.length} वार्ड लॉक होंगे। लॉक के बाद इनके उम्मीदवार नहीं बदल सकेंगे।`}
      confirmLabel="लॉक करें"
      danger
      canConfirm={typed === 'LOCK'}
      onConfirm={async (password) => {
        const out = await api<{ locked: number[] }>('POST', '/api/admin/lock', {
          area,
          confirmText: typed,
          expectedWardIds: preview.toLock.map((w) => w.id),
          password,
        });
        onDone(out.locked.length);
      }}
      onCancel={onCancel}
    >
      {preview.alreadyLocked > 0 && (
        <p className="muted">{preview.alreadyLocked} वार्ड पहले से लॉक हैं (छोड़ दिए जाएँगे)।</p>
      )}
      {preview.notReady.length > 0 && (
        <p className="msg msg-warn">
          ! इन वार्डों को RO ने अभी तैयार नहीं बताया: {preview.notReady.map((w) => w.wardNo).join(', ')}
        </p>
      )}
      <div className="field">
        <label htmlFor="lock-typed">पुष्टि के लिए अंग्रेज़ी में LOCK लिखें</label>
        <input
          id="lock-typed"
          autoComplete="off"
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
          }}
        />
      </div>
    </PasswordDialog>
  );
}
