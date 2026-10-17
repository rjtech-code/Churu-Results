import { Fragment, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { GENDER_HINDI } from '../../api/adminTypes';
import type { Gender, Issue, RoCandidate, RoWardDetail } from '../../api/adminTypes';
import { api } from '../../api/api';
import { IssueList, ListStatusBadge, PageIntro, issuesOf } from '../../components/AdminParts';
import { CandidateDetailsFields } from '../../components/CandidateDetailsFields';
import { ErrorBox, SuccessBox } from '../../components/ErrorBox';
import { PasswordDialog } from '../../components/PasswordDialog';
import { useApiData } from '../../components/useApiData';
import '../../styles/admin.css';

interface Row extends Omit<RoCandidate, 'ballotPosition'> {
  key: number;
  ballotPosition: string;
}

let nextKey = 1;
const toRows = (list: readonly RoCandidate[]): Row[] =>
  list.map((c) => ({ ...c, key: nextKey++, ballotPosition: String(c.ballotPosition) }));

/**
 * One ward's candidate list: ballot number, Hindi name, party (or निर्दलीय), gender. Add / edit /
 * delete rows, then "सूची सेव करें" saves the whole list (the server checks every rule). Then
 * "सूची तैयार है" (with the password) tells the DM it can be checked.
 */
export function RoCandidateWardPage() {
  const { wardId = '' } = useParams();
  const { data, error, reload, loadedAt } = useApiData(
    () => api<RoWardDetail>('GET', `/api/candidates/wards/${encodeURIComponent(wardId)}`),
    [wardId],
  );
  const [done, setDone] = useState<string | null>(null);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <p className="loading">लोड हो रहा है…</p>;
  return (
    <WardForm
      // Fresh data (after a save) starts the form again from the saved list.
      key={loadedAt?.getTime() ?? 0}
      data={data}
      done={done}
      setDone={setDone}
      reload={reload}
    />
  );
}

function WardForm({
  data,
  done,
  setDone,
  reload,
}: {
  data: RoWardDetail;
  done: string | null;
  setDone: (text: string | null) => void;
  reload: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => toRows(data.candidates));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [confirmReady, setConfirmReady] = useState(false);
  const { ward, parties } = data;
  const editable = ward.editable;

  const change = (key: number, patch: Partial<Row>) => {
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
    setDone(null);
    setIssues([]);
  };
  const add = () => {
    const next = rows.reduce((m, r) => Math.max(m, Number(r.ballotPosition) || 0), 0) + 1;
    setRows([
      ...rows,
      {
        key: nextKey++,
        ballotPosition: String(next),
        nameHindi: '',
        partyId: null,
        gender: 'M',
        dob: null,
        ageStated: null,
        education: null,
        mobile: null,
        candidateCategory: null,
      },
    ]);
    setDirty(true);
    setDone(null);
  };
  const remove = (key: number) => {
    setRows(rows.filter((r) => r.key !== key));
    setDirty(true);
    setDone(null);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setIssues([]);
    setSaveError(null);
    try {
      await api('PUT', `/api/candidates/wards/${ward.id}`, {
        candidates: rows.map((r) => ({
          ballotPosition: Number(r.ballotPosition) || 0,
          nameHindi: r.nameHindi,
          partyId: r.partyId,
          gender: r.gender,
          dob: r.dob,
          ageStated: r.ageStated,
          education: r.education,
          mobile: r.mobile,
          candidateCategory: r.candidateCategory,
        })),
      });
      setDone('सूची सेव हो गई');
      reload();
    } catch (err) {
      const list = issuesOf(err);
      if (list) setIssues(list);
      else setSaveError(err);
    } finally {
      setSaving(false);
    }
  };

  const positionsOk = rows.every((r) => Number(r.ballotPosition) >= 1);

  return (
    <>
      <p className="backlink">
        <Link to="/candidates">← उम्मीदवार</Link>
      </p>
      <PageIntro
        title={`${ward.label} — उम्मीदवार सूची`}
        hint={
          editable
            ? 'हर उम्मीदवार का बैलेट नंबर, नाम, पार्टी और लिंग भरें (जन्म तिथि या उम्र, शिक्षा, मोबाइल वैकल्पिक हैं), फिर सूची सेव करें।'
            : 'यह सूची अब बदली नहीं जा सकती।'
        }
      />
      <p>
        स्थिति: <ListStatusBadge status={ward.status} />
        {ward.reservationCategory && (
          <span className="muted"> · आरक्षण वर्ग: {ward.reservationCategory}</span>
        )}
      </p>
      {ward.returnReason && ward.status === 'PENDING' && (
        <p className="msg msg-warn" data-testid="return-reason">
          ! DM ने सूची वापस भेजी है: {ward.returnReason}
        </p>
      )}
      {!editable && (
        <p className="msg msg-ok">
          ✓ {ward.status === 'LOCKED' ? 'यह सूची लॉक है।' : 'मतगणना शुरू हो चुकी है।'}
        </p>
      )}

      <table className="list cand-form" data-testid="cand-form">
        <thead>
          <tr>
            <th>बैलेट नंबर</th>
            <th>नाम (हिंदी)</th>
            <th>पार्टी</th>
            <th>लिंग</th>
            {editable && <th />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <Fragment key={r.key}>
              <tr>
                <td>
                  <input
                    aria-label={`पंक्ति ${i + 1} बैलेट नंबर`}
                    className="num num-small"
                    inputMode="numeric"
                    disabled={!editable}
                    value={r.ballotPosition}
                    onChange={(e) => {
                      change(r.key, { ballotPosition: e.target.value.replace(/\D/g, '').slice(0, 3) });
                    }}
                  />
                </td>
                <td>
                  <input
                    aria-label={`पंक्ति ${i + 1} नाम`}
                    className="wide"
                    maxLength={200}
                    disabled={!editable}
                    value={r.nameHindi}
                    onChange={(e) => {
                      change(r.key, { nameHindi: e.target.value });
                    }}
                  />
                </td>
                <td>
                  <select
                    aria-label={`पंक्ति ${i + 1} पार्टी`}
                    disabled={!editable}
                    value={r.partyId === null ? '' : String(r.partyId)}
                    onChange={(e) => {
                      change(r.key, { partyId: e.target.value === '' ? null : Number(e.target.value) });
                    }}
                  >
                    <option value="">निर्दलीय</option>
                    {parties.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.nameHindi} ({p.shortName})
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    aria-label={`पंक्ति ${i + 1} लिंग`}
                    disabled={!editable}
                    value={r.gender}
                    onChange={(e) => {
                      change(r.key, { gender: e.target.value as Gender });
                    }}
                  >
                    {(['M', 'F', 'O'] as const).map((g) => (
                      <option key={g} value={g}>
                        {GENDER_HINDI[g]}
                      </option>
                    ))}
                  </select>
                </td>
                {editable && (
                  <td>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        remove(r.key);
                      }}
                    >
                      हटाएँ
                    </button>
                  </td>
                )}
              </tr>
              <tr className="cand-details-row">
                <td />
                <td colSpan={editable ? 4 : 3}>
                  <CandidateDetailsFields
                    idPrefix={`cand-${String(r.key)}`}
                    label={`पंक्ति ${String(i + 1)}`}
                    value={r}
                    disabled={!editable}
                    onChange={(patch) => {
                      change(r.key, patch);
                    }}
                  />
                </td>
              </tr>
            </Fragment>
          ))}
          {rows.length > 1 && (
            <tr className="nota-row">
              <td className="numcell">{rows.length + 1}</td>
              <td colSpan={editable ? 4 : 3}>इनमें से कोई नहीं (नोटा) — अपने आप जुड़ेगा</td>
            </tr>
          )}
        </tbody>
      </table>
      {rows.length === 0 && <p>अभी कोई उम्मीदवार नहीं है।</p>}

      {editable && (
        <>
          <p>
            <button type="button" className="btn btn-secondary" onClick={add}>
              + उम्मीदवार जोड़ें
            </button>
          </p>
          <p className="muted">नोटा अपने आप अंत में जुड़ेगा। एक ही उम्मीदवार हो तो वार्ड निर्विरोध होगा।</p>
          <IssueList title="सूची सेव नहीं हुई — ये गलतियाँ ठीक करें" issues={issues} />
          <ErrorBox error={saveError} />
          <SuccessBox text={done} />
          <div className="actions main-action">
            {dirty || rows.length === 0 ? (
              <button
                type="button"
                className="btn btn-primary btn-big"
                disabled={saving || !dirty || !positionsOk}
                onClick={() => void save()}
              >
                {saving ? 'सेव हो रहा है…' : 'सूची सेव करें'}
              </button>
            ) : (
              ward.status === 'PENDING' && (
                <button
                  type="button"
                  className="btn btn-primary btn-big"
                  onClick={() => {
                    setDone(null);
                    setConfirmReady(true);
                  }}
                >
                  सूची तैयार है
                </button>
              )
            )}
          </div>
          {!dirty && ward.status === 'READY' && (
            <p className="msg msg-ok">✓ सूची तैयार है — DM इसे जाँचकर लॉक करेंगे।</p>
          )}
        </>
      )}

      {confirmReady && (
        <PasswordDialog
          title={`${ward.label} — सूची तैयार है?`}
          explain="DM को बताया जाएगा कि यह सूची जाँच और लॉक के लिए तैयार है।"
          confirmLabel="हाँ, सूची तैयार है"
          onConfirm={async (password) => {
            await api('POST', `/api/candidates/wards/${ward.id}/ready`, { password });
            setConfirmReady(false);
            setDone('सूची तैयार बता दी गई');
            reload();
          }}
          onCancel={() => {
            setConfirmReady(false);
          }}
        />
      )}
    </>
  );
}
