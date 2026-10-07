// Directory domain API, read side (druid-internal docs/plan-migration-postgresql.md, lot 1).
//
// One Hono application, runtime-agnostic (Web Request/Response only), served by server.cjs on Nantes
// (through the server-api.cjs bundle, see server/apiV1.ts) and by functions/api/v1 on Cloudflare. The host
// passes, per request, the stores of its instance and the scope of the authenticated user as Hono
// bindings: this module never reads a session, a header or an environment variable itself.
//
//   GET /api/v1/people                   → { items: Researcher[], updatedAt }   (rows of the user's labs)
//   GET /api/v1/structures               → { items: Structure[], updatedAt }
//   GET /api/v1/institutions             → { items: Institution[], updatedAt }
//   GET /api/v1/abes-exports             → { items: AbesExportMark[], updatedAt } (rows of the user's labs)
//   GET /api/v1/merges?limit=50          → { items: MergeLogEntry[], updatedAt } (institution right only)
//   GET /api/v1/newsletter?slug=<slug>   → { items: NewsletterItem[] }         (structures of the user)
//   GET /api/v1/axis-corrections/<slug>  → { items: AxisCorrectionRow[] }      (every authenticated user)
import { Hono } from 'hono';
import { normalizeAcronym } from '../normalize';
import type { DirectoryRepository, DirectoryScope } from './repository';
import { DocumentNotAllowedError, PublicationsStore } from '../publications/store';

export interface DirectoryApiBindings {
  repository: DirectoryRepository;
  /** Publications side (D10): tables that stay in Grist. */
  publications: PublicationsStore;
  /** null = no authenticated user. */
  scope: DirectoryScope | null;
}

type Env = { Bindings: DirectoryApiBindings };

const NO_STORE = { 'Cache-Control': 'no-store' };
const MAX_MERGES = 500;

/** Same rule as server.cjs canAccessSlug: institution right, or one of the user's labs. */
export const scopeAllowsSlug = (scope: DirectoryScope, slug: string): boolean =>
  scope.all || scope.labAnchors.includes(normalizeAcronym(slug));

export const createDirectoryApi = (): Hono<Env> => {
  const app = new Hono<Env>().basePath('/api/v1');

  app.use('*', async (c, next) => {
    if (!c.env?.scope) return c.json({ error: 'Unauthorized' }, 401, NO_STORE);
    await next();
  });

  app.get('/people', async (c) => c.json(await c.env.repository.people(c.env.scope!), 200, NO_STORE));
  app.get('/structures', async (c) => c.json(await c.env.repository.structures(), 200, NO_STORE));
  app.get('/institutions', async (c) => c.json(await c.env.repository.institutions(), 200, NO_STORE));
  app.get('/abes-exports', async (c) => c.json(await c.env.repository.abesExports(c.env.scope!), 200, NO_STORE));

  // Merge history of the Duplicates page (« À traiter », admins): institution tool, never for a lab right.
  app.get('/merges', async (c) => {
    if (!c.env.scope!.all) return c.json({ error: 'Forbidden' }, 403, NO_STORE);
    const limit = Math.min(Math.max(Number.parseInt(c.req.query('limit') || '50', 10) || 50, 1), MAX_MERGES);
    return c.json(await c.env.repository.merges(limit), 200, NO_STORE);
  });

  app.get('/newsletter', async (c) => {
    const slug = String(c.req.query('slug') || '').trim();
    if (!slug) return c.json({ error: 'Invalid slug' }, 400, NO_STORE);
    if (!scopeAllowsSlug(c.env.scope!, slug)) return c.json({ error: 'Forbidden' }, 403, NO_STORE);
    return c.json({ items: await c.env.publications.newsletter(slug) }, 200, NO_STORE);
  });

  // Classification of publications, no personal data: readable by every authenticated user, as through the
  // proxy — a report shared with a lab right must show the same axes as the Axes tab (ec-nantes dashboard).
  app.get('/axis-corrections/:slug', async (c) => {
    const slug = c.req.param('slug');
    const items = await c.env.publications.axisCorrections(slug);
    if (items === null) return c.json({ error: 'Not found' }, 404, NO_STORE);
    return c.json({ items }, 200, NO_STORE);
  });

  app.notFound((c) => c.json({ error: 'Unknown API route' }, 404, NO_STORE));
  app.onError((err, c) => {
    if (err instanceof DocumentNotAllowedError) return c.json({ error: 'Forbidden' }, 403, NO_STORE);
    console.error('[api/v1]', c.req.method, c.req.path, err);
    return c.json({ error: 'Directory storage unavailable' }, 502, NO_STORE);
  });
  return app;
};
