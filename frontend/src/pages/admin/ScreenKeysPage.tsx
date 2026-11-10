import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { SCREEN_KEY_STATUS_HINDI } from '../../api/adminTypes';
import type { ScreenKey } from '../../api/adminTypes';
import { api } from '../../api/api';
import { PageIntro, Section } from '../../components/AdminParts';
import { ErrorBox, SuccessBox } from '../../components/ErrorBox';
import { Modal } from '../../components/Modal';
import { copyText } from '../../components/copyText';
import { formatDateTime } from '../../components/format';
import { useApiData } from '../../components/useApiData';
import '../../styles/admin.css';

/** The three public screens (their names as on the TVs). */
export const SCREENS = [
  { no: 1, name: 'स्क्रीन 1 — पंचायत समिति' },
  { no: 2, name: 'स्क्रीन 2 — पंचायत समिति' },
  { no: 3, name: 'स्क्रीन 3 — ज़िला परिषद' },
] as const;

export function screenUrl(no: number): string {
  return `${window.location.origin}/screen/${String(no)}`;
}

/** The text the DEO sends with a key: the three URLs and the key together. */
export function shareText(k: Pick<ScreenKey, 'label' | 'key'>): string {
  return [
    `चूरू पंचायत चुनाव 2026 — परिणाम स्क्रीन (${k.label})`,
    ...SCREENS.map((s) => `${s.name}: ${screenUrl(s.no)}`),
    `Screen key: ${k.key ?? ''}`,
  ].join('\n');
}

const MASK = '••••-••••-••••';

/** An eye (open = shown, crossed = hidden). Inline SVG: no image request, allowed by the CSP. */
function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg className="sk-eye-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
      {!open && <line x1="3" y1="21" x2="21" y2="3" stroke="currentColor" strokeWidth="2" />}
    </svg>
  );
}

