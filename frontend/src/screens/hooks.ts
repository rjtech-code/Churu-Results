import { useCallback, useEffect, useRef, useState } from 'react';
import { LiveFeed } from './liveFeed';
import type { FeedState } from './liveFeed';
import { fetchPublic } from './publicApi';
import type { ScreenNo } from './types';

const EMPTY: FeedState = {
  bundle: null,
  stale: false,
  unavailable: false,
  failed: false,
  changed: new Set(),
};

/** Live data of one screen (fetch + SSE, see liveFeed.ts). */
export function useLiveFeed(screen: ScreenNo): FeedState {
  const [state, setState] = useState<FeedState>(EMPTY);
  useEffect(() => {
    const feed = new LiveFeed(
      screen,
      {
        fetchJson: fetchPublic,
        openStream: () => new EventSource('/api/public/stream'),
        now: () => Date.now(),
      },
      setState,
    );
    feed.start();
    return () => {
      feed.stop();
    };
  }, [screen]);
  return state;
}

export interface ScreenPager {
  /** Index of the page on show. */
  index: number;
  /** Shows page `i` (wraps around) and gives it a full turn; rotation then goes on as usual. */
  goTo: (i: number) => void;
}

/**
 * The page on show. Each page has its own duration (seconds); data refreshes do NOT restart the
 * countdown of the page on show (only its remaining time is re-planned). A jump (dot, PS name or
 * Left/Right arrow key) restarts the countdown from the chosen page.
 */
export function useScreenPager(durationsS: readonly number[]): ScreenPager {
  const count = durationsS.length;
  const [index, setIndex] = useState(0);
  const [jumps, setJumps] = useState(0); // a jump to the page already on show must restart its countdown too
  const shownSince = useRef(0); // set when the first page is shown (an effect: render stays pure)
  const current = count === 0 ? 0 : index % count;
  const duration = durationsS[current] ?? 15;
  useEffect(() => {
    if (shownSince.current === 0) shownSince.current = Date.now();
    if (count <= 1) return;
    const left = Math.max(0, duration * 1000 - (Date.now() - shownSince.current));
    const t = setTimeout(() => {
      shownSince.current = Date.now();
      setIndex((i) => (i + 1) % count);
    }, left);
    return () => {
      clearTimeout(t);
    };
  }, [count, current, duration, jumps]);

  const goTo = useCallback(
    (i: number) => {
      if (count === 0) return;
      shownSince.current = Date.now();
      setIndex(((i % count) + count) % count);
      setJumps((j) => j + 1);
    },
    [count],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault(); // no sideways scroll of the PS strip
      goTo(current + (e.key === 'ArrowRight' ? 1 : -1));
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [goTo, current]);

  return { index: current, goTo };
}

/** Scales the 1920x1080 stage to the window (one CSS variable; the transform lives in CSS). */
export function useStageScale(): void {
  useEffect(() => {
    const root = document.documentElement;
    const fit = () => {
      const scale = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
      root.style.setProperty('--tv-scale', String(scale)); // CSSOM: allowed by the CSP
    };
    fit();
    window.addEventListener('resize', fit);
    root.classList.add('screen-mode');
    return () => {
      window.removeEventListener('resize', fit);
      root.classList.remove('screen-mode');
      root.style.removeProperty('--tv-scale');
    };
  }, []);
}

/** Hides the mouse cursor after 3 s without movement. */
export function useHideCursor(delayMs = 3000): void {
  useEffect(() => {
    const root = document.documentElement;
    let t: ReturnType<typeof setTimeout> | undefined;
    const wake = () => {
      root.classList.remove('hide-cursor');
      clearTimeout(t);
      t = setTimeout(() => {
        root.classList.add('hide-cursor');
      }, delayMs);
    };
    wake();
    window.addEventListener('mousemove', wake);
    return () => {
      window.removeEventListener('mousemove', wake);
      clearTimeout(t);
      root.classList.remove('hide-cursor');
    };
  }, [delayMs]);
}
