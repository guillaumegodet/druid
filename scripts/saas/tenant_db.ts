// Tenants of a multi-tenant deployment (druid-internal docs/plan-druid-saas.md, lot 1 b). Bundled to
// scripts/.build/tenant_db.cjs (`npm run build:saas`), run with the OWNER connection string:
//
//   DATABASE_URL=postgres://druid_owner:…/druid node scripts/.build/tenant_db.cjs create <slug> --label "…" \
//       --host <slug>.example.org [--host …] [--plan trial] [--mail-domain example.org] [--owner admin@example.org]
//   DATABASE_URL=… node scripts/.build/tenant_db.cjs migrate-all          # after a deployment with new migrations
//   DATABASE_URL=… node scripts/.build/tenant_db.cjs list
//   DATABASE_URL=… node scripts/.build/tenant_db.cjs drop <slug> --confirm   # schema and control-plane row
//
// The control plane itself (schema saas) is migrated by `npm run db:saas:migrate` beforehand.
import { findTenantBySlug, isValidSlug } from '../../lib/saas/controlPlane';
import { createTenant, dropTenantSchema, migrateAllTenants, openSaasDb, setTenantStatus } from '../../lib/saas/tenantDb';

const args = process.argv.slice(2);
const command = args[0];
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const flags = (name: string): string[] => args.flatMap((a, i) => (a === `--${name}` && args[i + 1] ? [args[i + 1]] : []));
const has = (name: string): boolean => args.includes(`--${name}`);

const usage = (): never => {
  console.error('usage: tenant_db.cjs <create <slug> --label … --host … | migrate-all | list | drop <slug> --confirm>');
  process.exit(2);
};

const main = async (): Promise<void> => {
  const ownerUrl = process.env.DATABASE_URL;
  if (!ownerUrl) throw new Error('DATABASE_URL (owner role) is required');
  const saas = openSaasDb(ownerUrl);
  const log = (l: string) => console.log(`[tenant_db] ${l}`);
  try {
    if (command === 'create') {
      const slug = args[1];
      const label = flag('label');
      const hosts = flags('host');
      if (!slug || !label || !hosts.length) return usage();
      if (!isValidSlug(slug)) throw new Error(`invalid or reserved slug "${slug}"`);
      if (await findTenantBySlug(saas, slug)) throw new Error(`tenant "${slug}" already exists`);
      const { schema } = await createTenant(saas, {
        slug, label, hosts, planCode: flag('plan'), mailDomains: flags('mail-domain'), ownerEmail: flag('owner') || null,
        ror: flag('ror') || null, uai: flag('uai') || null, country: flag('country') || null, createdBy: 'tenant_db',
      }, { ownerUrl, log });
      log(`tenant ${slug} created (schema ${schema}, hosts ${hosts.join(', ')})`);
    } else if (command === 'migrate-all') {
      const done = await migrateAllTenants(saas, { ownerUrl, log });
      log(`${done.length} tenant(s) migrated${done.length ? `: ${done.join(', ')}` : ''}`);
    } else if (command === 'list') {
      const rows = await saas.selectFrom('tenant').leftJoin('tenant_host', (j) => j.onRef('tenant_host.tenant_id', '=', 'tenant.id').on('tenant_host.is_primary', '=', true))
        .select(['tenant.slug', 'tenant.label', 'tenant.status', 'tenant.plan_code', 'tenant.schema_name', 'tenant_host.host', 'tenant.created_at']).orderBy('tenant.slug').execute();
      for (const r of rows) console.log(`${r.slug}\t${r.status}\t${r.plan_code}\t${r.host || '-'}\t${r.schema_name}\t${r.label}`);
      if (!rows.length) console.log('(no tenant)');
    } else if (command === 'drop') {
      const slug = args[1];
      if (!slug) return usage();
      const tenant = await findTenantBySlug(saas, slug);
      if (!tenant) throw new Error(`unknown tenant "${slug}"`);
      if (!has('confirm')) throw new Error(`drop needs --confirm (schema ${tenant.schema_name} and every row of ${slug} will be lost)`);
      await setTenantStatus(saas, tenant.id, 'deleted');
      await dropTenantSchema(tenant.schema_name, { ownerUrl });
      await saas.deleteFrom('tenant').where('id', '=', tenant.id).execute();
      log(`tenant ${slug} dropped`);
    } else {
      usage();
    }
  } finally {
    await saas.destroy();
  }
};

main().catch((err) => {
  console.error(`[tenant_db] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
