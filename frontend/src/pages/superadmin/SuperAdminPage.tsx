import { Link } from 'react-router-dom';
import { api } from '../../api/api';
import type { Overview } from '../../api/superadminTypes';
import { PanelError } from '../../components/ErrorBox';
import { useApiData } from '../../components/useApiData';
import '../../styles/admin.css';
import '../../styles/superadmin.css';
import { BoothAddCard, BoothDeleteCard } from './BoothCards';
import { DmCard } from './DmCard';
import { MasterDataCard } from './MasterDataCard';
import { StatusBar } from './StatusBar';
import { TestDataCard } from './TestDataCard';
import { TaskCard } from './parts';

/** The Super Admin setup panel: status on top, everyday tasks, then the red danger zone. */
export function SuperAdminPage() {
  const data = useApiData(() => api<Overview>('GET', '/api/superadmin/overview'), []);
  const ov = data.data;
  return (
    <div className="sa-page">
      <header className="sa-head">
        <h1>Super Admin</h1>
        <p className="page-hint">Setup के काम — counting के लिए नहीं।</p>
      </header>
      <PanelError error={data.error} />
      {ov === null ? (
        !data.error && <p className="loading">लोड हो रहा है…</p>
      ) : (
        <>
          <StatusBar ov={ov} onChanged={data.reload} />
          <h2 className="sa-section-title">रोज़ के काम</h2>
          <div className="sa-grid-cards">
            <BoothAddCard ov={ov} onChanged={data.reload} />
            <DmCard ov={ov} onChanged={data.reload} />
            <TaskCard
              title="Guide (मार्गदर्शिका)"
              icon="📘"
              testId="card-guide"
              intro={<p>हर काम कब और किस क्रम में करें, files कैसी हों, और problem आए तो किसे बताएँ।</p>}
            >
              <Link className="btn btn-secondary sa-btn" to="/guide">
                Guide खोलें
              </Link>
            </TaskCard>
          </div>
          <section className="sa-danger-zone" aria-labelledby="sa-danger-title">
            <h2 id="sa-danger-title" className="sa-section-title">
              ⚠ खतरनाक क्षेत्र
            </h2>
            <p className="sa-danger-note">
              ये काम data मिटाते हैं। हर काम से पहले दिखेगा कि क्या मिटेगा, और अपने-आप backup बनेगा। Audit log
              कभी नहीं मिटता।
            </p>
            <div className="sa-grid-cards">
              <TestDataCard ov={ov} onChanged={data.reload} />
              <BoothDeleteCard ov={ov} onChanged={data.reload} />
            </div>
            <MasterDataCard ov={ov} onChanged={data.reload} />
          </section>
        </>
      )}
    </div>
  );
}
