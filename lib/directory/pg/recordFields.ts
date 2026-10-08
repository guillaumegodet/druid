// Record fields ⇄ PostgreSQL (druid-internal docs/plan-migration-postgresql.md, lot 6 c). The API represents one
// directory row — a person in one lab — as « record fields » named after the former Annuaire columns: GET
// /people/rows (merge assistant), the duplicate groups, the merge patch and the merge log snapshots use that format,
// and the browser's merge rules (lib/mergeProposal.ts) work on it. This module reads those fields from a person and one
// of its memberships, with the cell types the assistant expects (dates as epoch seconds, employer and Scopus as
// numbers), and writes a set of them back to the person, its identifiers, links, sync traces and the membership.
// A value the import kept in `extra` (lib/migration/gristToPg.ts) is read back as it was and dropped once rewritten.
import { sql, Transaction } from 'kysely';
import type { DB } from '../../db/schema.gen';
import { normalizeAcronym } from '../../normalize';
import { normalizeFuzzyDate } from '../../dates';
import { normStatus, parseValidationScope } from '../../validation';
import { HR_ID_COLUMN, normalizeHrId } from '../../hrId';
import { parseFteCell, FTE_COLUMNS } from '../../fte';
import { fromGristDate, fromGristFuzzyDate } from '../gristMapping';
import { toGristEpoch } from '../annuaireWrite';
import type { PgIdentifier, PgLink } from './directoryRows';

/** Source of an OpenAlex author id typed in the record (the import uses the same tag). */
export const OPENALEX_AUTHOR_SOURCE = 'grist:openalex_author_id';
const OPENALEX_LIST_SOURCE = 'grist:OpenAlex_ids';

/** Person text columns, by record field. */
const PERSON_TEXT: Record<string, string> = {
  Nom: 'last_name', Prenom: 'first_name', Email: 'email', Nationalite: 'nationality', Corps_grade: 'corps_grade',
  TYPE_EMPLOI: 'employment_type', LIB_TYPE_EMPLOI: 'employment_type_label', HDR: 'hdr', ED_de_rattachement: 'doctoral_school',
  statut_dyna: 'ldap_state', photo_url: 'photo_url', annuaire_url: 'directory_url', validation_source: 'presence_validation_source',
  validated_by: 'presence_validated_by', Commentaires: 'note',
};
/** Primary identifiers, by record field. */
const IDENTIFIER_FIELDS: Record<string, string> = {
  ORCID: 'orcid', IdRef: 'idref', IdRef_nom_valide: 'idref_name_validated', IdHAL: 'idhal', IdHAL_i: 'idhal_i', ID_SCOPUS: 'scopus',
  Bluesky: 'bluesky', Mastodon: 'mastodon',
};
/** Web profiles, by record field. */
export const LINK_FIELDS: Record<string, string> = {
  CV_institutionnel: 'cv_institutionnel', CV_site_labo: 'cv_site_labo', CV_pdf_docx_: 'cv_pdf_docx', CV_HAL: 'cv_hal', Academia: 'academia',
  Researchgate: 'researchgate', Profil_GS: 'profil_gs', LinkedIn: 'linkedin', Site_web: 'site_web', YouTube: 'youtube', Blog: 'blog',
  Podcast_flux: 'podcast_flux',
};
const SYNC_SOURCES = ['LDAP', 'IdRef', 'HAL', 'ORCID', 'OpenAlex', 'Scopus'];
const ROLES = ['PRINCIPAL', 'SECONDAIRE', 'HISTORIQUE'];

