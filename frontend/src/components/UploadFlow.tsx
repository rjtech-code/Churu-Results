import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { CheckResult, Issue } from '../api/adminTypes';
import { api } from '../api/api';
import { IssueList, StepBar, fileProblem, fileToBase64, issuesOf } from './AdminParts';
import { ErrorBox, SuccessBox } from './ErrorBox';
import { PasswordDialog } from './PasswordDialog';

const STEPS = ['फ़ाइल चुनें', 'जाँच', 'पूर्वावलोकन', 'सेव'] as const;

interface Picked {
  name: string;
  base64: string;
}

/**
 * 1 फ़ाइल चुनें → 2 जाँच → 3 पूर्वावलोकन → 4 सेव. Only the current step's button is enabled.
 * "जाँच" writes nothing on the server; "सेव" checks everything again and saves all or nothing.
 * Save stays disabled until the check found zero problems. askPassword (default true): "सेव" asks
 * for the password in a dialog; false saves straight away (parties).
 */
export function UploadFlow<P>({
  checkPath,
  savePath,
  templateHref,
  templateLabel = 'खाली फ़ाइल (टेम्पलेट) डाउनलोड करें',
  saveExplain,
  successText,
  renderPreview,
  onSaved,
  askPassword = true,
}: {
  checkPath: string;
  savePath: string;
  templateHref: string;
  templateLabel?: string;
  /** One sentence for the save confirmation box. */
  saveExplain: (preview: P) => string;
  successText: string;
  renderPreview: (preview: P) => ReactNode;
  onSaved?: () => void;
  askPassword?: boolean;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<Picked | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<CheckResult<P> | null>(null);
  const [saveIssues, setSaveIssues] = useState<Issue[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const clearState = () => {
    setFile(null);
    setResult(null);
    setSaveIssues([]);
    setError(null);
    setSaved(false);
  };
  const reset = () => {
    clearState();
    if (input.current) input.current.value = '';
  };

  const pick = async (f: File | undefined) => {
    clearState(); // keep the chosen file shown in the box
    setFileError(null);
    if (!f) return;
    const problem = fileProblem(f);
    if (problem !== null) {
      setFileError(problem);
      if (input.current) input.current.value = '';
      return;
    }
    setFile({ name: f.name, base64: await fileToBase64(f) });
  };

  const check = async () => {
    if (!file || checking) return;
    setChecking(true);
    setError(null);
    try {
      setResult(
        await api<CheckResult<P>>('POST', checkPath, { fileName: file.name, fileBase64: file.base64 }),
      );
    } catch (err) {
      setError(err);
    } finally {
      setChecking(false);
    }
  };

  const save = async (password: string | null) => {
    if (!file) return;
    try {
      const body = { fileName: file.name, fileBase64: file.base64 };
      await api('POST', savePath, password === null ? body : { ...body, password });
    } catch (err) {
      const issues = issuesOf(err);
      if (issues === null) throw err; // shown in the dialog (e.g. wrong password)
      setSaveIssues(issues);
      setConfirming(false);
      return;
    }
    setConfirming(false);
    setSaved(true);
    onSaved?.();
  };

  /** No password: save straight away; errors show on the page. */
  const saveNow = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await save(null);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const step = saved ? 4 : result?.ok === true ? 3 : file ? 1 : 0;
  const preview = result?.ok === true ? result.preview : null;

  return (
    <div className="upload-flow">
      <StepBar steps={STEPS} current={step} />
      <p>
        <a className="btn btn-secondary" href={templateHref} download>
          {templateLabel}
        </a>
      </p>

      <div className="field">
        <label htmlFor="upload-file">1. Excel फ़ाइल चुनें (.xlsx, अधिकतम 5 MB)</label>
        <input
          ref={input}
          id="upload-file"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={checking || confirming || saving}
          // Choosing the same (corrected) file again must still count as a new choice.
          onClick={(e) => {
            e.currentTarget.value = '';
          }}
          onChange={(e) => void pick(e.target.files?.[0])}
        />
      </div>
      <ErrorBox error={fileError} />
      {file && !saved && <p className="muted">चुनी गई फ़ाइल: {file.name}</p>}

      {saved ? (
        <>
          <SuccessBox text={successText} />
          <button type="button" className="btn btn-secondary" onClick={reset}>
            दूसरी फ़ाइल चुनें
          </button>
        </>
      ) : (
        <>
          {result && !result.ok && (
            <IssueList
              title="गलतियाँ — इन्हें Excel में ठीक करके फ़ाइल फिर से चुनें"
              issues={result.errors}
            />
          )}
          <IssueList title="सेव नहीं हुआ — ये गलतियाँ ठीक करें" issues={saveIssues} />
          {result && <IssueList title="ध्यान दें" issues={result.warnings} kind="warn" />}
          <ErrorBox error={error} />
          {preview !== null && (
            <>
              <h2>3. पूर्वावलोकन — जाँचें कि सब सही है</h2>
              {renderPreview(preview)}
            </>
          )}
          <div className="actions main-action">
            {step === 3 ? (
              <button
                type="button"
                className="btn btn-primary btn-big"
                disabled={saving}
                onClick={() => {
                  if (askPassword) setConfirming(true);
                  else void saveNow();
                }}
              >
                {saving ? 'सेव हो रहा है…' : '4. सेव करें'}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-big"
                disabled={!file || checking || result !== null}
                onClick={() => void check()}
              >
                {checking ? 'जाँच हो रही है…' : '2. जाँच करें'}
              </button>
            )}
          </div>
        </>
      )}

      {confirming && preview !== null && (
        <PasswordDialog
          title="सूची सेव करें?"
          explain={saveExplain(preview)}
          confirmLabel="हाँ, सेव करें"
          onConfirm={save}
          onCancel={() => {
            setConfirming(false);
          }}
        />
      )}
    </div>
  );
}
