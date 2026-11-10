// Import of researchers from a spreadsheet (druid-internal docs/plan-druid-saas.md, lot 5 a): the list an
// establishment keeps (CSV or XLSX, one row = one person in one lab), matched with the directory, reviewed, then
// written. The matching and typing rules are those of the lab website import (siteImport.ts), extended to a file that
// spans several labs:
//   - the rows of one person are grouped (same email, ORCID, IdRef, IdHAL, uid, or same last + first name): a person
//     listed in two labs is ONE record with two memberships, never two records;
//   - a group is matched with the directory by uid, email, ORCID, IdRef or IdHAL anywhere, then by name inside its
//     labs (full name, then compatible first name, then the only member with that last name when the file gives no
//     first name — a file's first names are reliable, unlike a site's); a last name shared in a lab without a
//     compatible first name = ambiguous (left out, listed);
//   - matched: each row of a lab the person already belongs to brings complements (a value where Druid has none) and
//     differences (never applied unless ticked); a row of another lab adds a membership (« join »);
//   - not matched: one creation carrying every lab of the group (the first row's lab is the main one);
//   - team labels unknown under their lab are proposed as teams to create;
//   - rows without last name or lab, or of a lab the directory does not have, are listed and left out.
// Pure: the API (lib/directory/api.ts) gives the directory and the commands.
import { z } from 'zod';
import { StructureLevel, type Researcher, type Structure } from '../../types';
import type { Institution } from './gristMapping';
import { employerResolver, newTeamOf, normLab, normName, typingOf, validationOf, type SiteImportCommands, type SitePerson } from './siteImport';

// ── Reading the sheet ─────────────────────────────────────────────────────────────────────────────────────────────────
export const PEOPLE_IMPORT_FIELDS = ['lastName', 'firstName', 'lab', 'email', 'team', 'employer', 'position', 'grade', 'orcid', 'idref', 'halId', 'uid'] as const;
export type PeopleImportField = typeof PEOPLE_IMPORT_FIELDS[number];

/** Header spellings recognized for each field (compared without case, accents, spaces or punctuation). */
export const HEADER_ALIASES: Record<PeopleImportField, string[]> = {
  lastName: ['nom', 'nomdefamille', 'nomdusage', 'lastname', 'surname', 'familyname'],
  firstName: ['prenom', 'prenoms', 'firstname', 'givenname'],
  lab: ['laboratoire', 'labo', 'unite', 'unitederecherche', 'structure', 'siglelabo', 'siglelaboratoire', 'sigle', 'lab', 'laboratory', 'unit', 'researchunit'],
  email: ['email', 'mail', 'courriel', 'adressemail', 'adresseemail', 'adressecourriel', 'emailaddress'],
  team: ['equipe', 'equipes', 'team', 'teams'],
  employer: ['employeur', 'etablissement', 'etablissementemployeur', 'tutelle', 'employer', 'institution'],
  position: ['fonction', 'statut', 'poste', 'categorie', 'position', 'status', 'jobtitle'],
  grade: ['corps', 'grade', 'corpsgrade', 'corpsetgrade'],
  orcid: ['orcid', 'idorcid'],
  idref: ['idref', 'ppn', 'ididref'],
  halId: ['idhal', 'halid', 'hal'],
  uid: ['uid', 'login', 'identifiantlocal', 'identifiantldap'],
};

const normHeader = (s: unknown): string =>
  String(s ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]/g, '');

export const fieldOfHeader = (header: unknown): PeopleImportField | null => {
  const h = normHeader(header);
  if (!h) return null;
  for (const field of PEOPLE_IMPORT_FIELDS) if (HEADER_ALIASES[field].includes(h)) return field;
  return null;
};

const Text = z.string().trim().max(2000).optional().default('');
export const PeopleImportRowSchema = z.object(Object.fromEntries(PEOPLE_IMPORT_FIELDS.map((f) => [f, Text])) as Record<PeopleImportField, typeof Text>);
export type PeopleImportRow = z.infer<typeof PeopleImportRowSchema>;

