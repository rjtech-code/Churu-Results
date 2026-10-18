import { useState } from 'react';
import { api } from '../api/api';
import { ErrorBox, SuccessBox } from './ErrorBox';
import { useApiData } from './useApiData';

const PATH = '/api/admin/settings/election-date';

/** The saved date, the date being typed, and saving it ('' clears it). */
function useElectionDate() {
  const { data, error, reload } = useApiData(() => api<{ date: string | null }>('GET', PATH), []);
  const [value, setValue] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const shown = value ?? data?.date ?? '';

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    setDone(null);
    try {
      await api('POST', PATH, { date: shown });
      setDone(shown === '' ? 'तारीख हटा दी गई (फ़ॉर्म पर खाली रहेगी)' : 'तारीख सेव हो गई');
      setValue(null);
      reload();
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  };

  const busy = data === null || saving;
  return { shown, setValue, save, busy, loadError: error, saveError, done };
}

/**
 * DM: the election date printed on Prarup-7 ("निर्वाचन की तारीख"). Empty = printed blank. Saved
 * with an audit entry; no password.
 */
export function ElectionDateCard() {
  const { shown, setValue, save, busy, loadError, saveError, done } = useElectionDate();
  return (
    <section
      className="admin-section"
      aria-labelledby="election-date-title"
      data-testid="section-election-date"
    >
      <h2 id="election-date-title">निर्वाचन की तारीख / Election date (प्ररूप-7)</h2>
      <ErrorBox error={loadError} />
      <div className="actions">
        <label htmlFor="election-date">तारीख</label>
        <input
          id="election-date"
          type="date"
          value={shown}
          disabled={busy}
          onChange={(e) => {
            setValue(e.target.value);
          }}
        />
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
          सेव करें
        </button>
      </div>
      <ErrorBox error={saveError} />
      <SuccessBox text={done} />
    </section>
  );
}
