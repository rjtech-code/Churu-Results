import { Link } from 'react-router-dom';
import type { RoWard } from '../../api/adminTypes';
import { api } from '../../api/api';
import { ListStatusBadge, PageIntro } from '../../components/AdminParts';
import { ErrorBox } from '../../components/ErrorBox';
import { useApiData } from '../../components/useApiData';
import '../../styles/admin.css';

/** RO "उम्मीदवार": the RO's own wards with their list status. */
export function RoCandidateWardsPage() {
  const { data, error } = useApiData(() => api<{ wards: RoWard[] }>('GET', '/api/candidates/wards'), []);
  return (
    <>
      <PageIntro
        title="उम्मीदवार"
        hint="यहाँ अपने वार्ड की उम्मीदवार सूची भरें। वार्ड के सामने 'खोलें' दबाएँ।"
      />
      <ErrorBox error={error} />
      {data === null ? (
        <p className="loading">लोड हो रहा है…</p>
      ) : (
        <table className="list" data-testid="ro-ward-table">
          <thead>
            <tr>
              <th>वार्ड</th>
              <th>उम्मीदवार</th>
              <th>स्थिति</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.wards.map((w) => (
              <tr key={w.id}>
                <td className="ward-name">वार्ड {w.wardNo}</td>
                <td>
                  {w.candidates === 0 ? 'कोई नहीं' : w.unopposed ? '1 (निर्विरोध)' : `${w.candidates} + नोटा`}
                </td>
                <td>
                  <ListStatusBadge status={w.status} />
                  {w.returnReason && w.status === 'PENDING' && (
                    <div className="small msg-inline-warn">वापस भेजी गई: {w.returnReason}</div>
                  )}
                </td>
                <td>
                  <Link className="btn btn-secondary" to={`/candidates/${w.id}`}>
                    खोलें
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
