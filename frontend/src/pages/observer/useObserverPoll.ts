// Light polling for the observer dashboard: load once, then refresh every `intervalMs` (default
// 25 s), paused while the tab is hidden and refreshed the moment it becomes visible again. Errors
// keep the last good data and surface a calm retry note; polling itself keeps retrying.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../../api/api';

export const OBSERVER_POLL_MS = 25_000;

export interface PollState<T> {
  data: T | null;
  /** True when the latest refresh failed (the last good data is still shown). */
  stale: boolean;
  /** True only before the first successful load. */
  loading: boolean;
  /** 403/404: the ward or PS does not exist (or the session lost its role). */
  notFound: boolean;
  loadedAt: Date | null;
  reload: () => void;
}

export function useObserverPoll<T>(path: string, intervalMs = OBSERVER_POLL_MS): PollState<T> {
  const [data, setData] = useState<T | null>(null);
  const [stale, setStale] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [tick, setTick] = useState(0);
  const pathRef = useRef(path);

  useEffect(() => {
    if (pathRef.current !== path) {
      pathRef.current = path;
      setData(null);
      setStale(false);
      setNotFound(false);
      setLoadedAt(null);
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      try {
        const fresh = await api<T>('GET', path);
        if (cancelled) return;
        setData(fresh);
        setStale(false);
        setNotFound(false);
        setLoadedAt(new Date());
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
          setNotFound(true);
          return;
        }
        if (err instanceof ApiError && err.status === 401) return; // session handler takes over
        setStale(true);
      } finally {
        if (!cancelled) schedule();
      }
    };

    const schedule = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        if (document.hidden) schedule();
        else void load();
      }, intervalMs);
    };

    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    void load();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [path, intervalMs, tick]);

  const reload = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  return { data, stale, loading: data === null && !notFound, notFound, loadedAt, reload };
}
