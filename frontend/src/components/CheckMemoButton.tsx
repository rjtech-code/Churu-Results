import { useState } from 'react';
import { downloadFile } from '../api/api';
import { ErrorBox } from './ErrorBox';

/** One label, one URL, one file name for the memo — wherever the button stands. */
export const CHECK_MEMO_LABEL = 'चेक मीमो (Excel)';
export const CHECK_MEMO_BUSY = 'बन रहा है…';
export const CHECK_MEMO_FILE = 'CheckMemo.xlsx';
export const checkMemoUrl = (wardId: number) => `/api/ward-forms/${String(wardId)}/check-memo.xlsx`;

/**
 * The "चेक मीमो (Excel)" download on its own, for the PS_RO's जिला परिषद ward page: there the
 * official forms (भाग-2, प्ररूप-7) belong to the ZP RO, so only this one button is offered.
 *
 * Which booths the sheet holds is decided on the server from the login — a PS_RO gets their own
 * Panchayat Samiti's booths of that ZP ward, and the sheet itself says so. The request carries
 * nothing but the ward id.
 */
export function CheckMemoButton({ wardId }: { wardId: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      await downloadFile(checkMemoUrl(wardId), CHECK_MEMO_FILE);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="no-print" data-testid="check-memo">
      <div className="actions">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy}
          onClick={() => {
            void download();
          }}
        >
          {busy ? CHECK_MEMO_BUSY : CHECK_MEMO_LABEL}
        </button>
      </div>
      <ErrorBox error={error} />
    </div>
  );
}
