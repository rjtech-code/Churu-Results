import { useEffect, useRef } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { idParam, loadBooths, loadWard } from '../api/loaders';
import { ErrorBox, SuccessBox } from '../components/ErrorBox';
import { StatusBadge } from '../components/StatusBadge';
import { formatDateTime, wardTitle } from '../components/format';
import { useApiData } from '../components/useApiData';

export interface WardFlash {
  flash?: string;
  highlightBoothId?: number | null;
}

export function WardDetailPage() {
  const wardId = idParam(useParams().wardId);
  const location = useLocation();
  const state = (location.state ?? {}) as WardFlash;
  const { data, error } = useApiData(async () => {
    const [ward, booths] = await Promise.all([loadWard(wardId), loadBooths(wardId)]);
    return { ward, booths };
  }, [wardId, location.key]);
  const highlightRef = useRef<HTMLAnchorElement | null>(null);
  useEffect(() => {
    highlightRef.current?.focus();
  }, [data]);

  if (error) return <ErrorBox error={error} />;
  if (!data) return <p className="loading">लोड हो रहा है…</p>;
  const { ward, booths } = data;
  const open =
    ward.ballotLocked && !ward.isUnopposed && ward.status !== 'DECLARED' && ward.status !== 'TIE_RESOLVED';
  const declared = ward.status === 'DECLARED' || ward.status === 'TIE_RESOLVED';

  return (
    <>
      <p>
        <Link to="/wards">← मेरे वार्ड</Link>
      </p>
      <h1>
        {wardTitle(ward)} <StatusBadge status={ward.status} />
      </h1>
      <SuccessBox text={state.flash} />
      {!ward.ballotLocked && (
        <p className="msg msg-warn">! इस वार्ड की उम्मीदवार सूची अभी लॉक नहीं है — एंट्री नहीं हो सकती।</p>
      )}
      <div className="actions">
        {(ward.status === 'READY_TO_DECLARE' || ward.status === 'TIE_NEEDS_LOTTERY') && (
          <Link className="btn btn-primary" to={`/wards/${ward.id}/declare`}>
            घोषणा करें
          </Link>
        )}
        {declared && (
          <Link className="btn btn-secondary" to={`/wards/${ward.id}/correction`}>
            संशोधन / घोषणा के संस्करण
          </Link>
        )}
      </div>

      <h2>डाक मत</h2>
      <p>
        {booths.postal.entered ? `✓ दर्ज (${formatDateTime(booths.postal.enteredAt)})` : 'अभी दर्ज नहीं'}{' '}
        {open && !booths.postal.entered && (
          <Link className="btn btn-secondary" to={`/wards/${ward.id}/postal`}>
            डाक मत दर्ज करें
          </Link>
        )}
        {booths.postal.entryId !== null && (
          <>
            {open && (
              <Link className="btn btn-secondary" to={`/wards/${ward.id}/postal`}>
                सुधारें
              </Link>
            )}{' '}
            {open && (
              <Link className="btn btn-secondary" to={`/postal/${booths.postal.entryId}/void`}>
                रद्द करें
              </Link>
            )}{' '}
            <Link className="btn btn-link" to={`/postal/${booths.postal.entryId}/history`}>
              इतिहास
            </Link>
          </>
        )}
      </p>

      <h2>बूथ</h2>
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
          {booths.booths.map((b) => {
            const highlighted = b.boothId === state.highlightBoothId;
            return (
              <tr key={b.boothId} className={highlighted ? 'highlight' : undefined}>
                <td className="numcell">{b.boothNo}</td>
                <td>
                  {b.nameHindi}
                  {ward.kind === 'ZP' ? <small className="muted"> ({b.panchayatSamiti})</small> : null}
                </td>
                <td>{b.entered ? '✓ दर्ज' : 'बाकी'}</td>
                <td className="numcell">{b.roundNo ?? '—'}</td>
                <td>{formatDateTime(b.enteredAt)}</td>
                <td className="actions">
                  {!b.entered && open && (
                    <Link
                      className={`btn ${highlighted ? 'btn-primary' : 'btn-secondary'}`}
                      to={`/wards/${ward.id}/booths/${b.boothId}/entry`}
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
                  {b.entryId !== null && (
                    <Link className="btn btn-link" to={`/entries/${b.entryId}/history`}>
                      इतिहास
                    </Link>
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
