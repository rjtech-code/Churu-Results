// The observer shell: its own refined layout (never the operator header), the language toggle,
// search, and the "About this system" panel. OBSERVER only; every other role is sent to its own
// start page, and an observer reaching any other URL is sent back here (RequireRole + homePath).
import { useMemo, useState } from 'react';
import type { ReactNode, SyntheticEvent } from 'react';
import { NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { homePath } from '../../auth/home';
import '../../styles/observer.css';
import { LangContext, storeLang, storedLang, translate, useLang } from './i18n';
import type { DictKey, Lang } from './i18n';

/** A dictionary line whose **…** parts are shown bold. Plain text otherwise; no other markup. */
function withBold(text: string): ReactNode[] {
  return text.split('**').map((part, i) => (i % 2 === 1 ? <strong key={i}>{part}</strong> : part));
}

export function AboutPanel({ onClose }: { onClose: () => void }) {
  // The live language from the context, so the panel follows the toggle even where the browser
  // refuses storage (a private window), which storedLang() cannot see.
  const { t } = useLang();
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

function Shell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [lang, setLangState] = useState<Lang>(storedLang);
  const [about, setAbout] = useState(false);
  const [query, setQuery] = useState('');
  const langState = useMemo(
    () => ({
      lang,
      t: (key: DictKey) => translate(lang, key),
      setLang: (next: Lang) => {
        storeLang(next);
        setLangState(next);
      },
    }),
    [lang],
  );
  const t = langState.t;

  const onSearch = (e: SyntheticEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q !== '') void navigate(`/observer/search?q=${encodeURIComponent(q)}`);
  };

  const nav: readonly [string, DictKey][] = [
    ['/observer', 'overview'],
    ['/observer/ps', 'panchayatSamitis'],
    ['/observer/zp', 'zilaParishad'],
    ['/observer/winners', 'winners'],
    ['/observer/reports', 'reports'],
  ];

  return (
    <LangContext.Provider value={langState}>
      <div className="obs-shell">
        <header className="obs-header no-print">
          <div className="obs-header-inner">
            <NavLink to="/observer" className="obs-brand" end>
              <span className="obs-brand-district">{t('title')}</span>
              <span className="obs-brand-sub">{t('subtitle')}</span>
            </NavLink>
            <form className="obs-search" role="search" onSubmit={onSearch}>
              <input
                type="search"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                }}
                placeholder={t('searchHint')}
                aria-label={t('search')}
              />
            </form>
            <div className="obs-header-tools">
              <button
                type="button"
                className="obs-lang"
                onClick={() => {
                  langState.setLang(lang === 'en' ? 'hi' : 'en');
                }}
              >
                {lang === 'en' ? 'हिंदी' : 'English'}
              </button>
              <span className="obs-user" title={user?.username}>
                {user?.fullName ?? user?.username}
              </span>
              <button
                type="button"
                className="obs-lang obs-logout"
                onClick={() => {
                  void logout();
                }}
              >
                {t('logout')}
              </button>
            </div>
          </div>
          <nav className="obs-nav" aria-label={t('overview')}>
            {nav.map(([to, key]) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/observer'}
                className={({ isActive }) => `obs-navitem${isActive ? ' active' : ''}`}
              >
                {t(key)}
              </NavLink>
            ))}
          </nav>
        </header>
        <main className="obs-main">
          <Outlet />
        </main>
        <footer className="obs-footer no-print">
          <span>
            Churu District · Panchayat General Elections 2026 ·{' '}
            <span className="obs-footer-gold">Code Churu</span>
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
            onClose={() => {
              setAbout(false);
            }}
          />
        )}
      </div>
    </LangContext.Provider>
  );
}

/** OBSERVER-only pages under the observer shell. */
export function RequireObserver() {
  const { user } = useAuth();
  if (user === undefined) return <p className="loading">…</p>;
  if (user === null) return <Navigate to="/login" replace />;
  if (user.role !== 'OBSERVER') return <Navigate to={homePath(user.role)} replace />;
  return <Shell />;
}
