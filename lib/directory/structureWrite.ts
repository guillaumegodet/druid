// Druid → Grist encoding of the structure writes (V2 « Structures » table, mirror of structures.csv of the
// CRISalid directory bridge). Pure module shared by the browser and the server-side commands of the domain API
// (lib/directory/commands.ts, druid-internal docs/plan-migration-postgresql.md, lot 2 b). The helpers below
// moved verbatim out of lib/gristService.ts; the field builders are its createStructure / updateStructure bodies.
import { Structure, StructureLevel, Membership } from '../../types';
import { ApiError } from './errors';

/**
 * Re-encodes a simple value in the V2 multi-label format for writing (`Valeur[fr]`).
 */
export const encodeMultiLabel = (value: any, lang = 'fr'): string => {
  const v = (value === null || value === undefined) ? '' : String(value).trim();
  return v ? `${v}[${lang}]` : '';
};

/** Druid StructureMission -> V2 text value for writing. */
export const missionToV2 = (mission: any): string => {
  switch (mission) {
    case 'RECHERCHE': return 'research';
    case 'SERVICES_SCIENTIFIQUES': return 'scientific_services';
    case 'SERVICES_ADMINISTRATIFS': return 'administrative_services';
    default: return '';
  }
};

/** `YYYY-MM-DD` -> `YYYYMMDD` (empty if invalid). */
export const isoToCompact = (d: any): string => {
  const s = String(d || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.replace(/-/g, '') : '';
};

/**
 * Re-encodes a Membership[] to the V2 column (`inclusions`/`participations`).
 * Keeps the supervision code and always emits a date range
 * (default start `20000101`, end possibly empty = open), as expected by
 * the CRISalid directory bridge.
 */
export const serializeMembershipList = (list: any): string => {
  if (!Array.isArray(list)) return '';
  return list
    .filter((m: any) => m && m.ref)
    .map((m: any) => {
      let out = `${m.refType || 'local'}-${String(m.ref).trim()}`;
      if (m.supervision) out += `[${m.supervision}]`;
      const start = isoToCompact(m.startDate) || '20000101';
      const end = isoToCompact(m.endDate);
      out += `[${start}-${end}]`;
      return out;
    })
    .join('|');
};

/** Local id of a structure created from Druid when no entity code (supannCodeEntite) is entered: `T-<LABO>-<SIGLE>` for a
 * team (convention already in place in the table, e.g. T-GEM-MULTIX), `D-<SIGLE>` otherwise. */
export const makeLocalId = (structure: Pick<Structure, 'level' | 'acronym' | 'parentStructure'>): string => {
  const slug = (s: string) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return String(structure.level) === StructureLevel.EQUIPE
    ? `T-${slug(structure.parentStructure || '')}-${slug(structure.acronym)}`
    : `D-${slug(structure.acronym)}`;
};

/**
 * `local_id` of a new structure: the entity code entered on creation (supannCodeEntite, e.g. 1485), trimmed,
 * or, failing that, the generated D-/T- id. It becomes the Neo4j uid `local-<local_id>` through cdb, hence
 * no spaces or special characters.
 */
export const resolveNewStructureLocalId = (entered: unknown, generate: () => string): string => {
  const code = String(entered ?? '').trim();
  if (!code) return generate();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(code)) {
    throw new ApiError(400, `Invalid entity code (letters, digits, “-”, “_” or “.” only): ${code}`);
  }
  return code;
};

/** Scopus id cell: a number, or null when empty / not numeric. */
const scopusCell = (raw: unknown): number | null => {
  const n = raw ? Number(raw) : null;
  return Number.isFinite(n) ? n : null;
};

/**
 * Cells of a new structure (formerly GristService.createStructure): checks the acronym, the lab of a team and
 * the uniqueness (same acronym at the same level — within the same lab for a team — and same local_id) against
 * `allStructures`; a team gets `inclusions` = `local-<lab local_id>` (consistent with structures.csv / cdb).
 */