export interface SheetReading {
  rows: PeopleImportRow[];
  /** Each column of the sheet and the field it feeds (null = ignored). */
  columns: { header: string; field: PeopleImportField | null }[];
  /** Required fields with no column. */
  missing: PeopleImportField[];
}

/**
 * Rows of a sheet given as a matrix (first non-empty row = headers, as SheetJS `sheet_to_json(…, { header: 1 })`
 * returns it). The first column of a field wins; empty rows are skipped.
 */
export const readSheet = (matrix: unknown[][]): SheetReading => {
  const start = matrix.findIndex((r) => Array.isArray(r) && r.some((c) => String(c ?? '').trim()));
  if (start < 0) return { rows: [], columns: [], missing: ['lastName', 'lab'] };
  const headers = (matrix[start] || []).map((h) => String(h ?? '').trim());
  const taken = new Set<PeopleImportField>();
  const columns = headers.map((header) => {
    const field = fieldOfHeader(header);
    if (!field || taken.has(field)) return { header, field: null };
    taken.add(field);
    return { header, field };
  });
  const rows: PeopleImportRow[] = [];
  for (const raw of matrix.slice(start + 1)) {
    if (!Array.isArray(raw) || !raw.some((c) => String(c ?? '').trim())) continue;
    const row = Object.fromEntries(PEOPLE_IMPORT_FIELDS.map((f) => [f, ''])) as PeopleImportRow;
    columns.forEach((c, i) => { if (c.field) row[c.field] = String(raw[i] ?? '').trim(); });
    rows.push(row);
  }
  return { rows, columns, missing: (['lastName', 'lab'] as PeopleImportField[]).filter((f) => !taken.has(f)) };
};

/**
 * Cells of a CSV text: separator guessed from the first line (`;` as French Excel writes it, `,`, or a tab), quoted
 * cells with doubled quotes and line breaks, a leading BOM ignored.
 */
export const parseCsv = (text: string): string[][] => {
  const src = text.replace(/^\uFEFF/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const sep = [';', ',', '\t'].map((c) => ({ c, n: firstLine.split(c).length })).sort((a, b) => b.n - a.n)[0].c;
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); out.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); out.push(row); }
  return out;
};

