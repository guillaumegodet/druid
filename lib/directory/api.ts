// Directory domain API, read side (druid-internal docs/plan-migration-postgresql.md, lot 1).
//
// One Hono application, runtime-agnostic (Web Request/Response only), served by server.cjs on Nantes
// (through the server-api.cjs bundle, see server/apiV1.ts) and by functions/api/v1 on Cloudflare. The host
// passes, per request, the repository of its instance and the scope of the authenticated user as Hono
// bindings: this module never reads a session, a header or an environment variable itself.
//
//   GET /api/v1/people        → { items: Researcher[], updatedAt }   (scoped to the user's labs)
//   GET /api/v1/structures    → { items: Structure[], updatedAt }
//   GET /api/v1/institutions  → { items: Institution[], updatedAt }
import { Hono } from 'hono';
import type { DirectoryRepository, DirectoryScope } from './repository';

export interface DirectoryApiBindings {
  repository: DirectoryRepository;
  /** null = no authenticated user. */
  scope: DirectoryScope | null;
}

type Env = { Bindings: DirectoryApiBindings };

const NO_STORE = { 'Cache-Control': 'no-store' };

export const createDirectoryApi = (): Hono<Env> => {
  const app = new Hono<Env>().basePath('/api/v1');

  app.use('*', async (c, next) => {
    if (!c.env?.scope) return c.json({ error: 'Unauthorized' }, 401, NO_STORE);
    await next();
  });

  app.get('/people', async (c) => c.json(await c.env.repository.people(c.env.scope!), 200, NO_STORE));
  app.get('/structures', async (c) => c.json(await c.env.repository.structures(), 200, NO_STORE));
  app.get('/institutions', async (c) => c.json(await c.env.repository.institutions(), 200, NO_STORE));

  app.notFound((c) => c.json({ error: 'Unknown API route' }, 404, NO_STORE));
  app.onError((err, c) => {
    console.error('[api/v1]', c.req.method, c.req.path, err);
    return c.json({ error: 'Directory storage unavailable' }, 502, NO_STORE);
  });
  return app;
};
