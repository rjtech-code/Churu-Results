import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { GENDER_HINDI } from '../../api/adminTypes';
import type {
  AreaWard,
  CandidateDetails,
  CandidateStatus,
  Issue,
  WardCandidate,
  WardCandidatesView,
} from '../../api/adminTypes';
import { api } from '../../api/api';
import { IssueList, ListStatusBadge, PageIntro, issuesOf } from '../../components/AdminParts';
import { CandidateDetailsFields, detailsSummary } from '../../components/CandidateDetailsFields';
import { ErrorBox, SuccessBox } from '../../components/ErrorBox';
import { Modal } from '../../components/Modal';
import { PasswordDialog } from '../../components/PasswordDialog';
import { useApiData } from '../../components/useApiData';
import { LockDialog } from './LockDialog';
import '../../styles/admin.css';

function WardView({
  ward,
  onClose,
  onEdit,
}: {
  ward: AreaWard;
  onClose: () => void;
  onEdit: (candidate: WardCandidate) => void;
}) {
  const { data, error } = useApiData(
    () => api<WardCandidatesView>('GET', `/api/admin/wards/${ward.id}/candidates`),
    [ward.id],
  );
  return (
    <Modal label={ward.label} onCancel={onClose}>
      <h2>{ward.label}</h2>
      <ErrorBox error={error} />
      {data && (
        <>
          {data.ward.reservationCategory && <p>आरक्षण वर्ग: {data.ward.reservationCategory}</p>}
          <table className="list">
            <thead>
              <tr>
                <th>क्रम</th>
                <th>नाम</th>
                <th>पार्टी</th>
                <th>लिंग</th>
                <th>विवरण (निजी)</th>
              </tr>
            </thead>
            <tbody>
              {data.candidates.map((c) => (
                <tr key={c.position}>
                  <td className="numcell">{c.position}</td>
                  <td>{c.nameHindi}</td>
                  <td>{c.party ? `${c.party.nameHindi} (${c.party.shortName})` : 'निर्दलीय'}</td>
                  <td>{GENDER_HINDI[c.gender]}</td>
                  <td>
                    {detailsSummary(c)}{' '}
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        onEdit(c);
                      }}
                    >
                      विवरण बदलें
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.ward.unopposed && <p className="msg msg-ok">✓ निर्विरोध (एक ही उम्मीदवार)</p>}
          {data.candidates.length === 0 && <p>इस वार्ड में अभी कोई उम्मीदवार नहीं है।</p>}
        </>
      )}
      <button type="button" className="btn btn-secondary btn-big" onClick={onClose}>
        बंद करें
      </button>
    </Modal>
  );
}