/** A button that copies `text` and says "कॉपी हो गया" for a moment. */
function CopyButton({ text, label, testId }: { text: string; label: string; testId?: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  return (
    <button
      type="button"
      className="btn btn-secondary"
      data-testid={testId}
      onClick={() => {
        void copyText(text).then((ok) => {
          setState(ok ? 'done' : 'failed');
          setTimeout(() => {
            setState('idle');
          }, 2500);
        });
      }}
    >
      {state === 'done' ? 'कॉपी हो गया ✓' : state === 'failed' ? 'कॉपी नहीं हुआ' : label}
    </button>
  );
}

interface Confirm {
  kind: 'revoke' | 'renew';
  key: ScreenKey;
}

/** DM: "स्क्रीन सुरक्षा (Screen Keys)" — who may open the three public TV screens. */
export function ScreenKeysPage() {
  const { data, error, reload } = useApiData(
    () => api<{ keys: ScreenKey[] }>('GET', '/api/admin/screen-keys'),
    [],
  );
  const [done, setDone] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [fresh, setFresh] = useState<number | null>(null);

  const keys = data?.keys ?? [];
  const active = keys.filter((k) => k.status === 'ACTIVE');
  const old = keys.filter((k) => k.status !== 'ACTIVE');

  const preview = async (no: number) => {
    setActionError(null);
    // Opened at once (still inside the click, so no popup blocker), pointed at the screen once the
    // server has given this browser its preview session.
    const tab = window.open('', '_blank');
    try {
      await api('POST', '/api/admin/screen-keys/preview', {});
      if (tab !== null) {
        tab.opener = null;
        tab.location.assign(screenUrl(no));
      } else window.location.assign(screenUrl(no));
    } catch (err) {
      tab?.close();
      setActionError(err);
    }
  };

  return (
    <>
      <PageIntro
        title="स्क्रीन सुरक्षा (Screen Keys)"
        hint="परिणाम की TV स्क्रीन केवल key डालने पर खुलती हैं। हर TV या कक्ष के लिए अलग key बनाएँ और URL के साथ भेजें। key रद्द करते ही उससे खुली स्क्रीन तुरंत बंद हो जाती है।"
      />
      <ErrorBox error={error ?? actionError} />
      <SuccessBox text={done} />

      <Section title="स्क्रीन के पते (URL)">
        <ul className="sk-urls" data-testid="screen-urls">
          {SCREENS.map((s) => (
            <li key={s.no} className="sk-url">
              <span className="sk-url-name">{s.name}</span>
              <code className="sk-url-text">{screenUrl(s.no)}</code>
              <span className="sk-actions">
                <CopyButton text={screenUrl(s.no)} label="URL कॉपी करें" />
                <button type="button" className="btn btn-secondary" onClick={() => void preview(s.no)}>
                  देखें (Preview)
                </button>
              </span>
            </li>
          ))}
        </ul>
        <p className="page-hint">
          "देखें" दबाने पर यह स्क्रीन इसी browser में बिना key के खुलेगी (केवल आपके लिए, 8 घंटे तक)।
        </p>
      </Section>

      <Section title="नई key बनाएँ">
        <CreateKeyForm
          onCreated={(k) => {
            setDone(`नई key बन गई: ${k.label}`);
            setFresh(k.id);
            reload();
          }}
        />
      </Section>

      <Section title={`सक्रिय keys (${String(active.length)})`}>
        {data === null ? (
          <p className="loading">लोड हो रहा है…</p>
        ) : active.length === 0 ? (
          <p className="page-hint" data-testid="no-keys">
            अभी कोई सक्रिय key नहीं है — कोई भी स्क्रीन नहीं खुलेगी। ऊपर से key बनाएँ।
          </p>
        ) : (
          <ul className="sk-list" data-testid="active-keys">
            {active.map((k) => (
              <KeyCard
                key={k.id}
                k={k}
                highlight={k.id === fresh}
                onRevoke={() => {
                  setConfirm({ kind: 'revoke', key: k });
                }}
                onRenew={() => {
                  setConfirm({ kind: 'renew', key: k });
                }}
              />
            ))}
          </ul>
        )}
      </Section>

      {old.length > 0 && (
        <Section title={`रद्द / समाप्त keys (${String(old.length)})`}>
          <ul className="sk-list sk-list-old" data-testid="old-keys">
            {old.map((k) => (
              <KeyCard
                key={k.id}
                k={k}
                highlight={false}
                onRenew={() => {
                  setConfirm({ kind: 'renew', key: k });
                }}
              />
            ))}
          </ul>
        </Section>
      )}

      {confirm !== null && (
        <ConfirmDialog
          confirm={confirm}
          onCancel={() => {
            setConfirm(null);
          }}
          onDone={(message, newId) => {
            setConfirm(null);
            setActionError(null);
            setDone(message);
            setFresh(newId);
            reload();
          }}
        />
      )}
    </>
  );
}

function KeyCard({
  k,
  highlight,
  onRevoke,
  onRenew,
}: {
  k: ScreenKey;
  highlight: boolean;
  onRevoke?: () => void;
  onRenew: () => void;
}) {
  const [shown, setShown] = useState(highlight);
  return (
    <li
      className={`sk-card${highlight ? ' sk-card-new' : ''}${k.status === 'ACTIVE' ? '' : ' sk-card-old'}`}
      data-testid="key-card"
      data-key-id={k.id}
    >
      <div className="sk-card-head">
        <strong className="sk-label">{k.label}</strong>
        <span className={`badge sk-status sk-status-${k.status.toLowerCase()}`} data-testid="key-status">
          {SCREEN_KEY_STATUS_HINDI[k.status]}
        </span>
      </div>
      {k.key !== null && (
        <div className="sk-key-row">
          <code className="sk-key" data-testid="key-value" aria-label="Screen key">
            {shown ? k.key : MASK}
          </code>
          <span className="sk-actions">
            <button
              type="button"
              className="btn btn-secondary sk-eye"
              aria-pressed={shown}
              aria-label={shown ? 'key छिपाएँ' : 'key दिखाएँ'}
              title={shown ? 'key छिपाएँ' : 'key दिखाएँ'}
              onClick={() => {
                setShown((v) => !v);
              }}
            >
              <EyeIcon open={!shown} /> {shown ? 'छिपाएँ' : 'दिखाएँ'}
            </button>
            <CopyButton text={k.key} label="key कॉपी करें" testId="copy-key" />
            <CopyButton text={shareText(k)} label="URL + key कॉपी करें" testId="copy-share" />
          </span>
        </div>
      )}
      <dl className="sk-meta">
        <div>
          <dt>बनाई</dt>
          <dd>
            {formatDateTime(k.createdAt)} · {k.createdByName}
          </dd>
        </div>
        <div>
          <dt>अंतिम उपयोग</dt>
          <dd>{formatDateTime(k.lastUsedAt)}</dd>
        </div>
        <div>
          <dt>मान्य</dt>
          <dd>{k.expiresAt === null ? 'जब तक रद्द न करें' : `${formatDateTime(k.expiresAt)} तक`}</dd>
        </div>
        {k.status === 'ACTIVE' ? (
          <div>
            <dt>अभी चालू स्क्रीन</dt>
            <dd data-testid="active-screens">{k.activeScreens}</dd>
          </div>
        ) : (
          k.revokedAt !== null && (
            <div>
              <dt>रद्द</dt>
              <dd>{formatDateTime(k.revokedAt)}</dd>
            </div>
          )
        )}
      </dl>
      <div className="sk-actions sk-card-actions">
        <button type="button" className="btn btn-secondary" onClick={onRenew}>
          नई key बनाएँ
        </button>
        {onRevoke !== undefined && (
          <button type="button" className="btn btn-danger" onClick={onRevoke}>
            रद्द करें
          </button>
        )}
      </div>
    </li>
  );
}

function CreateKeyForm({ onCreated }: { onCreated: (k: ScreenKey) => void }) {
  const [label, setLabel] = useState('');
  const [withExpiry, setWithExpiry] = useState(false);
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const submit = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    if (label.trim() === '') {
      setError('key का नाम लिखें (जैसे: मुख्य हॉल TV)');
      return;
    }
    if (withExpiry && expiresAt === '') {
      setError('समाप्ति की तारीख और समय चुनें');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const out = await api<{ key: ScreenKey }>('POST', '/api/admin/screen-keys/create', {
        label: label.trim(),
        expiresAt: withExpiry ? expiresAt : null,
      });
      setLabel('');
      setWithExpiry(false);
      setExpiresAt('');
      onCreated(out.key);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="sk-form" onSubmit={(e) => void submit(e)} noValidate>
      <div className="field">
        <label htmlFor="sk-label">key का नाम (कौन-सा TV / कक्ष)</label>
        <input
          id="sk-label"
          value={label}
          maxLength={60}
          placeholder="जैसे: मुख्य हॉल TV, प्रेस कक्ष"
          autoComplete="off"
          onChange={(e) => {
            setLabel(e.target.value);
          }}
        />
      </div>
      <fieldset className="sk-expiry">
        <legend>कब तक मान्य</legend>
        <label className="sk-radio">
          <input
            type="radio"
            name="sk-expiry"
            checked={!withExpiry}
            onChange={() => {
              setWithExpiry(false);
            }}
          />
          जब तक रद्द न करें
        </label>
        <label className="sk-radio">
          <input
            type="radio"
            name="sk-expiry"
            checked={withExpiry}
            onChange={() => {
              setWithExpiry(true);
            }}
          />
          इस समय तक:
        </label>
        {withExpiry && (
          <input
            type="datetime-local"
            aria-label="समाप्ति की तारीख और समय"
            value={expiresAt}
            onChange={(e) => {
              setExpiresAt(e.target.value);
            }}
          />
        )}
      </fieldset>
      <ErrorBox error={error} />
      <button type="submit" className="btn btn-primary btn-big" disabled={busy}>
        {busy ? 'बन रही है…' : 'Key बनाएँ'}
      </button>
    </form>
  );
}

function ConfirmDialog({
  confirm,
  onCancel,
  onDone,
}: {
  confirm: Confirm;
  onCancel: () => void;
  onDone: (message: string, newId: number | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const { kind, key } = confirm;
  const revoke = kind === 'revoke';
  const title = revoke ? `"${key.label}" की key रद्द करें?` : `"${key.label}" के लिए नई key बनाएँ?`;

  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      if (revoke) {
        await api('POST', `/api/admin/screen-keys/${String(key.id)}/revoke`, {});
        onDone(`"${key.label}" की key रद्द हो गई। उससे खुली स्क्रीन बंद हो गईं।`, null);
      } else {
        const out = await api<{ key: ScreenKey }>(
          'POST',
          `/api/admin/screen-keys/${String(key.id)}/renew`,
          {},
        );
        onDone(`"${key.label}" के लिए नई key बन गई। इसे हर TV पर दोबारा डालें।`, out.key.id);
      }
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Modal label={title} onCancel={onCancel}>
      <h2>{title}</h2>
      <p className="big-explain">
        {revoke
          ? 'इस key से खुली सभी स्क्रीन तुरंत बंद हो जाएँगी और key माँगेंगी। यह वापस नहीं होगा।'
          : key.status === 'ACTIVE'
            ? 'पुरानी key तुरंत रद्द होगी और उससे खुली स्क्रीन बंद हो जाएँगी। नई key हर TV पर दोबारा डालनी होगी।'
            : 'इसी नाम से एक नई key बनेगी।'}
      </p>
      <ErrorBox error={error} />
      <div className="actions">
        <button type="button" className="btn btn-secondary btn-big" onClick={onCancel} disabled={busy}>
          नहीं, वापस जाएँ
        </button>
        <button
          type="button"
          className={`btn btn-big ${revoke ? 'btn-danger' : 'btn-primary'}`}
          onClick={() => void go()}
          disabled={busy}
        >
          {revoke ? 'हाँ, रद्द करें' : 'हाँ, नई key बनाएँ'}
        </button>
      </div>
    </Modal>
  );
}
