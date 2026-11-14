// "मतगणना डेटा download": saves everything the ROs entered as one .zip of CSVs, so it can be checked
// after either reset has cleared it. Sits ABOVE both reset buttons; read only, and it never blocks a
// reset.
import { useState } from 'react';
import { downloadFile } from '../../api/api';
import { fmt } from '../../api/superadminTypes';
import type { ExportRowCounts } from '../../api/superadminTypes';
import { ErrorBox, SuccessBox } from '../../components/ErrorBox';

/**
 * "मतगणना डेटा download": saves everything the ROs entered as one .zip of CSVs, BEFORE either reset
 * clears it. Read only, and it never blocks a reset.
 */
export function CountingExportButton({ rows }: { rows: ExportRowCounts }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  const total = rows.boothEntries + rows.postalEntries + rows.declarations + rows.voidedEntries;

  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await downloadFile('/api/superadmin/counting-data/export.zip', 'churu-counting-data.zip');
      setDone('मतगणना data की .zip file डाउनलोड हो गई — इसे सुरक्षित जगह रखें');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sa-export" data-testid="counting-export">
      <p className="sa-export-note">
        <strong>पहले यह download करें, फिर नीचे से data हटाएँ।</strong> मिटाया हुआ data सिर्फ़ backup से वापस
        आता है — यह file Excel में सीधे खुल जाती है।
      </p>
      <div className="sa-export-row">
        <button
          type="button"
          className="btn btn-secondary sa-btn"
          disabled={busy || total === 0}
          onClick={() => void run()}
        >
          <span aria-hidden="true">⬇</span> {busy ? 'file बन रही है…' : 'मतगणना डेटा download (.zip)'}
        </button>
        <ul className="sa-export-counts">
          <li>
            <strong>{fmt(rows.boothEntries)}</strong> booth entry rows
          </li>
          <li>
            <strong>{fmt(rows.postalEntries)}</strong> postal entry rows
          </li>
          <li>
            <strong>{fmt(rows.declarations)}</strong> declaration rows
          </li>
          <li>
            <strong>{fmt(rows.voidedEntries)}</strong> voided entry rows
          </li>
        </ul>
      </div>
      {total === 0 && <p className="sa-reason">कोई मतगणना data नहीं है — download करने को कुछ नहीं।</p>}
      <ErrorBox error={error} />
      <SuccessBox text={done} />
    </div>
  );
}
