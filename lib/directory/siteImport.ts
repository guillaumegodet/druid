// Import of a lab website directory (druid-internal docs/plan-migration-postgresql.md, lot 8 d).
//
// The druid-biblio skill `sync-annuaire-grist` parses a lab's web directory and exports a `druid-site-import` v1 file
// (sync_annuaire.py --export). Druid matches it with the lab's members, shows the plan for review and applies the
// rows the user keeps. This module is the pure engine, ported from sync_annuaire.py (rules kept):
//   - matching of a site person with the lab's memberships: uid, then email (case-insensitive), then last + first
//     name, then the same last name with a compatible first name (prefix or same first word), or the only member
//     with that last name; a last name shared by several members without a compatible first name = ambiguous
//     (left out, listed);
//   - creation of the people the site has and the lab has not (never validated by default), typed from the site's
//     position (post-doc, PhD student) and grade, employer resolved from its label (the institution the lab already
//     uses first), with the other labs where the same email already exists (multi-affiliation, probably);
//   - complements: a site value written where Druid has none (email, team, profile URL, directory URL, grade, photo);
//   - differences: a site value other than Druid's (never applied unless the user ticks it — « the site is right »);
//     the photo is never overwritten;
//   - members present on the site but not validated (to validate), and members absent from the site (to review:
//     departures, other spellings) — SECONDAIRE / HISTORIQUE memberships excepted, their absence is expected.
import { z } from 'zod';
import type { Researcher } from '../../types';
import type { Institution } from './gristMapping';

export const SITE_IMPORT_FORMAT = 'druid-site-import';

const Text = z.string().trim().max(2000).optional().default('');
export const SitePersonSchema = z.object({
  lastName: z.string().trim().min(1).max(200),
  firstName: Text,
  email: Text,
  /** Teams, pipe-separated. */
  team: Text,
  /** Employer label as written on the site (« Nantes Université », « CNRS »…). */
  employer: Text,
  /** Position as written on the site (« Doctorant », « Post-doctorant », « Maître de conférences »…). */
  position: Text,
  /** Parser category: « Chercheur », « Doctorant/Post-doc », « Support », « Direction ». */
  role: Text,
  profileUrl: Text,
  directoryUrl: Text,
  photoUrl: Text,
  /** Corps_grade code read on the site (MCF, PR, ATER, IE…). */
  grade: Text,
  /** Presence given by the site (PRESENT; INTERNE / EXTERNE read as PRESENT), used when validating. */
  status: Text,
  uid: Text,
});
export type SitePerson = z.infer<typeof SitePersonSchema>;

export const SiteImportDocumentSchema = z.object({
  format: z.literal(SITE_IMPORT_FORMAT),
  version: z.literal(1),
  lab: z.string().trim().min(1).max(100),
  source: z.string().trim().max(300).optional().default(''),
  url: z.string().trim().max(2000).optional().default(''),
  generatedAt: z.string().max(40).optional().default(''),
  people: z.array(SitePersonSchema).max(5000),
});
export type SiteImportDocument = z.infer<typeof SiteImportDocumentSchema>;

/** Fields the import may fill in (complement) or replace (difference ticked by the user). */
export type SiteField = 'email' | 'team' | 'profileUrl' | 'directoryUrl' | 'grade' | 'photoUrl';
export const SITE_FIELDS: SiteField[] = ['email', 'team', 'profileUrl', 'directoryUrl', 'grade', 'photoUrl'];
/** Fields never overwritten: a photo is only added where there is none. */
const COMPLEMENT_ONLY: SiteField[] = ['photoUrl'];

export type MatchedBy = 'uid' | 'email' | 'name' | 'firstName' | 'lastName';

export interface SiteImportCreation {
  /** Index of the person in the file (stable key of the review). */
  index: number;
  person: SitePerson;
  /** Typing deduced from the site: grade and stored employment type (TYPE_EMPLOI) of the new record. */
  grade: string;
  employmentType: string;
  /** Institution name the employer label resolves to ('' when none). */
  employer: string;
  /** Other labs whose members already have this email (probably the same person). */
  sameEmailLabs: string[];
}

