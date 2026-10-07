import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/api';
import { idParam } from '../../api/loaders';
import type { ReportWardDetail } from '../../api/reportTypes';
import { ErrorBox } from '../../components/ErrorBox';
import { formatDateTime } from '../../components/format';
import { useApiData } from '../../components/useApiData';
import { GENDER, REPORT_STATUS, num } from './reportFormat';
import '../../styles/reports.css';

/** DM: everything about one ward, read only. */
export function ReportWardPage() {
  const wardId = idParam(useParams().wardId);
  const { data, error } = useApiData(
    () => api<ReportWardDetail>('GET', `/api/reports/wards/${wardId}`),
    [wardId],
  );
  if (error) return <ErrorBox error={error} />;
  if (!data) return <p className="loading">लोड हो रहा है…</p>;
  return <WardReport d={data} />;
}

export function WardReport({ d }: { d: ReportWardDetail }) {
  const w = d.ward;
  const title = w.kind === 'ZP' ? `ज़िला परिषद · वार्ड ${w.wardNo}` : `${w.psName ?? ''} · वार्ड ${w.wardNo}`;
  const real = d.candidates.filter((c) => !c.isNota);
  const columns = [...real, ...d.candidates.filter((c) => c.isNota)];
  const voteOf = (votes: { candidateId: number; votes: number }[], id: number) =>
    votes.find((v) => v.candidateId === id)?.votes;
  return (
    <div className="rp-page">
      <p className="no-print">
        <Link to="/reports">← रिपोर्ट</Link>
      </p>
      <div className="rp-title-row">
        <h1>{title}</h1>
        <span className="rp-chip">{REPORT_STATUS[w.status] ?? w.status}</span>
        <button
          type="button"
          className="btn btn-primary no-print"
          onClick={() => {
            window.print();
          }}
        >
          प्रिंट करें
        </button>
      </div>
      {(w.declarationMismatch ||
        w.unavailable ||
        (w.notaHighest && (w.status === 'DECLARED' || w.status === 'TIE_RESOLVED'))) && (
        <section className="rp-alarms" role="alert">
          <ul>
            {w.declarationMismatch && (
              <li>घोषणा के बाद मत बदले हैं — घोषित परिणाम और वर्तमान मत मेल नहीं खाते</li>
            )}
            {w.unavailable && <li>इस वार्ड के परिणाम की गणना नहीं हो सकी — डेटा जाँचें</li>}
            {w.notaHighest && <li>नोटा को सबसे अधिक मत मिले</li>}
          </ul>
        </section>
      )}
      <div className="rp-stats">
        <div className="rp-stat">
          <span className="rp-stat-value">{num(w.totalValidVotes)}</span>
          <span className="rp-stat-label">कुल वैध मत</span>
        </div>
        <div className="rp-stat">
          <span className="rp-stat-value">{num(w.notaVotes)}</span>
          <span className="rp-stat-label">नोटा</span>
        </div>
        <div className="rp-stat">
          <span className="rp-stat-value">
            {num(w.boothsEntered)} / {num(w.boothsTotal)}
          </span>
          <span className="rp-stat-label">बूथ दर्ज</span>
        </div>
        <div className="rp-stat">
          <span className="rp-stat-value">{w.isUnopposed ? '—' : w.postalEntered ? '✓ दर्ज' : 'बाकी'}</span>
          <span className="rp-stat-label">डाक मत</span>
        </div>
        <div className="rp-stat">
          <span className="rp-stat-value">{w.margin === null ? '—' : num(w.margin)}</span>
          <span className="rp-stat-label">अंतर</span>
        </div>
        {w.reservationCategory !== null && (
          <div className="rp-stat">
            <span className="rp-stat-value">{w.reservationCategory}</span>
            <span className="rp-stat-label">आरक्षण</span>
          </div>
        )}
      </div>

      <section className="rp-panel rp-wide" data-testid="ward-candidates">
        <h2>उम्मीदवार</h2>
        <table className="rp-table">
          <thead>
            <tr>
              <th className="num">क्रम</th>
              <th>उम्मीदवार</th>
              <th>पार्टी</th>
              <th>लिंग</th>
              <th className="num">बूथ मत</th>
              <th className="num">डाक मत</th>
              <th className="num">कुल</th>
              <th className="num">स्थान</th>
            </tr>
          </thead>
          <tbody>
            {d.candidates.map((c) => (
              <tr key={c.id} className={c.isWinner ? 'rp-winner' : undefined}>
                <td className="num">{c.isNota ? '—' : c.ballotPosition}</td>
                <td>{c.isWinner ? `✓ ${c.name}` : c.name}</td>
                <td>{c.isNota ? '—' : (c.party?.nameHindi ?? 'निर्दलीय')}</td>
                <td>{c.gender === null ? '—' : (GENDER[c.gender] ?? c.gender)}</td>
                <td className="num">{num(c.boothVotes)}</td>
                <td className="num">{num(c.postalVotes)}</td>
                <td className="num">
                  <strong>{num(c.totalVotes)}</strong>
                </td>
                <td className="num">{c.rank ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rp-panel rp-wide" data-testid="ward-booths">
        <h2>बूथवार मत</h2>
        <div className="rp-scroll">
          <table className="rp-table">
            <thead>
              <tr>
                <th className="num">बूथ</th>
                <th>नाम</th>
                {w.kind === 'ZP' && <th>पंचायत समिति</th>}
                <th className="num">मतदाता</th>
                <th className="num">राउंड</th>
                {columns.map((c) => (
                  <th key={c.id} className="num">
                    {c.isNota ? 'नोटा' : c.name}
                  </th>
                ))}
                <th className="num">योग</th>
                <th>दर्ज</th>
                <th className="num">सुधार</th>
                <th className="num">रद्द</th>
              </tr>
            </thead>
            <tbody>
              {d.booths.map((b) => (
                <tr key={b.boothId}>
                  <td className="num">{b.boothNo}</td>
                  <td>{b.name}</td>
                  {w.kind === 'ZP' && <td>{b.psName}</td>}
                  <td className="num">{b.registeredVoters === null ? '—' : num(b.registeredVoters)}</td>
                  <td className="num">{b.roundNo ?? '—'}</td>
                  {columns.map((c) => {
                    const v = voteOf(b.votes, c.id);
                    return (
                      <td key={c.id} className="num">
                        {v === undefined ? '—' : num(v)}
                      </td>
                    );
                  })}
                  <td className="num">{b.sheetTotal === null ? '—' : num(b.sheetTotal)}</td>
                  <td>{b.entered ? `${b.enteredBy ?? ''}, ${formatDateTime(b.enteredAt)}` : 'बाकी'}</td>
                  <td className="num">{num(b.edits)}</td>
                  <td className="num">{num(b.voids)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rp-panel rp-wide" data-testid="ward-postal">
        <h2>डाक मत</h2>
        {!d.postal.entered ? (
          <p className="rp-empty">
            अभी दर्ज नहीं{d.postal.voids > 0 ? ` (रद्द: ${num(d.postal.voids)})` : ''}
          </p>
        ) : (
          <p>
            योग {num(d.postal.sheetTotal ?? 0)} · अस्वीकृत{' '}
            {d.postal.rejectedCount === null ? '—' : num(d.postal.rejectedCount)} ·{' '}
            {columns
              .map((c) => `${c.isNota ? 'नोटा' : c.name}: ${num(voteOf(d.postal.votes, c.id) ?? 0)}`)
              .join(' · ')}{' '}
            · दर्ज: {d.postal.enteredBy}, {formatDateTime(d.postal.enteredAt)} · सुधार {num(d.postal.edits)} ·
            रद्द {num(d.postal.voids)}
          </p>
        )}
      </section>

      <section className="rp-panel rp-wide" data-testid="ward-declarations">
        <h2>घोषणा के सभी संस्करण</h2>
        {d.declarations.length === 0 ? (
          <p className="rp-empty">अभी घोषित नहीं</p>
        ) : (
          <table className="rp-table">
            <thead>
              <tr>
                <th className="num">संस्करण</th>
                <th>स्थिति</th>
                <th>विजेता</th>
                <th className="num">अंतर</th>
                <th className="num">कुल वैध मत</th>
                <th>लॉटरी</th>
                <th>नोटा पुष्टि</th>
                <th>संशोधन का कारण</th>
                <th>किसने, कब</th>
              </tr>
            </thead>
            <tbody>
              {d.declarations.map((v) => (
                <tr key={v.version}>
                  <td className="num">{v.version}</td>
                  <td>{REPORT_STATUS[v.status] ?? v.status}</td>
                  <td>{v.winner.name}</td>
                  <td className="num">{num(v.margin)}</td>
                  <td className="num">{v.totalValidVotes === null ? '—' : num(v.totalValidVotes)}</td>
                  <td>{v.lottery === null ? '—' : `${v.lottery.conductedBy}: ${v.lottery.note}`}</td>
                  <td>{v.notaHighestAck ? 'हाँ' : '—'}</td>
                  <td>{v.correctionReason ?? '—'}</td>
                  <td>
                    {v.declaredBy}, {formatDateTime(v.declaredAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
