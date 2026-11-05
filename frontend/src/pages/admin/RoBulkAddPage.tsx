import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { Link } from 'react-router-dom';
import type { Issue, RoBulkCheck, RoBulkRow, RoBulkSaved } from '../../api/adminTypes';
import { ApiError, api, saveBase64Xlsx } from '../../api/api';
import {
  IssueList,
  PageIntro,
  StepBar,
  fileProblem,
  fileToBase64,
  issuesOf,
} from '../../components/AdminParts';
import { ErrorBox, SuccessBox, WarningBox } from '../../components/ErrorBox';
import { PasswordDialog } from '../../components/PasswordDialog';
import '../../styles/admin.css';

const STEPS = ['फ़ाइल चुनें', 'जाँच', 'पूर्वावलोकन', 'सेव'] as const;
const TEMPLATE_HREF = '/api/admin/users/bulk-template.xlsx';

const STATUS_TEXT: Readonly<Record<RoBulkRow['status'], string>> = {
  NEW: '✓ नया बनेगा',
  EXISTS: '⏭ पहले से मौजूद है, छोड़ा गया',
  ERROR: '✗ गलत',
};

interface Picked {
  name: string;
  base64: string;
}

/** The checked rows: status in symbol + words, and the reason for every skipped or wrong row. */
export function RoBulkPreview({ check }: { check: RoBulkCheck }) {
  const t = check.totals;
  return (
    <>
      <p className="bulk-totals" data-testid="bulk-totals">
        <span className="badge bulk-new">{t.create} नए बनेंगे</span>
        <span className="badge bulk-exists">{t.exists} पहले से मौजूद (छोड़े जाएँगे)</span>
        <span className="badge bulk-error">{t.errors} गलत</span>
      </p>
      <div className="table-scroll">
        <table className="list bulk-table" data-testid="bulk-rows">
          <thead>
            <tr>
              <th>पंक्ति</th>
              <th>पद</th>
              <th>RO का नाम</th>
              <th>मोबाइल</th>
              <th>स्थिति</th>
              <th>कारण</th>
            </tr>
          </thead>
          <tbody>
            {check.rows.map((r) => (
              <tr key={r.rowNumber} className={`bulk-row-${r.status.toLowerCase()}`}>
                <td>{r.rowNumber}</td>
                <td>{r.seatLabel ?? '—'}</td>
                <td>{r.fullName ?? '—'}</td>
                <td>{r.phone ?? '—'}</td>
                <td className="bulk-status">{STATUS_TEXT[r.status]}</td>
                <td>{r.reasons.length === 0 ? '—' : r.reasons.join('; ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** The accounts just created, with their one-time passwords (this page is DM only). */
function CreatedList({ saved, onDownload }: { saved: RoBulkSaved; onDownload: () => void }) {
  return (
    <div className="otp-box">
      <p className="big-explain">
        ये पासवर्ड केवल अभी दिख रहे हैं। Excel फ़ाइल गोपनीय है — इसे संभालकर रखें और किसी को न भेजें।
      </p>
      <div className="table-scroll">
        <table className="list" data-testid="bulk-created">
          <thead>
            <tr>
              <th>पद</th>
              <th>RO का नाम</th>
              <th>यूज़रनेम</th>
              <th>पासवर्ड</th>
            </tr>
          </thead>
          <tbody>
            {saved.created.map((c) => (
              <tr key={c.username}>
                <td>{c.seatLabel}</td>
                <td>{c.fullName}</td>
                <td className="mono">{c.username}</td>
                <td className="mono">{c.password}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="action-list">
        <button type="button" className="btn btn-secondary btn-big" onClick={onDownload}>
          लॉगिन Excel फिर से डाउनलोड करें
        </button>
        <Link className="btn btn-primary btn-big" to="/admin/users">
          RO सूची पर वापस जाएँ
        </Link>
      </p>
    </div>
  );
}

/**
 * "Excel से RO जोड़ें": 1 फ़ाइल चुनें → 2 जाँच (nothing is saved) → 3 पूर्वावलोकन → 4 सेव (the DM's
 * password; one transaction on the server). Wrong rows block the save unless the DM ticks the box;
 * rows whose post or mobile already exists are always skipped. After saving, the login file of the
 * new accounts downloads at once (the passwords exist only now).
 */
export function RoBulkAddPage() {
  const input = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<Picked | null>(null);
  const [dragging, setDragging] = useState(false);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<RoBulkCheck | null>(null);
  const [allowErrors, setAllowErrors] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saveIssues, setSaveIssues] = useState<Issue[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState<RoBulkSaved | null>(null);

  const busy = checking || confirming;
  const clear = () => {
    setFile(null);
    setCheck(null);
    setAllowErrors(false);
    setSaveIssues([]);
    setError(null);
  };

  const pick = async (f: File | undefined) => {
    if (busy) return;
    clear();
    if (!f) return;
    const problem = fileProblem(f);
    if (problem !== null) {
      setError(problem);
      if (input.current) input.current.value = '';
      return;
    }
    setFile({ name: f.name, base64: await fileToBase64(f) });
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    void pick(e.dataTransfer.files[0]);
  };

  const runCheck = async () => {
    if (!file || checking) return;
    setChecking(true);
    setError(null);
    try {
      setCheck(
        await api<RoBulkCheck>('POST', '/api/admin/users/bulk/check', {
          fileName: file.name,
          fileBase64: file.base64,
        }),
      );
    } catch (err) {
      setError(err);
    } finally {
      setChecking(false);
    }
  };

  const save = async (password: string) => {
    if (!file || !check) return;
    let out: RoBulkSaved;
    try {
      out = await api<RoBulkSaved>('POST', '/api/admin/users/bulk/save', {
        fileName: file.name,
        fileBase64: file.base64,
        password,
        allowErrors,
        expectedSeats: check.expectedSeats,
      });
    } catch (err) {
      const issues = issuesOf(err);
      const stale = err instanceof ApiError && err.code === 'PREVIEW_STALE';
      if (issues === null && !stale) throw err; // shown in the dialog (e.g. wrong password)
      setConfirming(false);
      if (stale) {
        setCheck(null);
        setError(err);
      } else setSaveIssues(issues ?? []);
      return;
    }
    setConfirming(false);
    setSaved(out);
    saveBase64Xlsx(out.credentialsFile);
  };

  const t = check?.ok === true ? check.totals : null;
  const canSave = t !== null && t.create > 0 && (t.errors === 0 || allowErrors);
  const step = saved ? 4 : t !== null ? 3 : file ? 1 : 0;

  return (
    <>
      <PageIntro
        title="Excel से RO जोड़ें"
        hint="खाली Excel डाउनलोड करें, उसमें RO की जानकारी भरें, फिर फ़ाइल चुनकर जाँच करें। जाँच में कुछ सेव नहीं होता।"
      />
      <StepBar steps={STEPS} current={step} />

      {saved ? (
        <>
          <SuccessBox
            text={`${saved.created.length} नए RO खाते बन गए — लॉगिन की Excel फ़ाइल डाउनलोड हो गई`}
          />
          <CreatedList
            saved={saved}
            onDownload={() => {
              saveBase64Xlsx(saved.credentialsFile);
            }}
          />
        </>
      ) : (
        <>
          <p>
            <a className="btn btn-secondary btn-big" href={TEMPLATE_HREF} download>
              खाली Excel (टेम्पलेट) डाउनलोड करें
            </a>
          </p>
          <div
            className={`drop-zone${dragging ? ' drop-zone-active' : ''}`}
            data-testid="drop-zone"
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => {
              setDragging(false);
            }}
            onDrop={onDrop}
          >
            <label htmlFor="ro-bulk-file">
              1. Excel फ़ाइल यहाँ छोड़ें या चुनें (.xlsx, अधिकतम 5 MB, 200 पंक्तियाँ)
            </label>
            <input
              ref={input}
              id="ro-bulk-file"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={busy}
              // Choosing the same (corrected) file again must still count as a new choice.
              onClick={(e) => {
                e.currentTarget.value = '';
              }}
              onChange={(e) => void pick(e.target.files?.[0])}
            />
            {file && <p className="muted">चुनी गई फ़ाइल: {file.name}</p>}
          </div>

          <ErrorBox error={error} />
          {check && !check.ok && (
            <IssueList title="फ़ाइल में गलती — इसे ठीक करके फ़ाइल फिर से चुनें" issues={check.errors} />
          )}
          <IssueList title="सेव नहीं हुआ — ये गलतियाँ ठीक करें" issues={saveIssues} />

          {check?.ok === true && (
            <>
              <h2>3. पूर्वावलोकन — जाँचें कि सब सही है</h2>
              <RoBulkPreview check={check} />
              {check.totals.create === 0 && (
                <WarningBox text="इस फ़ाइल से कोई नया RO खाता नहीं बनेगा — सही फ़ाइल चुनें" />
              )}
              {check.totals.errors > 0 && check.totals.create > 0 && (
                <div className="field">
                  <WarningBox text="कुछ पंक्तियाँ गलत हैं। इन्हें Excel में ठीक करके फ़ाइल फिर से चुनें — या नीचे टिक करके बाकी सही पंक्तियाँ सेव करें।" />
                  <label className="check-line">
                    <input
                      type="checkbox"
                      checked={allowErrors}
                      onChange={(e) => {
                        setAllowErrors(e.target.checked);
                      }}
                    />{' '}
                    गलत पंक्तियाँ छोड़कर {check.totals.create} सही पंक्तियाँ सेव करें
                  </label>
                </div>
              )}
            </>
          )}

          <div className="actions main-action">
            {step === 3 ? (
              <button
                type="button"
                className="btn btn-primary btn-big"
                disabled={!canSave || confirming}
                onClick={() => {
                  setConfirming(true);
                }}
              >
                4. सेव करें
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-big"
                disabled={!file || checking || check !== null}
                onClick={() => void runCheck()}
              >
                {checking ? 'जाँच हो रही है…' : '2. जाँच करें'}
              </button>
            )}
            <Link className="btn btn-secondary btn-big" to="/admin/users">
              रुकें, RO सूची पर जाएँ
            </Link>
          </div>
        </>
      )}

      {confirming && t !== null && (
        <PasswordDialog
          title="नए RO खाते बनाएँ?"
          explain={`${t.create} नए RO खाते बनेंगे${t.exists > 0 ? `, ${t.exists} पहले से मौजूद छोड़े जाएँगे` : ''}${t.errors > 0 ? `, ${t.errors} गलत पंक्तियाँ छोड़ी जाएँगी` : ''}। पासवर्ड वाली Excel तुरंत डाउनलोड होगी।`}
          confirmLabel="हाँ, खाते बनाएँ"
          onConfirm={save}
          onCancel={() => {
            setConfirming(false);
          }}
        />
      )}
    </>
  );
}