/** One PS (or the ZP): print the ballot report, send a list back, lock or unlock the area. */
export function CandidateAreaPage() {
  const { area = '' } = useParams();
  const { data, error, reload } = useApiData(
    () => api<CandidateStatus>('GET', `/api/admin/candidate-status?area=${encodeURIComponent(area)}`),
    [area],
  );
  const [viewing, setViewing] = useState<AreaWard | null>(null);
  // "विवरण बदलें" replaces the ward view while open; closing it shows the ward again.
  const [editing, setEditing] = useState<{ ward: AreaWard; candidate: WardCandidate } | null>(null);
  const [details, setDetails] = useState<CandidateDetails | null>(null);
  const [detailIssues, setDetailIssues] = useState<Issue[]>([]);
  const [sending, setSending] = useState<AreaWard | null>(null);
  const [reason, setReason] = useState('');
  const [locking, setLocking] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockReason, setUnlockReason] = useState('');
  const [unlockTyped, setUnlockTyped] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const detail = data?.detail;
  const name = detail?.name ?? '';
  const unlocked = (detail?.wards ?? []).filter((w) => w.status !== 'LOCKED').length;
  const lockedCount = (detail?.wards ?? []).length - unlocked;

  return (
    <>
      <p className="backlink">
        <Link to="/admin/candidates/check">← उम्मीदवार जाँच</Link>
      </p>
      <PageIntro
        title={`${name} — उम्मीदवार जाँच`}
        hint="रिपोर्ट प्रिंट करके दो लोग आधिकारिक सूची से मिलाएँ, फिर लॉक करें।"
      />
      <ErrorBox error={error} />
      <SuccessBox text={done} />
      <p>
        <a
          className="btn btn-secondary btn-big"
          href={`/api/admin/ballot-report.xlsx?scope=${encodeURIComponent(area)}`}
          download
          data-testid="ballot-report"
        >
          रिपोर्ट (Excel) डाउनलोड करें
        </a>
      </p>
      {detail && (
        <table className="list" data-testid="ward-table">
          <thead>
            <tr>
              <th>वार्ड</th>
              <th>उम्मीदवार</th>
              <th>स्थिति</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {detail.wards.map((w) => (
              <tr key={w.id}>
                <td className="ward-name">वार्ड {w.wardNo}</td>
                <td>
                  {w.candidates === 0 ? 'कोई नहीं' : w.unopposed ? '1 (निर्विरोध)' : `${w.candidates} + नोटा`}
                </td>
                <td>
                  <ListStatusBadge status={w.status} />
                  {w.returnReason && <div className="small">वापस भेजी गई: {w.returnReason}</div>}
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setViewing(w);
                    }}
                  >
                    देखें
                  </button>
                  {w.status !== 'LOCKED' && !w.hasEntries && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        setDone(null);
                        setReason('');
                        setSending(w);
                      }}
                    >
                      वापस भेजें
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(unlocked > 0 || lockedCount > 0) && (
        <div className="actions main-action">
          {unlocked > 0 && (
            <button
              type="button"
              className="btn btn-danger btn-big"
              onClick={() => {
                setDone(null);
                setLocking(true);
              }}
            >
              {area === 'ZP' ? 'ज़िला परिषद लॉक करें' : 'इस पंचायत समिति को लॉक करें'}
            </button>
          )}
          {lockedCount > 0 && (
            <button
              type="button"
              className="btn btn-secondary btn-big"
              onClick={() => {
                setDone(null);
                setUnlockReason('');
                setUnlockTyped('');
                setUnlocking(true);
              }}
            >
              अनलॉक करें
            </button>
          )}
        </div>
      )}

      {viewing && (
        <WardView
          ward={viewing}
          onClose={() => {
            setViewing(null);
          }}
          onEdit={(candidate) => {
            setDone(null);
            setEditing({ ward: viewing, candidate });
            setDetailIssues([]);
            setDetails({
              dob: candidate.dob,
              ageStated: candidate.ageStated,
              education: candidate.education,
              mobile: candidate.mobile,
              candidateCategory: candidate.candidateCategory,
            });
            setViewing(null);
          }}
        />
      )}
      {editing && details && (
        <PasswordDialog
          title={`${editing.ward.label} — ${editing.candidate.nameHindi} — विवरण बदलें`}
          explain="जन्म तिथि या उम्र, शिक्षा, मोबाइल और Category (श्रेणी) बदलेंगे (लॉक के बाद भी)। नाम, पार्टी, बैलेट नंबर और वोट नहीं बदलेंगे।"
          confirmLabel="विवरण सेव करें"
          askPassword={false}
          onConfirm={async () => {
            try {
              await api('POST', `/api/admin/candidates/${editing.candidate.id}/details`, details);
            } catch (err) {
              const list = issuesOf(err);
              if (!list) throw err;
              setDetailIssues(list);
              return;
            }
            setViewing(editing.ward);
            setEditing(null);
            setDone('विवरण सेव हो गया');
          }}
          onCancel={() => {
            setViewing(editing.ward);
            setEditing(null);
          }}
        >
          <div className="field">
            <CandidateDetailsFields
              idPrefix="dm-details"
              label={editing.candidate.nameHindi}
              value={details}
              onChange={(patch) => {
                setDetails({ ...details, ...patch });
                setDetailIssues([]);
              }}
            />
          </div>
          <IssueList title="विवरण सेव नहीं हुआ — ये गलतियाँ ठीक करें" issues={detailIssues} />
        </PasswordDialog>
      )}
      {sending && (
        <PasswordDialog
          title={`${sending.label} — वापस भेजें`}
          explain="यह सूची RO को सुधार के लिए वापस जाएगी।"
          confirmLabel="वापस भेजें"
          canConfirm={reason.trim().length >= 10}
          askPassword={false}
          onConfirm={async () => {
            await api('POST', `/api/admin/wards/${sending.id}/send-back`, { reason: reason.trim() });
            setSending(null);
            setDone('सूची RO को वापस भेज दी गई');
            reload();
          }}
          onCancel={() => {
            setSending(null);
          }}
        >
          <div className="field">
            <label htmlFor="send-back-reason">कारण (RO को दिखेगा, कम से कम 10 अक्षर)</label>
            <textarea
              id="send-back-reason"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
              }}
            />
          </div>
        </PasswordDialog>
      )}
      {unlocking && (
        <PasswordDialog
          title={`${name} अनलॉक करें?`}
          explain={`${name} के ${lockedCount} लॉक वार्ड खुल जाएँगे और RO का "सूची तैयार है" हट जाएगा। बदलाव के बाद RO फिर "सूची तैयार है" करें, फिर लॉक करें।`}
          confirmLabel="अनलॉक करें"
          danger
          canConfirm={unlockReason.trim().length >= 10 && unlockTyped === 'UNLOCK'}
          onConfirm={async (password) => {
            const out = await api<{ unlocked: number[] }>('POST', '/api/admin/unlock', {
              area,
              reason: unlockReason.trim(),
              confirmText: unlockTyped,
              password,
            });
            setUnlocking(false);
            setDone(`${out.unlocked.length} वार्ड अनलॉक हो गए`);
            reload();
          }}
          onCancel={() => {
            setUnlocking(false);
          }}
        >
          <div className="field">
            <label htmlFor="unlock-reason">कारण (कम से कम 10 अक्षर)</label>
            <input
              id="unlock-reason"
              autoComplete="off"
              maxLength={500}
              value={unlockReason}
              onChange={(e) => {
                setUnlockReason(e.target.value);
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="unlock-typed">पुष्टि के लिए अंग्रेज़ी में UNLOCK लिखें</label>
            <input
              id="unlock-typed"
              autoComplete="off"
              value={unlockTyped}
              onChange={(e) => {
                setUnlockTyped(e.target.value);
              }}
            />
          </div>
        </PasswordDialog>
      )}
      {locking && (
        <LockDialog
          area={area}
          areaName={name}
          onCancel={() => {
            setLocking(false);
          }}
          onDone={(n) => {
            setLocking(false);
            setDone(`${n} वार्ड लॉक हो गए`);
            reload();
          }}
        />
      )}
    </>
  );
}
