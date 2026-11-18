// The three public TV screens, on or off, from the panel. Each screen's state must be readable in
// one glance from a metre away: the word चालू / बंद carries it, with a glyph beside it — never the
// colour alone. Switching is quick and reversible (the hall sees it), so it asks for a short
// confirmation naming the screen, never a typed word or a password.
import { useState } from 'react';
import { api } from '../../api/api';
import type { ScreenLockout, ScreenPowerRow } from '../../api/superadminTypes';
import { ConfirmDialog } from './parts';

/** The names the officers use, the same as on the keys below and on the TVs. */
const SCREEN_NAMES: Readonly<Record<string, string>> = {
  '1': 'स्क्रीन 1 — पंचायत समिति',
  '2': 'स्क्रीन 2 — पंचायत समिति',
  '3': 'स्क्रीन 3 — ज़िला परिषद',
};

/** "आज 14:05" / "16.11.2026, 14:05" — short, for the small line under the state. */
function when(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const time = at.toLocaleTimeString('hi-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const today = new Date();
  const sameDay =
    at.getDate() === today.getDate() &&
    at.getMonth() === today.getMonth() &&
    at.getFullYear() === today.getFullYear();
  if (sameDay) return `आज ${time}`;
  return `${at.toLocaleDateString('hi-IN', { day: '2-digit', month: '2-digit', year: 'numeric' })}, ${time}`;
}

/** The name of a locked-out counter ("none" = the popup was used without saying which screen). */
const lockoutName = (screen: string): string =>
  SCREEN_NAMES[screen] ?? 'स्क्रीन (कौन-सी, यह TV ने नहीं बताया)';

/**
 * The key-popup lockout: after repeated wrong keys that screen cannot be unlocked for a while. It
 * is shown ONLY while one is in effect — with the screen and the time it ends — and the button to
 * clear it appears with it. When nothing is locked out the panel says so, and offers nothing.
 */
function Lockouts({ lockouts, onChanged }: { lockouts: readonly ScreenLockout[]; onChanged: () => void }) {
  const [ask, setAsk] = useState(false);
  if (lockouts.length === 0) {
    return (
      <p className="sa-lockout-none" data-testid="sa-lockout-none">
        ✔ किसी स्क्रीन पर key लॉक नहीं है।
      </p>
    );
  }
  return (
    <div className="sa-lockout" data-testid="sa-lockout">
      <div className="sa-lockout-text">
        <p className="sa-lockout-title">
          <span aria-hidden="true">⚠</span> गलत key बार-बार डालने से लॉक:
        </p>
        <ul className="sa-lockout-list">
          {lockouts.map((l) => (
            <li key={l.screen}>
              {lockoutName(l.screen)} — {when(l.until)} तक
            </li>
          ))}
        </ul>
        <p className="sa-lockout-note">
          इतनी देर उस स्क्रीन पर सही key भी नहीं चलेगी। नीचे का बटन सिर्फ़ यह लॉक हटाता है — key वही रहती है,
          और चल रही स्क्रीनों पर कोई असर नहीं पड़ता।
        </p>
      </div>
      <button
        type="button"
        className="btn btn-primary sa-btn"
        onClick={() => {
          setAsk(true);
        }}
      >
        key लॉक हटाएँ
      </button>
      {ask && (
        <ConfirmDialog
          title="key लॉक हटाएँ"
          summary={
            <p>
              गलत key की गिनती मिट जाएगी, जिससे स्क्रीन पर तुरंत सही key डाली जा सकेगी। key नहीं बदलेगी, रद्द
              नहीं होगी, और किसी चलती स्क्रीन पर कुछ नहीं बदलेगा।
            </p>
          }
          confirmLabel="लॉक हटाएँ"
          askPassword={false}
          workingText="लॉक हटाया जा रहा है…"
          run={async () => {
            await api('POST', '/api/superadmin/screens/clear-lockout', {});
            return { title: 'key लॉक हटा दिया गया', lines: ['अब स्क्रीन पर सही key डाली जा सकती है।'] };
          }}
          onClose={(changed) => {
            setAsk(false);
            if (changed) onChanged();
          }}
        />
      )}
    </div>
  );
}

export function ScreenPower({
  screens,
  lockouts,
  onChanged,
}: {
  screens: readonly ScreenPowerRow[];
  lockouts: readonly ScreenLockout[];
  onChanged: () => void;
}) {
  const [ask, setAsk] = useState<ScreenPowerRow | null>(null);
  return (
    <section className="sa-screens" aria-label="सार्वजनिक स्क्रीन" data-testid="sa-screens">
      <div className="sa-screens-head">
        <h3 className="sa-count-group-title sa-screens-title">सार्वजनिक स्क्रीन</h3>
        <p className="sa-screens-note">
          बंद स्क्रीन पर कोई परिणाम नहीं जाता।{' '}
          <strong>बंद करके फिर चालू करने पर उस TV पर key दोबारा डालनी होती है</strong> — key का box अपने आप आ
          जाता है, TV पर कुछ नहीं करना पड़ता। (सिर्फ़ page reload या app restart से key नहीं माँगी जाती।)
        </p>
      </div>
      <ul className="sa-screen-list">
        {screens.map((s) => (
          <li
            key={s.screen}
            className={`sa-screen ${s.on ? 'sa-screen-on' : 'sa-screen-off'}`}
            data-testid={`sa-screen-${s.screen}`}
          >
            <div className="sa-screen-text">
              <p className="sa-screen-name">{SCREEN_NAMES[s.screen] ?? s.screen}</p>
              <p className="sa-screen-state" data-testid={`sa-screen-state-${s.screen}`}>
                <span aria-hidden="true">{s.on ? '●' : '○'}</span> {s.on ? 'चालू' : 'बंद'}
              </p>
              <p className="sa-screen-last">
                {s.lastChange === null
                  ? 'अब तक कोई बदलाव नहीं'
                  : `अंतिम बदलाव: ${s.lastChange.byName} · ${when(s.lastChange.at)}`}
              </p>
            </div>
            <button
              type="button"
              className={`btn sa-btn ${s.on ? 'btn-secondary' : 'btn-primary'}`}
              onClick={() => {
                setAsk(s);
              }}
            >
              {s.on ? 'बंद करें' : 'चालू करें'}
            </button>
          </li>
        ))}
      </ul>
      <Lockouts lockouts={lockouts} onChanged={onChanged} />
      {ask !== null && (
        <ConfirmDialog
          title={`${SCREEN_NAMES[ask.screen] ?? ask.screen}: ${ask.on ? 'बंद करें' : 'चालू करें'}`}
          summary={
            ask.on ? (
              <>
                <p>
                  यह स्क्रीन कुछ ही सेकंड में परिणाम दिखाना बंद कर देगी और उस पर “यह स्क्रीन अस्थायी रूप से
                  बंद है” लिखा दिखेगा। बाकी दोनों स्क्रीन चलती रहेंगी।
                </p>
                <p>फिर चालू करने पर इस TV पर key दोबारा डालनी होगी।</p>
              </>
            ) : (
              <>
                <p>
                  यह स्क्रीन कुछ ही सेकंड में <strong>key माँगेगी</strong> — box अपने आप आ जाएगा, TV पर कुछ
                  नहीं करना पड़ेगा। key डालते ही परिणाम दिखने लगेंगे।
                </p>
                <p>key नीचे “स्क्रीन keys” में है। बाकी दोनों स्क्रीन पर कोई असर नहीं पड़ेगा।</p>
              </>
            )
          }
          confirmLabel={ask.on ? 'बंद करें' : 'चालू करें'}
          askPassword={false}
          workingText="बदलाव सहेजा जा रहा है…"
          run={async () => {
            await api('POST', `/api/superadmin/screens/${ask.screen}`, { on: !ask.on });
            return {
              title: ask.on
                ? `${SCREEN_NAMES[ask.screen] ?? ask.screen} बंद कर दी गई`
                : `${SCREEN_NAMES[ask.screen] ?? ask.screen} चालू कर दी गई`,
              lines: ask.on ? [] : ['उस TV पर key का box आ गया होगा — key डाल दें।'],
            };
          }}
          onClose={(changed) => {
            setAsk(null);
            if (changed) onChanged();
          }}
        />
      )}
    </section>
  );
}
