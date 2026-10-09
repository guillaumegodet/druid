// PostgreSQL implementation of the directory commands (druid-internal docs/plan-migration-postgresql.md, lot 6 b):
// record (creation, update with its memberships, groups, OpenAlex author id, validations, ABES marks) and structures.
// Same contract as the Grist commands (lib/directory/commands.ts): same checks, same errors, and the record read back
// afterwards is the same (contract tests: lib/__tests__/pgCommands.integration.test.ts). Each command is one
// transaction; the audit triggers record its writes with the author of the context (`druid.actor`).
//
// The record's person fields live on `person` (one per person), its memberships on `membership` (one per lab); a value
// the import kept in `extra` under a Grist column id (lib/migration/gristToPg.ts) is dropped as soon as the field is
// written. Duplicates and merges (lot 6 c) work on the record fields of the API (lib/directory/pg/recordFields.ts): the
// merge assistant reads and patches them, the merge log keeps them as snapshots.
import { sql, Transaction } from 'kysely';
import type { Affiliation, Researcher } from '../../../types';
import type { DB } from '../../db/schema.gen';
import type { Db } from '../../db/client';
import { ApiError } from '../errors';
import { normalizeAcronym } from '../../normalize';
import { normalizeFuzzyDate } from '../../dates';
import { normStatus, type ValidationInfo } from '../../validation';
import { normalizeHrId } from '../../hrId';
import { parseFteCell, FTE_COLUMNS } from '../../fte';
import { HR_ID_COLUMN } from '../../hrId';
import { STATUT_DYNA_MAP } from '../../ldapCodes';
import { fromGristDate, fromGristFuzzyDate, parseMultiLabel } from '../gristMapping';
import { planAffiliationRows, type AnnuaireColumnMeta } from '../annuaireWrite';
import { structureCreateFields, structureUpdateFields } from '../structureWrite';
import { buildMergeLogRow } from '../../mergeLog';
import { OPENALEX_AUTHOR_SOURCE, loadPersonParts, readRecordFields, resolveStructures, writeRecordFields } from './recordFields';
import { insertStructure, writeStructure } from './structures';
import type { CommandContext, DirectoryCommands } from '../commands';
import type { DirectoryRepository, DirectoryScope } from '../repository';

export interface PgDirectoryCommandsOptions {
  db: Db;
  /** Its cached reads are dropped after every write. */
  repository: DirectoryRepository;
  /** Today (YYYY-MM-DD), for the HISTORIQUE / SECONDAIRE qualification of the memberships. */
  today?: () => string;
}

export { OPENALEX_AUTHOR_SOURCE };
/** Record fields of a membership (as opposed to the person): what a restoration writes on a person that already exists. */
const MEMBERSHIP_FIELDS = ['LABO', 'team', 'affiliation_start_date', 'affiliation_end_date', 'membership_type', 'rattachement', 'doublon_decision'];

/**
 * Fields of a record, under the ids the client knows (former Annuaire columns): `GET /people/columns` tells the record
 * form which optional fields the instance has (FTE, staff number) and the merge assistant which fields it may write.
 */
export const RECORD_FIELDS: AnnuaireColumnMeta[] = [
  ...['uid_dyna', 'Nom', 'Prenom', 'Civilite', 'Email', 'Nationalite', 'Corps_grade', 'TYPE_EMPLOI', 'LIB_TYPE_EMPLOI', 'HDR', 'ANNEE_HDR',
    'ED_de_rattachement', 'statut_dyna', 'photo_url', 'annuaire_url', 'LABO', 'team', 'rattachement', 'membership_type', 'groupes',
    'ORCID', 'IdRef', 'IdRef_nom_valide', 'IdHAL', 'IdHAL_i', 'OpenAlex_ids', 'openalex_author_id', 'Bluesky', 'Mastodon', 'YouTube',
    'Podcast_flux', 'Blog', 'LinkedIn', 'CV_institutionnel', 'CV_site_labo', 'CV_pdf_docx_', 'CV_HAL', 'Academia', 'Researchgate',
    'Profil_GS', 'Site_web', 'Commentaires', 'Data_source', 'validated_status', 'validation_source', 'validation_scope', 'validated_by',
    'doublon_decision', 'ABES_export_hash', 'ABES_export_date']
    .map((id) => ({ id, label: id, type: 'Text', isFormula: false })),
  ...['employment_start_date', 'employment_end_date', 'affiliation_start_date', 'affiliation_end_date']
    .map((id) => ({ id, label: id, type: 'Text', isFormula: false })),
  { id: 'DATE_DE_NAISSANCE_JJ_MM_AAAA', label: 'DATE_DE_NAISSANCE_JJ_MM_AAAA', type: 'Date', isFormula: false },
  { id: 'validation_date', label: 'validation_date', type: 'Date', isFormula: false },
  { id: 'validated', label: 'validated', type: 'Bool', isFormula: false },
  { id: 'Employeur', label: 'Employeur', type: 'Ref:Etablissements', isFormula: false },
  { id: 'ID_SCOPUS', label: 'ID_SCOPUS', type: 'Numeric', isFormula: false },
  { id: HR_ID_COLUMN, label: HR_ID_COLUMN, type: 'Numeric', isFormula: false },
  { id: FTE_COLUMNS.fte, label: FTE_COLUMNS.fte, type: 'Numeric', isFormula: false },
  { id: FTE_COLUMNS.researchFte, label: FTE_COLUMNS.researchFte, type: 'Numeric', isFormula: false },
];

