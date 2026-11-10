import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { Link, useLocation } from 'react-router-dom';

type Ballot = 'PS' | 'ZP';

/** The ballot a page shows when its URL alone does not say it (an entry's edit / void page). */
const PageBallot = createContext<{ set: (b: Ballot | null) => void; value: Ballot | null }>({
  set: () => undefined,
  value: null,
});

export function RoTabsProvider({ children }: { children: ReactNode }) {
  const [value, set] = useState<Ballot | null>(null);
  return <PageBallot.Provider value={{ value, set }}>{children}</PageBallot.Provider>;
}

/** A page whose URL does not name the ballot reports it here while it is shown. */
export function usePageBallot(ballot: Ballot | null): void {
  const { set } = useContext(PageBallot);
  useEffect(() => {
    set(ballot);
    return () => {
      set(null);
    };
  }, [ballot, set]);
}

/** The ballot of an RO URL: the list's selected tab, a ZP ward / ZP postal, a PS ward. */
export function ballotOfPath(pathname: string, search: string): Ballot | null {
  if (pathname === '/wards') return new URLSearchParams(search).get('ballot') === 'ZP' ? 'ZP' : 'PS';
  if (pathname.startsWith('/zp/') || pathname.startsWith('/zp-postal/')) return 'ZP';
  if (pathname.startsWith('/wards/')) return 'PS';
  return null;
}

const TABS: readonly { ballot: Ballot; label: string; to: string }[] = [
  { ballot: 'PS', label: 'पंचायत समिति', to: '/wards' },
  { ballot: 'ZP', label: 'जिला परिषद', to: '/wards?ballot=ZP' },
];

/** Wide screens: the tabs sit IN the header row (no extra height: one-screen forms must still fit). */
const WIDE = '(min-width: 1000px)';

export function useTabsInHeader(): boolean {
  const query = typeof window.matchMedia === 'function' ? window.matchMedia(WIDE) : null;
  const [wide, setWide] = useState(query?.matches ?? false);
  useEffect(() => {
    if (query === null) return;
    const onChange = () => {
      setWide(query.matches);
    };
    query.addEventListener('change', onChange);
    return () => {
      query.removeEventListener('change', onChange);
    };
  }, [query]);
  return wide;
}

/**
 * Publishes the height of a sticky element as --sticky-top on <html> (CSSOM, allowed by the CSP), so
 * the forms' own sticky side panels start below it instead of sliding under it.
 */
export function useStickyTop<T extends HTMLElement>(active: boolean): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!active || el === null) return;
    const root = document.documentElement;
    const publish = () => {
      root.style.setProperty('--sticky-top', `${String(el.offsetHeight)}px`);
    };
    publish();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(publish) : null;
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      root.style.removeProperty('--sticky-top');
    };
  }, [active]);
  return ref;
}

/**
 * The PS_RO's two lists, on every RO page: in the sticky header row on wide screens, else a sticky
 * bar under the header. A click goes straight to that list; leaving a form with unsaved input still
 * asks first (LeaveGuard on that form).
 */
export function RoTabs({ placement }: { placement: 'header' | 'bar' }) {
  const { pathname, search } = useLocation();
  const { value } = useContext(PageBallot);
  const active = ballotOfPath(pathname, search) ?? value;
  const barRef = useStickyTop<HTMLElement>(placement === 'bar');
  return (
    <nav
      ref={placement === 'bar' ? barRef : undefined}
      className={`ro-tabs ro-tabs-${placement} no-print`}
      aria-label="मतपत्र चुनें"
    >
      <div className="ro-tabs-track" role="tablist">
        {TABS.map((t) => (
          <Link
            key={t.ballot}
            to={t.to}
            role="tab"
            aria-selected={active === t.ballot}
            className={`ro-tab${active === t.ballot ? ' ro-tab-active' : ''}`}
          >
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
