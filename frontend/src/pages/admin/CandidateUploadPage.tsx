import { useState } from 'react';
import { GENDER_HINDI } from '../../api/adminTypes';
import type { CandidateWardPreview, CandidatesPreview } from '../../api/adminTypes';
import { PageIntro } from '../../components/AdminParts';
import { UploadFlow } from '../../components/UploadFlow';
import '../../styles/admin.css';

const areaKey = (w: CandidateWardPreview) => (w.panchayatSamiti ? `PS:${w.panchayatSamiti.id}` : 'ZP');
const areaName = (w: CandidateWardPreview) => (w.panchayatSamiti ? w.panchayatSamiti.name : 'ज़िला परिषद');

/** One PS (or the ZP) at a time: each ward's ballot in order, NOTA added, unopposed marked. */
function Preview({ preview }: { preview: CandidatesPreview }) {
  const areas = [...new Map(preview.wards.map((w) => [areaKey(w), areaName(w)])).entries()];
  const [area, setArea] = useState(areas[0]?.[0] ?? '');
  const wards = preview.wards.filter((w) => areaKey(w) === area);
  const t = preview.totals;
  return (
    <>
      <p className="big" data-testid="upload-totals">
        वार्ड {t.wards} · उम्मीदवार {t.candidates} · निर्विरोध {t.unopposed} · बदले जाने वाले वार्ड{' '}
        {t.replaced}
      </p>
      {preview.wardsStillEmpty > 0 && (
        <p className="msg msg-warn">
          ! {preview.wardsStillEmpty} वार्ड इस फ़ाइल में नहीं हैं और उनकी सूची अभी खाली है।
        </p>
      )}
      <div className="field">
        <label htmlFor="preview-area">पंचायत समिति चुनें</label>
        <select
          id="preview-area"
          value={area}
          onChange={(e) => {
            setArea(e.target.value);
          }}
        >
          {areas.map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
      </div>
      {wards.map((w) => (
        <section key={w.wardId} className="ward-preview">
          <h3>
            वार्ड {w.wardNo}
            {w.reservationCategory ? ` — ${w.reservationCategory}` : ''}
            {w.replaces ? ' — पुरानी सूची बदलेगी' : ''}
          </h3>
          <table className="list">
            <thead>
              <tr>
                <th>क्रम</th>
                <th>नाम</th>
                <th>पार्टी</th>
                <th>लिंग</th>
              </tr>
            </thead>
            <tbody>
              {w.candidates.map((c) => (
                <tr key={c.position}>
                  <td className="numcell">{c.position}</td>
                  <td>{c.nameHindi}</td>
                  <td>{c.party ? `${c.party.nameHindi} (${c.party.shortName})` : 'निर्दलीय'}</td>
                  <td>{GENDER_HINDI[c.gender]}</td>
                </tr>
              ))}
              {w.unopposed ? (
                <tr className="nota-row">
                  <td colSpan={4}>निर्विरोध — एक ही उम्मीदवार, नोटा नहीं जुड़ेगा</td>
                </tr>
              ) : (
                <tr className="nota-row">
                  <td className="numcell">{w.candidates.length + 1}</td>
                  <td colSpan={3}>इनमें से कोई नहीं (नोटा) — अपने आप जुड़ेगा</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      ))}
    </>
  );
}

/** DM "उम्मीदवार सूची अपलोड": the full list (all PS and ZP wards) from one Excel file. */
export function CandidateUploadPage() {
  return (
    <>
      <PageIntro title="उम्मीदवार सूची अपलोड" hint="यहाँ उम्मीदवार सूची की Excel फ़ाइल चुनें।" />
      <UploadFlow<CandidatesPreview>
        checkPath="/api/admin/candidates/check"
        savePath="/api/admin/candidates/save"
        templateHref="/api/admin/templates/candidates.xlsx"
        successText="सूची सेव हो गई"
        saveExplain={(p) =>
          `${p.totals.wards} वार्डों की सूची सेव होगी${p.totals.replaced > 0 ? ` (${p.totals.replaced} वार्डों की पुरानी सूची बदलेगी)` : ''}।`
        }
        renderPreview={(p) => <Preview preview={p} />}
      />
    </>
  );
}
