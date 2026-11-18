// "स्क्रीन keys" — who may open the three public TV screens. Nov 2026: every screen control lives in
// this panel (it used to be the DM's page), right under the ON / OFF switches, so one officer holds
// the whole of the screens in one place. The DM has no screen page at all any more.
//
// Each screen has its OWN session: the key typed into screen 1 opens screen 1 only, so the key goes
// into all three TVs separately. The panel says so, because an officer who expects one key to open
// all three would think a TV was broken.
import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { api } from '../../api/api';
import { SCREEN_KEY_STATUS_HINDI } from '../../api/superadminTypes';
import type { ScreenKey } from '../../api/superadminTypes';
import { PanelError } from '../../components/ErrorBox';
import { copyText } from '../../components/copyText';
import { formatDateTime } from '../../components/format';
import { useApiData } from '../../components/useApiData';
import { ConfirmDialog } from './parts';

/** The three public screens, named as they are on the TVs and on the ON / OFF switches above. */
export const SCREENS = [
  { no: 1, name: 'स्क्रीन 1 — पंचायत समिति' },
  { no: 2, name: 'स्क्रीन 2 — पंचायत समिति' },
  { no: 3, name: 'स्क्रीन 3 — ज़िला परिषद' },
] as const;

export function screenUrl(no: number): string {
  return `${window.location.origin}/screen/${String(no)}`;
}

/** The text sent out with a key: the three URLs and the key together. */
export function shareText(k: Pick<ScreenKey, 'label' | 'key'>): string {
  return [
    `चूरू पंचायत चुनाव 2026 — परिणाम स्क्रीन (${k.label})`,
    ...SCREENS.map((s) => `${s.name}: ${screenUrl(s.no)}`),
    `Screen key: ${k.key ?? ''}`,
    'हर TV पर यह key अलग से डालनी होती है।',
  ].join('\n');
}

const MASK = '••••-••••-••••';

