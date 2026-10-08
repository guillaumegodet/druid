// PostgreSQL implementation of the directory repository (druid-internal docs/plan-migration-postgresql.md, lot 6 a):
// the same DirectoryRepository as the Grist one (lib/directory/repository.ts), checked against it by the contract
// tests (lib/__tests__/pgRepository.integration.test.ts). People go through the storage-independent rules of
// lib/directory/people.ts; structures keep their V2 (cdb) fields in `extra` and go through the same structure mapping.
//
// Version of the data = the last audit_log row: every write to an audited table adds one (deletes included), and the
// import adds one too. The mapped lists are cached on it, as the Grist repository caches them on the document date.
// `duplicates` and `recordRows` speak the record fields of the API (lib/directory/pg/recordFields.ts).
import { sql } from 'kysely';
import type { Db } from '../../db/client';
import { computeDuplicateGroups } from '../duplicates';
import { readRecords } from './recordFields';
import type { Researcher, Structure } from '../../../types';
import { normalizeAcronym } from '../../normalize';
import { mapDirectoryRows } from '../people';
import { mapStructureRecords, type AbesExportMark, type Institution, type MergeLogEntry } from '../gristMapping';
import type { DirectoryRepository, DirectoryScope, LdapCacheSnapshot, Versioned } from '../repository';
import { pgDirectoryRow, pgEmployerIndex, type PgIdentifier, type PgLink, type PgMembership, type PgPerson } from './directoryRows';

export interface PgDirectoryRepositoryOptions {
  db: Db;
  /** Instance without LDAP: omitted → empty cache. */
  loadLdapCache?: () => Promise<LdapCacheSnapshot>;
}

const inScope = (scope: DirectoryScope) => {
  const anchors = new Set(scope.labAnchors);
  return (lab: string | null) => scope.all || anchors.has(normalizeAcronym(String(lab || '')));
};

