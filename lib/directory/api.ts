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
//   GET /api/v1/people/columns           → { items: AnnuaireColumnMeta[] }
//   GET /api/v1/people/uid/<uid>/labs    → { items: string[] }                 (rows of the user's labs)
//
// Writes (lot 2 a, lib/directory/commands.ts — scope checked by the command):
//   POST  /api/v1/people                        Researcher            → 201 { recordId }
//   PUT   /api/v1/people/<recordId>             Researcher            → { ok: true }
//   PATCH /api/v1/people/groups                 { entries: [{ recordId, groups }] }
//   PATCH /api/v1/people/<recordId>/openalex-id { openalexId }
//   POST  /api/v1/people/validations            { entries: [{ recordId, validation }] } → { updated }
//   POST  /api/v1/abes-exports                  { entries: [{ recordId, hash }], date }  → { updated }
//   POST  /api/v1/structures                    Structure             → 201 { id: 'S-<rowId>' }   (lot 2 b)
//   PUT   /api/v1/structures/<recordId>         Structure             → { ok: true }
//   POST  /api/v1/duplicates/qualification      { rowIds, principalRowId?, mode, endDate?, author }  (lot 2 c)
//   POST  /api/v1/duplicates/unqualification    { rowIds }
//   POST  /api/v1/people/uid-switch             { fromUid, rowId?, toUid, author }
//   POST  /api/v1/merges                        { keepRowId, dropRowId, fields, author, note? } → 201 { logId }
//   POST  /api/v1/merges/<logId>/restore        → { restoredRowId }
// Reads of lot 2 c: GET /api/v1/duplicates (DuplicatesDiff, rows of the scope), GET /api/v1/people/rows?ids=1,2
// (raw Annuaire rows of the scope, for the merge assistant).
// Every write answer carries an `X-Druid-Audit` header (JSON list of the Grist writes) that the host moves to
// its audit log and never forwards to the browser.
import { Hono } from 'hono';
import { z } from 'zod';
import { normalizeAcronym } from '../normalize';
import type { DirectoryRepository, DirectoryScope } from './repository';
import { DocumentNotAllowedError, PublicationsStore } from '../publications/store';
import type { CommandContext, DirectoryCommands, WriteAudit } from './commands';
import { ApiError } from './errors';

export interface DirectoryApiBindings {
  repository: DirectoryRepository;
  /** Publications side (D10): tables that stay in Grist. */
  publications: PublicationsStore;
  /** Write commands; absent on a host without writes (tests of the read routes). */
  commands?: DirectoryCommands;
  /** null = no authenticated user. */
  scope: DirectoryScope | null;
  /** Why this instance refuses every write (read-only demo, no Cloudflare Access identity), null = allowed. */
  writeRefusal?: { status: 403; error: string } | null;
}

type Env = { Bindings: DirectoryApiBindings; Variables: { audit: WriteAudit[] } };

export const AUDIT_HEADER = 'X-Druid-Audit';

