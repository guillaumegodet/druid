/**
 * @file alignCache.ts
 * @description Alignment caches of the people in the database of a tenant (table `align_cache` of its schema, migration
 * 20261021180000; druid-internal docs/plan-druid-saas.md, lot 3 b). On Nantes the scripts write
 * `<source>_align_cache.json` next to the server, which serves and reads the files; on a multi-tenant deployment the
 * runner stores each file here after a run, and the Functions serve `/<name>.json` and read the review from it.
 */
import { sql, type Kysely } from 'kysely';
import type { AlignCacheSource } from '../directory/alignCommands';
import type { PeopleAlignSource } from './jobs';

/** Names served at the site root (functions/_lib/instanceAssets.js ALIGN_CACHES) plus the Qualinka cache of IdRef. */
export const ALIGN_CACHE_NAMES = ['idref_align_cache', 'idref_align_qualinka_cache', 'orcid_align_cache', 'hal_align_cache', 'openalex_align_cache', 'scopus_align_cache'] as const;
export type AlignCacheName = typeof ALIGN_CACHE_NAMES[number];
export const isAlignCacheName = (v: unknown): v is AlignCacheName => ALIGN_CACHE_NAMES.includes(v as AlignCacheName);

/** Files a run of `source` writes (scripts/sync_*.cjs makeStore): the unified view reads the Qualinka cache for IdRef. */
export const cacheNamesOfSource = (source: PeopleAlignSource): AlignCacheName[] =>
  (source === 'idref' ? ['idref_align_qualinka_cache'] : [`${source}_align_cache` as AlignCacheName]);

type AnyDb = Kysely<any>;

export const readAlignCache = async (db: AnyDb, name: string): Promise<Record<string, any> | null> => {
  if (!isAlignCacheName(name)) return null;
  const row = await db.selectFrom('align_cache').select('data').where('name', '=', name).executeTakeFirst();
  return (row?.data as Record<string, any>) ?? null;
};

/** Upsert through the query builder: a raw statement would not be qualified by the schema of the tenant (withSchema). */
export const writeAlignCache = async (db: AnyDb, name: AlignCacheName, data: Record<string, any>): Promise<void> => {
  const json = JSON.stringify(data);
  await db.insertInto('align_cache').values({ name, data: sql`${json}::jsonb` })
    .onConflict((oc) => oc.column('name').doUpdateSet({ data: sql`excluded.data`, updated_at: sql`now()` })).execute();
};

/** The caches as the alignment commands read them (lib/directory/alignCommands.ts AlignCacheSource). */
export const alignCacheSourceOf = (db: AnyDb): AlignCacheSource => ({ read: (name) => readAlignCache(db, name) });