/** An eye (open = shown, crossed = hidden). Inline SVG: no image request, allowed by the CSP. */
function EyeIcon({ open }: { open: boolean }) {
  return (
    <svg className="sa-key-eye-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
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
      className="btn btn-secondary sa-btn sa-key-btn"
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

/** The screen addresses, with the Super Admin's own key-free preview of one screen. */
function ScreenUrls() {
  const [error, setError] = useState<unknown>(null);
  const preview = async (no: number) => {
    setError(null);
    // Opened at once (still inside the click, so no popup blocker), pointed at the screen once the
    // server has given this browser its preview session FOR THAT SCREEN.
    const tab = window.open('', '_blank');
    try {
      await api('POST', `/api/superadmin/screen-keys/preview/${String(no)}`, {});
      if (tab !== null) {
        tab.opener = null;
        tab.location.assign(screenUrl(no));
      } else window.location.assign(screenUrl(no));
    } catch (err) {
      tab?.close();
      setError(err);
    }
  };
  return (
    <div className="sa-key-urls" data-testid="sa-screen-urls">
      {error !== null && <PanelError error={error} />}
      <ul className="sa-key-url-list">
        {SCREENS.map((s) => (
          <li key={s.no} className="sa-key-url">
            <span className="sa-key-url-name">{s.name}</span>
            <code className="sa-key-url-text">{screenUrl(s.no)}</code>
            <span className="sa-key-actions">
              <CopyButton text={screenUrl(s.no)} label="URL कॉपी करें" />
              <button
                type="button"
                className="btn btn-secondary sa-btn sa-key-btn"
                onClick={() => void preview(s.no)}
              >
                देखें (Preview)
              </button>
            </span>
          </li>
        ))}
      </ul>
      <p className="sa-key-note">
        “देखें” दबाने पर वह एक स्क्रीन इसी browser में बिना key के खुलेगी (केवल आपके लिए, 8 घंटे तक)।
      </p>
    </div>
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
  const active = k.status === 'ACTIVE';
  return (
    <li
      className={`sa-key-card${highlight ? ' sa-key-card-new' : ''}${active ? '' : ' sa-key-card-old'}`}
      data-testid="sa-key-card"
      data-key-id={k.id}
    >
      <div className="sa-key-card-head">
        <strong className="sa-key-label">{k.label}</strong>
        <span className={`sa-key-status sa-key-status-${k.status.toLowerCase()}`} data-testid="sa-key-status">
          {SCREEN_KEY_STATUS_HINDI[k.status]}
        </span>
      </div>
      {k.key !== null && (
        <div className="sa-key-row">
          <code className="sa-key-value" data-testid="sa-key-value" aria-label="Screen key">
            {shown ? k.key : MASK}
          </code>
          <span className="sa-key-actions">
            <button
              type="button"
              className="btn btn-secondary sa-btn sa-key-btn"
              aria-pressed={shown}
              aria-label={shown ? 'key छिपाएँ' : 'key दिखाएँ'}
              onClick={() => {
                setShown((v) => !v);
              }}
            >
              <EyeIcon open={!shown} /> {shown ? 'छिपाएँ' : 'दिखाएँ'}
            </button>
            <CopyButton text={k.key} label="key कॉपी करें" testId="sa-copy-key" />
            <CopyButton text={shareText(k)} label="URL + key कॉपी करें" testId="sa-copy-share" />
          </span>
        </div>
      )}
      <dl className="sa-key-meta">
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
        {active ? (
          <div>
            <dt>अभी चालू स्क्रीन</dt>
            <dd data-testid="sa-active-screens">{k.activeScreens}</dd>
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
      <div className="sa-key-actions sa-key-card-actions">
        <button type="button" className="btn btn-secondary sa-btn sa-key-btn" onClick={onRenew}>
          नई key बनाएँ
        </button>
        {onRevoke !== undefined && (
          <button type="button" className="btn btn-danger sa-btn sa-key-btn" onClick={onRevoke}>
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
      const out = await api<{ key: ScreenKey }>('POST', '/api/superadmin/screen-keys/create', {
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
    <form className="sa-key-form" onSubmit={(e) => void submit(e)} noValidate>
      <div className="sa-key-field">
        <label htmlFor="sa-key-label">key का नाम (कौन-सा TV / कक्ष)</label>
        <input
          id="sa-key-label"
          value={label}
          maxLength={60}
          placeholder="जैसे: मुख्य हॉल TV, प्रेस कक्ष"
          autoComplete="off"
          onChange={(e) => {
            setLabel(e.target.value);
          }}
        />
      </div>
      <fieldset className="sa-key-expiry">
        <legend>कब तक मान्य</legend>
        <label className="sa-key-radio">
          <input
            type="radio"
            name="sa-key-expiry"
            checked={!withExpiry}
            onChange={() => {
              setWithExpiry(false);
            }}
          />
          जब तक रद्द न करें
        </label>
        <label className="sa-key-radio">
          <input
            type="radio"
            name="sa-key-expiry"
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
      {error !== null && <PanelError error={error} />}
      <button type="submit" className="btn btn-primary sa-btn" disabled={busy}>
        {busy ? 'बन रही है…' : 'Key बनाएँ'}
      </button>
    </form>
  );
}

/** The whole "स्क्रीन keys" block of the panel (its own fetch: /overview is unchanged). */
export function ScreenKeys() {
  const { data, error, reload } = useApiData(
    () => api<{ keys: ScreenKey[] }>('GET', '/api/superadmin/screen-keys'),
    [],
  );
  const [confirm, setConfirm] = useState<{ kind: 'revoke' | 'renew'; key: ScreenKey } | null>(null);
  const [fresh, setFresh] = useState<number | null>(null);

  const keys = data?.keys ?? [];
  const active = keys.filter((k) => k.status === 'ACTIVE');
  const old = keys.filter((k) => k.status !== 'ACTIVE');

  return (
    <section className="sa-screens sa-keys" aria-label="स्क्रीन keys" data-testid="sa-keys">
      <div className="sa-screens-head">
        <h3 className="sa-count-group-title sa-screens-title">स्क्रीन keys</h3>
        <p className="sa-screens-note">
          TV स्क्रीन केवल key डालने पर खुलती है। <strong>हर स्क्रीन की अपनी key डालनी होती है</strong> — एक
          key तीनों TV पर चलती है, पर हर TV पर अलग से डाली जाती है। key रद्द करते ही उससे खुली स्क्रीन तुरंत
          बंद हो जाती हैं।
        </p>
      </div>
      {error !== null && error !== undefined && <PanelError error={error} />}
      <ScreenUrls />
      <CreateKeyForm
        onCreated={(k) => {
          setFresh(k.id);
          reload();
        }}
      />
      {data === null ? (
        <p className="sa-key-note">लोड हो रहा है…</p>
      ) : active.length === 0 ? (
        <p className="sa-key-note" data-testid="sa-no-keys">
          अभी कोई सक्रिय key नहीं है — कोई भी स्क्रीन नहीं खुलेगी। ऊपर से key बनाएँ।
        </p>
      ) : (
        <ul className="sa-key-list" data-testid="sa-active-keys">
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
      {old.length > 0 && (
        <details className="sa-key-old">
          <summary>रद्द / समाप्त keys ({old.length})</summary>
          <ul className="sa-key-list" data-testid="sa-old-keys">
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
        </details>
      )}
      {confirm !== null && (
        <ConfirmDialog
          title={
            confirm.kind === 'revoke'
              ? `"${confirm.key.label}" की key रद्द करें?`
              : `"${confirm.key.label}" के लिए नई key बनाएँ?`
          }
          summary={
            confirm.kind === 'revoke' ? (
              <p>इस key से खुली सभी स्क्रीन तुरंत बंद हो जाएँगी और key माँगेंगी। यह वापस नहीं होगा।</p>
            ) : confirm.key.status === 'ACTIVE' ? (
              <p>
                पुरानी key तुरंत रद्द होगी और उससे खुली स्क्रीन बंद हो जाएँगी। नई key हर TV पर दोबारा डालनी
                होगी।
              </p>
            ) : (
              <p>इसी नाम से एक नई key बनेगी।</p>
            )
          }
          confirmLabel={confirm.kind === 'revoke' ? 'हाँ, रद्द करें' : 'हाँ, नई key बनाएँ'}
          danger={confirm.kind === 'revoke'}
          askPassword={false}
          workingText={confirm.kind === 'revoke' ? 'रद्द हो रही है…' : 'नई key बन रही है…'}
          run={async () => {
            const id = String(confirm.key.id);
            if (confirm.kind === 'revoke') {
              await api('POST', `/api/superadmin/screen-keys/${id}/revoke`, {});
              setFresh(null);
              return {
                title: `"${confirm.key.label}" की key रद्द हो गई`,
                lines: ['उससे खुली स्क्रीन बंद हो गईं।'],
              };
            }
            const out = await api<{ key: ScreenKey }>('POST', `/api/superadmin/screen-keys/${id}/renew`, {});
            setFresh(out.key.id);
            return {
              title: `"${confirm.key.label}" के लिए नई key बन गई`,
              lines: ['इसे हर TV पर दोबारा डालें।'],
            };
          }}
          onClose={(changed) => {
            setConfirm(null);
            if (changed) reload();
          }}
        />
      )}
    </section>
  );
}
