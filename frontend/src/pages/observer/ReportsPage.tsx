// Read-only downloads of the existing Counting Status Report (whole district). Audited server-side.
import { useLang } from './i18n';
import type { DictKey } from './i18n';
import { Panel } from './parts';

const FILES: readonly [DictKey, string][] = [
  ['countingStatusPdf', '/api/observer/reports/counting-status.pdf'],
  ['wardsCsv', '/api/observer/reports/counting-status/wards.csv'],
  ['boothsCsv', '/api/observer/reports/counting-status/booths.csv'],
  ['zpByPsCsv', '/api/observer/reports/counting-status/zp-by-ps.csv'],
];

export function ReportsPage() {
  const { t } = useLang();
  return (
    <div>
      <h1 className="obs-pagetitle">{t('reports')}</h1>
      <Panel title={t('downloads')}>
        <ul className="obs-downloads">
          {FILES.map(([key, href]) => (
            <li key={href}>
              <a className="obs-download" href={href} download>
                <span className="obs-download-icon" aria-hidden="true">
                  {href.endsWith('.pdf') ? 'PDF' : 'CSV'}
                </span>
                {t(key)}
              </a>
            </li>
          ))}
        </ul>
        <p className="obs-muted">{t('downloadNote')}</p>
      </Panel>
    </div>
  );
}
