// Guard of the multi-tenant storage (druid-internal docs/plan-druid-saas.md, lot 1 b): a tenant's queries are qualified
// by its schema through Kysely `withSchema`, which rewrites the tables of the query builder only. A raw sql`…` template
// that names a table reads `public` instead — silent on a database whose public schema is migrated (Nantes, the CI's
// main database), fatal on the managed database of the SaaS where public is empty (« relation "audit_log" does not
// exist » at the provisioning, HTTP 502 on /api/v1/alignments/unified). Raw templates stay fine for expressions
// (count(*), now(), lower(x)…) and for the control plane, whose tables are written `saas.<table>`.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const SCANNED = ['lib', 'functions', 'scripts'];
/** Files that never run on a tenant: the Grist → PostgreSQL migration of Nantes (its tables are sql.table()). */
const ALLOWED = [/^lib\/migration\//];

const filesOf = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  if (name === 'node_modules' || name === '__tests__' || name.startsWith('.') || name === '_generated') return [];
  if (statSync(path).isDirectory()) return filesOf(path);
  return /\.(ts|tsx|js|cjs|mjs)$/.test(name) ? [path] : [];
});

const RAW_SQL = /\bsql(?:<[^`]*?>)?`([^`]*)`/g;
// A table named after FROM / JOIN / UPDATE (not « FOR UPDATE ») / INSERT INTO / DELETE FROM, unless schema-qualified
// (saas.job) or a set-returning function (unnest(…), jsonb_…, generate_series…) or a parameter (${…}).
const TABLE_REF = /\b(?:FROM|JOIN|(?<!FOR\s)UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+(?!\$\{)([a-z_][a-z0-9_]*)\b(?!\s*\(|\.)/gi;
const NOT_TABLES = new Set(['lateral', 'only']);

const unqualifiedTablesIn = (source: string): { line: number; table: string }[] => {
  const out: { line: number; table: string }[] = [];
  for (const m of source.matchAll(RAW_SQL)) {
    for (const t of m[1].matchAll(TABLE_REF)) {
      if (NOT_TABLES.has(t[1].toLowerCase())) continue;
      out.push({ line: source.slice(0, m.index).split('\n').length, table: t[1] });
    }
  }
  return out;
};

describe('raw SQL and the schema of a tenant', () => {
  it('the detector: raw table references found, qualified or expression-only templates ignored', () => {
    expect(unqualifiedTablesIn('await sql`SELECT max(at) FROM audit_log`.execute(db)').map((x) => x.table)).toEqual(['audit_log']);
    expect(unqualifiedTablesIn('sql`SELECT a.* FROM alignment_candidate a JOIN person p ON p.id = a.person_id`').map((x) => x.table)).toEqual(['alignment_candidate', 'person']);
    expect(unqualifiedTablesIn('sql`UPDATE saas.job SET status = 1 WHERE id = (SELECT j.id FROM saas.job j FOR UPDATE SKIP LOCKED)`')).toEqual([]);
    expect(unqualifiedTablesIn("sql<string>`count(DISTINCT person_id)`, sql`now()`, sql`lower(uid)`, sql`SELECT x FROM unnest(${'a'}::text[]) x`")).toEqual([]);
    expect(unqualifiedTablesIn('sql`SELECT count(*) FROM ${sql.table(t)}`')).toEqual([]);
  });

  it('no raw sql`…` template names a table of the directory (it would read public on a tenant)', () => {
    const offenders = SCANNED.flatMap((d) => filesOf(join(ROOT, d)))
      .map((path) => relative(ROOT, path).split('\\').join('/'))
      .filter((rel) => !ALLOWED.some((re) => re.test(rel)))
      .flatMap((rel) => unqualifiedTablesIn(readFileSync(join(ROOT, rel), 'utf8')).map((x) => `${rel}:${x.line} ${x.table}`));
    expect(offenders, 'use the query builder (qualified by withSchema) instead of a raw template').toEqual([]);
  });
});
