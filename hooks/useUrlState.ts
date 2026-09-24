
import { useEffect, useCallback } from 'react';

/**
 * Hook keeping the application state in sync with the URL parameters.
 */
export function useUrlState<T extends Record<string, string | null>>(
  initialState: T,
  onUpdate: (newState: T) => void
) {
  // Read the initial state from the URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const newState = { ...initialState };
    
    Object.keys(initialState).forEach((key) => {
      const value = params.get(key);
      if (value !== null) {
        (newState as any)[key] = value;
      }
    });
    
    onUpdate(newState);
  }, []);

  // Update the URL without reloading the page
  const setUrlState = useCallback((updates: Partial<T>) => {
    const params = new URLSearchParams(window.location.search);
    
    Object.entries(updates).forEach(([key, value]) => {
      if (value === null || value === '' || value === 'ALL') {
        params.delete(key);
      } else {
        params.set(key, value as string);
      }
    });

    const newUrl = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
    window.history.replaceState({ ...window.history.state }, '', newUrl);
  }, []);

  return { setUrlState };
}
