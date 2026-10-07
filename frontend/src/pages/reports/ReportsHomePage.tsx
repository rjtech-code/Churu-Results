import { useEffect, useState } from 'react';
import { api } from '../../api/api';
import type { ReportSummary } from '../../api/reportTypes';
import { ErrorBox } from '../../components/ErrorBox';
import { formatDateTime } from '../../components/format';
import { useApiData } from '../../components/useApiData';
import {
  Alarms,
  Close,
  Corrections,
  Lottery,
  Nota,
  Panel,
  PartySeats,
  Progress,
  Reservation,
  Turnout,
  Women,
} from './Sections';
import '../../styles/reports.css';

export const REFRESH_MS = 30_000;

/** The DM's read-only reports. No entry, edit, declare or correction actions exist here. */
export function ReportsHomePage() {
  const { data, error, reload } = useApiData(() => api<ReportSummary>('GET', '/api/reports/summary'), []);
  const [scope, setScope] = useState('ALL_PS');
  useEffect(() => {
    const t = setInterval(reload, REFRESH_MS);
    return () => {
      clearInterval(t);
    };
  }, [reload]);

  if (error && !data) return <ErrorBox error={error} />;
  if (!data) return <p className="loading">लोड हो रहा है…</p>;
  return <ReportsView data={data} scope={scope} onScope={setScope} />;
}

/** Printed on every page: when it was printed, the filter, and how fresh the data is. */
function PrintFooter({ scopeLabel, generatedAt }: { scopeLabel: string; generatedAt: string }) {
  const [printedAt, setPrintedAt] = useState<string | null>(null);
  useEffect(() => {
    const before = () => {
      setPrintedAt(new Date().toISOString());
    };
    window.addEventListener('beforeprint', before);
    return () => {
      window.removeEventListener('beforeprint', before);
    };
  }, []);
  return (
    <div className="rp-print-footer">
      मुद्रित: {formatDateTime(printedAt)} · क्षेत्र: {scopeLabel} · आँकड़े: {formatDateTime(generatedAt)}
    </div>
  );
}

export function ReportsView({
  data,
  scope,
  onScope,
}: {
  data: ReportSummary;
  scope: string;
  onScope: (s: string) => void;
}) {
  const s = data.sections[scope] ?? data.sections.ALL_PS;
  const scopeLabel = data.scopes.find((x) => x.key === scope)?.label ?? '';
  if (s === undefined) return <p>रिपोर्ट उपलब्ध नहीं।</p>;
  return (
    <div className="rp-page">
      <div className="rp-title-row">
        <h1>रिपोर्ट — चूरू पंचायत चुनाव 2026</h1>
        <span className="muted" data-testid="report-updated">
          अंतिम अपडेट {formatDateTime(data.generatedAt)}
        </span>
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
      <div className="rp-filter no-print" role="group" aria-label="क्षेत्र चुनें">
        {data.scopes.map((x) => (
          <button
            key={x.key}
            type="button"
            className={x.key === scope ? 'rp-filter-btn rp-filter-on' : 'rp-filter-btn'}
            aria-pressed={x.key === scope}
            onClick={() => {
              onScope(x.key);
            }}
          >
            {x.label}
          </button>
        ))}
      </div>
      <p className="rp-scope-print">क्षेत्र: {scopeLabel}</p>
      <Alarms alarms={data.alarms} />
      <div className="rp-grid">
        <Panel id="progress" title="प्रगति" section="progress" scope={scope}>
          <Progress s={s.progress} />
        </Panel>
        <Panel id="party-seats" title="पार्टीवार सीटें" section="party-seats" scope={scope}>
          <PartySeats rows={s.partySeats} />
        </Panel>
        <Panel id="women" title="महिला विजेता" section="women" scope={scope}>
          <Women w={s.women} />
        </Panel>
        {s.reservation !== null && (
          <Panel id="reservation" title="आरक्षण वर्ग" section="reservation" scope={scope}>
            <Reservation rows={s.reservation} />
          </Panel>
        )}
        <Panel id="nota" title="नोटा" section="nota" scope={scope}>
          <Nota n={s.nota} />
        </Panel>
        <Panel id="turnout" title="मतदान प्रतिशत" section="turnout" scope={scope}>
          <Turnout t={s.turnout} />
        </Panel>
        <Panel id="close" title="नज़दीकी मुकाबले" section="close-contests" scope={scope} wide>
          <Close rows={s.close} />
        </Panel>
        <Panel id="lottery" title="लॉटरी से निर्णय" section="lottery" scope={scope} wide>
          <Lottery rows={s.lottery} />
        </Panel>
        <Panel id="corrections" title="संशोधन" section="corrections" scope={scope} wide>
          <Corrections rows={s.corrections} />
        </Panel>
      </div>
      <PrintFooter scopeLabel={scopeLabel} generatedAt={data.generatedAt} />
    </div>
  );
}
