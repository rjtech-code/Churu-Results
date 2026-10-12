import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { EditWard } from '../../api/adminTypes';
import { api } from '../../api/api';
import { PageIntro } from '../../components/AdminParts';
import { ErrorBox, SuccessBox } from '../../components/ErrorBox';
import { PasswordDialog } from '../../components/PasswordDialog';
import { useApiData } from '../../components/useApiData';
import '../../styles/admin.css';

/** A Panchayat Samiti's wards (and the ZP wards): change a ward's reservation category. */
export function WardCategoryPage() {
  const { psId = '' } = useParams();
  const { data, error, reload } = useApiData(
    () => api<{ wards: EditWard[] }>('GET', `/api/admin/wards?psId=${encodeURIComponent(psId)}`),
    [psId],
  );
  const [editing, setEditing] = useState<EditWard | null>(null);
  const [category, setCategory] = useState('');
  const [reason, setReason] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const label = (w: EditWard) => `${w.kind === 'ZP' ? 'ज़िला परिषद' : 'पंचायत समिति'} वार्ड ${w.wardNo}`;

  return (
    <>
      <p className="backlink">
        <Link to={`/admin/booths?ps=${encodeURIComponent(psId)}`}>← बूथ / वार्ड</Link>
      </p>
      <PageIntro
        title="वार्ड का आरक्षण वर्ग"
        hint="जिस वार्ड का आरक्षण वर्ग बदलना है, उसके सामने 'बदलें' दबाएँ।"
      />
      <ErrorBox error={error} />
      <SuccessBox text={done} />
      {data && (
        <table className="list" data-testid="category-table">
          <thead>
            <tr>
              <th>वार्ड</th>
              <th>आरक्षण वर्ग</th>
              <th>स्थिति</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.wards.map((w) => (
              <tr key={w.id}>
                <td className="ward-name">{label(w)}</td>
                <td>{w.reservationCategory ?? '—'}</td>
                <td>{w.locked ? 'लॉक' : w.hasEntries ? 'मतगणना शुरू' : 'खुला'}</td>
                <td>
                  {!w.locked && !w.hasEntries && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        setDone(null);
                        setCategory(w.reservationCategory ?? '');
                        setReason('');
                        setEditing(w);
                      }}
                    >
                      बदलें
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {editing && (
        <PasswordDialog
          title={`${label(editing)} — आरक्षण वर्ग`}
          explain={`${label(editing)} का आरक्षण वर्ग "${category.trim() || 'कोई नहीं'}" हो जाएगा।`}
          confirmLabel="सेव करें"
          canConfirm={reason.trim().length >= 10}
          onConfirm={async (password) => {
            await api('POST', `/api/admin/wards/${editing.id}/category`, {
              category: category.trim(),
              reason: reason.trim(),
              password,
            });
            setEditing(null);
            setDone('आरक्षण वर्ग सेव हो गया');
            reload();
          }}
          onCancel={() => {
            setEditing(null);
          }}
        >
          <div className="field">
            <label htmlFor="ward-category">आरक्षण वर्ग (जैसे सामान्य महिला)</label>
            <input
              id="ward-category"
              maxLength={50}
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="category-reason">बदलाव का कारण (कम से कम 10 अक्षर)</label>
            <textarea
              id="category-reason"
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
              }}
            />
          </div>
        </PasswordDialog>
      )}
    </>
  );
}
