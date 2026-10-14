import { useEffect, useRef } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { idParam, loadPsZpWard } from '../api/loaders';
import type { PsZpWardState } from '../api/types';
import { ErrorBox, SuccessBox } from '../components/ErrorBox';
import { formatDateTime } from '../components/format';
import { useApiData } from '../components/useApiData';
import type { WardFlash } from './WardDetailPage';

const CLOSED_TEXT: Record<Exclude<PsZpWardState, 'OPEN'>, string> = {
  DECLARED: 'यह जिला परिषद वार्ड घोषित हो चुका है — अब एंट्री नहीं हो सकती।',
  UNOPPOSED: 'यह वार्ड निर्विरोध है — एंट्री नहीं होती।',
  NO_CANDIDATES: 'इस वार्ड की उम्मीदवार सूची उपलब्ध नहीं है।',
  NOT_LOCKED: 'इस वार्ड की उम्मीदवार सूची अभी लॉक नहीं है — एंट्री नहीं हो सकती।',
};

/**
 * ZP tab of a PS_RO: only this PS's booths of one ZP ward. No postal, declare, lottery,
 * correction, totals or leader — those belong to the ZP RO.
 */
export function ZpWardPage() {
  const wardId = idParam(useParams().wardId);
  const location = useLocation();
  const state = (location.state ?? {}) as WardFlash;
  const { data, error } = useApiData(() => loadPsZpWard(wardId), [wardId, location.key]);
  const highlightRef = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    highlightRef.current?.focus();
  }, [data]);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <p className="loading">लोड हो रहा है…</p>;
  const { ward, booths } = data;
  const open = ward.state === 'OPEN';
  return (
    <>
      <p>
        <Link to="/wards?ballot=ZP">← मेरे वार्ड (जिला परिषद)</Link>
      </p>
      <h1>जिला परिषद — वार्ड {ward.wardNo}</h1>
      <SuccessBox text={state.flash} />
      {!open && <p className="msg msg-warn">! {CLOSED_TEXT[ward.state as Exclude<PsZpWardState, 'OPEN'>]}</p>}
      <h2>आपकी पंचायत समिति के बूथ</h2>
      <table className="list">
        <thead>
          <tr>
            <th>बूथ संख्या</th>
            <th>बूथ का नाम</th>
            <th>स्थिति</th>
            <th>राउंड</th>
            <th>समय</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {booths.map((b) => {
            const highlighted = b.boothId === state.highlightBoothId;
            return (
              <tr key={b.boothId} className={highlighted ? 'highlight' : undefined}>
                <td className="numcell">{b.boothNo}</td>
                <td>{b.nameHindi}</td>
                <td>{b.entered ? '✓ दर्ज' : 'बाकी'}</td>
                <td className="numcell">{b.roundNo ?? '—'}</td>
                <td>{formatDateTime(b.enteredAt)}</td>
                <td className="actions">
                  {!b.entered && open && (
                    <Link
                      className={`btn ${highlighted ? 'btn-primary' : 'btn-secondary'}`}
                      to={`/zp/${ward.id}/booths/${b.boothId}/entry`}
                      ref={highlighted ? highlightRef : undefined}
                    >
                      {highlighted ? 'अगला बूथ: एंट्री करें' : 'एंट्री करें'}
                    </Link>
                  )}
                  {b.entryId !== null && open && (
                    <>
                      <Link className="btn btn-secondary" to={`/entries/${b.entryId}/edit`}>
                        सुधारें
                      </Link>
                      <Link className="btn btn-secondary" to={`/entries/${b.entryId}/void`}>
                        रद्द करें
                      </Link>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
