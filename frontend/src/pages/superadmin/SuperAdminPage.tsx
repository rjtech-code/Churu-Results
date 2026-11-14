import { Link } from 'react-router-dom';
import { api } from '../../api/api';
import type { Overview } from '../../api/superadminTypes';
import { PanelError } from '../../components/ErrorBox';
import { Skeleton } from '../../components/Skeleton';
import { formatDateTime } from '../../components/format';
import { useApiData } from '../../components/useApiData';
import '../../styles/admin.css';
import '../../styles/superadmin.css';
import { BoothAddCard, BoothDeleteCard } from './BoothCards';
import { CountingDataCard } from './CountingDataCard';
import { CountingExportButton } from './CountingExportButton';
import { DmCard } from './DmCard';
import { MasterDataCard } from './MasterDataCard';
import { StatusBar } from './StatusBar';
import { TestDataCard } from './TestDataCard';
import { TaskCard } from './parts';

/** When the newest backup was written, beside the panel's name (who is logged in: shell header). */
function HeadMeta({ ov, failed }: { ov: Overview | null; failed: boolean }) {
  return (
    <dl className="sa-head-meta">
      <div>
        <dt>अंतिम backup</dt>
        <dd data-testid="sa-last-backup">
          {ov === null
            ? failed
              ? '—'
              : '…'
            : ov.lastBackupAt === null
              ? 'अभी कोई backup नहीं'
              : formatDateTime(ov.lastBackupAt)}
        </dd>
      </div>
    </dl>
  );
}

/**
 * The panel while /overview is still on its way: the shape the page is about to have (the lock
 * band, the state tiles, the first task cards) — never a blank screen.
 */
function Loading() {
  return (
    <div data-testid="sa-loading">
      <p className="loading sa-loading-text">लोड हो रहा है…</p>
      <div className="sa-skeleton-lock obs-skeleton-line" aria-hidden="true" />
      <div className="sa-skeleton-tiles" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="sa-skeleton-tile obs-skeleton-line" />
        ))}
      </div>
      <div className="sa-skeletons">
        <div className="sa-panel">
          <Skeleton lines={3} />
        </div>
        <div className="sa-panel">
          <Skeleton lines={4} />
        </div>
      </div>
    </div>
  );
}

/** The Super Admin setup panel: state on top, everyday tasks, then the danger zone. */
export function SuperAdminPage() {
  const data = useApiData(() => api<Overview>('GET', '/api/superadmin/overview'), []);
  const ov = data.data;
  return (
    <div className="sa-page">
      <header className="sa-head">
        <div className="sa-head-text">
          <h1>Super Admin</h1>
          <p className="page-hint">Setup के काम — counting के लिए नहीं।</p>
        </div>
        <HeadMeta ov={ov} failed={data.error !== null && data.error !== undefined} />
      </header>
      {data.error !== null && data.error !== undefined && (
        <div className="sa-error-panel">
          <PanelError error={data.error} />
          <p className="sa-hint">Internet / server से जुड़ाव टूट सकता है। फिर से कोशिश करें।</p>
          <button
            type="button"
            className="btn btn-secondary sa-btn"
            onClick={() => {
              data.reload();
            }}
          >
            फिर से कोशिश करें
          </button>
        </div>
      )}
      {ov === null ? (
        !data.error && <Loading />
      ) : (
        <>
          <StatusBar ov={ov} onChanged={data.reload} />
          <h2 className="sa-section-title">रोज़ के काम</h2>
          <div className="sa-grid-cards sa-grid-tasks">
            <BoothAddCard ov={ov} onChanged={data.reload} />
            <DmCard ov={ov} onChanged={data.reload} />
            <TaskCard
              title="Guide (मार्गदर्शिका)"
              icon="📘"
              testId="card-guide"
              when="जब पता न हो कि कौन-सा काम पहले करना है।"
              intro={<p>हर काम कब और किस क्रम में करें, files कैसी हों, और problem आए तो किसे बताएँ।</p>}
            >
              <Link className="btn btn-secondary sa-btn" to="/guide">
                Guide खोलें
              </Link>
            </TaskCard>
          </div>
          <section className="sa-danger-zone" aria-labelledby="sa-danger-title">
            <div className="sa-danger-head">
              <h2 id="sa-danger-title" className="sa-section-title">
                ⚠ खतरनाक क्षेत्र
              </h2>
              <p className="sa-danger-note">
                ये काम data मिटाते हैं। हर काम से पहले दिखेगा कि क्या मिटेगा, और{' '}
                <strong>अपने-आप backup बनेगा</strong>। <strong>Audit log कभी नहीं मिटता।</strong>
              </p>
            </div>
            {/* Above both resets on purpose: save the counting data first. */}
            <CountingExportButton rows={ov.countingExport.rows} />
            <div className="sa-grid-cards">
              <CountingDataCard ov={ov} onChanged={data.reload} />
              <TestDataCard ov={ov} onChanged={data.reload} />
            </div>
            <div className="sa-grid-cards">
              <BoothDeleteCard ov={ov} onChanged={data.reload} />
            </div>
            <MasterDataCard ov={ov} onChanged={data.reload} />
          </section>
        </>
      )}
    </div>
  );
}