// Request bodies: structure only (the record itself is the client's Researcher object, mapped field by field
// by lib/directory/annuaireWrite.ts; unknown keys are kept).
const RecordId = z.number().int().positive();
const ResearcherBody = z.object({
  lastName: z.string(),
  firstName: z.string(),
  affiliations: z.array(z.looseObject({})),
  employment: z.looseObject({}),
  identifiers: z.looseObject({}),
}).loose();
const StructureBody = z.looseObject({ acronym: z.string().optional(), level: z.union([z.string(), z.number()]).optional() });
const RowIds = z.array(RecordId).min(1).max(500);
const QualifyBody = z.object({
  rowIds: RowIds, principalRowId: RecordId.optional(), mode: z.enum(['concomitant', 'successif', 'a_revoir']),
  endDate: z.string().optional(), author: z.string(),
});
const UnqualifyBody = z.object({ rowIds: RowIds });
const UidSwitchBody = z.object({ fromUid: z.string(), rowId: RecordId.optional(), toUid: z.string(), author: z.string() });
const MergeBody = z.object({ keepRowId: RecordId, dropRowId: RecordId, fields: z.record(z.string(), z.unknown()), author: z.string(), note: z.string().optional() });
const GroupsBody = z.object({ entries: z.array(z.object({ recordId: RecordId, groups: z.array(z.string()) })) });
const OpenalexBody = z.object({ openalexId: z.string() });
const ValidationsBody = z.object({ entries: z.array(z.object({ recordId: RecordId, validation: z.looseObject({}) })) });
const AbesBody = z.object({
  entries: z.array(z.object({ recordId: RecordId, hash: z.string().min(1) })),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

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

  app.get('/people/columns', async (c) => {
    if (!c.env.commands) return c.json({ error: 'Unknown API route' }, 404, NO_STORE);
    return c.json({ items: await c.env.commands.annuaireColumns() }, 200, NO_STORE);
  });
  app.get('/duplicates', async (c) => c.json(await c.env.repository.duplicates(c.env.scope!), 200, NO_STORE));
  app.get('/people/rows', async (c) => {
    const ids = String(c.req.query('ids') || '').split(',').filter(Boolean).map(Number);
    if (ids.length === 0 || ids.length > 500 || !ids.every((n) => Number.isInteger(n) && n > 0)) return c.json({ error: 'Invalid Grist identifiers' }, 400, NO_STORE);
    return c.json({ items: await c.env.repository.recordRows(ids, c.env.scope!) }, 200, NO_STORE);
  });
  app.get('/people/uid/:uid/labs', async (c) =>
    c.json({ items: await c.env.repository.labsOfUid(c.req.param('uid'), c.env.scope!) }, 200, NO_STORE));

  // ── Writes ──────────────────────────────────────────────────────────────
  const writes = new Hono<Env>();
  writes.use('*', async (c, next) => {
    if (c.req.method === 'GET' || c.req.method === 'HEAD') return next();
    if (c.env.writeRefusal) return c.json({ error: c.env.writeRefusal.error }, c.env.writeRefusal.status, NO_STORE);
    if (!c.env.commands) return c.json({ error: 'Unknown API route' }, 404, NO_STORE);
    c.set('audit', []);
    await next();
    const audit = c.get('audit');
    if (audit.length) c.res.headers.set(AUDIT_HEADER, JSON.stringify(audit));
  });
  const ctxOf = (c: { env: DirectoryApiBindings; get: (k: 'audit') => WriteAudit[] }): CommandContext =>
    ({ scope: c.env.scope!, audit: (entry) => c.get('audit').push(entry) });
  /** Parsed JSON body, or null when it does not match the schema. */
  const bodyOf = async <T>(c: { req: { json: () => Promise<unknown> } }, schema: z.ZodType<T>): Promise<T | null> => {
    const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
    return parsed.success ? parsed.data : null;
  };
  const recordIdOf = (raw: string): number | null => (/^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : null);

  writes.post('/people', async (c) => {
    const body = await bodyOf(c, ResearcherBody);
    if (!body) return c.json({ error: 'Invalid record' }, 400, NO_STORE);
    return c.json(await c.env.commands!.createPerson(body as any, ctxOf(c)), 201, NO_STORE);
  });
  writes.patch('/people/groups', async (c) => {
    const body = await bodyOf(c, GroupsBody);
    if (!body) return c.json({ error: 'Invalid record' }, 400, NO_STORE);
    await c.env.commands!.setGroups(body.entries, ctxOf(c));
    return c.json({ ok: true }, 200, NO_STORE);
  });
  writes.post('/people/validations', async (c) => {
    const body = await bodyOf(c, ValidationsBody);
    if (!body) return c.json({ error: 'Invalid record' }, 400, NO_STORE);
    return c.json({ updated: await c.env.commands!.applyValidations(body.entries as any, ctxOf(c)) }, 200, NO_STORE);
  });
  writes.put('/people/:recordId', async (c) => {
    const recordId = recordIdOf(c.req.param('recordId'));
    const body = await bodyOf(c, ResearcherBody);
    if (!recordId || !body) return c.json({ error: 'Invalid record' }, 400, NO_STORE);
    await c.env.commands!.updatePerson(recordId, body as any, ctxOf(c));
    return c.json({ ok: true }, 200, NO_STORE);
  });
  writes.patch('/people/:recordId/openalex-id', async (c) => {
    const recordId = recordIdOf(c.req.param('recordId'));
    const body = await bodyOf(c, OpenalexBody);
    if (!recordId || !body) return c.json({ error: 'Invalid record' }, 400, NO_STORE);
    await c.env.commands!.setOpenalexId(recordId, body.openalexId, ctxOf(c));
    return c.json({ ok: true }, 200, NO_STORE);
  });
  writes.post('/abes-exports', async (c) => {
    const body = await bodyOf(c, AbesBody);
    if (!body) return c.json({ error: 'Invalid record' }, 400, NO_STORE);
    return c.json({ updated: await c.env.commands!.markAbesSent(body.entries, body.date, ctxOf(c)) }, 200, NO_STORE);
  });
  writes.post('/structures', async (c) => {
    const body = await bodyOf(c, StructureBody);
    if (!body) return c.json({ error: 'Invalid record' }, 400, NO_STORE);
    return c.json(await c.env.commands!.createStructure(body as any, ctxOf(c)), 201, NO_STORE);
  });
  writes.put('/structures/:recordId', async (c) => {
    const recordId = recordIdOf(c.req.param('recordId'));
    const body = await bodyOf(c, StructureBody);
    if (!recordId || !body) return c.json({ error: 'Invalid record' }, 400, NO_STORE);
    await c.env.commands!.updateStructure(recordId, body as any, ctxOf(c));
    return c.json({ ok: true }, 200, NO_STORE);
  });
  writes.post('/duplicates/qualification', async (c) => {
    const body = await bodyOf(c, QualifyBody);
    if (!body) return c.json({ error: 'Invalid record' }, 400, NO_STORE);
    return c.json(await c.env.commands!.qualifyDuplicates(body, ctxOf(c)), 200, NO_STORE);
  });
  writes.post('/duplicates/unqualification', async (c) => {
    const body = await bodyOf(c, UnqualifyBody);
    if (!body) return c.json({ error: 'Invalid record' }, 400, NO_STORE);
    return c.json(await c.env.commands!.unqualifyDuplicates(body.rowIds, ctxOf(c)), 200, NO_STORE);
  });
  writes.post('/people/uid-switch', async (c) => {
    const body = await bodyOf(c, UidSwitchBody);
    if (!body) return c.json({ error: 'Invalid record' }, 400, NO_STORE);
    return c.json(await c.env.commands!.switchUid(body, ctxOf(c)), 200, NO_STORE);
  });
  writes.post('/merges', async (c) => {
    const body = await bodyOf(c, MergeBody);
    if (!body) return c.json({ error: 'Invalid record' }, 400, NO_STORE);
    return c.json(await c.env.commands!.mergeRows(body as any, ctxOf(c)), 201, NO_STORE);
  });
  writes.post('/merges/:logId/restore', async (c) => {
    const logId = recordIdOf(c.req.param('logId'));
    if (!logId) return c.json({ error: 'Invalid Grist identifiers' }, 400, NO_STORE);
    return c.json(await c.env.commands!.restoreMerge(logId, ctxOf(c)), 200, NO_STORE);
  });
  app.route('/', writes);

  app.notFound((c) => c.json({ error: 'Unknown API route' }, 404, NO_STORE));
  app.onError((err, c) => {
    // A command refused or failed after some writes: the audit of what was written still goes out.
    const audit = (c as any).get?.('audit') as WriteAudit[] | undefined;
    const headers: Record<string, string> = { ...NO_STORE, ...(audit?.length ? { [AUDIT_HEADER]: JSON.stringify(audit) } : {}) };
    if (err instanceof ApiError) return c.json({ error: err.message }, err.status, headers);
    if (err instanceof DocumentNotAllowedError) return c.json({ error: 'Forbidden' }, 403, NO_STORE);
    console.error('[api/v1]', c.req.method, c.req.path, err);
    return c.json({ error: 'Directory storage unavailable' }, 502, headers);
  });
  return app;
};
