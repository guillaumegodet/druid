import { useEffect, useCallback, useRef } from 'react';

/**
 * Hook keeping the application state in sync with the URL parameters.
 *
 * Filter tweaks replace the current history entry; navigations (`{ push: true }`)
 * add one, so the browser's back button returns to the previous page instead of
 * leaving the application (it used to land on the /auth/callback of the login).
 * Back/forward re-applies the URL through `onUpdate`.
 */
export function useUrlState<T extends Record<string, string | null>>(
  initialState: T,
  onUpdate: (newState: T) => void
) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  // Read the state from the URL on mount and on every back/forward
  useEffect(() => {
    const apply = () => {
      const params = new URLSearchParams(window.location.search);
      const newState = { ...initialState };

      Object.keys(initialState).forEach((key) => {
        const value = params.get(key);
        if (value !== null) {
          (newState as any)[key] = value;
        }
      });

      onUpdateRef.current(newState);
    };
    apply();
    window.addEventListener('popstate', apply);
    return () => window.removeEventListener('popstate', apply);
  }, []);

  // Update the URL without reloading the page
  const setUrlState = useCallback((updates: Partial<T>, opts: { push?: boolean } = {}) => {
    const params = new URLSearchParams(window.location.search);

    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === '' || value === 'ALL') {
        params.delete(key);
      } else {
        params.set(key, value as string);
      }
    });

    const newUrl = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (opts.push && newUrl !== currentUrl) window.history.pushState({ ...window.history.state }, '', newUrl);
    else window.history.replaceState({ ...window.history.state }, '', newUrl);
  }, []);

  return { setUrlState };
}
