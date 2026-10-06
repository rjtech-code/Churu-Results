import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api/api';

/**
 * Loads data for a page. FORBIDDEN / NOT_FOUND (e.g. another PS's ward by direct URL) go to the
 * "not allowed" page; other errors are returned for display. `deps` (ids from the URL) reload it;
 * `loadedAt` is when the data last arrived.
 */
export function useApiData<T>(load: () => Promise<T>, deps: readonly unknown[]) {
  const navigate = useNavigate();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load; // always the latest closure, without making it a reload trigger
  });
  const key = JSON.stringify(deps);
  useEffect(() => {
    let cancelled = false;
    loadRef.current().then(
      (d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
          setLoadedAt(new Date());
        }
      },
      (err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
          void navigate('/not-allowed', { replace: true });
          return;
        }
        if (err instanceof ApiError && err.status === 401) return; // handled by the session handler
        setError(err);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, tick, navigate]);
  const reload = useCallback(() => {
    setTick((t) => t + 1);
  }, []);
  return { data, error, reload, loadedAt };
}
