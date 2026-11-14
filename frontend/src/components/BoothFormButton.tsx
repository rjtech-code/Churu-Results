import { useState } from 'react';
import { downloadFile } from '../api/api';
import { ErrorBox } from './ErrorBox';

/**
 * PDF to print as it is, or Excel for the officers who fill the sheet on a computer. The PDF
 * button's label and accessible name are unchanged; the Excel one says "Excel" so the two never
 * read the same to a screen reader.
 */
const FORMATS = [
  { format: 'pdf', label: 'प्रारूप–14 डाउनलोड', aria: 'प्रारूप–14 डाउनलोड करें' },
  { format: 'xlsx', label: 'प्रारूप–14 Excel', aria: 'प्रारूप–14 Excel डाउनलोड करें' },
] as const;

/**
 * "प्रारूप–14 डाउनलोड" of one ENTERED booth (its live entry as प्रारूप–14 भाग–II), as PDF or Excel —
 * the same form, the same numbers. The pages show it only on दर्ज rows and only to roles the server
 * allows; the server checks again.
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
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const download = async (format: 'pdf' | 'xlsx') => {
    setBusy(format);
    setError(null);
    try {
      await downloadFile(
        `/api/ward-forms/booths/${String(boothId)}/${ballotFor}/prarup14.${format}`,
        `Prarup14_${ballotFor}_${String(wardNo)}_Booth${boothNo}.${format}`,
      );
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      {FORMATS.map((f) => (
        <button
          key={f.format}
          type="button"
          className="btn btn-secondary booth-form-btn"
          disabled={busy !== null}
          aria-label={`बूथ ${boothNo} का ${f.aria}`}
          onClick={() => void download(f.format)}
        >
          <span aria-hidden="true">⬇</span> {busy === f.format ? 'बन रहा है…' : f.label}
        </button>
      ))}
      <ErrorBox error={error} />
    </>
  );
}
