import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { GENDER_HINDI, NO_CANDIDATE_DETAILS, pickDetails } from '../../api/adminTypes';
import type { Gender, Issue, RoCandidate, RoWardDetail } from '../../api/adminTypes';
import { api } from '../../api/api';
import { IssueList, ListStatusBadge, issuesOf } from '../../components/AdminParts';
import { CandidateDetailsFields, detailsComplete } from '../../components/CandidateDetailsFields';
import { ErrorBox, SuccessBox } from '../../components/ErrorBox';
import { PasswordDialog } from '../../components/PasswordDialog';
import { useApiData } from '../../components/useApiData';
import '../../styles/admin.css';
import '../../styles/candidates.css';

/** A row of the form. The ballot number is its place in the list (1, 2, 3 …), never typed. */
type Row = Omit<RoCandidate, 'ballotPosition'> & { key: number };

let nextKey = 1;
const toRows = (list: readonly RoCandidate[]): Row[] =>
  [...list]
    .sort((a, b) => a.ballotPosition - b.ballotPosition)
    .map(({ ballotPosition: _p, ...c }) => ({ ...c, key: nextKey++ }));

/**
 * One ward's candidate list: one card per candidate (ballot number = position in the list, moved
 * with ↑ / ↓), name, party, gender and the optional details. "सूची सेव करें" saves the whole list
 * (the server checks every rule); then "सूची तैयार है" tells the DM it can be checked.
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
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [readying, setReadying] = useState(false);
  const [removing, setRemoving] = useState<{ row: Row; no: number } | null>(null);
  const { ward, parties } = data;
  const editable = ward.editable;

  const touched = () => {
    setDirty(true);
    setDone(null);
    setIssues([]);
  };
  const change = (key: number, patch: Partial<Row>) => {
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    touched();
  };
  const add = () => {
    setRows([
      ...rows,
      { key: nextKey++, nameHindi: '', partyId: null, gender: 'M', ...NO_CANDIDATE_DETAILS },
    ]);
    touched();
  };
  const move = (index: number, by: -1 | 1) => {
    const list = [...rows];
    const [row] = list.splice(index, 1);
    if (row === undefined) return;
    list.splice(index + by, 0, row);
    setRows(list);
    touched();
  };
  const remove = (key: number) => {
    setRows(rows.filter((r) => r.key !== key));
    touched();
  };

  const emptyNames = rows.filter((r) => r.nameHindi.trim() === '').length;
  const complete = rows.filter(detailsComplete).length;

  /** "सूची तैयार है": no password, no confirmation box. */
  const markReady = async () => {
    if (readying) return;
    setReadying(true);
    setDone(null);
    setSaveError(null);
    try {
      await api('POST', `/api/candidates/wards/${ward.id}/ready`, {});
      setDone('सूची तैयार बता दी गई');
      reload();
    } catch (err) {
      setSaveError(err);
    } finally {
      setReadying(false);
    }
  };

  const save = async () => {
    if (saving) return;
    setTried(true);
    if (emptyNames > 0) return; // shown on the card itself
    setSaving(true);
    setIssues([]);
    setSaveError(null);
    try {
      await api('PUT', `/api/candidates/wards/${ward.id}`, {
        candidates: rows.map((r, i) => ({
          ballotPosition: i + 1,
          nameHindi: r.nameHindi,
          partyId: r.partyId,
          gender: r.gender,
          ...pickDetails(r),
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

  return (
    <div className="cw-page">
      <p className="backlink">
        <Link to="/candidates">← उम्मीदवार</Link>
      </p>

      <header className="cw-head">
        <div>
          <h1>{ward.label} — उम्मीदवार सूची</h1>
          <p className="cw-meta">
            <ListStatusBadge status={ward.status} />
            {ward.reservationCategory && <span className="cw-chip">आरक्षण: {ward.reservationCategory}</span>}
          </p>
        </div>
        <ul className="cw-stats" aria-label="सारांश">
          <li>
            <strong>{rows.length}</strong>
            <span>उम्मीदवार</span>
          </li>
          <li>
            <strong>
              {complete}/{rows.length}
            </strong>
            <span>पूरी जानकारी</span>
          </li>
        </ul>
      </header>

      {editable ? (
        <p className="page-hint">
          हर उम्मीदवार का नाम, पार्टी और लिंग भरें। बाकी जानकारी (जन्म तिथि या उम्र, शिक्षा, मोबाइल…) वैकल्पिक
          है। बैलेट नंबर ↑ ↓ से बदलें, फिर सूची सेव करें।
        </p>
      ) : (
        <p className="msg msg-ok">
          ✓{' '}
          {ward.status === 'LOCKED' ? 'यह सूची लॉक है। अब इसे बदला नहीं जा सकता।' : 'मतगणना शुरू हो चुकी है।'}
        </p>
      )}
      {ward.returnReason && ward.status === 'PENDING' && (
        <p className="msg msg-warn" data-testid="return-reason">
          ! DM ने सूची वापस भेजी है: {ward.returnReason}
        </p>
      )}

      <ol className="cw-list" data-testid="cand-form">
        {rows.map((r, i) => {
          const no = i + 1;
          const nameMissing = tried && r.nameHindi.trim() === '';
          return (
            <li key={r.key} className={`cw-card${nameMissing ? ' cw-card-bad' : ''}`}>
              <div className="cw-order">
                <span className="cw-no" aria-label={`बैलेट नंबर ${String(no)}`}>
                  {no}
                </span>
                {editable && (
                  <span className="cw-move">
                    <button
                      type="button"
                      className="cw-icon"
                      aria-label={`पंक्ति ${String(no)} ऊपर करें`}
                      disabled={i === 0}
                      onClick={() => {
                        move(i, -1);
                      }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="cw-icon"
                      aria-label={`पंक्ति ${String(no)} नीचे करें`}
                      disabled={i === rows.length - 1}
                      onClick={() => {
                        move(i, 1);
                      }}
                    >
                      ↓
                    </button>
                  </span>
                )}
              </div>

              <div className="cw-body">
                <div className="cw-main">
                  <div className="cw-field cw-name">
                    <label htmlFor={`cw-${String(r.key)}-name`}>नाम (हिंदी)</label>
                    <input
                      id={`cw-${String(r.key)}-name`}
                      aria-label={`पंक्ति ${String(no)} नाम`}
                      aria-invalid={nameMissing}
                      maxLength={200}
                      disabled={!editable}
                      value={r.nameHindi}
                      onChange={(e) => {
                        change(r.key, { nameHindi: e.target.value });
                      }}
                    />
                    {nameMissing && <p className="cw-err">उम्मीदवार का नाम लिखें</p>}
                  </div>
                  <div className="cw-field cw-party">
                    <label htmlFor={`cw-${String(r.key)}-party`}>पार्टी</label>
                    <select
                      id={`cw-${String(r.key)}-party`}
                      aria-label={`पंक्ति ${String(no)} पार्टी`}
                      disabled={!editable}
                      value={r.partyId === null ? '' : String(r.partyId)}
                      onChange={(e) => {
                        change(r.key, {
                          partyId: e.target.value === '' ? null : Number(e.target.value),
                        });
                      }}
                    >
                      <option value="">निर्दलीय</option>
                      {parties.map((p) => (
                        <option key={p.id} value={String(p.id)}>
                          {p.nameHindi} ({p.shortName})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="cw-field cw-gender">
                    <label htmlFor={`cw-${String(r.key)}-gender`}>लिंग</label>
                    <select
                      id={`cw-${String(r.key)}-gender`}
                      aria-label={`पंक्ति ${String(no)} लिंग`}
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
                  </div>
                  {editable && (
                    <button
                      type="button"
                      className="cw-remove"
                      aria-label={`पंक्ति ${String(no)} हटाएँ`}
                      onClick={() => {
                        setRemoving({ row: r, no });
                      }}
                    >
                      हटाएँ
                    </button>
                  )}
                </div>
                <CandidateDetailsFields
                  idPrefix={`cand-${String(r.key)}`}
                  label={`पंक्ति ${String(no)}`}
                  value={r}
                  disabled={!editable}
                  onChange={(patch) => {
                    change(r.key, patch);
                  }}
                />
              </div>
            </li>
          );
        })}
        {rows.length > 1 && (
          <li className="cw-card cw-nota">
            <div className="cw-order">
              <span className="cw-no">{rows.length + 1}</span>
            </div>
            <p>इनमें से कोई नहीं (नोटा) — अपने आप आख़िर में जुड़ेगा</p>
          </li>
        )}
      </ol>

      {rows.length === 0 && (
        <div className="cw-empty">
          <p>अभी कोई उम्मीदवार नहीं है।</p>
        </div>
      )}
      {rows.length === 1 && (
        <p className="msg msg-warn">
          ! एक ही उम्मीदवार है — यह वार्ड निर्विरोध माना जाएगा (नोटा नहीं जुड़ेगा)।
        </p>
      )}

      {editable && (
        <button type="button" className="cw-add" onClick={add}>
          + उम्मीदवार जोड़ें
        </button>
      )}

      <IssueList title="सूची सेव नहीं हुई — ये गलतियाँ ठीक करें" issues={issues} />
      <ErrorBox error={saveError} />
      {!dirty && ward.status === 'READY' && (
        <p className="msg msg-ok">✓ सूची तैयार है — DM इसे जाँचकर लॉक करेंगे।</p>
      )}

      {editable && (
        <div className="cw-bar" role="region" aria-label="सूची सेव करें">
          <p className="cw-bar-state">
            {dirty ? (
              <span className="cw-unsaved">● बदलाव सेव नहीं हुए</span>
            ) : done ? (
              <SuccessBox text={done} />
            ) : (
              <span className="muted">सब सेव है</span>
            )}
            {tried && emptyNames > 0 && <span className="cw-err">{emptyNames} उम्मीदवार का नाम खाली है</span>}
          </p>
          <div className="cw-bar-actions">
            {dirty || rows.length === 0 ? (
              <button
                type="button"
                className="btn btn-primary btn-big"
                disabled={saving || !dirty}
                onClick={() => void save()}
              >
                {saving ? 'सेव हो रहा है…' : 'सूची सेव करें'}
              </button>
            ) : (
              ward.status === 'PENDING' && (
                <button
                  type="button"
                  className="btn btn-primary btn-big"
                  disabled={readying}
                  onClick={() => void markReady()}
                >
                  {readying ? 'हो रहा है…' : 'सूची तैयार है'}
                </button>
              )
            )}
          </div>
        </div>
      )}

      {removing && (
        <PasswordDialog
          title="उम्मीदवार हटाएँ"
          explain={`बैलेट नंबर ${String(removing.no)} — ${removing.row.nameHindi.trim() || '(बिना नाम)'} सूची से हटेगा। बाकी नंबर अपने आप ऊपर खिसकेंगे। सेव करने पर ही पक्का होगा।`}
          confirmLabel="हटाएँ"
          danger
          askPassword={false}
          onCancel={() => {
            setRemoving(null);
          }}
          onConfirm={() => {
            remove(removing.row.key);
            setRemoving(null);
            return Promise.resolve();
          }}
        />
      )}
    </div>
  );
}
