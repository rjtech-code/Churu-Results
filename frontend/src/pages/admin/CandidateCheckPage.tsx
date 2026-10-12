import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { CandidateStatus } from '../../api/adminTypes';
import { api } from '../../api/api';
import { PageIntro } from '../../components/AdminParts';
import { ErrorBox, SuccessBox } from '../../components/ErrorBox';
import { useApiData } from '../../components/useApiData';
import { LockDialog } from './LockDialog';
import '../../styles/admin.css';

/** DM "उम्मीदवार जाँच": every PS and the ZP with ward counts by list status. */
export function CandidateCheckPage() {
  const { data, error, reload } = useApiData(
    () => api<CandidateStatus>('GET', '/api/admin/candidate-status'),
    [],
  );
  const [locking, setLocking] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const psAreas = (data?.areas ?? []).filter((a) => a.area !== 'ZP');
  return (
    <>
      <PageIntro
        title="उम्मीदवार जाँच"
        hint="यहाँ हर पंचायत समिति और ज़िला परिषद की सूची देखें, प्रिंट करें और लॉक करें।"
      />
      <ErrorBox error={error} />
      <SuccessBox text={done} />
      {data === null ? (
        <p className="loading">लोड हो रहा है…</p>
      ) : (
        <table className="list" data-testid="area-table">
          <thead>
            <tr>
              <th>क्षेत्र</th>
              <th>कुल वार्ड</th>
              <th>सूची बाकी</th>
              <th>सूची तैयार</th>
              <th>लॉक</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.areas.map((a) => (
              <tr key={a.area}>
                <td className="ward-name">{a.name}</td>
                <td className="numcell">{a.total}</td>
                <td className="numcell">{a.pending}</td>
                <td className="numcell">{a.ready}</td>
                <td className="numcell">{a.locked}</td>
                <td>
                  <Link
                    className="btn btn-secondary"
                    to={`/admin/candidates/check/${encodeURIComponent(a.area)}`}
                  >
                    खोलें
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {psAreas.some((a) => a.locked < a.total) && (
        <div className="actions main-action">
          <button
            type="button"
            className="btn btn-danger btn-big"
            onClick={() => {
              setDone(null);
              setLocking(true);
            }}
          >
            सभी पंचायत समितियाँ लॉक करें
          </button>
        </div>
      )}
      {locking && (
        <LockDialog
          area="ALL_PS"
          areaName="सभी पंचायत समितियों"
          onCancel={() => {
            setLocking(false);
          }}
          onDone={(n) => {
            setLocking(false);
            setDone(`${n} वार्ड लॉक हो गए`);
            reload();
          }}
        />
      )}
    </>
  );
}
