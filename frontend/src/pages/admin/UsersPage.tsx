import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Credentials, Seat } from '../../api/adminTypes';
import { api } from '../../api/api';
import { OneTimePassword, PageIntro } from '../../components/AdminParts';
import { CredentialsDialog } from '../../components/CredentialsDialog';
import { ErrorBox, SuccessBox } from '../../components/ErrorBox';
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
  const { data, error, reload } = useApiData(() => api<{ seats: Seat[] }>('GET', '/api/admin/users'), []);
  const [editing, setEditing] = useState<Seat | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [done, setDone] = useState<string | null>(null);
  return (
    <>
      <PageIntro title="RO सूची" hint="यहाँ RO के खाते देखें। किसी पद का खाता बदलने के लिए 'खोलें' दबाएँ।" />
      <ErrorBox error={error} />
      <SuccessBox text={done} />
      {credentials && (
        <OneTimePassword
          username={credentials.username}
          password={credentials.password}
          onDone={() => {
            setCredentials(null);
          }}
        />
      )}
      {editing?.account && (
        <CredentialsDialog
          userId={editing.account.id}
          currentUsername={editing.account.username}
          currentPhone={editing.account.phone}
          title={`${editing.label} — बदलें`}
          onSaved={(saved) => {
            setEditing(null);
            if (saved.credentialsChanged === false) setDone('मोबाइल नंबर सहेज लिया गया');
            else if (saved.password === null) setDone('यूज़रनेम बदल गया');
            else setCredentials({ username: saved.username, password: saved.password });
            reload();
          }}
          onCancel={() => {
            setEditing(null);
          }}
        />
      )}
      {data === null ? (
        <p className="loading">लोड हो रहा है…</p>
      ) : (
        <table className="list" data-testid="seat-table">
          <thead>
            <tr>
              <th>पद</th>
              <th>नाम</th>
              <th>यूज़रनेम</th>
              <th>मोबाइल</th>
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
                <td>{s.account?.phone ?? '—'}</td>
                <td>{seatState(s)}</td>
                <td>{s.account?.lastLoginAt ? formatDateTime(s.account.lastLoginAt) : '—'}</td>
                <td className="actions">
                  {s.account && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        setDone(null);
                        setCredentials(null);
                        setEditing(s);
                      }}
                    >
                      बदलें
                    </button>
                  )}
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
