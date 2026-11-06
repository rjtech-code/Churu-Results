// DM: booth-wise status of one ward (English). Pending booths first, then every booth with its entry
// (round, who, when, the saved sheet total). Refreshed every 30 s from the same report object.
import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/api';
import type { CountingStatusWard, CsBoothRow } from '../../api/reportTypes';
import { ErrorBox } from '../../components/ErrorBox';
import { useApiData } from '../../components/useApiData';
import { REFRESH_MS } from './ReportsHomePage';
import { Bar, CS_API, StatusChip, WardFlags, fmt } from './countingStatusParts';
import '../../styles/counting-status.css';

export function CountingStatusWardPage() {
  const { wardId = '' } = useParams();
  const { data, error, reload } = useApiData(
    () => api<CountingStatusWard>('GET', `${CS_API}/wards/${encodeURIComponent(wardId)}`),
    [wardId],
  );
  useEffect(() => {
    const t = setInterval(reload, REFRESH_MS);
    return () => {
      clearInterval(t);
    };
  }, [reload]);

  if (data === null) {
    return error === null ? (
      <p className="cs-loading" role="status">
        Loading the ward…
      </p>
    ) : (
      <ErrorBox error="The ward could not be loaded. Please refresh the page." />
    );
  }
  return (
    <>
      {error !== null && (
        <ErrorBox error={`Refresh failed. Showing data of ${data.asOfText}; it will retry in 30 seconds.`} />
      )}
      <CountingStatusWardView data={data} />
    </>
  );
}

const boothKey = (b: CsBoothRow) => `${String(b.psId)}-${String(b.boothNo)}`;

export function CountingStatusWardView({ data }: { data: CountingStatusWard }) {
  const w = data.ward;
  const multiPs = new Set(data.booths.map((b) => b.psId)).size > 1;
  const pending = data.booths.filter((b) => b.entered === 'NO');
  const title =
    w.kind === 'PS'
      ? `${w.psName ?? ''} – Panchayat Samiti Ward ${String(w.wardNo)}`
      : `Zila Parishad Ward ${String(w.wardNo)}`;

  return (
    <div className="cs-page">
      <p className="cs-back">
        <Link to="/reports/counting-status">← Counting Status Report</Link>
      </p>
      <header className="cs-head">
        <div>
          <h1>{title}</h1>
          <p className="cs-meta">
            <span data-testid="cs-report-time">Last updated {data.asOfText}</span>
            <span aria-hidden="true"> · </span>
            Refreshes every 30 seconds
          </p>
        </div>
      </header>

      <div className="cs-cards cs-ward-cards">
        <div className="cs-card">
          <span className="cs-card-label">Status</span>
          <span className="cs-flags">
            <StatusChip ward={w} />
            <WardFlags ward={w} />
          </span>
        </div>
        <div className="cs-card cs-card-wide">
          <span className="cs-card-label">Booths entered</span>
          {w.boothsTotal === null ? (
            <span className="cs-card-time">Unopposed – no counting</span>
          ) : (
            <>
              <span className="cs-card-value">
                {fmt(w.boothsDone)} <span className="cs-card-of">/ {fmt(w.boothsTotal)}</span>
              </span>
              <Bar percent={w.boothsPercent} label="Booths entered" />
              <span className="cs-card-note">{fmt(w.boothsPending)} pending</span>
            </>
          )}
        </div>
        <div className="cs-card">
          <span className="cs-card-label">Postal ballots</span>
          <span className="cs-card-time">
            {w.postalDone === null ? 'n/a' : w.postalDone ? 'Entered' : 'Pending'}
          </span>
        </div>
        <div className="cs-card">
          <span className="cs-card-label">Latest round · Last entry</span>
          <span className="cs-card-time">
            {w.latestRound === null ? '–' : `Round ${String(w.latestRound)}`} ·{' '}
            {w.lastEntryText ?? 'No entry yet'}
          </span>
        </div>
        {w.winner !== null && (
          <div className="cs-card cs-card-wide">
            <span className="cs-card-label">Winner (declared)</span>
            <span className="cs-card-time">
              {w.winner.name} ({w.winner.party}){w.margin === null ? '' : ` · margin ${fmt(w.margin)}`}
            </span>
          </div>
        )}
      </div>

      {w.boothsTotal !== null && (
        <section className="cs-section" aria-labelledby="cs-pending-title">
          <h2 id="cs-pending-title">
            Pending Booths <span className="cs-band-count">{fmt(w.boothsPending)}</span>
          </h2>
          {pending.length === 0 ? (
            <p className="cs-empty">Every booth of this ward is entered.</p>
          ) : (
            <ul className="cs-pending" data-testid="cs-pending">
              {pending.map((b) => (
                <li key={boothKey(b)} title={b.boothName}>
                  {multiPs ? `${b.psName} ` : ''}#{b.boothNo}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="cs-section" aria-labelledby="cs-booths-title">
        <h2 id="cs-booths-title">Booth-wise Status</h2>
        {data.booths.length === 0 ? (
          <p className="cs-empty">No booths found for this ward.</p>
        ) : (
          <div className="cs-table-wrap cs-table-tall">
            <table className="cs-table" data-testid="cs-booth-table">
              <thead>
                <tr>
                  {multiPs && <th scope="col">Panchayat Samiti</th>}
                  <th scope="col" className="num">
                    Booth No
                  </th>
                  <th scope="col">Booth Name</th>
                  <th scope="col">Entry</th>
                  <th scope="col" className="num">
                    Round
                  </th>
                  <th scope="col">Entered By</th>
                  <th scope="col">Entered At</th>
                  <th scope="col">Last Edited</th>
                  <th scope="col" className="num">
                    Total Votes
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.booths.map((b) => (
                  <tr key={boothKey(b)}>
                    {multiPs && <td>{b.psName}</td>}
                    <td className="num">{b.boothNo}</td>
                    <td className="cs-booth-name">{b.boothName}</td>
                    <td>
                      {b.entered === 'YES' ? (
                        <span className="cs-chip cs-chip-ok">Entered</span>
                      ) : b.entered === 'NO' ? (
                        <span className="cs-chip cs-chip-muted">Pending</span>
                      ) : (
                        'n/a'
                      )}
                    </td>
                    <td className="num">{fmt(b.round)}</td>
                    <td>{b.enteredBy ?? '–'}</td>
                    <td className="cs-nowrap">{b.enteredAtText ?? '–'}</td>
                    <td className="cs-nowrap">{b.lastEditedAtText ?? '–'}</td>
                    <td className="num">{fmt(b.totalVotes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
