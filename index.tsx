import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { initKeycloak } from './lib/auth';
import { I18nProvider } from '@lingui/react';
import { i18n } from '@lingui/core';
import { activateLocale, detectLocale } from './lib/i18n';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);

// The language catalog is loaded before any render: components can then
// call `useLingui()` / `<Trans>` without a loading state.
const i18nReady = activateLocale(detectLocale());

/**
 * `activateLocale` does a dynamic import() of the language chunk: without a safety net, a tab
 * left open after a redeploy (chunk from a previous build, 404) made i18nReady reject and
 * root.render() never ran anywhere — permanent blank page, with no ErrorBoundary to
 * recover from it (review lot 7a). A single automatic reload fetches the new shell (new chunk
 * hashes); if it still rejects (lasting outage, not a stale chunk), we render anyway
 * rather than staying stuck.
 */
function withI18nFallback(render: () => void): void {
  i18nReady.then(render).catch((e) => {
    console.error('Catalogue de langue indisponible', e);
    const key = 'druid_i18n_reload_once';
    let alreadyReloaded = true;
    try { alreadyReloaded = sessionStorage.getItem(key) === '1'; sessionStorage.setItem(key, '1'); } catch { /* noop */ }
    if (!alreadyReloaded) window.location.reload();
    else render();
  });
}

if (window.location.pathname.startsWith('/embed')) {
  // Public chart embed page: no authentication (public route and data on
  // the server.cjs side), no application layout.
  const EmbedPage = React.lazy(() =>
    import('./components/dashboard/EmbedPage').then((m) => ({ default: m.EmbedPage }))
  );
  withI18nFallback(() =>
    root.render(
      <React.StrictMode>
        <I18nProvider i18n={i18n}>
          <React.Suspense fallback={null}>
            <EmbedPage />
          </React.Suspense>
        </I18nProvider>
      </React.StrictMode>
    )
  );
} else {
  initKeycloak(() => {
    withI18nFallback(() =>
      root.render(
        <React.StrictMode>
          <I18nProvider i18n={i18n}>
            <App />
          </I18nProvider>
        </React.StrictMode>
      )
    );
  });
}