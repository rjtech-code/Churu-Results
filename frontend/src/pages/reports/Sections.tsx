import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Alarm, ReportWardRef, ScopeSections } from '../../api/reportTypes';
import { formatDateTime } from '../../components/format';
import { ALARM_LABEL, REPORT_STATUS, csvUrl, num, pct } from './reportFormat';

export function WardLink({ ward }: { ward: ReportWardRef }) {
  return <Link to={`/reports/wards/${ward.id}`}>{ward.label}</Link>;
}

/** One report panel: title, its CSV download, content. A new printed page per panel. */
export function Panel({
  id,
  title,
  section,
  scope,
  wide = false,
  children,
}: {
  id: string;
  title: string;
  section: string;
  scope: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={wide ? 'rp-panel rp-wide' : 'rp-panel'}
      aria-labelledby={`${id}-title`}
      data-testid={`section-${id}`}
    >
      <header className="rp-panel-head">
        <h2 id={`${id}-title`}>{title}</h2>
        <a className="btn btn-secondary rp-csv no-print" href={csvUrl(section, scope)} download>
          CSV डाउनलोड
        </a>
      </header>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rp-empty">{text}</p>;
}

export function Alarms({ alarms }: { alarms: Alarm[] }) {
  if (alarms.length === 0) {
    return (
      <div className="rp-ok" role="status" data-testid="alarms">
        ✓ कोई चेतावनी नहीं
      </div>
    );
  }
  return (
    <section className="rp-alarms" role="alert" data-testid="alarms">
      <h2>! चेतावनियाँ ({num(alarms.length)})</h2>
      <ul>
        {alarms.map((a, i) => (
          <li key={i}>
            <strong>{ALARM_LABEL[a.kind]}</strong>
            {a.ward !== null && (
              <>
                {' '}
                — <WardLink ward={a.ward} />
              </>
            )}
            : {a.detail}
            {a.at !== null && <span className="muted"> ({formatDateTime(a.at)})</span>}
          </li>
        ))}
      </ul>
      <a className="btn btn-secondary rp-csv no-print" href={csvUrl('alarms', 'ALL_PS')} download>
        CSV डाउनलोड
      </a>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className={`rp-stat ${tone ?? ''}`}>
      <span className="rp-stat-value">{value}</span>
      <span className="rp-stat-label">{label}</span>
    </div>
  );
}

export function Progress({ s }: { s: ScopeSections['progress'] }) {
  return (
    <div className="rp-stats">
      <Stat label="कुल वार्ड" value={num(s.wardsTotal)} />
      <Stat label="घोषित" value={num(s.declared)} tone="rp-green" />
      <Stat label="निर्विरोध" value={num(s.unopposed)} tone="rp-teal" />
      <Stat label="मतगणना जारी" value={num(s.counting)} tone="rp-blue" />
      <Stat label="शुरू नहीं" value={num(s.notStarted)} />
      {s.noCandidates > 0 && <Stat label="उम्मीदवार सूची बाकी" value={num(s.noCandidates)} />}
      {s.unavailable > 0 && <Stat label="उपलब्ध नहीं" value={num(s.unavailable)} tone="rp-red" />}
      <Stat label="बूथ दर्ज" value={`${num(s.boothsEntered)} / ${num(s.boothsTotal)}`} />
      <Stat label="डाक मत दर्ज" value={`${num(s.postalEntered)} / ${num(s.postalTotal)}`} />
    </div>
  );
}

export function PartySeats({ rows }: { rows: ScopeSections['partySeats'] }) {
  if (rows.length === 0) return <Empty text="अभी कोई सीट नहीं — कोई परिणाम या बढ़त नहीं" />;
  return (
    <table className="rp-table">
      <thead>
        <tr>
          <th>पार्टी</th>
          <th className="num">जीते</th>
          <th className="num">आगे</th>
          <th className="num">कुल</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.party.shortName ?? '-'}>
            <td>{r.party.nameHindi}</td>
            <td className="num">{num(r.won)}</td>
            <td className="num">{num(r.leading)}</td>
            <td className="num">{num(r.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Women({ w }: { w: ScopeSections['women'] }) {
  if (w.total === 0) return <Empty text="अभी कोई महिला विजेता नहीं" />;
  return (
    <>
      <p className="rp-lead">
        कुल महिला विजेता: <strong>{num(w.total)}</strong>
      </p>
      <table className="rp-table">
        <thead>
          <tr>
            <th>पार्टी</th>
            <th className="num">महिला विजेता</th>
          </tr>
        </thead>
        <tbody>
          {w.byParty.map((r) => (
            <tr key={r.party.shortName ?? '-'}>
              <td>{r.party.nameHindi}</td>
              <td className="num">{num(r.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="rp-table">
        <thead>
          <tr>
            <th>वार्ड</th>
            <th>विजेता</th>
            <th>पार्टी</th>
            <th>स्थिति</th>
          </tr>
        </thead>
        <tbody>
          {w.list.map((r) => (
            <tr key={r.ward.id}>
              <td>
                <WardLink ward={r.ward} />
              </td>
              <td>{r.name}</td>
              <td>{r.party.nameHindi}</td>
              <td>{REPORT_STATUS[r.status]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function Reservation({ rows }: { rows: NonNullable<ScopeSections['reservation']> }) {
  return (
    <table className="rp-table">
      <thead>
        <tr>
          <th>आरक्षण वर्ग</th>
          <th className="num">वार्ड</th>
          <th className="num">परिणाम घोषित</th>
          <th className="num">महिला विजेता</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.category}>
            <td>{r.category}</td>
            <td className="num">{num(r.wards)}</td>
            <td className="num">{num(r.decided)}</td>
            <td className="num">{num(r.womenWinners)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Nota({ n }: { n: ScopeSections['nota'] }) {
  return (
    <>
      <p className="rp-lead">
        कुल नोटा मत: <strong>{num(n.notaVotes)}</strong>
        {n.totalValidVotes > 0 && (
          <>
            {' '}
            (कुल वैध मत {num(n.totalValidVotes)} का {pct((n.notaVotes * 100) / n.totalValidVotes)})
          </>
        )}
      </p>
      {n.highest.length === 0 ? (
        <Empty text="किसी वार्ड में नोटा को सबसे अधिक मत नहीं" />
      ) : (
        <table className="rp-table">
          <thead>
            <tr>
              <th>नोटा सर्वाधिक: वार्ड</th>
              <th className="num">नोटा</th>
              <th className="num">सर्वाधिक उम्मीदवार</th>
              <th>स्थिति</th>
            </tr>
          </thead>
          <tbody>
            {n.highest.map((r) => (
              <tr key={r.ward.id}>
                <td>
                  <WardLink ward={r.ward} />
                </td>
                <td className="num">{num(r.notaVotes)}</td>
                <td className="num">{num(r.topCandidateVotes)}</td>
                <td>{REPORT_STATUS[r.status] ?? r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export function Turnout({ t }: { t: ScopeSections['turnout'] }) {
  return (
    <div className="rp-stats">
      <Stat label="मतदान प्रतिशत" value={t.percent === null ? 'डेटा उपलब्ध नहीं' : pct(t.percent)} />
      <Stat
        label="वैध मत / पंजीकृत मतदाता"
        value={t.percent === null ? '—' : `${num(t.validVotes)} / ${num(t.registeredVoters)}`}
      />
      <Stat label="शामिल वार्ड" value={`${num(t.wardsIncluded)} / ${num(t.wardsTotal)}`} />
    </div>
  );
}

export function Close({ rows }: { rows: ScopeSections['close'] }) {
  if (rows.length === 0) return <Empty text="कोई नज़दीकी मुकाबला नहीं (अंतर 100 मत या 1% से कम)" />;
  return (
    <table className="rp-table">
      <thead>
        <tr>
          <th>वार्ड</th>
          <th>विजेता</th>
          <th>दूसरे स्थान पर</th>
          <th className="num">अंतर</th>
          <th className="num">अंतर %</th>
          <th className="num">कुल वैध मत</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.ward.id}>
            <td>
              <WardLink ward={r.ward} />
            </td>
            <td>{r.winner}</td>
            <td>{r.runnerUp ?? '—'}</td>
            <td className="num">{num(r.margin)}</td>
            <td className="num">{pct(r.marginPercent)}</td>
            <td className="num">{num(r.totalValidVotes)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Lottery({ rows }: { rows: ScopeSections['lottery'] }) {
  if (rows.length === 0) return <Empty text="कोई वार्ड लॉटरी से तय नहीं हुआ" />;
  return (
    <table className="rp-table">
      <thead>
        <tr>
          <th>वार्ड</th>
          <th>विजेता (लॉटरी)</th>
          <th className="num">बराबर मत</th>
          <th>लॉटरी किसने कराई</th>
          <th>विवरण</th>
          <th>घोषणा</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.ward.id}>
            <td>
              <WardLink ward={r.ward} />
            </td>
            <td>{r.winner}</td>
            <td className="num">{num(r.tiedVotes)}</td>
            <td>{r.conductedBy}</td>
            <td>{r.note}</td>
            <td>
              {r.declaredBy}, {formatDateTime(r.declaredAt)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Corrections({ rows }: { rows: ScopeSections['corrections'] }) {
  if (rows.length === 0) return <Empty text="कोई संशोधन नहीं" />;
  return (
    <table className="rp-table">
      <thead>
        <tr>
          <th>वार्ड</th>
          <th className="num">संस्करण</th>
          <th>पहले विजेता</th>
          <th>नया विजेता</th>
          <th>कारण</th>
          <th>किसने, कब</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={`${r.ward.id}-${r.version}`}>
            <td>
              <WardLink ward={r.ward} />
            </td>
            <td className="num">{num(r.version)}</td>
            <td>{r.oldWinner}</td>
            <td>{r.newWinner}</td>
            <td>{r.reason}</td>
            <td>
              {r.declaredBy}, {formatDateTime(r.declaredAt)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