const blank = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const has = (o: Record<string, any>, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const epochOf = (iso: string | null) => (iso ? toGristEpoch(iso) : null);

/** What a person carries besides its own columns (loaded once for a set of people). */
export interface PersonParts {
  identifiers: PgIdentifier[];
  scopusAbsent: boolean;
  links: PgLink[];
  sync: { source: string; last_run: string | null; changed_fields: string[] }[];
}

/** Record fields of one membership of a person. */
export const readRecordFields = (p: Record<string, any>, m: Record<string, any>, parts: PersonParts): Record<string, any> => {
  const e: Record<string, any> = p.extra || {};
  const rowId = Number(m.id);
  const out: Record<string, any> = {};
  // Columns without a normalized home first (human columns, groups, ABES marks…), then everything normalized.
  for (const [k, v] of Object.entries(e)) if (!k.includes('@G-')) out[k] = v;
  for (const [field, col] of Object.entries(PERSON_TEXT)) out[field] = p[col] ?? '';
  out.uid_dyna = p.uid ?? '';
  out.Civilite = has(e, 'Civilite') ? e.Civilite : (p.civility ?? '');
  out.DATE_DE_NAISSANCE_JJ_MM_AAAA = has(e, 'DATE_DE_NAISSANCE_JJ_MM_AAAA') ? e.DATE_DE_NAISSANCE_JJ_MM_AAAA : epochOf(p.birth_date);
  out.ANNEE_HDR = has(e, 'ANNEE_HDR') ? e.ANNEE_HDR : (p.hdr_year !== null && p.hdr_year !== undefined ? String(p.hdr_year) : '');
  out.Employeur = has(e, 'Employeur') ? e.Employeur : (p.employer_id !== null && p.employer_id !== undefined ? Number(p.employer_id) : 0);
  out.employment_start_date = has(e, 'employment_start_date') ? e.employment_start_date : (p.employment_start ?? '');
  out.employment_end_date = has(e, 'employment_end_date') ? e.employment_end_date : (p.employment_end ?? '');
  out[HR_ID_COLUMN] = has(e, HR_ID_COLUMN) ? e[HR_ID_COLUMN] : (p.hr_id ? Number(p.hr_id) : 0);
  out[FTE_COLUMNS.fte] = p.fte_ratio === null || p.fte_ratio === undefined ? null : Number(p.fte_ratio);
  out[FTE_COLUMNS.researchFte] = p.fte_research === null || p.fte_research === undefined ? null : Number(p.fte_research);
  out.validated = !!p.presence_validated;
  out.validated_status = has(e, 'validated_status') ? e.validated_status : (p.presence_status ?? '');
  out.validation_date = has(e, 'validation_date') ? e.validation_date : epochOf(p.presence_validated_on);
  out.validation_scope = (p.presence_validation_scope || []).join(',');
  out.Data_source = (p.sources || []).join('|');
  for (const s of SYNC_SOURCES) {
    const t = parts.sync.find((x) => x.source === s.toLowerCase());
    out[`${s}_derniere_maj`] = has(e, `${s}_derniere_maj`) ? e[`${s}_derniere_maj`] : (t?.last_run ?? '');
    out[`${s}_champs_modifies`] = (t?.changed_fields || []).join('|');
  }
  const primary = (scheme: string) => parts.identifiers.find((i) => i.scheme === scheme && i.is_primary)?.value ?? '';
  for (const [field, scheme] of Object.entries(IDENTIFIER_FIELDS)) out[field] = primary(scheme);
  const scopus = primary('scopus');
  out.ID_SCOPUS = has(e, 'ID_SCOPUS') ? e.ID_SCOPUS : scopus ? Number(scopus) : parts.scopusAbsent ? 'absent' : 0;
  out.OpenAlex_ids = has(e, 'OpenAlex_ids') ? e.OpenAlex_ids
    : parts.identifiers.filter((i) => i.scheme === 'openalex' && i.source !== OPENALEX_AUTHOR_SOURCE).map((i) => i.value).join('|');
  out.openalex_author_id = parts.identifiers.find((i) => i.scheme === 'openalex' && i.source === OPENALEX_AUTHOR_SOURCE)?.value ?? '';
  for (const [field, kind] of Object.entries(LINK_FIELDS)) {
    out[field] = has(e, field) ? e[field] : parts.links.filter((l) => l.kind === kind).map((l) => l.url).join('; ');
  }
  // The membership.
  const raw = (col: string) => e[`${col}@G-${rowId}`];
  out.LABO = m.lab_label ?? '';
  out.team = (m.team_labels || []).join('|');
  out.affiliation_start_date = raw('affiliation_start_date') ?? (m.start_date ?? '');
  out.affiliation_end_date = raw('affiliation_end_date') ?? (m.end_date ?? '');
  out.membership_type = m.type ?? '';
  out.rattachement = raw('rattachement') ?? (m.role ?? '');
  out.doublon_decision = m.duplicate_decision ?? '';
  return out;
};

/** Loads the parts of a set of people (identifiers, absence checks, links, sync traces). */
export const loadPersonParts = async (trx: Transaction<DB> | any, personIds: string[]): Promise<Map<string, PersonParts>> => {
  const ids = [...new Set(personIds)];
  const out = new Map<string, PersonParts>(ids.map((id) => [id, { identifiers: [], scopusAbsent: false, links: [], sync: [] }]));
  if (!ids.length) return out;
  const [identifiers, checks, links, sync] = await Promise.all([
    trx.selectFrom('person_identifier').select(['person_id', 'scheme', 'value', 'is_primary', 'source']).where('person_id', 'in', ids).orderBy('id').execute(),
    trx.selectFrom('person_identifier_check').select(['person_id', 'scheme', 'result']).where('person_id', 'in', ids).execute(),
    trx.selectFrom('person_link').select(['person_id', 'kind', 'url']).where('person_id', 'in', ids).orderBy('id').execute(),
    trx.selectFrom('sync_state').select(['person_id', 'source', 'last_run', 'changed_fields']).where('person_id', 'in', ids).execute(),
  ]);
  for (const i of identifiers) out.get(i.person_id)!.identifiers.push(i);
  for (const c of checks) if (c.scheme === 'scopus' && c.result === 'absent') out.get(c.person_id)!.scopusAbsent = true;
  for (const l of links) out.get(l.person_id)!.links.push(l);
  for (const s of sync) out.get(s.person_id)!.sync.push(s);
  return out;
};

/** Memberships (all of them when omitted) → { id, fields } in the record fields of the API, in record id order. */
export const readRecords = async (db: any, memberships?: any[]): Promise<{ id: number; fields: Record<string, any> }[]> => {
  const rows = memberships ?? await db.selectFrom('membership').selectAll().orderBy('id').execute();
  if (!rows.length) return [];
  const personIds = [...new Set(rows.map((m: any) => m.person_id))] as string[];
  const persons = memberships ? await db.selectFrom('person').selectAll().where('id', 'in', personIds).execute() : await db.selectFrom('person').selectAll().execute();
  const parts = await loadPersonParts(db, personIds);
  const personOf = new Map(persons.map((p: any) => [p.id, p]));
  return rows.map((m: any) => ({ id: Number(m.id), fields: readRecordFields(personOf.get(m.person_id)!, m, parts.get(m.person_id)!) }));
};

/**
 * Writes record fields onto a person and one of its memberships (merge patch, restoration, qualification…): each
 * field goes to its column, identifier, link, sync trace or membership; a field without a normalized home goes to
 * `extra`. Values come as cells (dates as epoch seconds or text, employer as an id or a label).
 */
export const writeRecordFields = async (trx: Transaction<DB>, personId: string, membershipId: string, fields: Record<string, any>): Promise<void> => {
  const person = await trx.selectFrom('person').selectAll().where('id', '=', personId).executeTakeFirstOrThrow();
  const extra: Record<string, any> = { ...(person.extra as object) };
  const set: Record<string, any> = {};
  const membership: Record<string, any> = {};
  const keep = (field: string, value: unknown) => { extra[field] = value; };
  const done = (field: string) => { delete extra[field]; };
  const sync = new Map<string, { last_run?: string | null; changed_fields?: string[] }>();

  for (const [field, value] of Object.entries(fields)) {
    if (field === 'id' || field === 'manualSort') continue;
    if (PERSON_TEXT[field]) { set[PERSON_TEXT[field]] = field === 'Nom' ? String(value ?? '') : (blank(value) ? null : String(value)); continue; }
    switch (field) {
      case 'uid_dyna': set.uid = blank(value) ? null : String(value).trim(); continue;
      case 'Civilite': {
        const c = String(value ?? '').trim().toUpperCase();
        if (c === 'F' || c === 'M' || c === '') { set.civility = c || null; done(field); } else { set.civility = null; keep(field, value); }
        continue;
      }
      case 'DATE_DE_NAISSANCE_JJ_MM_AAAA': case 'validation_date': {
        const col = field === 'validation_date' ? 'presence_validated_on' : 'birth_date';
        const d = blank(value) || value === 0 ? '' : fromGristDate(value);
        if (!d || (/^\d{4}-\d{2}-\d{2}$/.test(d) && normalizeFuzzyDate(d) === d)) { set[col] = d || null; done(field); } else { set[col] = null; keep(field, value); }
        continue;
      }
      case 'ANNEE_HDR':
        if (blank(value)) { set.hdr_year = null; done(field); } else if (/^\s*\d{4}\s*$/.test(String(value))) { set.hdr_year = Number(String(value).trim()); done(field); }
        else { set.hdr_year = null; keep(field, value); }
        continue;
      case 'Employeur': {
        if (value === 0 || blank(value)) { set.employer_id = null; done(field); continue; }
        if (typeof value === 'number') {
          const e = await trx.selectFrom('establishment').select('id').where('id', '=', String(value)).executeTakeFirst();
          if (e) { set.employer_id = e.id; done(field); } else { set.employer_id = null; keep(field, value); }
          continue;
        }
        const e = await trx.selectFrom('establishment').select('id').where(sql`lower(name)`, '=', String(value).trim().toLowerCase()).executeTakeFirst();
        set.employer_id = e?.id ?? null;
        keep(field, value); // a typed label is shown as typed
        continue;
      }
      case 'employment_start_date': case 'employment_end_date': {
        const col = field === 'employment_start_date' ? 'employment_start' : 'employment_end';
        const d = blank(value) ? null : normalizeFuzzyDate(fromGristFuzzyDate(value)) || null;
        set[col] = d;
        if (d || blank(value)) done(field); else keep(field, value);
        continue;
      }
      case HR_ID_COLUMN: {
        const id = value === 0 || blank(value) ? '' : normalizeHrId(value);
        set.hr_id = id || null;
        if (id || value === 0 || blank(value)) done(field); else keep(field, value);
        continue;
      }
      case FTE_COLUMNS.fte: set.fte_ratio = parseFteCell(value); continue;
      case FTE_COLUMNS.researchFte: set.fte_research = parseFteCell(value); continue;
      case 'validated': set.presence_validated = value === true || value === 'true' || value === 1; continue;
      case 'validated_status': {
        const s = normStatus(value);
        set.presence_status = s ?? null;
        if (s || blank(value)) done(field); else keep(field, value);
        continue;
      }
      case 'validation_scope': set.presence_validation_scope = blank(value) ? [] : parseValidationScope(value); continue;
      case 'Data_source': set.sources = blank(value) ? [] : [...new Set(String(value).split(/[|,]/).map((x) => x.trim()).filter(Boolean))]; continue;
      case 'LABO': membership.lab_label = blank(value) ? null : String(value); continue;
      case 'team': membership.team_labels = blank(value) ? [] : String(value).split('|').map((t) => t.trim()).filter(Boolean); continue;
      case 'affiliation_start_date': case 'affiliation_end_date': {
        const col = field === 'affiliation_start_date' ? 'start_date' : 'end_date';
        const d = blank(value) ? null : normalizeFuzzyDate(fromGristFuzzyDate(value)) || null;
        membership[col] = d;
        if (d || blank(value)) done(`${field}@G-${membershipId}`); else keep(`${field}@G-${membershipId}`, value);
        continue;
      }
      case 'membership_type': membership.type = blank(value) ? null : String(value); continue;
      case 'rattachement': {
        const r = String(value ?? '').trim().toUpperCase();
        membership.role = ROLES.includes(r) ? r : null;
        if (!r || ROLES.includes(r)) done(`rattachement@G-${membershipId}`); else keep(`rattachement@G-${membershipId}`, value);
        continue;
      }
      case 'doublon_decision': membership.duplicate_decision = blank(value) ? null : String(value); continue;
      case 'OpenAlex_ids': {
        const list = blank(value) ? [] : String(value).split(/[|,;\s]+/).map((x) => x.trim()).filter(Boolean);
        await trx.deleteFrom('person_identifier').where('person_id', '=', personId).where('scheme', '=', 'openalex')
          .where((eb) => eb.or([eb('source', 'is', null), eb('source', '<>', OPENALEX_AUTHOR_SOURCE)])).execute();
        for (const [i, v] of [...new Set(list)].entries()) {
          await trx.insertInto('person_identifier').values({ person_id: personId, scheme: 'openalex', value: v, is_primary: i === 0, source: OPENALEX_LIST_SOURCE })
            .onConflict((oc) => oc.columns(['person_id', 'scheme', 'value']).doUpdateSet({ is_primary: i === 0, source: OPENALEX_LIST_SOURCE })).execute();
        }
        if (list.join('|') === String(value ?? '')) done(field); else keep(field, blank(value) ? '' : value);
        continue;
      }
      case 'openalex_author_id': {
        await trx.deleteFrom('person_identifier').where('person_id', '=', personId).where('source', '=', OPENALEX_AUTHOR_SOURCE).execute();
        if (!blank(value)) {
          await trx.insertInto('person_identifier').values({ person_id: personId, scheme: 'openalex', value: String(value).trim(), is_primary: false, source: OPENALEX_AUTHOR_SOURCE })
            .onConflict((oc) => oc.columns(['person_id', 'scheme', 'value']).doUpdateSet({ source: OPENALEX_AUTHOR_SOURCE })).execute();
        }
        continue;
      }
    }
    if (IDENTIFIER_FIELDS[field]) {
      const scheme = IDENTIFIER_FIELDS[field];
      const v = blank(value) || value === 0 ? '' : typeof value === 'number' ? String(Math.round(value)) : String(value).trim();
      if (scheme === 'scopus') {
        await trx.deleteFrom('person_identifier_check').where('person_id', '=', personId).where('scheme', '=', 'scopus').execute();
        done('ID_SCOPUS');
      }
      await trx.deleteFrom('person_identifier').where('person_id', '=', personId).where('scheme', '=', scheme).where('is_primary', '=', true).where('value', '<>', v).execute();
      if (scheme === 'scopus' && v.toLowerCase() === 'absent') {
        await trx.insertInto('person_identifier_check').values({ person_id: personId, scheme: 'scopus', result: 'absent' }).execute();
      } else if (scheme === 'scopus' && v && !/^\d+$/.test(v)) {
        keep('ID_SCOPUS', value);
      } else if (v) {
        await trx.insertInto('person_identifier').values({ person_id: personId, scheme, value: v, is_primary: true, source: 'record' })
          .onConflict((oc) => oc.columns(['person_id', 'scheme', 'value']).doUpdateSet({ is_primary: true })).execute();
      }
      continue;
    }
    if (LINK_FIELDS[field]) {
      const kind = LINK_FIELDS[field];
      const cell = blank(value) ? '' : String(value);
      const urls = cell ? cell.split(/\s*[;\n]\s*|,\s+(?=https?:\/\/)/).map((u) => u.trim()).filter(Boolean) : [];
      await trx.deleteFrom('person_link').where('person_id', '=', personId).where('kind', '=', kind).execute();
      if (urls.length) await trx.insertInto('person_link').values([...new Set(urls)].map((url) => ({ person_id: personId, kind, url }))).execute();
      if (urls.join('; ') === cell) done(field); else keep(field, cell);
      continue;
    }
    const s = /^(LDAP|IdRef|HAL|ORCID|OpenAlex|Scopus)_(derniere_maj|champs_modifies)$/.exec(field);
    if (s) {
      const source = s[1].toLowerCase();
      const cur = sync.get(source) || {};
      if (s[2] === 'derniere_maj') {
        const d = blank(value) ? null : fromGristDate(value);
        cur.last_run = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
        if (cur.last_run || blank(value)) done(field); else keep(field, value);
      } else {
        cur.changed_fields = blank(value) ? [] : String(value).split('|').map((x) => x.trim()).filter(Boolean);
      }
      sync.set(source, cur);
      continue;
    }
    // No normalized home: kept as it is.
    if (blank(value)) done(field); else keep(field, value);
  }

  await trx.updateTable('person').set({ ...set, extra: JSON.stringify(extra) as any }).where('id', '=', personId).execute();
  for (const [source, v] of sync) {
    await trx.insertInto('sync_state').values({ person_id: personId, source, last_run: v.last_run ?? null, changed_fields: v.changed_fields ?? [] })
      .onConflict((oc) => oc.columns(['person_id', 'source']).doUpdateSet({
        ...(v.last_run !== undefined ? { last_run: v.last_run } : {}), ...(v.changed_fields !== undefined ? { changed_fields: v.changed_fields } : {}),
      })).execute();
  }
  if (Object.keys(membership).length) {
    // The lab and its teams resolved to structures, as the import does.
    if ('lab_label' in membership || 'team_labels' in membership) {
      const current = await trx.selectFrom('membership').select(['lab_label', 'team_labels']).where('id', '=', membershipId).executeTakeFirstOrThrow();
      const lab = 'lab_label' in membership ? membership.lab_label : current.lab_label;
      const teams: string[] = 'team_labels' in membership ? membership.team_labels : current.team_labels;
      const { structureId, teamIds } = await resolveStructures(trx, String(lab || ''), teams);
      membership.structure_id = structureId;
      await trx.deleteFrom('membership_team').where('membership_id', '=', membershipId).execute();
      if (teamIds.length) await trx.insertInto('membership_team').values(teamIds.map((t) => ({ membership_id: membershipId, team_structure_id: t }))).execute();
    }
    await trx.updateTable('membership').set(membership).where('id', '=', membershipId).execute();
  }
};

/** Structure of a lab label and of its team labels (a team of the same acronym in two labs: the one under the lab). */
export const resolveStructures = async (trx: Transaction<DB>, lab: string, teams: string[]): Promise<{ structureId: string | null; teamIds: string[] }> => {
  const rows = await trx.selectFrom('structure').select(['id', 'acronym', 'parent_id']).orderBy('id').execute();
  const byAcronym = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = normalizeAcronym(String(r.acronym || ''));
    if (!k) continue;
    if (!byAcronym.has(k)) byAcronym.set(k, []);
    byAcronym.get(k)!.push(r);
  }
  const structureId = lab && lab.toLowerCase() !== 'zzz' ? byAcronym.get(normalizeAcronym(lab))?.[0]?.id ?? null : null;
  const teamIds = teams.map((t) => {
    const all = byAcronym.get(normalizeAcronym(t)) || [];
    const under = all.filter((s) => s.parent_id === structureId);
    return all.length === 1 ? all[0].id : under.length === 1 ? under[0].id : null;
  }).filter((id): id is string => id !== null && id !== structureId);
  return { structureId, teamIds: [...new Set(teamIds)] };
};