export const createPgDirectoryRepository = ({ db, loadLdapCache }: PgDirectoryRepositoryOptions): DirectoryRepository => {
  const ldap = async (): Promise<LdapCacheSnapshot> => (loadLdapCache ? loadLdapCache() : { data: {}, version: '' });

  /** Last audit row: id = version (cache key), date = `updatedAt` of the lists. */
  const version = async (): Promise<{ key: string; updatedAt: string }> => {
    const r = await sql<{ id: string | null; at: Date | null }>`SELECT id::text AS id, at FROM audit_log ORDER BY id DESC LIMIT 1`.execute(db);
    const row = r.rows[0];
    return { key: row?.id ?? '0', updatedAt: row?.at ? new Date(row.at).toISOString() : '' };
  };

  /** Every directory row (one per membership, Grist order = row id), with the employer index. */
  const loadRows = async () => {
    const [persons, memberships, identifiers, checks, links, establishments] = await Promise.all([
      db.selectFrom('person').selectAll().execute(),
      db.selectFrom('membership').select(['id', 'person_id', 'lab_label', 'type', 'role', 'start_date', 'end_date', 'team_labels']).orderBy('id').execute(),
      db.selectFrom('person_identifier').select(['person_id', 'scheme', 'value', 'is_primary', 'source']).orderBy('id').execute(),
      db.selectFrom('person_identifier_check').select(['person_id', 'scheme', 'result']).execute(),
      db.selectFrom('person_link').select(['person_id', 'kind', 'url']).orderBy('id').execute(),
      db.selectFrom('establishment').select(['id', 'name', 'uai', 'extra']).execute(),
    ]);
    const byPerson = <T extends { person_id: string }>(rows: T[]) => {
      const m = new Map<string, T[]>();
      for (const r of rows) { if (!m.has(r.person_id)) m.set(r.person_id, []); m.get(r.person_id)!.push(r); }
      return m;
    };
    const personOf = new Map(persons.map((p) => [p.id, p as unknown as PgPerson]));
    const idsOf = byPerson(identifiers as PgIdentifier[]);
    const linksOf = byPerson(links as PgLink[]);
    const absent = new Set(checks.filter((c) => c.scheme === 'scopus' && c.result === 'absent').map((c) => c.person_id));
    return {
      employers: pgEmployerIndex(establishments as any),
      rows: (memberships as unknown as PgMembership[]).map((m) => ({
        lab: m.lab_label,
        person: personOf.get(m.person_id)!,
        row: pgDirectoryRow(personOf.get(m.person_id)!, m, {
          identifiers: idsOf.get(m.person_id) || [], scopusAbsent: absent.has(m.person_id), links: linksOf.get(m.person_id) || [],
        }),
      })),
    };
  };

  /** Memberships → { id, fields } in the record fields of the API. */
  const recordsOf = (memberships: any[]) => readRecords(db, memberships);

  let rowsCache: { key: string; rows: Promise<Awaited<ReturnType<typeof loadRows>>> } | null = null;
  const rowsAt = (key: string) => {
    if (!rowsCache || rowsCache.key !== key) {
      const rows = loadRows();
      rowsCache = { key, rows };
      rows.catch(() => { if (rowsCache?.rows === rows) rowsCache = null; });
    }
    return rowsCache.rows;
  };
  let allPeople: { key: string; items: Researcher[] } | null = null;
  let structuresCache: { key: string; items: Structure[] } | null = null;

  return {
    async people(scope) {
      const [v, ldapCache] = await Promise.all([version(), ldap()]);
      const { rows, employers } = await rowsAt(v.key);
      if (scope.all) {
        const key = `${v.key}|${ldapCache.version}`;
        if (!allPeople || allPeople.key !== key) allPeople = { key, items: mapDirectoryRows(rows.map((r) => r.row), employers, ldapCache.data) };
        return { items: allPeople.items, updatedAt: v.updatedAt };
      }
      const keep = inScope(scope);
      return { items: mapDirectoryRows(rows.filter((r) => keep(r.lab)).map((r) => r.row), employers, ldapCache.data), updatedAt: v.updatedAt };
    },

    async structures() {
      const v = await version();
      if (!structuresCache || structuresCache.key !== v.key) {
        const rows = await db.selectFrom('structure').select(['id', 'local_id', 'extra']).orderBy('id').execute();
        // The V2 (cdb) fields of a structure, kept as they are in `extra`, plus its local id.
        structuresCache = { key: v.key, items: mapStructureRecords(rows.map((s) => ({ id: Number(s.id), fields: { ...(s.extra as object), local_id: s.local_id } }))) };
      }
      return { items: structuresCache.items, updatedAt: v.updatedAt };
    },

    async institutions() {
      const v = await version();
      const rows = await db.selectFrom('establishment').select(['id', 'name', 'uai', 'ror', 'idref', 'label', 'extra']).execute();
      const items: Institution[] = rows
        .map((r) => ({
          id: Number(r.id), name: r.name, uai: r.uai ?? String((r.extra as any)?.UAI ?? ''), ror: r.ror ?? '', idref: r.idref ?? '',
          label: r.label || r.name,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'fr') || a.id - b.id);
      return { items, updatedAt: v.updatedAt };
    },

    async merges(limit) {
      const v = await version();
      const rows = await db.selectFrom('merge_log')
        .select(['id', 'uid', 'legacy_kept_rowid', 'legacy_dropped_rowid', 'author', 'merged_at', 'note', 'restored', 'legacy_restored_rowid', 'extra'])
        .execute();
      const items: MergeLogEntry[] = rows
        .map((r) => ({
          id: Number(r.id), uid_dyna: r.uid ?? '', Nom: String((r.extra as any)?.Nom ?? ''),
          kept_rowid: r.legacy_kept_rowid as number, dropped_rowid: r.legacy_dropped_rowid as number,
          auteur: r.author ?? '', date: r.merged_at ? new Date(r.merged_at as any).toISOString() : String((r.extra as any)?.date ?? ''),
          note: r.note ?? '', restaure: r.restored, restored_rowid: r.legacy_restored_rowid ?? null,
        }))
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, limit);
      return { items, updatedAt: v.updatedAt };
    },

    async abesExports(scope) {
      const v = await version();
      const { rows } = await rowsAt(v.key);
      const keep = inScope(scope);
      const out: AbesExportMark[] = [];
      const seen = new Set<string>();
      for (const r of rows) {
        const e = r.person.extra || {};
        if (!keep(r.lab) || !e.ABES_export_hash || seen.has(r.person.id)) continue;
        seen.add(r.person.id);
        out.push({ key: r.person.uid || `g${r.person.legacy_grist_id}`, hash: String(e.ABES_export_hash), date: String(e.ABES_export_date || '') });
      }
      return { items: out, updatedAt: v.updatedAt };
    },

    async labsOfUid(uid, scope) {
      const rows = await db.selectFrom('membership as m').innerJoin('person as p', 'p.id', 'm.person_id')
        .select('m.lab_label').where('p.uid', '=', uid).orderBy('m.id').execute();
      const keep = inScope(scope);
      return rows.filter((r) => keep(r.lab_label)).map((r) => String(r.lab_label || '—'));
    },

    async duplicates(scope) {
      // A group = a person with several memberships (same uid on several rows): only those are read whole.
      const keep = inScope(scope);
      const memberships = (await db.selectFrom('membership').selectAll().orderBy('id').execute()).filter((m) => keep(m.lab_label));
      const count = new Map<string, number>();
      for (const m of memberships) count.set(m.person_id, (count.get(m.person_id) || 0) + 1);
      const multi = memberships.filter((m) => count.get(m.person_id)! > 1);
      const records = await recordsOf(multi);
      const { doublonsUid, duplicatesByKind } = computeDuplicateGroups(records);
      return {
        generatedAt: new Date().toISOString(),
        stats: { gristTotal: memberships.length, pending: doublonsUid.filter((d) => !d.qualified).length, qualified: doublonsUid.filter((d) => d.qualified).length, parKind: duplicatesByKind },
        doublonsUid,
      };
    },
    async recordRows(ids, scope) {
      if (ids.length === 0) return [];
      const keep = inScope(scope);
      const memberships = (await db.selectFrom('membership').selectAll().where('id', 'in', ids.map(String)).orderBy('id').execute()).filter((m) => keep(m.lab_label));
      return (await recordsOf(memberships)).map((r) => ({ rowId: r.id, fields: r.fields }));
    },

    invalidate() {
      rowsCache = null;
      allPeople = null;
      structuresCache = null;
    },
  };
};
