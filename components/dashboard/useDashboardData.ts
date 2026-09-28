import { useEffect, useState } from 'react';
import { DashboardDataset } from './types';
import { fetchDashboardData } from '../../lib/dashboardSource';
import { apiErrorText } from '../../lib/apiErrors';

interface State {
  data: DashboardDataset | null;
  loading: boolean;
  error: string | null;
}

// Bounded to avoid unlimited growth in a session that visits many structures
// (each may carry tens of thousands of publications) — review lot 8. Map preserves
// insertion order: the oldest key is the first one of the Map, hence the next evicted.
const CACHE_MAX_ENTRIES = 8;
const cache = new Map<string, DashboardDataset>();
const cacheSet = (slug: string, data: DashboardDataset): void => {
  cache.delete(slug); // re-inserts at the end of the order if already present (simple LRU)
  cache.set(slug, data);
  if (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
};

/**
 * Dataset of a structure through the same cache as useDashboardData (null when the
 * structure has no data). For callers needing several structures at once (reports).
 */
export async function loadDashboardDataset(slug: string, isPublic = false): Promise<DashboardDataset | null> {
  const cached = cache.get(slug);
  if (cached) {
    cacheSet(slug, cached);
    return cached;
  }
  const json = await fetchDashboardData<DashboardDataset>(slug, isPublic);
  if (json) cacheSet(slug, json);
  return json;
}

/**
 * Loads the publication dataset of a structure (with in-memory cache per slug).
 * `isPublic` switches to the unauthenticated endpoint (/embed page).
 */
export function useDashboardData(
  slug: string | null,
  { isPublic = false }: { isPublic?: boolean } = {},
): State {
  const [state, setState] = useState<State>({ data: null, loading: !!slug, error: null });

  useEffect(() => {
    if (!slug) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    const cached = cache.get(slug);
    if (cached) {
      cacheSet(slug, cached); // refreshes the LRU position
      setState({ data: cached, loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState({ data: null, loading: true, error: null });
    // druid-biblio API first, then the static asset embedded in the build (Cloudflare instances).
    fetchDashboardData<DashboardDataset>(slug, isPublic)
      .then((json) => {
        if (cancelled) return;
        if (!json) {
          setState({ data: null, loading: false, error: 'no-data' });
          return;
        }
        cacheSet(slug, json);
        setState({ data: json, loading: false, error: null });
      })
      .catch((err: Error) => {
        if (!cancelled) setState({ data: null, loading: false, error: apiErrorText(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [slug, isPublic]);

  return state;
}
