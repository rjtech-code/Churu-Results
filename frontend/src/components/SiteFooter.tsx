// THE footer of the whole portal: the observer dashboard and every operator page (login, RO
// pages, DM reports, Super Admin, candidate pages, error pages) render this one component, so
// they can never drift apart. The public TV screens (/screen/:n) have their own chrome and
// never render it.
//
// It is a normal block at the end of the page — never fixed, never sticky — and it is hidden in
// print, so it cannot overlap the entry form or the sticky panels, and never takes a line (or a
// whole extra page) in a printed report.
//
// The wording follows the page's own language: Hindi on the operator pages (the default), and
// the observer's chosen language on the observer dashboard. The strings come from the one
// dictionary in pages/observer/i18n.ts; there is no second copy to fall out of step.
import { useState } from 'react';
import type { ReactNode } from 'react';
import { translate } from '../pages/observer/i18n';
import type { DictKey, Lang } from '../pages/observer/i18n';
import '../styles/footer.css';

/** A dictionary line whose **…** parts are shown bold. Plain text otherwise; no other markup. */
function withBold(text: string): ReactNode[] {
  return text.split('**').map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part));
}

export function AboutPanel({ onClose, lang = 'hi' }: { onClose: () => void; lang?: Lang }) {
  const t = (key: DictKey) => translate(lang, key);
  return (
    <div className="obs-about-backdrop" role="presentation" onClick={onClose}>
      <div
        className="obs-about"
        role="dialog"
        aria-modal="true"
        aria-label={t('about')}
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <h2>{t('about')}</h2>
        <p>{t('aboutText')}</p>
        <p className="obs-about-credit">{withBold(t('aboutCredit'))}</p>
        <button type="button" className="obs-btn" onClick={onClose} autoFocus>
          {t('close')}
        </button>
      </div>
    </div>
  );
}

/** The one footer. `lang` defaults to Hindi, the language of the operator pages. */
export function SiteFooter({ lang = 'hi' }: { lang?: Lang } = {}) {
  const [about, setAbout] = useState(false);
  const t = (key: DictKey) => translate(lang, key);
  return (
    <>
      <footer className="obs-footer no-print">
        <span>
          {t('title')} · {t('footerElection')} · <span className="obs-footer-gold">Code Churu</span>
        </span>
        <button
          type="button"
          className="obs-about-link"
          onClick={() => {
            setAbout(true);
          }}
        >
          {t('about')}
        </button>
      </footer>
      {about && (
        <AboutPanel
          lang={lang}
          onClose={() => {
            setAbout(false);
          }}
        />
      )}
    </>
  );
}
