// Shared pieces of the Super Admin panel: task card, impact list, the confirm dialog (summary →
// typed word / password → progress → success or problems), and the drag-and-drop file picker.
import { useId, useRef, useState } from 'react';
import type { DragEvent, ReactNode, SubmitEvent } from 'react';
import { ApiError } from '../../api/api';
import { messageFor } from '../../api/errors';
import { fmt } from '../../api/superadminTypes';
import { MAX_UPLOAD_BYTES, fileProblem, fileToBase64 } from '../../components/AdminParts';
import { Modal } from '../../components/Modal';
import { ReauthPasswordField } from '../../components/ReauthPasswordField';

// ---------------------------------------------------------------- card

export function TaskCard({
  title,
  icon,
  intro,
  danger = false,
  children,
  testId,
}: {
  title: string;
  icon: string;
  intro: ReactNode;
  danger?: boolean;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className={`sa-card${danger ? ' sa-card-danger' : ''}`} data-testid={testId}>
      <h3 className="sa-card-title">
        <span className="sa-card-icon" aria-hidden="true">
          {icon}
        </span>
        {title}
      </h3>
      <div className="sa-card-intro">{intro}</div>
      {children}
    </section>
  );
}

/** A disabled button always says why, right under it. */
export function ActionButton({
  label,
  onClick,
  reason,
  kind = 'primary',
}: {
  label: string;
  onClick: () => void;
  reason: string | null;
  kind?: 'primary' | 'danger' | 'secondary';
}) {
  const id = useId();
  return (
    <div className="sa-action">
      <button
        type="button"
        className={`btn sa-btn btn-${kind}`}
        disabled={reason !== null}
        aria-describedby={reason === null ? undefined : id}
        onClick={onClick}
      >
        {label}
      </button>
      {reason !== null && (
        <p id={id} className="sa-reason">
          <span aria-hidden="true">🔒 </span>
          {reason}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- impact summary

export type ImpactRow = readonly [label: string, count: number];

export function Impact({ deletes, keeps }: { deletes: readonly ImpactRow[]; keeps: string }) {
  const shown = deletes.filter(([, n]) => n > 0);
  return (
    <div className="sa-impact">
      <div className="sa-impact-col sa-impact-del">
        <h4>क्या मिटेगा</h4>
        {shown.length === 0 ? (
          <p className="muted">कुछ नहीं</p>
        ) : (
          <ul>
            {shown.map(([label, n]) => (
              <li key={label}>
                <strong>{fmt(n)}</strong> {label}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="sa-impact-col sa-impact-keep">
        <h4>क्या बचेगा</h4>
        <p>{keeps}</p>
        <p className="sa-audit-note">Audit log कभी नहीं मिटता।</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- confirm dialog

/** What the success screen shows. */
export interface Done {
  title: string;
  lines: readonly string[];
  backupFile?: string | undefined;
  /** Shown instead of the lines (e.g. a one-time password). */
  extra?: ReactNode;
}

/** Thrown by `run` when the server refused with a list of plain problems. */
export class Problems extends Error {
  constructor(readonly lines: readonly string[]) {
    super('problems');
  }
}

type Stage = { kind: 'form' } | { kind: 'working' } | { kind: 'done'; done: Done };

/**
 * One dangerous (or simple) action: the summary, the typed word and the password (only when needed),
 * then "हो रहा है…", then a success screen. Errors stay on the form, in red, in plain words.
 */
export function ConfirmDialog({
  title,
  summary,
  confirmLabel,
  word,
  askPassword,
  danger = false,
  workingText = 'हो रहा है… कृपया page बंद न करें',
  run,
  onClose,
}: {
  title: string;
  summary: ReactNode;
  confirmLabel: string;
  /** The exact word to type ("RESET", "UNLOCK", the booth no), or undefined for a plain confirm. */
  word?: string | undefined;
  askPassword: boolean;
  danger?: boolean;
  workingText?: string;
  run: (password: string | undefined) => Promise<Done>;
  onClose: (changed: boolean) => void;
}) {
  const [stage, setStage] = useState<Stage>({ kind: 'form' });
  const [typed, setTyped] = useState('');
  const [password, setPassword] = useState('');
  const [needPassword, setNeedPassword] = useState(askPassword);
  const [error, setError] = useState<{ text: string; lines: readonly string[] } | null>(null);

  const ready = (word === undefined || typed.trim() === word) && (!needPassword || password !== '');
  const submit = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!ready) return;
    setError(null);
    setStage({ kind: 'working' });
    try {
      const done = await run(needPassword ? password : undefined);
      setStage({ kind: 'done', done });
    } catch (err) {
      setStage({ kind: 'form' });
      if (err instanceof Problems) {
        setError({ text: 'काम नहीं हुआ — ये बातें ठीक करें:', lines: err.lines });
      } else {
        if (err instanceof ApiError && err.code === 'PASSWORD_REQUIRED') setNeedPassword(true);
        setError({ text: messageFor(err), lines: [] });
      }
    } finally {
      setPassword('');
    }
  };

  const changed = stage.kind === 'done';
  return (
    <Modal
      label={title}
      onCancel={() => {
        if (stage.kind !== 'working') onClose(changed);
      }}
    >
      <div className={`sa-dialog${danger ? ' sa-dialog-danger' : ''}`}>
        {stage.kind === 'done' ? (
          <div className="sa-done" role="status" data-testid="sa-done">
            <p className="sa-done-mark" aria-hidden="true">
              ✓
            </p>
            <h2>{stage.done.title}</h2>
            {stage.done.extra}
            {stage.done.lines.length > 0 && (
              <ul className="sa-done-lines">
                {stage.done.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            )}
            {stage.done.backupFile && (
              <p className="sa-backup">
                Backup file: <code>{stage.done.backupFile}</code>
              </p>
            )}
            <div className="sa-dialog-actions">
              <button
                type="button"
                className="btn btn-primary sa-btn"
                onClick={() => {
                  onClose(true);
                }}
              >
                ठीक है
              </button>
            </div>
          </div>
        ) : stage.kind === 'working' ? (
          <div className="sa-working" role="status" aria-live="polite" data-testid="sa-working">
            <span className="sa-spinner" aria-hidden="true" />
            <p>{workingText}</p>
          </div>
        ) : (
          <form onSubmit={(e) => void submit(e)}>
            <h2>{title}</h2>
            <div className="sa-dialog-summary">{summary}</div>
            {word !== undefined && (
              <div className="field">
                <label htmlFor="sa-typed">
                  पक्का करने के लिए <code className="sa-word">{word}</code> टाइप करें
                </label>
                <input
                  id="sa-typed"
                  className="sa-input"
                  autoComplete="off"
                  spellCheck={false}
                  value={typed}
                  onChange={(e) => {
                    setTyped(e.target.value);
                  }}
                />
              </div>
            )}
            {needPassword && (
              <div className="field">
                <ReauthPasswordField id="sa-password" value={password} onChange={setPassword} />
                <p className="sa-hint">इसके बाद 15 मिनट तक password दोबारा नहीं पूछा जाएगा।</p>
              </div>
            )}
            {error && (
              <div className="msg msg-error" role="alert">
                ✗ {error.text}
                {error.lines.length > 0 && (
                  <ul className="sa-problem-list">
                    {error.lines.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="sa-dialog-actions">
              <button
                type="button"
                className="btn btn-secondary sa-btn"
                onClick={() => {
                  onClose(false);
                }}
              >
                रुकें
              </button>
              <button
                type="submit"
                className={`btn sa-btn ${danger ? 'btn-danger' : 'btn-primary'}`}
                disabled={!ready}
              >
                {confirmLabel}
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- file picker (drag & drop + button)

export interface PickedXlsx {
  fileName: string;
  fileBase64: string;
}
export interface PickedJson {
  fileName: string;
  text: string;
}

type DropProps = { label: string; hint: string; sampleHref: string } & (
  | { kind: 'xlsx'; value: PickedXlsx | null; onChange: (file: PickedXlsx | null) => void }
  | { kind: 'json'; value: PickedJson | null; onChange: (file: PickedJson | null) => void }
);

export function DropZone(props: DropProps) {
  const id = useId();
  const input = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const take = async (f: File | undefined) => {
    setProblem(null);
    if (!f) return;
    if (props.kind === 'xlsx') {
      const p = fileProblem(f);
      if (p !== null) {
        setProblem(p);
        return;
      }
      props.onChange({ fileName: f.name, fileBase64: await fileToBase64(f) });
      return;
    }
    if (!f.name.toLowerCase().endsWith('.json')) {
      setProblem('यह JSON (.json) file नहीं है');
      return;
    }
    if (f.size === 0 || f.size > MAX_UPLOAD_BYTES / 5) {
      setProblem('File खाली है या 1 MB से बड़ी है');
      return;
    }
    props.onChange({ fileName: f.name, text: await f.text() });
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    void take(e.dataTransfer.files[0]);
  };

  return (
    <div className="sa-drop-wrap">
      <div className="sa-drop-head">
        <span className="sa-drop-label" id={`${id}-label`}>
          {props.label}
        </span>
        <a className="sa-sample" href={props.sampleHref} download>
          ⬇ Sample file
        </a>
      </div>
      {props.value ? (
        <div className="sa-file-chip">
          <span aria-hidden="true">📄</span>
          <span className="sa-file-name">{props.value.fileName}</span>
          <button
            type="button"
            className="btn btn-link"
            onClick={() => {
              props.onChange(null);
            }}
          >
            बदलें
          </button>
        </div>
      ) : (
        <div
          className={`sa-drop${over ? ' sa-drop-over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => {
            setOver(false);
          }}
          onDrop={onDrop}
        >
          <p>
            File यहाँ खींचकर छोड़ें, या{' '}
            <button
              type="button"
              className="btn btn-secondary sa-btn-small"
              aria-describedby={`${id}-label`}
              onClick={() => input.current?.click()}
            >
              File चुनें
            </button>
          </p>
          <p className="sa-hint">{props.hint}</p>
          <input
            ref={input}
            type="file"
            hidden
            aria-labelledby={`${id}-label`}
            accept={props.kind === 'xlsx' ? '.xlsx' : '.json,application/json'}
            onChange={(e) => {
              void take(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      )}
      {problem && (
        <p className="sa-reason sa-reason-error" role="alert">
          ✗ {problem}
        </p>
      )}
    </div>
  );
}
