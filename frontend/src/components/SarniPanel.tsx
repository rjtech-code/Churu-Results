// सारणी-"क" / सारणी-"ख": the two official summary tables of elected members, as Excel downloads,
// under the ST Format sections. ZP: one file for the district. PS: one file per Panchayat Samiti —
// the DM picks one (the same picker the PS ST Format uses), a PS_RO always gets its own (the server
// enforces it, and the picker then shows only that one).
import { useState } from 'react';
import { api } from '../api/api';
import { ErrorBox } from './ErrorBox';
import { useApiData } from './useApiData';

interface Summary {
  psId?: number;
  psName?: string;
  wards: number;
  decided: number;
  /** reservation_category values the classification column could not use (cells left empty). */
  unmappedCategories: string[];
}

export function SarniPanel({ kind }: { kind: 'ZP' | 'PS' }) {
  const [ps, setPs] = useState('');
  const isPs = kind === 'PS';
  const query = isPs && ps !== '' ? `?ps=${encodeURIComponent(ps)}` : '';
  const base = `/api/sarni/${isPs ? 'ps' : 'zp'}`;
  const list = useApiData(
    () =>
      isPs
        ? api<{ ps: { id: number; nameEnglish: string }[] }>('GET', '/api/st-format/ps/list')
        : Promise.resolve({ ps: [] }),
    [isPs],
  );
  // The PS table needs a Panchayat Samiti; a PS_RO has exactly one and it is chosen for them.
  const only = list.data?.ps.length === 1 ? String(list.data.ps[0]?.id ?? '') : '';
  const chosen = isPs ? (ps !== '' ? ps : only) : '';
  const effective = isPs && chosen !== '' ? `?ps=${encodeURIComponent(chosen)}` : query;
  const { data, error } = useApiData(
    () =>
      isPs && chosen === '' ? Promise.resolve(null) : api<Summary>('GET', `${base}/summary${effective}`),
    [base, effective, chosen],
  );
  const titleId = `sarni-title-${kind.toLowerCase()}`;
  const title = isPs ? 'सारणी-"ख" — सदस्य पंचायत समिति (Excel)' : 'सारणी-"क" — सदस्य जिला परिषद (Excel)';

  return (
    <section
      className="rp-panel no-print"
      aria-labelledby={titleId}
      data-testid={`section-sarni-${kind.toLowerCase()}`}
    >
      <header className="rp-panel-head st-head">
        <h2 id={titleId}>{title}</h2>
        <div className="st-actions">
          {isPs && (
            <label className="st-ps-picker">
              Panchayat Samiti / पंचायत समिति{' '}
              <select
                value={chosen}
                onChange={(e) => {
                  setPs(e.target.value);
                }}
              >
                <option value="">— चुनें —</option>
                {(list.data?.ps ?? []).map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.nameEnglish}
                  </option>
                ))}
              </select>
            </label>
          )}
          {isPs && chosen === '' ? (
            <span className="muted">पहले पंचायत समिति चुनें</span>
          ) : (
            <a className="btn btn-secondary rp-csv" href={`${base}.xlsx${effective}`} download>
              {isPs ? 'सारणी-"ख" (Excel)' : 'सारणी-"क" (Excel)'}
            </a>
          )}
        </div>
      </header>
      {error !== null && !data && <ErrorBox error={error} />}
      {data && (
        <p data-testid={`sarni-summary-${kind.toLowerCase()}`}>
          {data.wards} वार्ड · {data.decided} निर्वाचित सदस्य भरे हैं
          {data.wards > data.decided ? ` · ${data.wards - data.decided} वार्ड अभी बाकी` : ''}
        </p>
      )}
      {data && data.unmappedCategories.length > 0 && (
        <p className="msg msg-warn" role="status">
          ! इन वर्गीकरण मानों को छोटा रूप नहीं बनाया जा सका, वह खाना खाली रहेगा:{' '}
          {data.unmappedCategories.join(', ')}
        </p>
      )}
    </section>
  );
}
