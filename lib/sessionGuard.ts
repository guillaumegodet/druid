/**
 * @file sessionGuard.ts
 * @description Lost or expired server session → back to the login. The Druid server keeps its sessions
 * in memory: every deployment (container recreated) and the 8-hour cookie end them, and the open tabs
 * then get 401 on every /api/… call. Without this guard each screen showed its own error (« Erreur
 * Grist (Annuaire) » on the Duplicates tab after the 1.6.0 deployment); a few screens already
 * redirected by themselves (groupDashboardApi, etlConsoleApi).
 *
 * Installed by initKeycloak only when /api/me says the server authenticates by session
 * (`auth: 'session'`, server.cjs): on the Cloudflare instances a 401 means « no Access identity »
 * (anonymous demo), and there is no /auth/login to go to.
 */

/** Same-origin API call (relative path or absolute URL on the current origin). */
export const isApiRequest = (url: string, origin: string): boolean => {
  try {
    const target = new URL(url, origin);
    return target.origin === new URL(origin).origin && target.pathname.startsWith('/api/');
  } catch {
    return false;
  }
};

let installed = false;
let redirecting = false;

/**
 * Wraps window.fetch: a 401 on an /api/… call triggers `onExpired` (the login redirect) once, and the
 * call never settles — the page is leaving, a rejected promise would only flash an error. Idempotent.
 */
export const installSessionExpiryGuard = (onExpired: () => void): void => {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const resp = await originalFetch(input, init);
    const url = input instanceof Request ? input.url : String(input);
    if (resp.status !== 401 || !isApiRequest(url, window.location.origin)) return resp;
    if (!redirecting) {
      redirecting = true;
      onExpired();
    }
    return new Promise<Response>(() => {});
  };
};

/** Tests only: forget the installation. */
export const resetSessionExpiryGuardForTests = (): void => {
  installed = false;
  redirecting = false;
};
