import { useState } from 'react';
import { downloadFile } from '../api/api';
import { ErrorBox } from './ErrorBox';

/**
 * "प्रारूप–14 डाउनलोड" of one ENTERED booth (its live entry as प्रारूप–14 भाग–II). The pages show it
 * only on दर्ज rows and only to roles the server allows; the server checks again.
 */
export function BoothFormButton({
  boothId,
  ballotFor,
  wardNo,
  boothNo,
}: {
  boothId: number;
  ballotFor: 'PS' | 'ZP';
  wardNo: number;
  boothNo: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      await downloadFile(
        `/api/ward-forms/booths/${String(boothId)}/${ballotFor}/prarup14.pdf`,
        `Prarup14_${ballotFor}_${String(wardNo)}_Booth${boothNo}.pdf`,
      );
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        className="btn btn-secondary booth-form-btn"
        disabled={busy}
        aria-label={`बूथ ${boothNo} का प्रारूप–14 डाउनलोड करें`}
        onClick={() => void download()}
      >
        <span aria-hidden="true">⬇</span> {busy ? 'बन रहा है…' : 'प्रारूप–14 डाउनलोड'}
      </button>
      <ErrorBox error={error} />
    </>
  );
}
