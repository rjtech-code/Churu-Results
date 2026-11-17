// The three public TV screens, on or off, from the panel. Each screen's state must be readable in
// one glance from a metre away: the word चालू / बंद carries it, with a glyph beside it — never the
// colour alone. Switching is quick and reversible (the hall sees it), so it asks for a short
// confirmation naming the screen, never a typed word or a password.
import { useState } from 'react';
import { api } from '../../api/api';
import type { ScreenPowerRow } from '../../api/superadminTypes';
import { ConfirmDialog } from './parts';

/** The names the officers use, the same as on the DM's "स्क्रीन सुरक्षा" page. */
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

export function ScreenPower({
  screens,
  onChanged,
}: {
  screens: readonly ScreenPowerRow[];
  onChanged: () => void;
}) {
  const [ask, setAsk] = useState<ScreenPowerRow | null>(null);
  return (
    <section className="sa-screens" aria-label="सार्वजनिक स्क्रीन" data-testid="sa-screens">
      <div className="sa-screens-head">
        <h3 className="sa-count-group-title sa-screens-title">सार्वजनिक स्क्रीन</h3>
        <p className="sa-screens-note">
          बंद स्क्रीन पर कोई परिणाम नहीं जाता। चालू करते ही TV अपने आप फिर दिखाने लगता है — key दोबारा नहीं डालनी पड़ती।
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
      {ask !== null && (
        <ConfirmDialog
          title={`${SCREEN_NAMES[ask.screen] ?? ask.screen}: ${ask.on ? 'बंद करें' : 'चालू करें'}`}
          summary={
            ask.on ? (
              <p>
                यह स्क्रीन कुछ ही सेकंड में परिणाम दिखाना बंद कर देगी और उस पर “यह स्क्रीन अस्थायी रूप से बंद है” लिखा दिखेगा।
                बाकी दोनों स्क्रीन चलती रहेंगी।
              </p>
            ) : (
              <p>
                यह स्क्रीन कुछ ही सेकंड में फिर से परिणाम दिखाने लगेगी। TV पर कुछ नहीं करना पड़ेगा, key भी दोबारा नहीं डालनी
                पड़ेगी।
              </p>
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
              lines: [],
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
