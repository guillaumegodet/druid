import { useEffect, useState } from 'react';

/** Persisted preference (localStorage — specific to this browser, no scope beyond
 * the tab/page that uses it). Extracted from components/dashboard/BenchmarkTab.tsx
 * (lot 3 of the multi-instance architecture plan, generic utilities sub-lot) — duplicated
 * verbatim on the docker/druid-demo side, where it already lived in this file. */
export function usePersistedState<T>(storageKey: string, initial: T): [T, (value: T) => void] {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      /* storage unavailable (private browsing…) — preference not persisted, not blocking */
    }
  }, [storageKey, state]);
  return [state, setState];
}
