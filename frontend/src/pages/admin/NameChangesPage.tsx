import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { NameChangeList } from '../../api/adminTypes';
import { api, downloadFile } from '../../api/api';
import { PageIntro } from '../../components/AdminParts';
import { ErrorBox } from '../../components/ErrorBox';
import { NameHistoryList } from '../../components/NameHistory';
import { useApiData } from '../../components/useApiData';
import '../../styles/admin.css';
import '../../styles/candidates.css';

/**
 * DM "विवरण सुधार इतिहास": every candidate detail corrected after the ballot lock (by the PS / ZP
 * ROs), newest first, with the field name and a CSV download. Read only: the DM never corrects.
 */
export function NameChangesPage() {
  const { data, error } = useApiData(
    () => api<NameChangeList>('GET', '/api/admin/candidate-name-changes'),
    [],
  );
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<unknown>(null);
  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadFile('/api/admin/candidate-name-changes.csv', 'candidate-name-changes.csv');
    } catch (err) {
      setDownloadError(err);
    } finally {
      setDownloading(false);
    }
  };
  return (
    <>
      <p className="backlink">
        <Link to="/admin/candidates">← उम्मीदवार सूची</Link>
      </p>
      <PageIntro
        title="विवरण सुधार इतिहास"
        hint="सूची लॉक होने के बाद RO द्वारा सुधारा गया उम्मीदवार विवरण: क्या बदला, पुराना मान, नया मान, कारण, किसने और कब।"
      />
      <p>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={downloading || data === null || data.changes.length === 0}
          onClick={() => void download()}
        >
          {downloading ? 'डाउनलोड हो रहा है…' : 'CSV डाउनलोड करें'}
        </button>
      </p>
      <ErrorBox error={error ?? downloadError} />
      {data === null ? (
        <p className="loading">लोड हो रहा है…</p>
      ) : (
        <NameHistoryList changes={data.changes} showWard />
      )}
    </>
  );
}
