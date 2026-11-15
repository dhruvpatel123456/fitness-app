// Small reusable hooks.

import { useCallback, useEffect, useRef, useState } from 'react';

/** A value that only changes after it has been stable for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/**
 * Saves "set this to X" changes (water total, a day's note) safely:
 *  * one request at a time per key, so they cannot arrive out of order;
 *  * if several changes pile up, only the newest is sent;
 *  * if the laptop cannot be reached, it keeps trying, so nothing typed is lost.
 */
export function useKeyedSaver<T>(save: (key: string, value: T) => Promise<void>) {
  const saveRef = useRef(save);
  saveRef.current = save;
  const queued = useRef(new Map<string, T>());
  const busy = useRef(new Set<string>());
  const timers = useRef(new Map<string, number>());
  const alive = useRef(true);
  const [failing, setFailing] = useState(false);

  const run = useCallback(async (key: string) => {
    if (busy.current.has(key) || !queued.current.has(key)) return;
    const value = queued.current.get(key) as T;
    queued.current.delete(key);
    busy.current.add(key);
    try {
      await saveRef.current(key, value);
      busy.current.delete(key);
      if (alive.current) setFailing(false);
      if (queued.current.has(key)) void run(key);
    } catch {
      busy.current.delete(key);
      // Keep the value (unless a newer one arrived) and try again shortly.
      if (!queued.current.has(key)) queued.current.set(key, value);
      if (alive.current) {
        setFailing(true);
        window.clearTimeout(timers.current.get(key));
        timers.current.set(
          key,
          window.setTimeout(() => void run(key), 3000),
        );
      }
    }
  }, []);

  const push = useCallback(
    (key: string, value: T) => {
      queued.current.set(key, value);
      void run(key);
    },
    [run],
  );

  useEffect(() => {
    alive.current = true;
    const pending = timers.current;
    return () => {
      alive.current = false;
      pending.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  return { push, failing };
}

/** A stable id for "this form" or "this action", made once when it opens. */
export function useStableId(make: () => string): string {
  const ref = useRef<string | null>(null);
  if (ref.current === null) ref.current = make();
  return ref.current;
}