// ── Identifiers ───────────────────────────────────────────────────────────────────────────────────────────────────────
/** ORCID iD from a bare id or a URL, '' when none is recognizable. */
export const orcidOf = (s: string): string => (s.match(/(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/i)?.[1] || '').toUpperCase();
/** IdRef PPN (8 digits + a digit or X) from a bare id or an idref.fr URL. */
export const idrefOf = (s: string): string => {
  const v = s.trim().replace(/\/+$/, '').split('/').pop() || '';
  return /^\d{8}[\dX]$/i.test(v) ? v.toUpperCase() : '';
};
/** IdHAL (the text form, « prenom-nom ») from a bare id or a cv.hal.science URL. */
export const halIdOf = (s: string): string => {
  const v = s.trim().replace(/\/+$/, '').split('/').pop() || '';
  return /^[a-z0-9][a-z0-9._-]{1,99}$/i.test(v) ? v.toLowerCase() : '';
};
const emailOf = (s: string): string => {
  const v = s.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : '';
};

/** A row with its identifiers and email normalized; what could not be read is reported. */
export const cleanRow = (row: PeopleImportRow): { row: PeopleImportRow; warnings: string[] } => {
  const out = { ...row };
  const warnings: string[] = [];
  const check = (field: 'orcid' | 'idref' | 'halId' | 'email', parse: (s: string) => string) => {
    if (!row[field]) return;
    out[field] = parse(row[field]);
    if (!out[field]) warnings.push(field);
  };
  check('email', emailOf); check('orcid', orcidOf); check('idref', idrefOf); check('halId', halIdOf);
  return { row: out, warnings };
};

// ── Plan ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type PeopleImportUpdateField = 'email' | 'grade' | 'employer' | 'team' | 'orcid' | 'idref' | 'halId';
export const PEOPLE_IMPORT_UPDATE_FIELDS: PeopleImportUpdateField[] = ['email', 'grade', 'employer', 'team', 'orcid', 'idref', 'halId'];
/** Identifiers are only added, never replaced: a different one is a question for the alignment pages. */
const COMPLEMENT_ONLY: PeopleImportUpdateField[] = ['orcid', 'idref', 'halId'];
export type PeopleMatchedBy = 'uid' | 'email' | 'orcid' | 'idref' | 'halId' | 'name' | 'firstName' | 'lastName';

export interface PeopleImportCreation {
  /** First row of the person (stable key of the review). */
  index: number;
  rows: number[];
  lastName: string;
  firstName: string;
  email: string;
  /** Labs of the person (structure acronyms as the directory writes them), the main one first, with the team. */
  labs: { lab: string; team: string }[];
  grade: string;
  employmentType: string;
  /** Institution the employer label resolves to ('' when none). */
  employer: string;
  identifiers: { orcid: string; idref: string; halId: string };
  uid: string;
}
export interface PeopleImportJoin {
  /** Row of the new membership. */
  index: number;
  researcherId: string;
  name: string;
  matchedBy: PeopleMatchedBy;
  lab: string;
  team: string;
}
export interface PeopleImportUpdate {
  index: number;
  researcherId: string;
  name: string;
  matchedBy: PeopleMatchedBy;
  lab: string;
  complements: { field: PeopleImportUpdateField; value: string }[];
  differences: { field: PeopleImportUpdateField; current: string; file: string }[];
}
export interface PeopleImportPlan {
  source: string;
  rowCount: number;
  creations: PeopleImportCreation[];
  joins: PeopleImportJoin[];
  updates: PeopleImportUpdate[];
  /** Rows matched with a member already up to date (nothing to write). */
  unchanged: number;
  ambiguous: { index: number; name: string; lab: string; candidates: { researcherId: string; name: string }[] }[];
  /** Rows left out: no last name, no lab, a lab the directory does not have, or the same person twice in a lab. */
  rejected: { index: number; name: string; lab: string; reason: 'lastName' | 'lab' | 'unknownLab' | 'duplicate' }[];
  /** Values that could not be read (an ORCID that is not one…): the field is ignored, the row kept. */
  warnings: { index: number; field: string; value: string }[];
  /** Team labels unknown under their lab, proposed for creation (key `<lab>|<team>`). */
  teams: { lab: string; acronym: string }[];
}

export const teamKey = (lab: string, team: string): string => `${normLab(lab)}|${team.trim().toUpperCase()}`;
/** Team labels of a cell: « IA | Réseaux », « IA; Réseaux », « IA, Réseaux ». */
export const teamsOfCell = (s: string): string[] => [...new Set(s.split(/[|;,]/).map((t) => t.trim()).filter(Boolean))];

const firstNamesMatch = (a: string, b: string): boolean =>
  !!a && !!b && (a.startsWith(b) || b.startsWith(a) || a.split(' ')[0] === b.split(' ')[0]);

/** Value of an update field on a researcher (the lab's membership for the team). */
const currentOf = (r: Researcher, lab: string, field: PeopleImportUpdateField): string => {
  switch (field) {
    case 'email': return r.email || '';
    case 'grade': return r.employment?.grade || '';
    case 'employer': return r.employment?.employer || '';
    case 'team': return r.affiliations.find((a) => normLab(a.structureName) === normLab(lab))?.team || '';
    case 'orcid': return r.identifiers?.orcid || '';
    case 'idref': return r.identifiers?.idref || '';
    case 'halId': return r.identifiers?.halId || '';
  }
};

/** Smallest union-find: the rows of one person. */
const groupsOf = (rows: PeopleImportRow[], indexes: number[]): number[][] => {
  const parent = new Map<number, number>(indexes.map((i) => [i, i]));
  const find = (i: number): number => { let r = i; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(i, r); return r; };
  const owner = new Map<string, number>();
  for (const i of indexes) {
    const r = rows[i];
    const keys = [
      r.email && `e:${r.email}`, r.orcid && `o:${r.orcid}`, r.idref && `i:${r.idref}`, r.halId && `h:${r.halId}`, r.uid && `u:${r.uid.toLowerCase()}`,
      r.firstName && `n:${normName(r.lastName)}|${normName(r.firstName)}`,
    ].filter(Boolean) as string[];
    for (const k of keys) {
      const o = owner.get(k);
      if (o === undefined) owner.set(k, i);
      else parent.set(find(i), find(o));
    }
  }
  const groups = new Map<number, number[]>();
  for (const i of indexes) groups.set(find(i), [...(groups.get(find(i)) ?? []), i]);
  return [...groups.values()].map((g) => g.sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);
};

/**
 * Plan of an import. `people` = the whole directory (institution scope), `institutions` = the employers, `structures`
 * = the labs and their teams.
 */
export function planPeopleImport(input: { source: string; rows: PeopleImportRow[] }, people: Researcher[], institutions: Institution[], structures: Structure[]): PeopleImportPlan {
  const plan: PeopleImportPlan = {
    source: input.source, rowCount: input.rows.length, creations: [], joins: [], updates: [], unchanged: 0, ambiguous: [], rejected: [], warnings: [], teams: [],
  };
  const labsByKey = new Map<string, Structure>();
  for (const s of structures) {
    if (String(s.level) !== StructureLevel.ENTITE) continue;
    for (const k of [normLab(s.acronym), normLab((s as any).officialName)]) if (k && !labsByKey.has(k)) labsByKey.set(k, s);
  }
  // Any structure under the lab counts as one of its teams, whatever its level says (older directories typed some
  // teams as labs).
  const existingTeams = new Set(structures.filter((s) => s.parentStructure).map((s) => teamKey(s.parentStructure || '', s.acronym || '')));

  // Rows: cleaned, their lab resolved to the directory's acronym.
  const rows: PeopleImportRow[] = [];
  const kept: number[] = [];
  input.rows.forEach((raw, index) => {
    const { row, warnings } = cleanRow(raw);
    for (const field of warnings) plan.warnings.push({ index, field, value: raw[field as PeopleImportField] });
    const name = `${row.lastName.toUpperCase()} ${row.firstName}`.trim();
    if (!row.lastName) { plan.rejected.push({ index, name, lab: row.lab, reason: 'lastName' }); rows.push(row); return; }
    if (!row.lab) { plan.rejected.push({ index, name, lab: '', reason: 'lab' }); rows.push(row); return; }
    const lab = labsByKey.get(normLab(row.lab));
    if (!lab) { plan.rejected.push({ index, name, lab: row.lab, reason: 'unknownLab' }); rows.push(row); return; }
    rows.push({ ...row, lab: lab.acronym });
    kept.push(index);
  });

  // The directory, indexed.
  const byKey = new Map<string, Researcher>();
  const index = (k: string, r: Researcher) => { if (!byKey.has(k)) byKey.set(k, r); };
  const labMembers = new Map<string, Researcher[]>();
  for (const r of people) {
    if (r.uid) index(`u:${r.uid.toLowerCase()}`, r);
    if (r.email) index(`e:${r.email.trim().toLowerCase()}`, r);
    if (r.identifiers?.orcid) index(`o:${orcidOf(r.identifiers.orcid)}`, r);
    if (r.identifiers?.idref) index(`i:${idrefOf(r.identifiers.idref)}`, r);
    if (r.identifiers?.halId) index(`h:${r.identifiers.halId.trim().toLowerCase()}`, r);
    for (const a of r.affiliations || []) {
      const k = normLab(a.structureName);
      if (!labMembers.get(k)?.includes(r)) labMembers.set(k, [...(labMembers.get(k) ?? []), r]);
    }
  }
  const byIdentity = (g: number[]): { r: Researcher; by: PeopleMatchedBy } | null => {
    for (const i of g) {
      const row = rows[i];
      const tries: [string, PeopleMatchedBy][] = [[row.uid && `u:${row.uid.toLowerCase()}`, 'uid'], [row.email && `e:${row.email}`, 'email'],
        [row.orcid && `o:${row.orcid}`, 'orcid'], [row.idref && `i:${row.idref}`, 'idref'], [row.halId && `h:${row.halId}`, 'halId']] as [string, PeopleMatchedBy][];
      for (const [k, by] of tries) if (k && byKey.has(k)) return { r: byKey.get(k)!, by };
    }
    return null;
  };
  /** Name rules of the site import, inside one lab: a match, an ambiguity (homonyms), or nothing. */
  const byName = (row: PeopleImportRow): { r: Researcher; by: PeopleMatchedBy } | { ambiguous: Researcher[] } | null => {
    const members = labMembers.get(normLab(row.lab)) ?? [];
    const last = normName(row.lastName);
    const first = normName(row.firstName);
    const sameLast = members.filter((m) => normName(m.lastName) === last);
    const full = sameLast.find((m) => normName(m.firstName) === first);
    if (full) return { r: full, by: 'name' };
    const compatible = sameLast.find((m) => firstNamesMatch(normName(m.firstName), first));
    if (compatible) return { r: compatible, by: 'firstName' };
    if (sameLast.length === 1 && !first) return { r: sameLast[0], by: 'lastName' };
    return sameLast.length ? { ambiguous: sameLast } : null;
  };

  const resolveEmployer = employerResolver(institutions, people);
  const teamsToCreate = new Map<string, { lab: string; acronym: string }>();
  const noteTeams = (lab: string, cell: string) => {
    for (const t of teamsOfCell(cell)) {
      const k = teamKey(lab, t);
      if (!existingTeams.has(k) && !teamsToCreate.has(k) && t.length <= 50) teamsToCreate.set(k, { lab, acronym: t });
    }
  };

  for (const g of groupsOf(rows, kept)) {
    let found = byIdentity(g);
    if (!found) {
      let ambiguous: { index: number; r: Researcher[] } | null = null;
      for (const i of g) {
        const m = byName(rows[i]);
        if (m && 'r' in m) { found = m; break; }
        if (m && 'ambiguous' in m && !ambiguous) ambiguous = { index: i, r: m.ambiguous };
      }
      if (!found && ambiguous) {
        const row = rows[ambiguous.index];
        plan.ambiguous.push({
          index: ambiguous.index, name: `${row.lastName.toUpperCase()} ${row.firstName}`.trim(), lab: row.lab,
          candidates: ambiguous.r.map((r) => ({ researcherId: r.id, name: r.displayName })),
        });
        continue;
      }
    }
    const seenLabs = new Set<string>();
    const firstOfLab = g.filter((i) => {
      const k = normLab(rows[i].lab);
      if (seenLabs.has(k)) {
        plan.rejected.push({ index: i, name: `${rows[i].lastName.toUpperCase()} ${rows[i].firstName}`.trim(), lab: rows[i].lab, reason: 'duplicate' });
        return false;
      }
      seenLabs.add(k);
      return true;
    });
    if (found) {
      const { r, by } = found;
      for (const i of firstOfLab) {
        const row = rows[i];
        noteTeams(row.lab, row.team);
        const member = r.affiliations.some((a) => normLab(a.structureName) === normLab(row.lab));
        if (!member) {
          plan.joins.push({ index: i, researcherId: r.id, name: r.displayName, matchedBy: by, lab: row.lab, team: teamsOfCell(row.team).join(' | ') });
          continue;
        }
        const complements: PeopleImportUpdate['complements'] = [];
        const differences: PeopleImportUpdate['differences'] = [];
        for (const field of PEOPLE_IMPORT_UPDATE_FIELDS) {
          const file = field === 'employer' ? resolveEmployer(row.employer) : field === 'team' ? teamsOfCell(row.team).join(' | ') : row[field];
          if (!file) continue;
          const current = currentOf(r, row.lab, field).trim();
          if (!current) complements.push({ field, value: file });
          else if (current.toLowerCase() !== file.toLowerCase() && !COMPLEMENT_ONLY.includes(field)) differences.push({ field, current, file });
        }
        if (complements.length || differences.length) plan.updates.push({ index: i, researcherId: r.id, name: r.displayName, matchedBy: by, lab: row.lab, complements, differences });
        else plan.unchanged++;
      }
      continue;
    }
    // A new person: the first non-empty value of each field across its rows.
    const pick = (f: PeopleImportField) => g.map((i) => rows[i][f]).find(Boolean) || '';
    const person = { lastName: pick('lastName'), firstName: pick('firstName'), position: pick('position'), grade: pick('grade') };
    for (const i of firstOfLab) noteTeams(rows[i].lab, rows[i].team);
    plan.creations.push({
      index: g[0], rows: g, lastName: person.lastName, firstName: person.firstName, email: pick('email'),
      labs: firstOfLab.map((i) => ({ lab: rows[i].lab, team: teamsOfCell(rows[i].team).join(' | ') })),
      ...typingOf({ ...person, role: '' } as SitePerson), employer: resolveEmployer(pick('employer')),
      identifiers: { orcid: pick('orcid'), idref: pick('idref'), halId: pick('halId') }, uid: pick('uid'),
    });
  }
  plan.teams = [...teamsToCreate.values()].sort((a, b) => a.lab.localeCompare(b.lab) || a.acronym.localeCompare(b.acronym));
  return plan;
}

// ── Application ───────────────────────────────────────────────────────────────────────────────────────────────────────
export const PeopleImportInputSchema = z.object({
  source: z.string().trim().max(300).optional().default(''),
  rows: z.array(PeopleImportRowSchema).min(1).max(5000),
});
export type PeopleImportInput = z.infer<typeof PeopleImportInputSchema>;

export const PeopleImportSelectionSchema = z.object({
  /** Keys `<lab>|<team>` of `plan.teams`. */
  teams: z.array(z.string().max(200)).max(1000).default([]),
  /** First rows of `plan.creations`. */
  creations: z.array(z.number().int().min(0)).max(5000).default([]),
  /** Rows of `plan.joins`. */
  joins: z.array(z.number().int().min(0)).max(5000).default([]),
  /** Fields to write on matched members: complements and the differences ticked. */
  fields: z.array(z.object({ index: z.number().int().min(0), field: z.enum(PEOPLE_IMPORT_UPDATE_FIELDS as [PeopleImportUpdateField, ...PeopleImportUpdateField[]]) })).max(40000).default([]),
  /** Mark the created records as validated (the list is the establishment's reference). */
  validateNew: z.boolean().default(false),
});
export type PeopleImportSelection = z.infer<typeof PeopleImportSelectionSchema>;

export interface PeopleImportResult {
  teamsCreated: number;
  created: number;
  joined: number;
  updated: number;
  stale: number;
  errors: { index: number; name: string; error: string }[];
}

/** New record of a creation: its main lab first; the other labs are added by an update (one row per membership). */
export const newPersonOf = (c: PeopleImportCreation, source: string, validation: ReturnType<typeof validationOf> | null): Researcher => ({
  id: '', uid: c.uid, lastName: c.lastName, firstName: c.firstName, displayName: `${c.lastName.toUpperCase()} ${c.firstName}`.trim(),
  civility: '', email: c.email, status: '' as any,
  employment: { employer: c.employer, grade: c.grade, contractType: c.employmentType },
  affiliations: c.labs.map((l, i) => ({ structureName: l.lab, team: l.team, startDate: '', isPrimary: i === 0 })),
  groups: [], identifiers: Object.fromEntries(Object.entries(c.identifiers).filter(([, v]) => v)), photoUrl: '', annuaireUrl: '', profiles: {},
  ...(validation ? { validation: validation as any } : {}),
  importSource: source,
} as unknown as Researcher);

/** A researcher with new memberships and the kept field values written. */
export const withImport = (r: Researcher, joins: PeopleImportJoin[], fields: { lab: string; field: PeopleImportUpdateField; value: string }[]): Researcher => {
  const out: Researcher = structuredClone(r);
  if (joins.length) {
    if (!out.affiliations.some((a) => a.isPrimary) && out.affiliations[0]) out.affiliations[0].isPrimary = true;
    for (const j of joins) out.affiliations.push({ structureName: j.lab, team: j.team, startDate: '', isPrimary: false } as any);
  }
  for (const { lab, field, value } of fields) {
    if (field === 'email') out.email = value;
    else if (field === 'grade') out.employment = { ...out.employment, grade: value };
    else if (field === 'employer') out.employment = { ...out.employment, employer: value };
    else if (field === 'team') { const a = out.affiliations.find((x) => normLab(x.structureName) === normLab(lab)); if (a) a.team = value; }
    else out.identifiers = { ...(out.identifiers || {}), [field]: value };
  }
  return out;
};

/**
 * Applies the rows the user kept. The plan is computed again from the file and the current directory (the browser's
 * copy is never trusted): an item it no longer has is counted as stale. Order: teams, creations (main lab, then the
 * other labs), then one update per matched researcher (its new memberships and its fields together).
 */
export async function applyPeopleImport(args: {
  input: PeopleImportInput; selection: PeopleImportSelection; people: Researcher[]; institutions: Institution[]; structures: Structure[];
  commands: SiteImportCommands; ctx: any; today: string; actor: string;
}): Promise<PeopleImportResult> {
  const { input, selection, people, institutions, structures, commands, ctx, today, actor } = args;
  const plan = planPeopleImport(input, people, institutions, structures);
  const source = input.source || 'Import de fichier';
  const result: PeopleImportResult = { teamsCreated: 0, created: 0, joined: 0, updated: 0, stale: 0, errors: [] };
  const fail = (index: number, name: string, e: unknown) => result.errors.push({ index, name, error: e instanceof Error ? e.message : String(e) });

  const teams = new Map(plan.teams.map((t) => [teamKey(t.lab, t.acronym), t]));
  for (const key of new Set(selection.teams)) {
    const t = teams.get(key);
    if (!t) { result.stale++; continue; }
    try {
      await commands.createStructure(newTeamOf({ acronym: t.acronym, name: t.acronym, description: '', url: '' }, t.lab), ctx);
      result.teamsCreated++;
    } catch (e) { fail(-1, `${t.lab} / ${t.acronym}`, e); }
  }

  const creations = new Map(plan.creations.map((c) => [c.index, c]));
  for (const index of new Set(selection.creations)) {
    const c = creations.get(index);
    if (!c) { result.stale++; continue; }
    const person = newPersonOf(c, source, selection.validateNew ? validationOf('PRESENT', source, today, actor) : null);
    try {
      const { recordId } = await commands.createPerson({ ...person, affiliations: person.affiliations.slice(0, 1) }, ctx);
      result.created++;
      if (person.affiliations.length > 1) {
        await commands.updatePerson(recordId, { ...person, gristRowId: recordId } as Researcher, ctx);
        result.joined += person.affiliations.length - 1;
      }
    } catch (e) { fail(index, `${c.firstName} ${c.lastName}`.trim(), e); }
  }

  // Matched researchers: their new memberships and fields, in one update each.
  const joins = new Map(plan.joins.map((j) => [j.index, j]));
  const updates = new Map(plan.updates.map((u) => [u.index, u]));
  const work = new Map<string, { joins: PeopleImportJoin[]; fields: { lab: string; field: PeopleImportUpdateField; value: string }[]; index: number; name: string }>();
  const entry = (researcherId: string, index: number, name: string) => {
    const w = work.get(researcherId) ?? { joins: [], fields: [], index, name };
    work.set(researcherId, w);
    return w;
  };
  for (const index of new Set(selection.joins)) {
    const j = joins.get(index);
    if (!j) { result.stale++; continue; }
    entry(j.researcherId, index, j.name).joins.push(j);
  }
  const seenFields = new Set<string>();
  for (const { index, field } of selection.fields) {
    if (seenFields.has(`${index}:${field}`)) continue;
    seenFields.add(`${index}:${field}`);
    const u = updates.get(index);
    const value = u?.complements.find((c) => c.field === field)?.value ?? u?.differences.find((d) => d.field === field)?.file;
    if (!u || !value) { result.stale++; continue; }
    entry(u.researcherId, index, u.name).fields.push({ lab: u.lab, field, value });
  }
  const byId = new Map(people.map((r) => [r.id, r]));
  for (const [researcherId, w] of work) {
    const r = byId.get(researcherId);
    try {
      if (!r?.gristRowId) throw new Error('record without row id');
      await commands.updatePerson(r.gristRowId, withImport(r, w.joins, w.fields), ctx);
      result.joined += w.joins.length;
      if (w.fields.length) result.updated++;
    } catch (e) { fail(w.index, w.name, e); }
  }
  return result;
}
