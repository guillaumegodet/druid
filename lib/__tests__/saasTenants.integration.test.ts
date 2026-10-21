// Multi-tenant control plane and tenant schemas (druid-internal docs/plan-druid-saas.md, lot 1 a-b): two tenants on the
// same database, each in its own schema, isolated from each other; magic links and sessions of the control plane.
// Needs DATABASE_URL (owner role: creates and drops schemas) and dbmate; run by the « database » CI job and
// `npm run test:db`. DATABASE_URL_APP (application role) checks the rows-only rights when set.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'kysely';
import { createDb, withActor } from '../db/client';
import {
  accessForMember, capabilitiesForTenant, consumeMagicLink, createMagicLink, createSession, deleteSession, findMember,
  findTenantByHost, isValidSlug, mayRequestLink, normalizeHost, sessionEmail, tenantSchemaName,
} from '../saas/controlPlane';
import { createTenant, dropTenantSchema, migrateControlPlane, openSaasDb } from '../saas/tenantDb';

const url = process.env.DATABASE_URL;
const appUrl = process.env.DATABASE_URL_APP;
const saas = url ? openSaasDb(url) : null;
const SLUGS = ['zz-alpha-test', 'zz-beta-test'];
const schemaOf = (slug: string) => tenantSchemaName(slug);
const tenantDb = (slug: string, asApp = false) => createDb({ connectionString: (asApp && appUrl) || url!, max: 1, schema: schemaOf(slug), allowExitOnIdle: true });

describe('pure rules', () => {
  it('schema names, hosts, slugs', () => {
    expect(tenantSchemaName('ecole-x')).toBe('t_ecole_x');
    expect(() => tenantSchemaName('Bad Slug')).toThrow();
    expect(normalizeHost(' Ecole.Example.ORG:443. ')).toBe('ecole.example.org');
    expect(isValidSlug('www')).toBe(false);
    expect(isValidSlug('demo')).toBe(false);
    expect(isValidSlug('univ-x')).toBe(true);
  });
  it('member roles → rights of the front and scope of the API', () => {
    expect(accessForMember(null).access.allowedSlugs).toEqual([]);
    const owner = accessForMember({ role: 'owner', lab_scope: [] });
    expect(owner.access.isSuperAdmin).toBe(true);
    expect(owner.roles).toEqual(['user', 'admin', 'dashboard_viewer']);
    expect(owner.scope).toEqual({ all: true, labAnchors: [] });
    const lab = accessForMember({ role: 'lab', lab_scope: ['LS2N', 'Gé-M'] });
    expect(lab.access.isSuperAdmin).toBe(false);
    expect(lab.access.allowedSlugs).toEqual(['ls2n', 'gem']);
    expect(lab.scope).toEqual({ all: false, labAnchors: ['ls2n', 'gem'] });
    // A suspended tenant keeps its readers, loses its administrators.
    const suspended = accessForMember({ role: 'owner', lab_scope: [] }, true);
    expect(suspended.access.isSuperAdmin).toBe(false);
    expect(suspended.access.allowedSlugs).toBe('all');
  });
  it('capabilities: runtime, then plan, then tenant overrides; suspended ⇒ read-only', () => {
    const base = { HAS_BENCHMARK: false, HAS_TASKS: false, READ_ONLY: false };
    const plan = { capabilities: { HAS_BENCHMARK: true, HAS_LDAP: true } };
    const active = { settings: { capabilities: { HAS_TASKS: true } }, status: 'active' as const };
    expect(capabilitiesForTenant(base, plan, active)).toEqual({ HAS_BENCHMARK: true, HAS_TASKS: true, READ_ONLY: false });
    expect(capabilitiesForTenant(base, null, { settings: {}, status: 'suspended' }).READ_ONLY).toBe(true);
  });
  it('who may ask for a magic link', () => {
    const tenant = { mail_domains: ['example.org'] };
    expect(mayRequestLink(tenant, null, 'x@example.org')).toBe(true);
    expect(mayRequestLink(tenant, null, 'x@example.net')).toBe(false);
    expect(mayRequestLink({ mail_domains: [] }, { role: 'lab' } as any, 'x@example.net')).toBe(true);
  });
});

