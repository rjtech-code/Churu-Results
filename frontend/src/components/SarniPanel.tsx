// सारणी-"क" / सारणी-"ख": the two official summary tables of elected members, as Excel downloads,
// under the ST Format sections. ZP: one file for the district. PS: one file per Panchayat Samiti.
// The DM may hold any of them, so the DM's panel gets the picker (`psSelector`, as the PS ST Format
// panel has). A PS_RO has exactly ONE Panchayat Samiti: it gets no picker, just its own Hindi name
// beside the button, and the server resolves the Panchayat Samiti from the session.
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

export function SarniPanel({ kind, psSelector = false }: { kind: 'ZP' | 'PS'; psSelector?: boolean }) {
  const [ps, setPs] = useState('');
  const isPs = kind === 'PS';
  const base = `/api/sarni/${isPs ? 'ps' : 'zp'}`;
  const list = useApiData(
    () =>
      psSelector
        ? api<{ ps: { id: number; nameEnglish: string }[] }>('GET', '/api/st-format/ps/list')
        : Promise.resolve({ ps: [] }),
    [psSelector],
  );
  // Only the picker ever names a Panchayat Samiti; without it the session decides (a PS_RO's own).
  const query = psSelector && ps !== '' ? `?ps=${encodeURIComponent(ps)}` : '';
  const { data, error } = useApiData(
    () => (psSelector && ps === '' ? Promise.resolve(null) : api<Summary>('GET', `${base}/summary${query}`)),
    [base, query, psSelector],
  );
  // The link always carries the Panchayat Samiti the summary was built for, so the file and the
  // numbers on screen can never be from two different Panchayat Samitis.
  const href = isPs
    ? data?.psId === undefined
      ? null
      : `${base}.xlsx?ps=${encodeURIComponent(String(data.psId))}`
    : `${base}.xlsx`;
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
          {psSelector && (
            <label className="st-ps-picker">
              Panchayat Samiti / पंचायत समिति{' '}
              <select
                value={ps}
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
          {/* A PS_RO's own Panchayat Samiti: shown, not chosen. */}
          {isPs && !psSelector && data?.psName !== undefined && (
            <span className="st-ps-name" data-testid="sarni-ps-name">
              {data.psName}
            </span>
          )}
          {href === null ? (
            <span className="muted">{psSelector ? 'पहले पंचायत समिति चुनें' : 'लोड हो रहा है…'}</span>
          ) : (
            <a className="btn btn-secondary rp-csv" href={href} download>
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