export interface SiteImportMatch {
  index: number;
  person: SitePerson;
  researcherId: string;
  /** Annuaire row (membership) of the lab. */
  recordId: number | null;
  name: string;
  matchedBy: MatchedBy;
  complements: { field: SiteField; value: string }[];
  differences: { field: SiteField; current: string; site: string }[];
  /** Present on the site, member not validated yet: proposed for validation (with the site's presence). */
  toValidate: boolean;
  validated: boolean;
}

export interface SiteImportPlan {
  lab: string;
  source: string;
  url: string;
  siteCount: number;
  labCount: number;
  creations: SiteImportCreation[];
  matches: SiteImportMatch[];
  ambiguous: { index: number; person: SitePerson; candidates: { researcherId: string; name: string }[] }[];
  /** Lab members (PRINCIPAL or unqualified memberships) the site does not list. */
  absent: { researcherId: string; recordId: number | null; name: string; grade: string; team: string; validated: boolean }[];
}

/** Same normalization as sync_annuaire._norm: no accents, lower case, hyphens and apostrophes as spaces. */
export const normName = (s: unknown): string =>
  String(s ?? '').normalize('NFD').toLowerCase().replace(/\p{M}/gu, '')
    .replace(/[-'’]/g, ' ').replace(/\s+/g, ' ').trim();

const normLab = (s: unknown): string =>
  String(s ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/²/g, '2').replace(/[^a-z0-9]/g, '');

/** Compatible first names: one starts with the other, or same first word. */
const firstNamesMatch = (a: string, b: string): boolean =>
  !!a && !!b && (a.startsWith(b) || b.startsWith(a) || a.split(' ')[0] === b.split(' ')[0]);

/** Typing of a new record from the site (sync_annuaire._classify_new), then the site's grade. */
export const typingOf = (p: SitePerson): { grade: string; employmentType: string } => {
  const position = p.position.toLowerCase();
  let grade = '';
  let employmentType = '';
  if (position.includes('post') && position.includes('doc')) {
    grade = 'POST-DOC';
    employmentType = 'Ch_aut';
  } else if (['doctora', 'phd', 'these', 'thèse'].some((t) => position.includes(t)) || p.role === 'Doctorant/Post-doc') {
    employmentType = 'DOCTORANT';
  }
  if (p.grade) grade = p.grade;
  return { grade, employmentType };
};

/** Value of a field on a researcher's membership of the lab. */
const currentValue = (r: Researcher, membershipTeam: string, field: SiteField): string => {
  switch (field) {
    case 'email': return r.email || '';
    case 'team': return membershipTeam || '';
    case 'profileUrl': return r.profiles?.cvSiteLabo || '';
    case 'directoryUrl': return r.annuaireUrl || '';
    case 'grade': return r.employment?.grade || '';
    case 'photoUrl': return r.photoUrl || '';
  }
};

/** Institution name for an employer label: the institutions the lab's members already use first (the list holds
 * duplicates), then any institution whose name or long label matches. */
export const employerResolver = (institutions: Institution[], labMembers: Researcher[]) => {
  const used = new Map<string, Map<string, number>>();
  for (const r of labMembers) {
    const name = r.employment?.employer || '';
    if (!name) continue;
    const key = normName(name);
    const counts = used.get(key) ?? new Map<string, number>();
    counts.set(name, (counts.get(name) ?? 0) + 1);
    used.set(key, counts);
  }
  const global = new Map<string, string>();
  for (const i of institutions) {
    for (const label of [i.name, i.label]) {
      const key = normName(label);
      if (key && !global.has(key)) global.set(key, i.name);
    }
  }
  return (label: string): string => {
    const key = normName(label);
    if (!key) return '';
    const counts = used.get(key);
    if (counts) return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return global.get(key) ?? '';
  };
};

interface LabMembership { researcher: Researcher; recordId: number | null; team: string; role: string }

/**
 * Plan of an import. `people` = the whole directory (institution scope: the other labs are needed for the
 * multi-affiliation hint), `institutions` = the employers. Pure.
 */
export function planSiteImport(doc: SiteImportDocument, people: Researcher[], institutions: Institution[]): SiteImportPlan {
  const lab = normLab(doc.lab);
  const memberships: LabMembership[] = [];
  const emailLabs = new Map<string, Set<string>>();
  for (const r of people) {
    for (const a of r.affiliations || []) {
      if (normLab(a.structureName) === lab) {
        // Row of the membership; a single-membership record carries it on the researcher only (PostgreSQL model).
        memberships.push({ researcher: r, recordId: a.gristRowId ?? r.gristRowId ?? null, team: a.team || '', role: String(a.role || '').toUpperCase() });
      }
      const email = (r.email || '').trim().toLowerCase();
      if (email) {
        const labs = emailLabs.get(email) ?? new Set<string>();
        labs.add(a.structureName || '');
        emailLabs.set(email, labs);
      }
    }
  }
  const byUid = new Map<string, LabMembership>();
  const byEmail = new Map<string, LabMembership>();
  const byFull = new Map<string, LabMembership>();
  const byLast = new Map<string, LabMembership[]>();
  for (const m of memberships) {
    const r = m.researcher;
    const uid = (r.uid || '').trim();
    if (uid && !byUid.has(uid)) byUid.set(uid, m);
    const email = (r.email || '').trim().toLowerCase();
    if (email && !byEmail.has(email)) byEmail.set(email, m);
    byFull.set(`${normName(r.lastName)}|${normName(r.firstName)}`, m);
    const last = normName(r.lastName);
    byLast.set(last, [...(byLast.get(last) ?? []), m]);
  }

  const match = (p: SitePerson): { m: LabMembership; by: MatchedBy } | null => {
    if (p.uid && byUid.has(p.uid)) return { m: byUid.get(p.uid)!, by: 'uid' };
    const email = p.email.toLowerCase();
    if (email && byEmail.has(email)) return { m: byEmail.get(email)!, by: 'email' };
    const last = normName(p.lastName);
    const first = normName(p.firstName);
    const full = byFull.get(`${last}|${first}`);
    if (full) return { m: full, by: 'name' };
    const candidates = byLast.get(last) ?? [];
    const compatible = candidates.find((c) => firstNamesMatch(normName(c.researcher.firstName), first));
    if (compatible) return { m: compatible, by: 'firstName' };
    return candidates.length === 1 ? { m: candidates[0], by: 'lastName' } : null;
  };

  const resolveEmployer = employerResolver(institutions, memberships.map((m) => m.researcher));
  const plan: SiteImportPlan = {
    lab: doc.lab, source: doc.source, url: doc.url, siteCount: doc.people.length, labCount: memberships.length,
    creations: [], matches: [], ambiguous: [], absent: [],
  };
  const seen = new Set<LabMembership>();
  doc.people.forEach((p, index) => {
    const found = match(p);
    if (!found) {
      const homonyms = byLast.get(normName(p.lastName)) ?? [];
      if (homonyms.length) {
        plan.ambiguous.push({ index, person: p, candidates: homonyms.map((c) => ({ researcherId: c.researcher.id, name: c.researcher.displayName })) });
        return;
      }
      const email = p.email.toLowerCase();
      const otherLabs = email ? [...(emailLabs.get(email) ?? [])].filter((l) => normLab(l) !== lab).sort() : [];
      plan.creations.push({ index, person: p, ...typingOf(p), employer: resolveEmployer(p.employer), sameEmailLabs: otherLabs });
      return;
    }
    const { m, by } = found;
    seen.add(m);
    const complements: SiteImportMatch['complements'] = [];
    const differences: SiteImportMatch['differences'] = [];
    for (const field of SITE_FIELDS) {
      const site = p[field];
      if (!site) continue;
      const current = currentValue(m.researcher, m.team, field).trim();
      if (!current) complements.push({ field, value: site });
      else if (current !== site && !COMPLEMENT_ONLY.includes(field)) differences.push({ field, current, site });
    }
    const validated = !!m.researcher.validation?.validated;
    plan.matches.push({
      index, person: p, researcherId: m.researcher.id, recordId: m.recordId, name: m.researcher.displayName, matchedBy: by,
      complements, differences, validated,
      // A SECONDAIRE / HISTORIQUE membership is not validated from another lab's site.
      toValidate: !validated && m.role !== 'SECONDAIRE' && m.role !== 'HISTORIQUE',
    });
  });
  // Present on the site under another spelling than the matched one: the name rule of sync_annuaire (validate
  // present) also counts them as present.
  const siteNames = doc.people.map((p) => ({ last: normName(p.lastName), first: normName(p.firstName) }));
  const onSite = (r: Researcher) => {
    const last = normName(r.lastName);
    const first = normName(r.firstName);
    return siteNames.some((s) => s.last === last && (s.first === first || firstNamesMatch(s.first, first)));
  };
  for (const m of memberships) {
    if (seen.has(m) || m.role === 'SECONDAIRE' || m.role === 'HISTORIQUE' || !normName(m.researcher.lastName)) continue;
    if (onSite(m.researcher)) continue;
    plan.absent.push({
      researcherId: m.researcher.id, recordId: m.recordId, name: m.researcher.displayName,
      grade: m.researcher.employment?.grade || '', team: m.team, validated: !!m.researcher.validation?.validated,
    });
  }
  return plan;
}

// ── Application (8 d3) ──────────────────────────────────────────────────────────────────────────────────────

/** What the user kept in the review. Indexes are the people's positions in the file. */
export const SiteImportSelectionSchema = z.object({
  creations: z.array(z.number().int().min(0)).max(5000).default([]),
  /** Fields to write on matched members: complements and the differences ticked (« the site is right »). */
  fields: z.array(z.object({ index: z.number().int().min(0), field: z.enum(SITE_FIELDS as [SiteField, ...SiteField[]]) })).max(30000).default([]),
  /** Matched members to validate (present on the site). */
  validate: z.array(z.number().int().min(0)).max(5000).default([]),
  /** Validate the created records too. */
  validateNew: z.boolean().default(false),
});
export type SiteImportSelection = z.infer<typeof SiteImportSelectionSchema>;

export interface SiteImportResult {
  created: number;
  updated: number;
  validated: number;
  /** Items the plan no longer has (the directory changed since the preview): not applied. */
  stale: number;
  errors: { index: number; name: string; error: string }[];
}

/** Commands the application needs (lib/directory/commands.ts, Grist or PostgreSQL). */
export interface SiteImportCommands {
  createPerson(researcher: Researcher, ctx: any): Promise<{ recordId: number }>;
  updatePerson(recordId: number, researcher: Researcher, ctx: any): Promise<void>;
  applyValidations(entries: { recordId: number; validation: any }[], ctx: any): Promise<number>;
}

/** Site presence → validated presence (INTERNE / EXTERNE written by older parsers read as PRESENT). */
export const presenceOfSite = (status: string): 'PRESENT' | 'DEPART' | 'PARTI' => {
  const s = status.trim().toUpperCase();
  return s === 'DEPART' || s === 'PARTI' ? s : 'PRESENT';
};

const validationOf = (status: string, source: string, today: string, actor: string) => ({
  validated: true, validatedStatus: presenceOfSite(status), validationDate: today, validationSource: source,
  validationScope: ['statut', 'rattachement'], validatedBy: actor,
});

/** A researcher with the site's values written on the given fields (the lab's membership for the team). */
export const withSiteFields = (r: Researcher, lab: string, p: SitePerson, fields: SiteField[]): Researcher => {
  const out: Researcher = structuredClone(r);
  for (const field of fields) {
    const v = p[field];
    if (!v) continue;
    if (field === 'email') out.email = v;
    else if (field === 'profileUrl') out.profiles = { ...(out.profiles || {}), cvSiteLabo: v };
    else if (field === 'directoryUrl') out.annuaireUrl = v;
    else if (field === 'grade') out.employment = { ...out.employment, grade: v };
    else if (field === 'photoUrl') out.photoUrl = v;
    else if (field === 'team') {
      const a = out.affiliations.find((x) => normLab(x.structureName) === normLab(lab));
      if (a) a.team = v;
    }
  }
  return out;
};

/** New record of a site person (creation of the plan). */
export const newResearcherOf = (c: SiteImportCreation, lab: string, source: string, validation: ReturnType<typeof validationOf> | null): Researcher => {
  const p = c.person;
  return {
    id: '', uid: p.uid, lastName: p.lastName, firstName: p.firstName, displayName: `${p.lastName.toUpperCase()} ${p.firstName}`.trim(),
    civility: '', email: p.email, status: '' as any,
    employment: { employer: c.employer, grade: c.grade, contractType: c.employmentType },
    affiliations: [{ structureName: lab, team: p.team, startDate: '', isPrimary: true }],
    groups: [], identifiers: {}, photoUrl: p.photoUrl, annuaireUrl: p.directoryUrl,
    profiles: p.profileUrl ? { cvSiteLabo: p.profileUrl } : {},
    ...(validation ? { validation: validation as any } : {}),
    importSource: source,
  } as Researcher;
};

/**
 * Applies the rows the user kept. The plan is computed again here from the file and the current directory (the
 * browser's copy is never trusted): an item the plan no longer has is counted as stale and skipped. Order: creations,
 * then field updates, then validations (an update rewrites the record, its validation included).
 */
export async function applySiteImport(args: {
  doc: SiteImportDocument; selection: SiteImportSelection; people: Researcher[]; institutions: Institution[];
  commands: SiteImportCommands; ctx: any; today: string; actor: string;
}): Promise<SiteImportResult> {
  const { doc, selection, people, institutions, commands, ctx, today, actor } = args;
  const plan = planSiteImport(doc, people, institutions);
  const source = doc.source || `Site ${doc.lab}`;
  // Lab label as the directory writes it (the file may differ in case or accents).
  const lab = people.flatMap((r) => r.affiliations || []).find((a) => normLab(a.structureName) === normLab(doc.lab))?.structureName || doc.lab;
  const result: SiteImportResult = { created: 0, updated: 0, validated: 0, stale: 0, errors: [] };
  const fail = (index: number, name: string, e: unknown) =>
    result.errors.push({ index, name, error: e instanceof Error ? e.message : String(e) });

  const creations = new Map(plan.creations.map((c) => [c.index, c]));
  for (const index of new Set(selection.creations)) {
    const c = creations.get(index);
    if (!c) { result.stale++; continue; }
    try {
      await commands.createPerson(newResearcherOf(c, lab, source, selection.validateNew ? validationOf(c.person.status, source, today, actor) : null), ctx);
      result.created++;
    } catch (e) { fail(index, `${c.person.firstName} ${c.person.lastName}`.trim(), e); }
  }

  const matches = new Map(plan.matches.map((m) => [m.index, m]));
  const fieldsOf = new Map<number, Set<SiteField>>();
  for (const { index, field } of selection.fields) fieldsOf.set(index, (fieldsOf.get(index) ?? new Set()).add(field));
  const byId = new Map(people.map((r) => [r.id, r]));
  for (const [index, fields] of fieldsOf) {
    const m = matches.get(index);
    const offered = new Set([...(m?.complements ?? []).map((c) => c.field), ...(m?.differences ?? []).map((d) => d.field)]);
    const kept = [...fields].filter((f) => offered.has(f));
    if (!m || kept.length < fields.size) result.stale++;
    if (!m || !kept.length) continue;
    const r = byId.get(m.researcherId);
    try {
      if (!r?.gristRowId) throw new Error('record without row id');
      await commands.updatePerson(r.gristRowId, withSiteFields(r, lab, m.person, kept), ctx);
      result.updated++;
    } catch (e) { fail(index, m.name, e); }
  }

  const toValidate = [...new Set(selection.validate)].map((index) => ({ index, m: matches.get(index) }));
  const entries: { recordId: number; validation: any }[] = [];
  for (const { index, m } of toValidate) {
    if (!m || !m.toValidate || !m.recordId) { result.stale++; continue; }
    entries.push({ recordId: m.recordId, validation: validationOf(m.person.status, source, today, actor) });
  }
  if (entries.length) {
    try { result.validated = await commands.applyValidations(entries, ctx); } catch (e) { fail(-1, 'validations', e); }
  }
  return result;
}
