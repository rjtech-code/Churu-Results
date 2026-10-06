import { useEffect, useState } from 'react';
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

/** Index of the page on show; moves on every `intervalS` seconds and wraps. */
export function usePager(count: number, intervalS: number): number {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      setIndex((i) => i + 1);
    }, intervalS * 1000);
    return () => {
      clearInterval(t);
    };
  }, [intervalS]);
  return count === 0 ? 0 : index % count;
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
