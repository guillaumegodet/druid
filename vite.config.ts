import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { lingui } from '@lingui/vite-plugin';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        // Lingui macros (`Trans`, `useLingui`) compiled by Babel; `.po` catalogs
        // imported directly (lib/i18n.ts) thanks to the Vite plugin.
        react({ babel: { plugins: ['@lingui/babel-plugin-lingui-macro'] } }),
        lingui(),
        {
          name: 'grist-proxy-artisanal',
          configureServer(server) {
            server.middlewares.use(async (req, res, next) => {
              // Only intercept calls to the Grist API
              if (req.url?.startsWith('/api/grist/')) {
                const gristPath = req.url.replace('/api/grist/', '');
                const targetUrl = `https://grist.numerique.gouv.fr/api/${gristPath}`;
                
                // Handle OPTIONS (CORS preflight) first to reassure the browser
                if (req.method === 'OPTIONS') {
                  res.statusCode = 204;
                  res.setHeader('Access-Control-Allow-Origin', '*');
                  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
                  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
                  res.end();
                  return;
                }

                console.log(`[Proxy Artisanal] ${req.method} -> ${targetUrl}`);

                try {
                  let body;
                  if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT') {
                    const chunks = [];
                    for await (const chunk of req) {
                      chunks.push(chunk);
                    }
                    body = Buffer.concat(chunks);
                  }

                  // Direct call, identical to the test script
                  const response = await fetch(targetUrl, {
                    method: req.method,
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${env.GRIST_API_KEY || env.VITE_GRIST_API_KEY || ''}`
                    },
                    body: body
                  });

                  const textResponse = await response.text();
                  
                  res.statusCode = response.status;
                  res.setHeader('Content-Type', 'application/json');
                  res.setHeader('Access-Control-Allow-Origin', '*');
                  res.end(textResponse);
                } catch (err) {
                  console.error('[Proxy Artisanal Error]', err);
                  res.statusCode = 500;
                  res.end(JSON.stringify({ error: err.message }));
                }
                return;
              }
              next();
            });

            server.middlewares.use(async (req, res, next) => {
              if (req.url === '/api/sync-ldap-trigger') {
                try {
                  const { execSync } = await import('child_process');
                  const { copyFileSync, unlinkSync, existsSync } = await import('fs');
                  execSync('node scripts/sync_ldap.cjs');
                  if (existsSync('ldap_status_cache.json')) {
                    copyFileSync('ldap_status_cache.json', 'public/ldap_status_cache.json');
                    unlinkSync('ldap_status_cache.json');
                  }
                  res.statusCode = 200;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ success: true }));
                } catch (err) {
                  res.statusCode = 500;
                  res.end(JSON.stringify({ error: err.message }));
                }
                return;
              }
              next();
            });
          }
        }
      ],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