const isRowId = (id: unknown): id is number => Number.isInteger(id) && (id as number) > 0;
const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === '';
const orNull = (v: unknown): string | null => (blank(v) ? null : String(v));
const isoDate = (v: unknown): string | null => {
  const d = fromGristDate(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && normalizeFuzzyDate(d) === d ? d : null;
};
const fuzzy = (v: unknown): string | null => normalizeFuzzyDate(fromGristFuzzyDate(v)) || null;
const splitUrls = (v: unknown): string[] => (blank(v) ? [] : String(v).split(/\s*[;\n]\s*|,\s+(?=https?:\/\/)/).map((s) => s.trim()).filter(Boolean));

/** Web profiles of the record: field of the Researcher → link kind (and the Grist column the import named it after). */
const LINKS: { kind: string; column: string; of: (r: Researcher) => unknown }[] = [
  { kind: 'youtube', column: 'YouTube', of: (r) => r.socials?.youtube },
  { kind: 'podcast_flux', column: 'Podcast_flux', of: (r) => r.socials?.podcast },
  { kind: 'blog', column: 'Blog', of: (r) => r.socials?.blog },
  { kind: 'linkedin', column: 'LinkedIn', of: (r) => r.socials?.linkedin },
  { kind: 'cv_institutionnel', column: 'CV_institutionnel', of: (r) => r.profiles?.cvInstitutionnel },
  { kind: 'cv_site_labo', column: 'CV_site_labo', of: (r) => r.profiles?.cvSiteLabo },
  { kind: 'cv_pdf_docx', column: 'CV_pdf_docx_', of: (r) => r.profiles?.cvPdf },
  { kind: 'cv_hal', column: 'CV_HAL', of: (r) => r.profiles?.cvHal },
  { kind: 'academia', column: 'Academia', of: (r) => r.profiles?.academia },
  { kind: 'researchgate', column: 'Researchgate', of: (r) => r.profiles?.researchgate },
  { kind: 'profil_gs', column: 'Profil_GS', of: (r) => r.profiles?.googleScholar },
  { kind: 'site_web', column: 'Site_web', of: (r) => r.profiles?.website },
];

/** Identifiers of the record (primary value of each scheme). `create`: a creation writes them as they are. */
const identifiersOf = (r: Researcher): Record<string, unknown> => ({
  orcid: r.identifiers?.orcid, idref: r.identifiers?.idref, idhal: r.identifiers?.halId,
  idhal_i: r.identifiers?.halIdNum ? String(r.identifiers.halIdNum).replace(/\D/g, '') : '',
  scopus: r.identifiers?.scopusId, bluesky: r.socials?.bluesky, mastodon: r.socials?.mastodon,
});
/** extra keys (Grist column ids) that a written field replaces. */
const EXTRA_OF_SCHEME: Record<string, string[]> = { scopus: ['ID_SCOPUS'] };

/** Validation columns of a person (same rules as validationToGristFields: not validated → everything cleared). */
const validationColumns = (v: ValidationInfo | undefined) => (!v || !v.validated
  ? { presence_validated: false, presence_status: null, presence_validated_on: null, presence_validation_source: null,
    presence_validation_scope: [] as string[], presence_validated_by: null }
  : { presence_validated: true, presence_status: normStatus(v.validatedStatus) ?? null, presence_validated_on: v.validationDate ? isoDate(v.validationDate) : null,
    presence_validation_source: orNull(v.validationSource), presence_validation_scope: [...(v.validationScope || [])], presence_validated_by: orNull(v.validatedBy) });

export const createPgDirectoryCommands = ({ db, repository, today }: PgDirectoryCommandsOptions): DirectoryCommands => {
  const todayIso = today ?? (() => new Date().toISOString().slice(0, 10));
  const anchorsOf = (scope: DirectoryScope) => new Set(scope.labAnchors);

  /**
   * One transaction, audited under the author of the context; the repository caches are dropped afterwards. Given a
   * transaction (a job chaining commands, the contract tests), the command runs in a savepoint of it instead.
   */
  let savepoints = 0;
  const writing = async <T>(ctx: CommandContext, fn: (trx: Transaction<DB>) => Promise<T>): Promise<T> => {
    const run = async (trx: Transaction<DB>) => {
      await sql`SELECT set_config('druid.actor', ${ctx.actor ?? ''}, true)`.execute(trx);
      return fn(trx);
    };
    try {
      if (!db.isTransaction) return await db.transaction().execute(run);
      const trx = db as Transaction<DB>;
      const name = sql.raw(`druid_command_${++savepoints}`);
      await sql`SAVEPOINT ${name}`.execute(trx);
      try {
        const out = await run(trx);
        await sql`RELEASE SAVEPOINT ${name}`.execute(trx);
        return out;
      } catch (err) {
        await sql`ROLLBACK TO SAVEPOINT ${name}`.execute(trx);
        throw err;
      }
    } finally {
      repository.invalidate();
    }
  };

  // ── Scope checks (lab right), same messages as the Grist commands ─────────────────────────────────────────
  const assertLabsInScope = (scope: DirectoryScope, labs: unknown[]): void => {
    if (scope.all) return;
    const anchors = anchorsOf(scope);
    if (anchors.size === 0) throw new ApiError(403, 'Grist writes require the institution right');
    if (labs.some((v) => !anchors.has(normalizeAcronym(String(v ?? ''))))) throw new ApiError(403, 'Write outside scope: LABO');
  };
  /** Memberships of the given record ids, checked against the scope (unknown or outside → 403). */
  const membershipsInScope = async (trx: Transaction<DB>, scope: DirectoryScope, ids: number[]) => {
    if (!ids.every(isRowId)) throw new ApiError(400, 'Invalid Grist identifiers');
    const unique = [...new Set(ids)];
    const rows = unique.length ? await trx.selectFrom('membership').selectAll().where('id', 'in', unique.map(String)).execute() : [];
    if (!scope.all) {
      const anchors = anchorsOf(scope);
      if (anchors.size === 0) throw new ApiError(403, 'Grist writes require the institution right');
      const byId = new Map(rows.map((r) => [Number(r.id), r]));
      if (unique.some((id) => !byId.has(id) || !anchors.has(normalizeAcronym(String(byId.get(id)!.lab_label || ''))))) {
        throw new ApiError(403, 'Rows outside scope or unknown: Annuaire');
      }
    }
    return rows;
  };
  const personOfRecord = async (trx: Transaction<DB>, scope: DirectoryScope, recordId: number) => {
    const [m] = await membershipsInScope(trx, scope, [recordId]);
    if (!m) throw new ApiError(404, `Record not found in Grist: uid ${recordId}`);
    return trx.selectFrom('person').selectAll().where('id', '=', m.person_id).executeTakeFirstOrThrow();
  };

  // ── Structures of the lab and team labels (membership.structure_id, membership_team) ─────────────────────
  const structureLinks = resolveStructures;
  const membershipValues = async (trx: Transaction<DB>, a: Affiliation | undefined) => {
    const lab = String(a?.structureName || '');
    const teams = String(a?.team || '').split('|').map((t) => t.trim()).filter(Boolean);
    const links = await structureLinks(trx, lab, teams);
    return {
      values: {
        lab_label: lab || null, team_labels: teams, start_date: fuzzy(a?.startDate), end_date: fuzzy(a?.endDate),
        type: orNull(a?.membershipType), structure_id: links.structureId,
      },
      teamIds: links.teamIds,
    };
  };
  const writeMembership = async (trx: Transaction<DB>, membershipId: string, a: Affiliation | undefined, role: string | null | undefined,
    personExtra: Record<string, any>) => {
    const { values, teamIds } = await membershipValues(trx, a);
    await trx.updateTable('membership').set({ ...values, ...(role !== undefined ? { role } : {}) }).where('id', '=', membershipId).execute();
    await trx.deleteFrom('membership_team').where('membership_id', '=', membershipId).execute();
    if (teamIds.length) await trx.insertInto('membership_team').values(teamIds.map((t) => ({ membership_id: membershipId, team_structure_id: t }))).execute();
    // Unreadable membership values the import kept for this row are replaced.
    for (const k of Object.keys(personExtra)) if (k.endsWith(`@G-${membershipId}`)) delete personExtra[k];
  };
  const addMembership = async (trx: Transaction<DB>, personId: string, a: Affiliation | undefined, role: string | null) => {
    const { values, teamIds } = await membershipValues(trx, a);
    const { id } = await trx.insertInto('membership').values({ person_id: personId, ...values, role }).returning('id').executeTakeFirstOrThrow();
    if (teamIds.length) await trx.insertInto('membership_team').values(teamIds.map((t) => ({ membership_id: id, team_structure_id: t }))).execute();
    return Number(id);
  };

  // ── Person fields ─────────────────────────────────────────────────────────────────────────────────────────
  /** Employer of the record: resolved by label (empty → none; a label outside the list leaves it untouched). */
  const employerOf = async (trx: Transaction<DB>, employer?: string): Promise<{ id: string | null } | undefined> => {
    const name = (employer || '').trim();
    if (!name) return { id: null };
    const match = await trx.selectFrom('establishment').select('id').where('name', '=', name).executeTakeFirst();
    return match ? { id: match.id } : undefined;
  };
  /** Person columns written by the record form (creation and update), and the extra keys they replace. */
  const personColumns = async (trx: Transaction<DB>, r: Researcher) => {
    const civility = String(r.civility || '').trim();
    const employer = await employerOf(trx, r.employment?.employer);
    const values: Record<string, any> = {
      last_name: String(r.lastName ?? ''), first_name: orNull(r.firstName),
      civility: civility === 'F' || civility === 'M' ? civility : null,
      email: orNull(r.email), nationality: orNull(r.nationality), birth_date: isoDate(r.birthDate),
      employment_start: fuzzy(r.employment?.startDate), employment_end: fuzzy(r.employment?.endDate),
      corps_grade: orNull(r.employment?.grade), employment_type: orNull(r.employment?.contractType),
      fte_ratio: parseFteCell(r.employment?.fte), fte_research: parseFteCell(r.employment?.researchFte),
      photo_url: orNull(String(r.photoUrl ?? '').trim()),
      // Lab website directory page: written by the site imports only (the record form does not edit it).
      ...(String(r.annuaireUrl ?? '').trim() ? { directory_url: String(r.annuaireUrl).trim() } : {}),
      ...validationColumns(r.validation),
      ...(employer ? { employer_id: employer.id } : {}),
    };
    const replaced = ['Civilite', 'DATE_DE_NAISSANCE_JJ_MM_AAAA', 'employment_start_date', 'employment_end_date', 'validated_status',
      'validation_date', ...(employer ? ['Employeur'] : []), ...LINKS.map((l) => l.column)];
    // A civility outside F / M is kept as typed (the record shows it normalized, like a Grist cell).
    const extra: Record<string, any> = civility && !values.civility ? { Civilite: civility } : {};
    return { values, replaced, extra };
  };
  const writeIdentifiers = async (trx: Transaction<DB>, personId: string, r: Researcher, extra: Record<string, any>) => {
    for (const [scheme, raw] of Object.entries(identifiersOf(r))) {
      const value = blank(raw) ? '' : String(raw).trim();
      for (const k of EXTRA_OF_SCHEME[scheme] || []) delete extra[k];
      if (scheme === 'scopus') await trx.deleteFrom('person_identifier_check').where('person_id', '=', personId).where('scheme', '=', 'scopus').execute();
      await trx.deleteFrom('person_identifier').where('person_id', '=', personId).where('scheme', '=', scheme).where('is_primary', '=', true)
        .where('value', '<>', value).execute();
      if (!value) continue;
      if (scheme === 'scopus' && value.toLowerCase() === 'absent') {
        await trx.insertInto('person_identifier_check').values({ person_id: personId, scheme: 'scopus', result: 'absent' }).execute();
        continue;
      }
      await trx.insertInto('person_identifier').values({ person_id: personId, scheme, value, is_primary: true, source: 'record' })
        .onConflict((oc) => oc.columns(['person_id', 'scheme', 'value']).doUpdateSet({ is_primary: true })).execute();
    }
  };
  const writeLinks = async (trx: Transaction<DB>, personId: string, r: Researcher, extra: Record<string, any>) => {
    for (const l of LINKS) {
      const cell = String(l.of(r) ?? '');
      const urls = splitUrls(cell);
      await trx.deleteFrom('person_link').where('person_id', '=', personId).where('kind', '=', l.kind).execute();
      if (urls.length) await trx.insertInto('person_link').values([...new Set(urls)].map((url) => ({ person_id: personId, kind: l.kind, url }))).execute();
      // The record shows the field as typed (several URLs, other separators): kept when the list reads differently.
      if (urls.join('; ') !== cell) extra[l.column] = cell; else delete extra[l.column];
    }
  };


  return {
    annuaireColumns: async () => RECORD_FIELDS,

    createPerson: (researcher, ctx) => writing(ctx, async (trx) => {
      const affiliation = researcher.affiliations?.[0];
      assertLabsInScope(ctx.scope, [affiliation?.structureName || '']);
      const uid = String(researcher.uid || '').trim();
      // A uid already in the directory: the new record is a new membership of that person (a row of the same uid,
      // as a second Grist row was; the Doublons page qualifies or merges it).
      const existing = uid ? await trx.selectFrom('person').select(['id']).where(sql`lower(uid)`, '=', uid.toLowerCase()).executeTakeFirst() : undefined;
      let personId = existing?.id;
      if (!personId) {
        const { values, extra } = await personColumns(trx, researcher);
        const prefill = researcher.ldapPrefill;
        const inserted = await trx.insertInto('person').values({
          ...values, uid: uid || null, extra: JSON.stringify(extra) as any,
          ...(prefill ? {
            ldap_state: STATUT_DYNA_MAP[prefill.etat.toUpperCase()] || prefill.etat || null, sources: ['LDAP'],
            hr_id: normalizeHrId(researcher.hrId) || null,
          } : researcher.importSource ? { sources: [researcher.importSource] } : {}),
        } as any).returning('id').executeTakeFirstOrThrow();
        personId = inserted.id;
        const personExtra: Record<string, any> = { ...extra };
        await writeIdentifiers(trx, personId, researcher, personExtra);
        await writeLinks(trx, personId, researcher, personExtra);
        await trx.updateTable('person').set({ extra: JSON.stringify(personExtra) as any }).where('id', '=', personId).execute();
        if (prefill?.date) await trx.insertInto('sync_state').values({ person_id: personId, source: 'ldap', last_run: isoDate(prefill.date), changed_fields: [] }).execute();
      }
      const recordId = await addMembership(trx, personId, affiliation, null);
      ctx.audit({ table: 'Annuaire', kind: 'create', rows: [recordId], count: 1 });
      return { recordId };
    }),

    updatePerson: (recordId, researcher, ctx) => writing(ctx, async (trx) => {
      if (!isRowId(recordId)) throw new ApiError(400, 'Invalid Grist ID (gristRowId missing)');
      const person = await personOfRecord(trx, ctx.scope, recordId);
      // The person's other memberships the scope sees (a lab right only rewrites the rows of its labs).
      const anchors = anchorsOf(ctx.scope);
      const siblings = (await trx.selectFrom('membership').selectAll().where('person_id', '=', person.id).orderBy('id').execute())
        .filter((m) => Number(m.id) !== recordId)
        .filter((m) => ctx.scope.all || anchors.has(normalizeAcronym(String(m.lab_label || ''))));
      const qualified = siblings.filter((m) => m.role).map((m) => Number(m.id));
      const plan = planAffiliationRows(recordId, researcher.affiliations || [], qualified, todayIso());
      if (plan.patches.length + plan.creates.length > 0) {
        if (!person.uid) throw new ApiError(400, 'Several affiliations can only be saved for a person with a directory identifier (uid_dyna).');
        if (qualified.length < siblings.length) {
          throw new ApiError(409, 'This person has other directory rows not yet qualified: resolve them on the Duplicates page before adding an affiliation.');
        }
      }
      // Every check before the first write.
      await membershipsInScope(trx, ctx.scope, [recordId, ...plan.patches.map((p) => p.rowId), ...plan.deletes]);
      assertLabsInScope(ctx.scope, [plan.primary?.structureName || '', ...plan.patches.map((p) => p.affiliation.structureName || ''),
        ...plan.creates.map((c) => c.affiliation.structureName || '')]);

      // Record fields of the rows about to be deleted, read before any write (merge log snapshots).
      const droppedRows = siblings.filter((m) => plan.deletes.includes(Number(m.id)));
      const parts = droppedRows.length ? (await loadPersonParts(trx, [person.id])).get(person.id)! : null;
      const droppedFields = droppedRows.map((m) => ({ rowId: Number(m.id), fields: readRecordFields(person, m, parts!) }));

      const { values, replaced, extra } = await personColumns(trx, researcher);
      const personExtra: Record<string, any> = { ...(person.extra as object) };
      for (const k of replaced) delete personExtra[k];
      Object.assign(personExtra, extra);
      await trx.updateTable('person').set(values as any).where('id', '=', person.id).execute();
      await writeIdentifiers(trx, person.id, researcher, personExtra);
      await writeLinks(trx, person.id, researcher, personExtra);

      await writeMembership(trx, String(recordId), plan.primary, plan.mainRole === undefined ? undefined : (plan.mainRole || null), personExtra);
      for (const p of plan.patches) await writeMembership(trx, String(p.rowId), p.affiliation, p.role, personExtra);
      const created: number[] = [];
      for (const c of plan.creates) created.push(await addMembership(trx, person.id, c.affiliation, c.role));
      if (plan.deletes.length > 0) {
        // Snapshot in the merge log before deleting (restorable like a merge).
        const keep = { rowId: recordId, fields: { uid_dyna: person.uid ?? '', Nom: researcher.lastName, Prenom: researcher.firstName } };
        for (const drop of droppedFields) {
          await insertMergeLog(trx, buildMergeLogRow({ keep, drop, patch: {}, author: 'druid', note: 'affiliation removed from the record' }), person.id);
        }
        await trx.deleteFrom('membership').where('id', 'in', plan.deletes.map(String)).execute();
      }
      await trx.updateTable('person').set({ extra: JSON.stringify(personExtra) as any }).where('id', '=', person.id).execute();
      ctx.audit({ table: 'Annuaire', kind: 'update', rows: [recordId, ...plan.patches.map((p) => p.rowId)], count: 1 + plan.patches.length });
      if (created.length) ctx.audit({ table: 'Annuaire', kind: 'create', rows: created, count: created.length });
      if (plan.deletes.length) ctx.audit({ table: 'Annuaire', kind: 'delete', rows: plan.deletes, count: plan.deletes.length });
    }),

    setGroups: (entries, ctx) => writing(ctx, async (trx) => {
      const valid = entries.filter((e) => isRowId(e.recordId));
      if (valid.length === 0) return;
      const rows = await membershipsInScope(trx, ctx.scope, valid.map((e) => e.recordId));
      const personOf = new Map(rows.map((m) => [Number(m.id), m.person_id]));
      for (const e of valid) {
        await trx.updateTable('person').set({ extra: sql`extra || jsonb_build_object('groupes', ${e.groups.join('|')}::text)` as any })
          .where('id', '=', personOf.get(e.recordId)!).execute();
      }
      ctx.audit({ table: 'Annuaire', kind: 'update', rows: valid.map((e) => e.recordId), fields: ['groupes'], count: valid.length });
    }),

    setOpenalexId: (recordId, openalexId, ctx) => writing(ctx, async (trx) => {
      const person = await personOfRecord(trx, ctx.scope, recordId);
      await trx.deleteFrom('person_identifier').where('person_id', '=', person.id).where('source', '=', OPENALEX_AUTHOR_SOURCE).execute();
      const value = String(openalexId || '').trim();
      if (value) {
        await trx.insertInto('person_identifier').values({ person_id: person.id, scheme: 'openalex', value, is_primary: false, source: OPENALEX_AUTHOR_SOURCE })
          .onConflict((oc) => oc.columns(['person_id', 'scheme', 'value']).doUpdateSet({ source: OPENALEX_AUTHOR_SOURCE })).execute();
      }
      ctx.audit({ table: 'Annuaire', kind: 'update', rows: [recordId], fields: ['openalex_author_id'], count: 1 });
    }),

    applyValidations: (entries, ctx) => writing(ctx, async (trx) => {
      const valid = entries.filter((e) => isRowId(e.recordId));
      if (valid.length === 0) return 0;
      const rows = await membershipsInScope(trx, ctx.scope, valid.map((e) => e.recordId));
      const personOf = new Map(rows.map((m) => [Number(m.id), m.person_id]));
      for (const e of valid) {
        await trx.updateTable('person').set({ ...validationColumns(e.validation), extra: sql`extra - 'validated_status' - 'validation_date'` as any } as any)
          .where('id', '=', personOf.get(e.recordId)!).execute();
      }
      ctx.audit({ table: 'Annuaire', kind: 'update', rows: valid.map((e) => e.recordId), count: valid.length });
      return valid.length;
    }),

    markAbesSent: (entries, date, ctx) => writing(ctx, async (trx) => {
      const valid = entries.filter((e) => isRowId(e.recordId));
      const rows = await membershipsInScope(trx, ctx.scope, valid.map((e) => e.recordId));
      const personOf = new Map(rows.map((m) => [Number(m.id), m.person_id]));
      for (const e of valid) {
        await trx.updateTable('person').set({ extra: sql`extra || jsonb_build_object('ABES_export_hash', ${e.hash}::text, 'ABES_export_date', ${date}::text)` as any })
          .where('id', '=', personOf.get(e.recordId)!).execute();
      }
      if (valid.length) ctx.audit({ table: 'Annuaire', kind: 'update', rows: valid.map((e) => e.recordId), fields: ['ABES_export_hash', 'ABES_export_date'], count: valid.length });
      return valid.length;
    }),

    createStructure: (structure, ctx) => writing(ctx, async (trx) => {
      // Uniqueness checked against every structure (the browser only knew the ones it could see).
      const fields = structureCreateFields(structure, (await repository.structures()).items, todayIso());
      assertStructureLabels(ctx.scope, [fields['short_labels']]);
      const id = await insertStructure(trx, fields);
      ctx.audit({ table: 'Structures', kind: 'create', rows: [id], count: 1 });
      return { id: `S-${id}` };
    }),

    updateStructure: (recordId, structure, ctx) => writing(ctx, async (trx) => {
      if (!isRowId(recordId)) throw new ApiError(400, 'Invalid Grist identifiers');
      const fields = structureUpdateFields(structure);
      const current = await trx.selectFrom('structure').selectAll().where('id', '=', String(recordId)).executeTakeFirst();
      assertStructureLabels(ctx.scope, [fields['short_labels']]);
      if (!ctx.scope.all && (!current || !anchorsOf(ctx.scope).has(normalizeAcronym(parseMultiLabel((current.extra as any)?.short_labels))))) {
        throw new ApiError(403, 'Rows outside scope or unknown: Structures');
      }
      if (!current) throw new ApiError(404, `Structure not found: S-${recordId}`);
      await writeStructure(trx, recordId, { ...(current.extra as object), local_id: current.local_id, ...fields });
      ctx.audit({ table: 'Structures', kind: 'update', rows: [recordId], fields: Object.keys(fields), count: 1 });
    }),

    /**
     * Qualifies a group of rows sharing a uid: `concomitant` → the chosen row PRINCIPAL, the others SECONDAIRE;
     * `successif` → the others HISTORIQUE (+ membership end when given and no end known); `a_revoir` → no role,
     * « A_REVOIR » decision. Trace on each row: « <MODE> <date> <author> ». Rows outside the scope are left out.
     */
    qualifyDuplicates: ({ rowIds, principalRowId, mode, endDate, author }, ctx) => writing(ctx, async (trx) => {
      if (mode !== 'a_revoir' && (principalRowId === undefined || !rowIds.includes(principalRowId))) {
        throw new ApiError(400, 'Qualification: primary row required');
      }
      if (!rowIds.every(isRowId)) throw new ApiError(400, 'Invalid Grist identifiers');
      const decision = `${mode === 'a_revoir' ? 'A_REVOIR' : mode === 'concomitant' ? 'CONCOMITANT' : 'SUCCESSIF'} ${todayIso()} ${author}`;
      const rows = await rowsInScope(trx, ctx.scope, rowIds);
      for (const m of rows) {
        const set: Record<string, any> = { duplicate_decision: decision };
        if (mode === 'a_revoir') set.role = null;
        else if (Number(m.id) === principalRowId) set.role = 'PRINCIPAL';
        else {
          set.role = mode === 'concomitant' ? 'SECONDAIRE' : 'HISTORIQUE';
          // Successive affiliation: the end of the old row is a lab membership end.
          if (mode === 'successif' && endDate) {
            const person = await trx.selectFrom('person').select(['employment_end', 'extra']).where('id', '=', m.person_id).executeTakeFirstOrThrow();
            const e = (person.extra || {}) as Record<string, any>;
            const known = m.end_date || e[`affiliation_end_date@G-${m.id}`] || person.employment_end || e.employment_end_date;
            const d = fuzzy(endDate);
            if (!known && d) set.end_date = d;
          }
        }
        await trx.updateTable('membership').set(set).where('id', '=', m.id).execute();
      }
      ctx.audit({ table: 'Annuaire', kind: 'update', rows: rows.map((m) => Number(m.id)), fields: ['rattachement', 'doublon_decision'], count: rows.length });
      return { updated: rows.length };
    }),

    /** Removes the qualification of a group (roles and decision cleared) → a pending duplicate again. */
    unqualifyDuplicates: (rowIds, ctx) => writing(ctx, async (trx) => {
      await membershipsInScope(trx, ctx.scope, rowIds);
      if (rowIds.length) await trx.updateTable('membership').set({ role: null, duplicate_decision: null }).where('id', 'in', rowIds.map(String)).execute();
      ctx.audit({ table: 'Annuaire', kind: 'update', rows: rowIds, fields: ['rattachement', 'doublon_decision'], count: rowIds.length });
      return { updated: rowIds.length };
    }),

    /**
     * Moves a record to its LDAP uid (`annuaire_uid_ldap` task): the person of `fromUid` (or of the row `rowId` of a
     * record without uid) gets `toUid`, with a dated line in its notes keeping the former uid. Refused when a person
     * already carries `toUid`: that case is a merge.
     */
    switchUid: ({ fromUid, rowId, toUid, author }, ctx) => writing(ctx, async (trx) => {
      if (!toUid || toUid.startsWith('ext_')) throw new ApiError(400, `Invalid LDAP uid: ${toUid}`);
      if (await trx.selectFrom('person').select('id').where(sql`lower(uid)`, '=', toUid.toLowerCase()).executeTakeFirst()) {
        throw new ApiError(409, `This uid already has a directory record, merge the two records instead: ${toUid}`);
      }
      const rows = fromUid
        ? await rowsInScope(trx, ctx.scope, (await trx.selectFrom('membership as m').innerJoin('person as p', 'p.id', 'm.person_id')
          .select('m.id').where('p.uid', '=', fromUid).execute()).map((r) => Number(r.id)))
        : rowId ? await rowsInScope(trx, ctx.scope, [rowId]) : [];
      if (!rows.length) throw new ApiError(404, `Record not found in Grist: uid ${fromUid || '—'}`);
      const note = `[${todayIso()}] uid ${fromUid || '(vide)'} → ${toUid} (n° agent = compte LDAP), par ${author}`;
      for (const personId of [...new Set(rows.map((m) => m.person_id))]) {
        const p = await trx.selectFrom('person').select('note').where('id', '=', personId).executeTakeFirstOrThrow();
        const com = String(p.note || '').trimEnd();
        await trx.updateTable('person').set({ uid: toUid, note: com ? `${com}\n${note}` : note }).where('id', '=', personId).execute();
      }
      ctx.audit({ table: 'Annuaire', kind: 'update', rows: rows.map((m) => Number(m.id)), fields: ['uid_dyna', 'Commentaires'], count: rows.length });
      return { updated: rows.length };
    }),

    /**
     * Merges two directory rows: logs (record fields of the absorbed row + previous values of the fields written on
     * the kept row), writes the patch on the kept row, then deletes the absorbed membership — and its person when it
     * has no other membership. The log exists before any destructive write.
     */
    mergeRows: ({ keepRowId, dropRowId, fields, author, note = '' }, ctx) => writing(ctx, async (trx) => {
      if (keepRowId === dropRowId) throw new ApiError(400, 'Merge: both rows are identical');
      if (![keepRowId, dropRowId].every(isRowId)) throw new ApiError(400, 'Invalid Grist identifiers');
      const rows = await rowsInScope(trx, ctx.scope, [keepRowId, dropRowId]);
      const keepM = rows.find((m) => Number(m.id) === keepRowId);
      const dropM = rows.find((m) => Number(m.id) === dropRowId);
      if (!keepM || !dropM) throw new ApiError(404, 'Merge: one of the rows no longer exists in Grist');
      const writable = new Set(RECORD_FIELDS.filter((c) => !c.isFormula).map((c) => c.id));
      const patch: Record<string, any> = {};
      for (const [k, v] of Object.entries(fields || {})) if (writable.has(k)) patch[k] = v;
      if (patch['LABO'] !== undefined) assertLabsInScope(ctx.scope, [patch['LABO']]);
      const [keep, drop] = await recordsOf(trx, [keepM, dropM]);
      const logId = await insertMergeLog(trx, buildMergeLogRow({ keep, drop, patch, author, note }), keepM.person_id);
      // The absorbed row goes first (with its person when it has no other membership): the kept row often takes its
      // uid or its identifiers, which two people cannot hold at once (Grist allowed it between two requests).
      await trx.deleteFrom('membership').where('id', '=', dropM.id).execute();
      if (dropM.person_id !== keepM.person_id) {
        const left = await trx.selectFrom('membership').select('id').where('person_id', '=', dropM.person_id).executeTakeFirst();
        if (!left) await trx.deleteFrom('person').where('id', '=', dropM.person_id).execute();
      }
      if (Object.keys(patch).length > 0) await writeRecordFields(trx, keepM.person_id, String(keepM.id), patch);
      ctx.audit({ table: 'Annuaire', kind: 'delete', rows: [dropRowId], count: 1 });
      return { logId };
    }),

    /**
     * Undoes a merge: re-creates the absorbed row from its snapshot (a new membership — of the person of its uid when
     * it still exists, otherwise of a new person) and restores the previous values of the fields written on the kept
     * row. The log is flagged as soon as the row exists again.
     */
    restoreMerge: (logId, ctx) => writing(ctx, async (trx) => {
      if (!isRowId(logId)) throw new ApiError(400, 'Invalid Grist identifiers');
      const log = await trx.selectFrom('merge_log').selectAll().where('id', '=', String(logId)).executeTakeFirst();
      if (!log) throw new ApiError(404, `Merge not found: ${logId}`);
      if (log.restored) throw new ApiError(409, `Merge already restored: ${logId}`);
      const writable = new Set(RECORD_FIELDS.filter((c) => !c.isFormula).map((c) => c.id));
      const fields: Record<string, any> = {};
      for (const [k, v] of Object.entries((log.dropped_snapshot || {}) as Record<string, any>)) if (writable.has(k) && v !== null) fields[k] = v;
      const before = (log.kept_before || {}) as Record<string, any>;
      const keptRowId = Number(log.legacy_kept_rowid);
      // Every check before the first write: re-created row and restored kept row within the scope.
      assertLabsInScope(ctx.scope, [fields['LABO']]);
      let kept: any;
      if (Object.keys(before).length > 0) {
        [kept] = await membershipsInScope(trx, ctx.scope, [keptRowId]);
        if (before['LABO'] !== undefined) assertLabsInScope(ctx.scope, [before['LABO']]);
      }
      const uid = String(fields['uid_dyna'] || '').trim();
      const existing = uid ? await trx.selectFrom('person').select('id').where(sql`lower(uid)`, '=', uid.toLowerCase()).executeTakeFirst() : undefined;
      const personId = existing?.id
        ?? (await trx.insertInto('person').values({ last_name: String(fields['Nom'] ?? '') }).returning('id').executeTakeFirstOrThrow()).id;
      const { id: membershipId } = await trx.insertInto('membership').values({ person_id: personId }).returning('id').executeTakeFirstOrThrow();
      // An existing person keeps its own fields: only the membership comes back.
      const written = existing ? Object.fromEntries(Object.entries(fields).filter(([k]) => MEMBERSHIP_FIELDS.includes(k))) : fields;
      await writeRecordFields(trx, personId, membershipId, written);
      const restoredRowId = Number(membershipId);
      await trx.updateTable('merge_log').set({ restored: true, restored_person_id: personId, legacy_restored_rowid: restoredRowId }).where('id', '=', String(logId)).execute();
      if (kept) await writeRecordFields(trx, kept.person_id, String(kept.id), before);
      ctx.audit({ table: 'Annuaire', kind: 'create', rows: [restoredRowId], count: 1 });
      return { restoredRowId };
    }),
  };

  // ── Duplicates and merges ─────────────────────────────────────────────────────────────────────────────────
  /** Memberships of the given ids that the scope sees (the others are left out, as the Grist commands do). */
  async function rowsInScope(trx: Transaction<DB>, scope: DirectoryScope, ids: number[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return [];
    const anchors = anchorsOf(scope);
    return (await trx.selectFrom('membership').selectAll().where('id', 'in', unique.map(String)).orderBy('id').execute())
      .filter((m) => scope.all || anchors.has(normalizeAcronym(String(m.lab_label || ''))));
  }
  /** Memberships → { rowId, fields } in the record fields of the API. */
  async function recordsOf(trx: Transaction<DB>, memberships: any[]) {
    const personIds = [...new Set(memberships.map((m) => m.person_id))];
    const persons = new Map((await trx.selectFrom('person').selectAll().where('id', 'in', personIds).execute()).map((p) => [p.id, p]));
    const parts = await loadPersonParts(trx, personIds);
    return memberships.map((m) => ({ rowId: Number(m.id), fields: readRecordFields(persons.get(m.person_id)!, m, parts.get(m.person_id)!) }));
  }
  /** A row of buildMergeLogRow (lib/mergeLog.ts) → merge_log. */
  async function insertMergeLog(trx: Transaction<DB>, row: Record<string, any>, keptPersonId: string): Promise<number> {
    const { id } = await trx.insertInto('merge_log').values({
      uid: row.uid_dyna || null, kept_person_id: keptPersonId, dropped_snapshot: row.dropped_json, kept_before: row.kept_before_json,
      kept_patch: row.kept_patch_json, author: row.auteur, note: row.note || null, merged_at: row.date, restored: false,
      legacy_kept_rowid: row.kept_rowid, legacy_dropped_rowid: row.dropped_rowid, extra: JSON.stringify({ Nom: row.Nom }),
    } as any).returning('id').executeTakeFirstOrThrow();
    return Number(id);
  }

  // ── Structures (their V2 fields live in `extra`, the normalized columns are derived from them) ─────────────
  function assertStructureLabels(scope: DirectoryScope, labels: unknown[]): void {
    if (scope.all) return;
    const anchors = anchorsOf(scope);
    if (anchors.size === 0) throw new ApiError(403, 'Grist writes require the institution right');
    if (labels.some((v) => !anchors.has(normalizeAcronym(parseMultiLabel(v))))) throw new ApiError(403, 'Write outside scope: short_labels');
  }

};

