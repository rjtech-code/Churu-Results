import { useState } from 'react';
import { api, downloadFile } from '../api/api';
import type { WardFormName, WardFormsInfo } from '../api/reportTypes';
import { CHECK_MEMO_BUSY, CHECK_MEMO_FILE, CHECK_MEMO_LABEL, checkMemoUrl } from './CheckMemoButton';
import { ErrorBox } from './ErrorBox';
import { useApiData } from './useApiData';

const FORMS: readonly { form: WardFormName; label: string; fallbackName: string }[] = [
  { form: 'part2', label: 'Download Part 2 / भाग-2', fallbackName: 'Part-II.pdf' },
  { form: 'prarup7', label: 'Download Format 7 / प्ररूप-7', fallbackName: 'Prarup-7.pdf' },
];

/**
 * The official forms of a declared ward as PDF (Part-II, Prarup-7), beside two downloads that are
 * offered for EVERY ward the user may read, declared or not: the "चेक मीमो (Excel)" (it exists to
 * check the counting as it stands) and the BLANK प्ररूप–7 (printed before there are results, filled
 * in by hand). A refusal at download time is shown in Hindi.
 */
export function WardFormDownloads({ wardId }: { wardId: number }) {
  const { data } = useApiData(() => api<WardFormsInfo>('GET', `/api/ward-forms/${String(wardId)}`), [wardId]);
  const [busy, setBusy] = useState<WardFormName | 'check-memo' | 'prarup7-blank' | null>(null);
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
      await downloadFile(checkMemoUrl(wardId), CHECK_MEMO_FILE);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const downloadBlankPrarup7 = async () => {
    setBusy('prarup7-blank');
    setError(null);
    try {
      await downloadFile(`/api/ward-forms/${String(wardId)}/prarup7-blank.pdf`, 'Prarup-7_Blank.pdf');
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
            void downloadBlankPrarup7();
          }}
        >
          {busy === 'prarup7-blank' ? 'बन रहा है…' : 'प्ररूप-7 खाली'}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy !== null}
          onClick={() => {
            void downloadMemo();
          }}
        >
          {busy === 'check-memo' ? CHECK_MEMO_BUSY : CHECK_MEMO_LABEL}
        </button>
      </div>
      <ErrorBox error={error} />
    </div>
  );
}
