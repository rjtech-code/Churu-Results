import { useState } from 'react';
import type { FileDownload } from '../../api/adminTypes';
import { api, downloadFile, saveBase64Xlsx } from '../../api/api';
import { ErrorBox, SuccessBox } from '../../components/ErrorBox';
import { PasswordDialog } from '../../components/PasswordDialog';

/**
 * "RO details download": by default without passwords (a plain GET). "पासवर्ड के साथ" asks for the
 * DM's password first (like creating an RO); every such download is audited on the server.
 */
export function RoExportButtons() {
  const [busy, setBusy] = useState(false);
  const [askPassword, setAskPassword] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);

  const plain = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await downloadFile('/api/admin/users/export.xlsx', 'ro-details.xlsx');
      setDone('RO details की Excel डाउनलोड हो गई (बिना पासवर्ड)');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const withPasswords = async (password: string) => {
    const file = await api<FileDownload>('POST', '/api/admin/users/export-with-passwords', { password });
    saveBase64Xlsx(file);
    setAskPassword(false);
    setDone('पासवर्ड वाली गोपनीय Excel डाउनलोड हो गई — इसे किसी को न भेजें');
  };

  return (
    <div className="ro-export">
      <div className="action-list">
        <button
          type="button"
          className="btn btn-secondary btn-big"
          disabled={busy}
          onClick={() => void plain()}
        >
          {busy ? 'डाउनलोड हो रहा है…' : 'RO details download'}
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-big"
          disabled={busy}
          onClick={() => {
            setError(null);
            setDone(null);
            setAskPassword(true);
          }}
        >
          पासवर्ड के साथ download
        </button>
      </div>
      <ErrorBox error={error} />
      <SuccessBox text={done} />
      {askPassword && (
        <PasswordDialog
          title="पासवर्ड के साथ download करें?"
          explain="इस Excel में सभी RO के पासवर्ड होंगे। यह गोपनीय है — इसे किसी को न भेजें। यह download रिकॉर्ड (audit) में लिखा जाएगा।"
          confirmLabel="हाँ, download करें"
          danger
          onConfirm={withPasswords}
          onCancel={() => {
            setAskPassword(false);
          }}
        />
      )}
    </div>
  );
}
