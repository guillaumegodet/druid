/**
 * @file readOnly.ts
 * @description Client-side guard of a read-only instance (capability READ_ONLY, public demo on
 * Cloudflare — docs/plan-instance-demo-cloudflare.md, lot A2).
 *
 * The real enforcement is server-side (the domain API of functions/api/v1 answers 403 to every write);
 * this guard only makes the refusal immediate and uniform: every write request of the app —
 * GristService, AxesTab, NewsletterPanel, tasks… — rejects before reaching the network with the
 * same message as the API, which `translateApiError` already knows. The main edit entry points
 * are also hidden (`canWrite()` in lib/auth.ts); this covers the ones that remain.
 */

/** Same text as the API refusal (functions/api/v1/[[path]].js), declared in lib/apiErrors.ts. */
export const READ_ONLY_ERROR = 'Read-only instance: writes are disabled';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** POST routes that only read (LLM or computation relays): allowed on a read-only instance. */
const READ_POST_PREFIXES = [
  '/api/collab-theme/',
  '/api/benchmark/topic-distribution',
  '/api/help-chat',
  '/api/chat',
];

/**
 * True when the request would write: a non-safe method sent to the app's own API (same
 * origin, `/api/…`) or to the Grist API read directly by the browser (`gristBase`), except
 * the read-only POST relays above.
 */
export const isWriteRequest = (url: string, method: string, origin: string, gristBase = ''): boolean => {
  if (SAFE_METHODS.has(method.toUpperCase())) return false;
  let target: URL;
  try {
    target = new URL(url, origin);
  } catch {
    return false;
  }
  if (gristBase && target.href.startsWith(gristBase.replace(/\/+$/, '') + '/')) return true;
  if (target.origin !== new URL(origin).origin || !target.pathname.startsWith('/api/')) return false;
  return !READ_POST_PREFIXES.some((prefix) => target.pathname.startsWith(prefix));
};

let installed = false;

/** Wraps window.fetch so that write requests reject with READ_ONLY_ERROR. Idempotent. */
export const installReadOnlyFetchGuard = (gristBase = ''): void => {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (isWriteRequest(url, method, window.location.origin, gristBase)) {
      return Promise.reject(new Error(READ_ONLY_ERROR));
    }
    return originalFetch(input, init);
  };
};
