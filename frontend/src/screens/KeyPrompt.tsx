import { useEffect, useRef, useState } from 'react';
import type { SubmitEvent } from 'react';
import { unlockScreen } from './publicApi';
import type { ScreenNo } from './types';

/** Typed text -> "XXXX-XXXX-XXXX" as you type (letters upper case, hyphens added). */
export function formatKeyInput(text: string): string {
  const raw = text
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
  return (raw.match(/.{1,4}/g) ?? []).join('-');
}

/**
 * The screen key popup: shown before any result, and again as soon as the server refuses this screen
 * (key revoked or expired). Big text for a TV across the room; works on a phone (no 1920x1080 stage
 * here). The key goes to the server only; it is never stored in the browser (the server sets an
 * HttpOnly cookie instead).
 */
export function KeyPrompt({ screen, onUnlocked }: { screen: ScreenNo; onUnlocked: () => void }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    input.current?.focus();
  }, [error]);

  const submit = async (e: SubmitEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    if (key.replace(/-/g, '').length !== 12) {
      setError('गलत key');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await unlockScreen(key, screen);
    setBusy(false);
    if (result.kind === 'ok') {
      onUnlocked();
      return;
    }
    if (result.kind === 'wrong') setError('गलत key');
    else if (result.kind === 'locked')
      setError(
        `बहुत ज़्यादा गलत कोशिशें। ${String(Math.max(1, Math.ceil(result.retryAfterSeconds / 60)))} मिनट बाद फिर कोशिश करें।`,
      );
    else setError('सर्वर से संपर्क नहीं हो पा रहा — थोड़ी देर बाद फिर कोशिश करें।');
  };

  return (
    <div className="screen-lock">
      <form
        className="screen-lock-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="screen-lock-title"
        onSubmit={(e) => void submit(e)}
      >
        <h1 id="screen-lock-title">स्क्रीन key डालें</h1>
        <p className="screen-lock-hint">
          यह परिणाम स्क्रीन केवल ज़िला निर्वाचन अधिकारी (DEO) की अनुमति से खुलती है। DEO कार्यालय से मिली key
          लिखें।
        </p>
        <label className="screen-lock-label" htmlFor="screen-key">
          स्क्रीन key
        </label>
        <input
          id="screen-key"
          ref={input}
          className="screen-lock-input"
          value={key}
          onChange={(e) => {
            setKey(formatKeyInput(e.target.value));
          }}
          placeholder="XXXX-XXXX-XXXX"
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          maxLength={14}
          aria-invalid={error !== null}
          aria-describedby={error === null ? undefined : 'screen-key-error'}
        />
        {error !== null && (
          <p id="screen-key-error" className="screen-lock-error" role="alert">
            ✗ {error}
          </p>
        )}
        <button type="submit" className="screen-lock-button" disabled={busy}>
          {busy ? 'जाँच हो रही है…' : 'स्क्रीन खोलें'}
        </button>
        <p className="screen-lock-small">स्क्रीन {String(screen)}</p>
      </form>
    </div>
  );
}