describe.skipIf(!url)('tenants on a database', () => {
  const ids: Record<string, string> = {};
  beforeAll(async () => {
    await migrateControlPlane({ ownerUrl: url! });
    for (const slug of SLUGS) {
      await saas!.deleteFrom('tenant').where('slug', '=', slug).execute();
      await dropTenantSchema(schemaOf(slug), { ownerUrl: url! });
    }
    for (const slug of SLUGS) {
      const { id } = await createTenant(saas!, {
        slug, label: `Tenant ${slug}`, hosts: [`${slug}.example.org`], mailDomains: ['example.org'], ownerEmail: `owner-${slug}@example.org`,
      }, { ownerUrl: url! });
      ids[slug] = id;
    }
  }, 120_000);
  afterAll(async () => {
    for (const slug of SLUGS) {
      await saas?.deleteFrom('tenant').where('slug', '=', slug).execute();
      await dropTenantSchema(schemaOf(slug), { ownerUrl: url! });
    }
    await saas?.destroy();
  });

  it('resolves a tenant by host (case and port ignored), with its plan and owner', async () => {
    const found = await findTenantByHost(saas!, 'ZZ-ALPHA-TEST.example.org:8443');
    expect(found?.tenant.slug).toBe('zz-alpha-test');
    expect(found?.tenant.status).toBe('active');
    expect(found?.plan?.code).toBe('trial');
    expect(found?.plan?.seats).toBe(1);
    expect(await findTenantByHost(saas!, 'nobody.example.org')).toBeNull();
    const owner = await findMember(saas!, ids['zz-alpha-test'], 'Owner-zz-alpha-test@example.org');
    expect(owner?.role).toBe('owner');
  });

  it('each tenant has its own tables: a row of one is invisible to the other, audited in its own schema', async () => {
    const alpha = tenantDb('zz-alpha-test', true);
    const beta = tenantDb('zz-beta-test', true);
    try {
      await withActor(alpha, 'test', (trx) => trx.insertInto('structure').values({ local_id: 'L1', acronym: 'LAB1', name: 'Lab one' }).execute());
      expect((await alpha.selectFrom('structure').selectAll().execute()).map((s) => s.acronym)).toEqual(['LAB1']);
      expect(await beta.selectFrom('structure').selectAll().execute()).toEqual([]);
      const audited = await alpha.selectFrom('audit_log').select(['table_name', 'actor']).execute();
      expect(audited).toEqual([{ table_name: 'structure', actor: 'test' }]);
      expect(await beta.selectFrom('audit_log').selectAll().execute()).toEqual([]);
      // The schema of the other tenant is not reachable by name either from a schema-bound client.
      const other = schemaOf('zz-beta-test');
      const cross = await sql<{ n: number }>`SELECT count(*)::int AS n FROM ${sql.raw(`"${other}"`)}.structure`.execute(alpha);
      expect(cross.rows[0].n).toBe(0);
      // The functions of the schema (fuzzy_date domain, triggers) work there: a dated membership.
      await withActor(alpha, 'test', async (trx) => {
        const p = await trx.insertInto('person').values({ last_name: 'Fictive', first_name: 'Ada', employment_start: '2024-05' }).returning('id').executeTakeFirstOrThrow();
        expect(p.id).toBeTruthy();
      });
      const person = await alpha.selectFrom('person').select(['employment_start', 'employment_start_lower']).executeTakeFirstOrThrow();
      expect(person.employment_start).toBe('2024-05');
      expect(person.employment_start_lower).toBe('2024-05-01');
    } finally {
      await alpha.destroy();
      await beta.destroy();
    }
  });

  it('migrating a tenant again is idempotent', async () => {
    const { migrateTenantSchema } = await import('../saas/tenantDb');
    await expect(migrateTenantSchema(schemaOf('zz-alpha-test'), { ownerUrl: url! })).resolves.toBeUndefined();
  });

  it('magic links are consumed once; sessions belong to one tenant', async () => {
    const alphaId = ids['zz-alpha-test'];
    await createMagicLink(saas!, { email: 'Owner-zz-alpha-test@example.org', tenantId: alphaId, tokenHash: 'hash-1', nextPath: '/x' });
    const first = await consumeMagicLink(saas!, 'hash-1');
    expect(first?.email).toBe('owner-zz-alpha-test@example.org');
    expect(first?.next_path).toBe('/x');
    expect(await consumeMagicLink(saas!, 'hash-1')).toBeNull();
    expect(await consumeMagicLink(saas!, 'unknown')).toBeNull();
    const sid = await createSession(saas!, { email: 'owner-zz-alpha-test@example.org', tenantId: alphaId, userAgent: 'vitest' });
    expect(await sessionEmail(saas!, sid, alphaId)).toBe('owner-zz-alpha-test@example.org');
    expect(await sessionEmail(saas!, sid, ids['zz-beta-test'])).toBeNull();
    expect(await sessionEmail(saas!, sid, null)).toBeNull();
    expect(await sessionEmail(saas!, 'not-a-uuid', alphaId)).toBeNull();
    await deleteSession(saas!, sid);
    expect(await sessionEmail(saas!, sid, alphaId)).toBeNull();
  });
});
