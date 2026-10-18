import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { BoothRow, CandidateStatus } from '../../api/adminTypes';
import { api } from '../../api/api';
import { PageIntro } from '../../components/AdminParts';
import { ElectionDateCard } from '../../components/ElectionDateCard';
import { ErrorBox } from '../../components/ErrorBox';
import { useApiData } from '../../components/useApiData';
import '../../styles/admin.css';

/** The 13 Panchayat Samitis (id + Hindi name), from the candidate-status summary. */
export function usePsList() {
  return useApiData(async () => {
    const s = await api<CandidateStatus>('GET', '/api/admin/candidate-status');
    return s.areas
      .filter((a) => a.area.startsWith('PS:'))
      .map((a) => ({ id: Number(a.area.slice(3)), name: a.name }));
  }, []);
}

const votersText = (b: BoothRow) => (b.voters.total === null ? 'दर्ज नहीं' : String(b.voters.total));

/** DM "बूथ / वार्ड": find booths by Panchayat Samiti and ward. */
export function BoothsPage() {
  const [params, setParams] = useSearchParams();
  const psId = params.get('ps') ?? '';
  const wardNo = params.get('ward') ?? '';
  const [ps, setPs] = useState(psId);
  const [ward, setWard] = useState(wardNo);
  const psList = usePsList();
  const booths = useApiData(
    () =>
      psId === ''
        ? Promise.resolve(null)
        : api<{ booths: BoothRow[] }>(
            'GET',
            `/api/admin/booths?psId=${encodeURIComponent(psId)}${wardNo === '' ? '' : `&wardNo=${encodeURIComponent(wardNo)}`}`,
          ),
    [psId, wardNo],
  );
  const list = booths.data?.booths ?? null;

  return (
    <>
      <PageIntro
        title="बूथ / वार्ड"
        hint="यहाँ बूथ खोजें और सुधारें। पंचायत समिति चुनें, चाहें तो वार्ड नंबर भी लिखें।"
      />
      <ErrorBox error={psList.error ?? booths.error} />
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setParams(ward === '' ? { ps } : { ps, ward });
        }}
      >
        <label htmlFor="booth-ps">पंचायत समिति</label>
        <select
          id="booth-ps"
          value={ps}
          onChange={(e) => {
            setPs(e.target.value);
          }}
        >
          <option value="">— चुनें —</option>
          {(psList.data ?? []).map((p) => (
            <option key={p.id} value={String(p.id)}>
              {p.name}
            </option>
          ))}
        </select>
        <label htmlFor="booth-ward">PS वार्ड नंबर</label>
        <input
          id="booth-ward"
          className="num num-small"
          inputMode="numeric"
          value={ward}
          onChange={(e) => {
            setWard(e.target.value.replace(/\D/g, ''));
          }}
        />
        <button type="submit" className="btn btn-primary btn-big" disabled={ps === ''}>
          खोजें
        </button>
      </form>
      {psId !== '' && (
        <p>
          <Link className="btn btn-secondary" to={`/admin/wards/${encodeURIComponent(psId)}`}>
            वार्ड का आरक्षण वर्ग बदलें
          </Link>
        </p>
      )}
      {list !== null && (
        <table className="list" data-testid="booth-table">
          <thead>
            <tr>
              <th>बूथ</th>
              <th>नाम</th>
              <th>PS वार्ड</th>
              <th>ZP वार्ड</th>
              <th>मतदाता</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((b) => (
              <tr key={b.id}>
                <td className="numcell">{b.boothNo}</td>
                <td>{b.nameHindi}</td>
                <td className="numcell">{b.psWard.wardNo}</td>
                <td className="numcell">{b.zpWard.wardNo}</td>
                <td className="numcell">{votersText(b)}</td>
                <td>
                  <Link className="btn btn-secondary" to={`/admin/booths/${psId}/${b.id}`}>
                    खोलें
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {list !== null && list.length === 0 && <p>कोई बूथ नहीं मिला।</p>}
      <ElectionDateCard />
    </>
  );
}
