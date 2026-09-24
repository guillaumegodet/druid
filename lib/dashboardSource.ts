// Dashboard data source — API first, static fallback.
//
// On Nantes (Docker + druid-biblio), server.cjs exposes /api/dashboard-structures and
// /api/dashboard/:slug/publications. On the Cloudflare Pages instances (Centrale) there is
// no druid-biblio backend: those routes do not exist (the SPA fallback answers 200 +
// index.html) and we read the static exports copied into public/dashboard-data/ at build
// time by scripts/prepare-cloudflare-assets.cjs (from the instance's dashboard-data/: private
// druid-instances repository for Centrale, instances/demo/ for the demo).
//
// The fallback is transparent: when the API answers valid JSON it wins, otherwise the
// static asset is read. The same build serves both targets.

const STATIC_BASE = `${import.meta.env.BASE_URL}dashboard-data`;

/** Decompresses a gzip stream (`.json.gz` asset) and parses it as JSON. */
async function fetchStaticGz<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok || !res.body) return null;
    const decompressed = res.body.pipeThrough(new DecompressionStream('gzip'));
    return JSON.parse(await new Response(decompressed).text()) as T;
  } catch {
    /* absent, SPA HTML (unknown route) or DecompressionStream unavailable → next candidate */
    return null;
  }
}

/**
 * Reads a static asset as JSON (null when absent or not JSON). For a `.json` URL, tries the
 * `.json.gz` twin first (5 to 6 times lighter — the uncompressed ec-nantes export exceeds the
 * 25 MiB per-file limit of Cloudflare Pages); the plain `.json` remains a fallback for assets
 * without a gz twin (index.json, mentions.json).
 */
async function fetchStatic<T>(url: string): Promise<T | null> {
  if (url.endsWith('.json')) {
    const gz = await fetchStaticGz<T>(`${url}.gz`);
    if (gz) return gz;
  }
  try {
    const res = await fetch(url, { cache: 'no-store' });
    // A static host answers 200 + index.html for an unknown route: JSON.parse then throws
    // and we land in the catch → null.
    if (res.ok) return (await res.json()) as T;
  } catch {
    /* absent, or SPA HTML (unknown route) → next candidate */
  }
  return null;
}

/**
 * Fetches JSON from the API first, then from the embedded static assets (in order: the
 * first one found wins). Returns `api: true` when the data came from the API, which lets
 * callers hide write features (validation queues…) on a static deployment.
 */
export async function fetchJsonWithFallback<T>(
  apiUrl: string,
  staticUrls: string[],
): Promise<{ data: T; api: boolean } | null> {
  try {
    const res = await fetch(apiUrl);
    if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
      return { data: (await res.json()) as T, api: true };
    }
  } catch {
    /* API unreachable → static fallback */
  }
  for (const url of staticUrls) {
    const data = await fetchStatic<T>(url);
    if (data) return { data, api: false };
  }
  return null;
}

async function fetchWithFallback<T>(apiUrl: string, staticUrls: string[]): Promise<T | null> {
  return (await fetchJsonWithFallback<T>(apiUrl, staticUrls))?.data ?? null;
}

/** Structures with a dashboard (+ groups, + tabs hidden per structure). */
export async function fetchDashboardStructures(): Promise<{
  slugs: string[];
  groups: string[];
  tabsHidden: Record<string, string[]>;
}> {
  const data = await fetchWithFallback<{
    slugs?: string[];
    groups?: string[];
    tabsHidden?: Record<string, string[]>;
  }>('/api/dashboard-structures', [`${STATIC_BASE}/index.json`]);
  return {
    slugs: data?.slugs ?? [],
    groups: data?.groups ?? [],
    tabsHidden: data?.tabsHidden ?? {},
  };
}

/** Publication dataset of a structure (null when no data). */
export async function fetchDashboardData<T>(slug: string, isPublic = false): Promise<T | null> {
  const api = isPublic ? '/api/public/dashboard' : '/api/dashboard';
  const dir = `${STATIC_BASE}/${encodeURIComponent(slug)}`;
  // Public view (/embed page): prefer the variant without named staff
  // (dashboard.public.json), falling back to the full file for structures without a
  // dedicated public variant.
  const staticUrls = isPublic
    ? [`${dir}/dashboard.public.json`, `${dir}/dashboard.json`]
    : [`${dir}/dashboard.json`];
  return fetchWithFallback<T>(`${api}/${encodeURIComponent(slug)}/publications`, staticUrls);
}

/** Static « Veille » feed of a structure (dashboard-data/<slug>/news.json): fallback of
 * /api/news/:slug on an instance without live monitoring (demo). Null when absent. */
export const fetchStaticNews = <T>(slug: string): Promise<T | null> =>
  fetchStatic<T>(`${STATIC_BASE}/${encodeURIComponent(slug)}/news.json`);

/** Static media mentions export (Cloudflare instances), filtered client-side by the caller. */
export const STATIC_MENTIONS_URL = `${STATIC_BASE}/mentions.json`;
