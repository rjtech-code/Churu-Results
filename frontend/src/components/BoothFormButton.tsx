import { useState } from 'react';
import { downloadFile } from '../api/api';
import { ErrorBox } from './ErrorBox';

/**
 * PDF to print as it is, or Excel for the officers who fill the sheet on a computer, plus the blank
 * sheet to print before counting. Each label and accessible name is distinct, so no two read the
 * same to a screen reader.
 */
const FORMATS = [
  { format: 'pdf', label: 'प्रारूप–14 डाउनलोड', aria: 'प्रारूप–14 डाउनलोड करें', blank: false },
  { format: 'xlsx', label: 'प्रारूप–14 Excel', aria: 'प्रारूप–14 Excel डाउनलोड करें', blank: false },
  // The empty sheet to print and fill in by hand: it needs no entry, so it is offered for every booth.
  {
    format: 'pdf',
    label: 'प्रारूप–14 खाली',
    aria: 'प्रारूप–14 खाली फ़ॉर्म डाउनलोड करें',
    blank: true,
  },
] as const;

/**
 * "प्रारूप–14 डाउनलोड" of one booth. The filled sheet (its live entry as प्रारूप–14 भाग–II, PDF or
 * Excel — the same form, the same numbers) appears only on दर्ज rows; the blank sheet appears on
 * EVERY row, because blank forms are printed before counting starts. Only roles the server allows
 * see any of it; the server checks again.
 */
export function BoothFormButton({
  boothId,
  ballotFor,
  wardNo,
  boothNo,
  entered,
}: {
  boothId: number;
  ballotFor: 'PS' | 'ZP';
  wardNo: number;
  boothNo: string;
  /** The filled sheet needs an entry; the blank one does not. */
  entered: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const download = async (format: 'pdf' | 'xlsx', blank: boolean) => {
    setBusy(blank ? `blank-${format}` : format);
    setError(null);
    try {
      await downloadFile(
        `/api/ward-forms/booths/${String(boothId)}/${ballotFor}/prarup14${blank ? '-blank' : ''}.${format}`,
        `Prarup14_${blank ? 'Blank_' : ''}${ballotFor}_${String(wardNo)}_Booth${boothNo}.${format}`,
      );
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      {FORMATS.filter((f) => f.blank || entered).map((f) => {
        const key = f.blank ? `blank-${f.format}` : f.format;
        return (
          <button
            key={key}
            type="button"
            className="btn btn-secondary booth-form-btn"
            disabled={busy !== null}
            aria-label={`बूथ ${boothNo} का ${f.aria}`}
            onClick={() => void download(f.format, f.blank)}
          >
            <span aria-hidden="true">⬇</span> {busy === key ? 'बन रहा है…' : f.label}
          </button>
        );
      })}
      <ErrorBox error={error} />
    </>
  );
}