export function structureCreateFields(structure: Structure, allStructures: Structure[], today: string): Record<string, any> {
  const acronym = String(structure.acronym || '').trim();
  if (!acronym) throw new ApiError(400, 'The acronym / short name is required');
  const level = String(structure.level);
  const parent = String(structure.parentStructure || '').trim();
  if (level === StructureLevel.EQUIPE && !parent) throw new ApiError(400, 'A team must be included in a lab (Memberships tab)');
  const norm = (s: string) => String(s || '').trim().toUpperCase();
  // Duplicate = same acronym at the same level (a team and a lab often share an acronym); for a
  // team, within the same lab (review lot 2, finding 10).
  const dup = allStructures.find((s) => norm(s.acronym) === norm(acronym) && String(s.level) === level
    && (level !== StructureLevel.EQUIPE || norm(s.parentStructure || '') === norm(parent)));
  if (dup) throw new ApiError(409, `A structure with this acronym already exists: ${dup.acronym}${level === StructureLevel.EQUIPE ? ` (${parent})` : ''}`);
  const lab = level === StructureLevel.EQUIPE ? allStructures.find((s) => norm(s.acronym) === norm(parent) && String(s.level) === StructureLevel.ENTITE) : undefined;
  const inclusions: Membership[] = (structure.inclusions && structure.inclusions.length)
    ? structure.inclusions
    : lab?.localId ? [{ refType: 'local', ref: lab.localId, startDate: today } as Membership] : [];
  const genericType = level === StructureLevel.EQUIPE ? 'team' : level === StructureLevel.ETABLISSEMENT ? 'institution' : 'unit';
  const type = String(structure.type || '').trim() || (level === StructureLevel.EQUIPE ? 'TEAM' : '');
  const localId = resolveNewStructureLocalId(structure.localId,
    () => makeLocalId({ level: structure.level, acronym, parentStructure: parent }));
  if (allStructures.some((s) => s.localId === localId)) throw new ApiError(409, `local_id already used: ${localId}`);
  return {
    'generic_type': genericType,
    'type': type,
    'local_id': localId,
    'parent_structure': parent,
    'short_labels': encodeMultiLabel(acronym),
    'long_labels': encodeMultiLabel(structure.officialName || acronym),
    'descriptions': encodeMultiLabel(structure.description || ''),
    'nns': structure.rnsrId || '',
    'web': structure.website || '',
    'ror': structure.rorId || '',
    'hal_collection': structure.halCollectionUrl || '',
    'scopus': scopusCell(structure.identifiers?.scopusId),
    'signature': (structure as any).signature || '',
    'uai': structure.identifiers?.uai || '',
    'isni': structure.identifiers?.isni || '',
    'wikidata': structure.identifiers?.wikidata || '',
    'inclusions': serializeMembershipList(inclusions),
    'participations': serializeMembershipList(structure.participations || []),
    'main_mission': missionToV2(structure.primaryMission),
    'secondary_missions': missionToV2(structure.secondaryMission),
    'erc_research_field': (structure as any).ercField || '',
    'hceres_research_areas': (structure as any).hceresAreas || '',
    'campus': (structure as any).campus || '',
  };
}

/**
 * Cells of an existing structure (formerly GristService.updateStructure). Only the fields present in the V2
 * schema are persisted; the fields without equivalent (city, address, director, level, nature, status, dates,
 * lineage) are not written back — the table is otherwise fed by structures.csv of the directory bridge.
 */
export function structureUpdateFields(structure: any): Record<string, any> {
  return {
    'type': structure.type,
    'parent_structure': structure.parentStructure || '',
    'short_labels': encodeMultiLabel(structure.acronym),
    'long_labels': encodeMultiLabel(structure.officialName),
    'descriptions': encodeMultiLabel(structure.description),
    'nns': structure.rnsrId,
    'web': structure.website,
    'ror': structure.rorId,
    'hal_collection': structure.halCollectionUrl,
    'scopus': scopusCell(structure.identifiers?.scopusId),
    'signature': structure.signature,
    // Identifiants tiers V2
    'uai': structure.identifiers?.uai || '',
    'isni': structure.identifiers?.isni || '',
    'wikidata': structure.identifiers?.wikidata || '',
    // Memberships: re-encoding of both families to the V2 columns.
    'inclusions': serializeMembershipList(structure.inclusions),
    'participations': serializeMembershipList(structure.participations),
    // Missions & themes
    'main_mission': missionToV2(structure.primaryMission),
    'secondary_missions': missionToV2(structure.secondaryMission),
    'erc_research_field': structure.ercField || '',
    'hceres_research_areas': structure.hceresAreas || '',
    'campus': structure.campus || ''
  };
}
