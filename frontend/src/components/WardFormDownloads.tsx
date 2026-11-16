import { useState } from 'react';
import { api, downloadFile } from '../api/api';
import type { WardFormName, WardFormsInfo } from '../api/reportTypes';
import { ErrorBox } from './ErrorBox';
import { useApiData } from './useApiData';

const FORMS: readonly { form: WardFormName; label: string; fallbackName: string }[] = [
  { form: 'part2', label: 'Download Part 2 / भाग-2', fallbackName: 'Part-II.pdf' },
  { form: 'prarup7', label: 'Download Format 7 / प्ररूप-7', fallbackName: 'Prarup-7.pdf' },
];

/**
 * The official forms of a declared ward as PDF (Part-II, Prarup-7), beside the "चेक मीमो (Excel)" —
 * the final-result check memo, which is offered for EVERY ward the user may read (it exists to
 * check the counting as it stands, declared or not). A refusal at download time is shown in Hindi.
 */
export function WardFormDownloads({ wardId }: { wardId: number }) {
  const { data } = useApiData(() => api<WardFormsInfo>('GET', `/api/ward-forms/${String(wardId)}`), [wardId]);
  const [busy, setBusy] = useState<WardFormName | 'check-memo' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const offered = FORMS.filter((f) => data?.forms[f.form].available === true);

  const download = async (form: WardFormName, fallbackName: string) => {
    setBusy(form);
    setError(null);
    try {
      await downloadFile(`/api/ward-forms/${String(wardId)}/${form}.pdf`, fallbackName);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const downloadMemo = async () => {
    setBusy('check-memo');
    setError(null);
    try {
      await downloadFile(`/api/ward-forms/${String(wardId)}/check-memo.xlsx`, 'CheckMemo.xlsx');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="ward-forms no-print" data-testid="ward-forms">
      <div className="actions">
        {offered.map((f) => (
          <button
            key={f.form}
            type="button"
            className="btn btn-secondary"
            disabled={busy !== null}
            onClick={() => {
              void download(f.form, f.fallbackName);
            }}
          >
            {busy === f.form ? 'बन रहा है…' : f.label}
          </button>
        ))}
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy !== null}
          onClick={() => {
            void downloadMemo();
          }}
        >
          {busy === 'check-memo' ? 'बन रहा है…' : 'चेक मीमो (Excel)'}
        </button>
      </div>
      <ErrorBox error={error} />
    </div>
  );
}
