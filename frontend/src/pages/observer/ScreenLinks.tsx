// The three public display screens (the TVs in the counting hall), as cards that open in a new
// tab. Read-only links: they add no permission of their own — a screen still asks for the screen
// key the District Election Officer issues, which is why the note below the cards says so.
import { useLang } from './i18n';
import type { DictKey } from './i18n';
import { Panel } from './parts';

const SCREENS: { no: 1 | 2 | 3; what: DictKey }[] = [
  { no: 1, what: 'screen1What' },
  { no: 2, what: 'screen2What' },
  { no: 3, what: 'screen3What' },
];

/** A TV showing a short result list: the mark that gives these cards their identity. */
function DisplayGlyph() {
  return (
    <svg className="obs-screen-glyph" viewBox="0 0 48 48" width="46" height="46" aria-hidden="true">
      <rect
        x="6.5"
        y="9.5"
        width="35"
        height="24"
        rx="3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path d="M19 38.5h10M24 33.5v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <g className="obs-screen-glyph-rows">
        <path d="M11.5 16h18M11.5 21h22M11.5 26h13" strokeWidth="2" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/** Arrow leaving a box: the "opens in a new tab" mark. Inline SVG, so the CSP stays intact. */
function NewTabIcon() {
  return (
    <svg className="obs-screen-ext" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
      <path
        d="M18 13.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M14.5 4H20v5.5M20 4l-7.5 7.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ScreenLinks() {
  const { t } = useLang();
  return (
    <Panel title={t('displayScreens')}>
      <div className="obs-screens">
        {SCREENS.map((s) => (
          <a
            key={s.no}
            className="obs-screen"
            href={`/screen/${String(s.no)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <DisplayGlyph />
            <span className="obs-screen-body">
              <span className="obs-screen-head">
                <span className="obs-screen-title">
                  {t('screen')} {s.no}
                </span>
                <NewTabIcon />
              </span>
              <span className="obs-screen-what">{t(s.what)}</span>
              <span className="visually-hidden">{t('opensNewTab')}</span>
            </span>
          </a>
        ))}
      </div>
      <p className="obs-screens-note">{t('screenKeyNote')}</p>
    </Panel>
  );
}
