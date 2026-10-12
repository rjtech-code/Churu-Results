import { Link } from 'react-router-dom';
import type { Seat } from '../../api/adminTypes';
import { api } from '../../api/api';
import { PageIntro } from '../../components/AdminParts';
import { ErrorBox } from '../../components/ErrorBox';
import { formatDateTime } from '../../components/format';
import { useApiData } from '../../components/useApiData';
import '../../styles/admin.css';

export function seatState(seat: Seat): string {
  const a = seat.account;
  if (a === null) return 'खाली';
  return `${a.isActive ? 'चालू' : 'बंद'}${a.locked ? ' · लॉक' : ''}`;
}

/** DM "RO सूची": the 13 Panchayat Samiti posts and the Zila Parishad post. */
export function UsersPage() {
  const { data, error } = useApiData(() => api<{ seats: Seat[] }>('GET', '/api/admin/users'), []);
  return (
    <>
      <PageIntro title="RO सूची" hint="यहाँ RO के खाते देखें। किसी पद का खाता बदलने के लिए 'खोलें' दबाएँ।" />
      <ErrorBox error={error} />
      {data === null ? (
        <p className="loading">लोड हो रहा है…</p>
      ) : (
        <table className="list" data-testid="seat-table">
          <thead>
            <tr>
              <th>पद</th>
              <th>नाम</th>
              <th>यूज़रनेम</th>
              <th>स्थिति</th>
              <th>अंतिम लॉगिन</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.seats.map((s) => (
              <tr key={s.seat}>
                <td className="ward-name">{s.label}</td>
                <td>{s.account?.fullName ?? '—'}</td>
                <td>{s.account?.username ?? '—'}</td>
                <td>{seatState(s)}</td>
                <td>{s.account?.lastLoginAt ? formatDateTime(s.account.lastLoginAt) : '—'}</td>
                <td>
                  <Link className="btn btn-secondary" to={`/admin/users/${encodeURIComponent(s.seat)}`}>
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
