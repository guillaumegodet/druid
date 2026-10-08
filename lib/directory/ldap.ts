// LDAP review of the directory (Nantes, capability HAS_LDAP): diff LDAP cache ↔ Annuaire, attachment of the
// records without uid (candidates), LDAP structures ↔ Structures table, « marked as left », and the Grist writes of
// each. Pure module (no network): the domain API reads the caches and the tables, then runs these functions on the
// server (druid-internal docs/plan-migration-postgresql.md, lot 2 d). Types and bodies moved verbatim out of
// lib/gristService.ts; the browser only receives the diffs and sends back the selected ids.
import { Presence } from '../../types';
import { normalizeCivility } from '../civility';
import { ldapGradeFor, resolveGrade, hasEmeritusTrace, EmeritusSignals } from '../emeritus';
import { parseValidation, isExternalEmployer } from '../validation';
import { fuzzyDateUpperBound } from '../dates';
import { HR_ID_COLUMN, hrIdCell, hrIdProposal } from '../hrId';
import { STATUT_DYNA_MAP } from '../ldapCodes';
import { computeDuplicateGroups, DuplicateGroup } from './duplicates';
import { AFFILIATION_END_COL, GristRecord, fromGristDate, fromGristFuzzyDate, parseMultiLabel } from './gristMapping';
import { FuzzyDateEncoder, toGristEpoch } from './annuaireWrite';
import type { LdapDuplicateKind } from '../mergeProposal';

export interface LdapFieldChange {
  field: string;   // Grist column (Annuaire)
  label: string;   // human-readable label
  before: string;  // current Grist value
  after: string;   // value coming from LDAP
}

export interface LdapDiff {
  generatedAt: string;
  stats: {
    ldapTotal: number;
    gristTotal: number;
    aMettreAJour: number;
    /** Duplicate groups NOT yet qualified (pending). */
    doublonsUid: number;
    /** Qualified groups (declared multi-affiliation or « à revoir »). */
    qualifiedDuplicates?: number;
    /** Breakdown of unqualified groups by class (see `doublonsUid[].kind`). */
    duplicatesByKind?: Record<LdapDuplicateKind, number>;
    orphelins: number;
    ldapWithoutRecord: number;
  };
  /** Existing records (uid_dyna match) where ≥1 LDAP-authoritative field differs.
   * `validated`: the record carries a manual validation; `validationConflict`:
   * an LDAP change contradicts the validated status → to arbitrate, not to overwrite. */
  aMettreAJour: { id: string; uid: string; displayName: string; labo?: string; changes: LdapFieldChange[]; validated?: boolean; validationConflict?: boolean;
    /** The record holds another HR staff number than LDAP: unchecked by default (two people mixed up, or a wrong uid). */
    hrIdConflict?: boolean }[];
  /** Same uid_dyna on ≥2 Annuaire rows. `kind` classifies the group (see docs/archive/plan-fusion-doublons.md):
   * - same_labo  : every row carries the same LABO → probable duplicate, to merge;
   * - parking    : one row sits in a parking LABO (`zzz`, empty) → to absorb into the lab row;
   * - multi_labo : different LABOs → multi-affiliation (concurrent or successive) to qualify.
   * `ids`/`names` kept for compatibility; `rows` carries the per-row detail. */
  doublonsUid: DuplicateGroup[];
  /** Grist record whose uid_dyna is missing from LDAP (probable departure).
   * `validated`: presence validated manually → do not conclude a departure without review. */
  orphelins: { id: string; uid: string; displayName: string; validated?: boolean }[];
  /** uids present in LDAP but missing from the Annuaire (creation in Phase 2) */
  ldapWithoutRecord: string[];
}

/** Diff structures LDAP (supannEntite) ↔ table Grist Structures. */
export interface StructuresLdapDiff {
  generatedAt: string;
  stats: { ldapTotal: number; gristTotal: number; aMettreAJour: number; aCreer: number; orphelins: number };
  /** Existing structures (local_id match) to update (type / name if empty / LDAP code / parent) */
  aMettreAJour: { id: string; local_id: string; displayName: string; rattachement?: string; changes: LdapFieldChange[] }[];
  /** LDAP structures missing from Grist → to create */
  aCreer: { local_id: string; displayName: string; type: string; rattachement?: string; fields: Record<string, any> }[];
  /** Grist structures whose local_id is outside the LDAP scope (info) */
  orphelins: { id: string; local_id: string; displayName: string }[];
}

/**
 * Service to interact with the collaborative Grist document.
 */
/** LDAP entry proposed to attach a record without uid (search by email). */
export interface LdapCandidateMatch {
  uid: string;
  displayName: string;
  sn?: string;
  givenName?: string;
  etat?: string;
  categorie?: string; // dynaCategorie (emeritus → PREM/MCFEM grade, see lib/emeritus.ts)
  empCorps?: string;
  civilite?: string;
  birthDate?: string;
  eppn?: string;
}

/** A proposal « Annuaire record without uid » ↔ « LDAP staff member » (1 sure candidate). */
export interface LdapCandidate {
  gristRowId: number;
  nom: string;
  prenom: string;
  email: string;
  labo: string;
  matchedBy?: 'email' | 'name';
  ldap: LdapCandidateMatch;
  /** The proposed uid is ALREADY carried by another row of the same LABO: attaching would create a
   * duplicate → propose merging the two rows instead (duplicate merge plan, lot 4). */
  duplicateOf?: { gristRowId: number; name: string };
}

/** Record without uid with several LDAP homonyms → manual arbitration required. */
export interface LdapAmbiguous {
  gristRowId: number;
  nom: string;
  prenom: string;
  email: string;
  labo: string;
  candidates: LdapCandidateMatch[];
}

/** A resolved entry ready to write (accepted proposal or arbitrated homonym). */
export interface LdapResolved {
  gristRowId: number;
  email: string;
  ldap: LdapCandidateMatch;
}

/** Result of the LDAP candidate search (email + name, with homonyms). */
export interface LdapCandidatesDiff {
  generatedAt?: string;
  /** Records matched to a single candidate (email, or unique name) → ready to attach. */
  proposals: LdapCandidate[];
  /** Records with several homonyms → to arbitrate. */
  ambiguous: LdapAmbiguous[];
  /** Cache entries attached in the meantime (ignored). */
  alreadyLinked: number;
  /** LDAP uid → Annuaire row already carrying it, per LABO (`uid::LABO`) — to flag the
   * homonyms where a candidate would create a duplicate. */
  uidTaken?: Record<string, { gristRowId: number; name: string }>;
}

/** Grist write of the LDAP tools: one record's cells. */
export interface RecordPatch { id: number; fields: Record<string, any> }

/**
 * Diff LDAP cache (ldap_status_cache.json, keyed by uid) ↔ Annuaire rows (raw Grist values). `etablissementsRows`:
 * the Etablissements table (employer external to Nantes Université ⇒ hosted LDAP account). Formerly
 * GristService.computeLdapDiff.
 */
export function computeLdapDiffFrom(records: GristRecord[], etablissementsRows: GristRecord[], ldapCache: Record<string, any>): LdapDiff {
  const etabs: Record<number, { name: string; uai: string }> = {};
  for (const r of etablissementsRows) etabs[r.id] = { name: String(r.fields['Employeur'] || ''), uai: String(r.fields['UAI'] || '') };

  const hasExternalEmployer = (f: any): boolean => {
    const id = f['Employeur'];
    const e = (typeof id === 'number') ? etabs[id] : undefined;
    return e ? isExternalEmployer(e.name, e.uai) : isExternalEmployer(typeof id === 'number' ? '' : id, '');
  };

  const fmtBirth = (b: string): string => {
    if (!b) return '';
    return /^\d{8}$/.test(b) ? `${b.slice(0, 4)}-${b.slice(4, 6)}-${b.slice(6, 8)}` : b;
  };
  const nameOf = (f: any) => `${(f['Nom'] || '').toUpperCase()} ${f['Prenom'] || ''}`.trim();

  // Index uid_dyna -> records
  const byUid: Record<string, any[]> = {};
  for (const rec of records) {
    const uid = rec.fields['uid_dyna'];
    if (uid) (byUid[uid] = byUid[uid] || []).push(rec);
  }

  const aMettreAJour: LdapDiff['aMettreAJour'] = [];
  const orphelins: LdapDiff['orphelins'] = [];

  // uid_dyna duplicates (same uid on ≥2 records): same computation as the « Doublons » page
  // (computeDuplicateGroups, on the Annuaire alone), kept here for the diff counters.
  const { doublonsUid, duplicatesByKind } = computeDuplicateGroups(records);

  // Diff per matched LDAP entry — on EVERY row carrying the uid (a duplicated or
  // multi-affiliated person has several records; before, only the 1st was compared
  // and the others stayed stale).
  for (const [uid, entry] of Object.entries(ldapCache)) {
    const recs = byUid[uid];
    if (!recs || recs.length === 0) continue;
    const e: any = entry;
    for (const rec of recs) {
      const f = rec.fields;
      const changes: LdapFieldChange[] = [];
      const push = (field: string, label: string, before: any, after: any) => {
        const b = (before ?? '').toString().trim();
        const a = (after ?? '').toString().trim();
        if (a && a !== b) changes.push({ field, label, before: b, after: a }); // never clear when LDAP is empty
      };
      // External employer (INSERM, CNRS, Centrale…) with a hosted LDAP account: the LDAP state,
      // employment end, category (« CDI UNIVERSITE ») and corps describe the account, not the
      // actual job → only civility and birth date are proposed; derived status EXTERNE.
      const externalEmployer = hasExternalEmployer(f);
      push('Civilite', 'Civilité', normalizeCivility(f['Civilite'] || f['Civilité'] || ''), normalizeCivility(e.civilite || ''));
      if (!externalEmployer) {
        // Grade: LDAP corps, transposed to an emeritus code when a trace of emeritus status exists (LDAP or Grist) —
        // otherwise the sync proposed PR/MCF again for an emeritus (LDAP keeps the original corps).
        const ldapBase = ldapGradeFor(e.categorie, e.empCorps, f['Corps_grade']);
        const gradeSignals: EmeritusSignals = { grade: f['Corps_grade'], typeEmploi: f['TYPE_EMPLOI'], libTypeEmploi: f['LIB_TYPE_EMPLOI'], ldapCategory: e.categorie };
        const gradeTarget = hasEmeritusTrace(gradeSignals) ? resolveGrade(ldapBase ?? f['Corps_grade'] ?? '', gradeSignals) : (ldapBase || '');
        push('Corps_grade', 'Grade', f['Corps_grade'] || '', gradeTarget);
        push('TYPE_EMPLOI', 'Type emploi', f['TYPE_EMPLOI'] || '', e.categorie || '');
      }
      push('DATE_DE_NAISSANCE_JJ_MM_AAAA', 'Date naissance', fromGristDate(f['DATE_DE_NAISSANCE_JJ_MM_AAAA']), fmtBirth(e.birthDate || ''));
      // Employment end: « [datefin=…] » of supannEmpProfil (`dateFin` cache, YYYY-MM-DD). Added on
      // 2026-09-15: before, an LDAP departure never surfaced the date in employment_end_date.
      if (!externalEmployer) push('employment_end_date', "Fin d'emploi", fromGristFuzzyDate(f['employment_end_date']), e.dateFin || '');
      // HR staff number (supannEmpId, lib/hrId.ts): for hosted accounts too — it identifies the person, not the job.
      const hrId = hrIdProposal(f[HR_ID_COLUMN], e.empId);
      if (hrId) changes.push({ field: HR_ID_COLUMN, label: 'N° agent', before: hrId.before, after: hrId.after });
      // Status: Grist stores a label ("NORMAL"), LDAP a code ("N") → compare on the code,
      // and propose the mapped label as the target value. (statut_dyna made editable on the Grist side.)
      const statutCode = (v: any) => (v ?? '').toString().trim().toUpperCase().charAt(0);
      if (!externalEmployer && e.etat && statutCode(f['statut_dyna']) !== statutCode(e.etat)) {
        changes.push({
          field: 'statut_dyna',
          label: 'Statut (dynaEtat)',
          before: (f['statut_dyna'] || '').toString().trim(),
          after: STATUT_DYNA_MAP[String(e.etat).toUpperCase()] || String(e.etat),
        });
      }
      // Manually validated presence contradicted by LDAP (e.g. « present » from a lab website, but
      // dynaEtat = D): the record displays the validated presence, so the departure stays invisible
      // until the validation is aligned. Proposed as a change to arbitrate (conflict). For another
      // employer the account is a hosted one and says nothing about the presence (D3).
      const v = parseValidation(f, fromGristDate);
      if (e.etat && !externalEmployer && v.validated && v.validationScope.includes('statut') && v.validatedStatus) {
        const derived = String(e.etat).trim().toUpperCase().startsWith('D') ? Presence.DEPART : Presence.PRESENT;
        if (v.validatedStatus !== derived) {
          changes.push({ field: 'validated_status', label: 'Statut validé', before: v.validatedStatus, after: derived });
        }
      }
      if (changes.length) {
        // Validation guard: if the record is validated on the status, an LDAP status
        // change becomes a conflict to arbitrate (LDAP must not overwrite).
        const validationConflict =
          v.validated && v.validationScope.includes('statut')
          && changes.some((c) => c.field === 'statut_dyna' || c.field === 'validated_status');
        aMettreAJour.push({
          id: `G-${rec.id}`, uid, displayName: nameOf(f), changes,
          labo: recs.length > 1 ? String(f['LABO'] || '').trim() : undefined,
          validated: v.validated, validationConflict,
          hrIdConflict: hrId?.kind === 'conflict',
        });
      }
    }
  }

  // Orphans: Grist record whose uid_dyna is no longer in LDAP
  for (const [uid, recs] of Object.entries(byUid)) {
    if (!ldapCache[uid]) {
      for (const rec of recs) {
        const v = parseValidation(rec.fields, fromGristDate);
        orphelins.push({ id: `G-${rec.id}`, uid, displayName: nameOf(rec.fields), validated: v.validated });
      }
    }
  }

  // LDAP uid without Annuaire record
  const ldapWithoutRecord = Object.keys(ldapCache).filter((uid) => !byUid[uid]);

  return {
    generatedAt: new Date().toISOString(),
    stats: {
      ldapTotal: Object.keys(ldapCache).length,
      gristTotal: records.length,
      aMettreAJour: aMettreAJour.length,
      doublonsUid: doublonsUid.filter((d) => !d.qualified).length,
      qualifiedDuplicates: doublonsUid.filter((d) => d.qualified).length,
      duplicatesByKind,
      orphelins: orphelins.length,
      ldapWithoutRecord: ldapWithoutRecord.length,
    },
    aMettreAJour,
    doublonsUid,
    orphelins,
    ldapWithoutRecord,
  };
}

/** Cells written by « apply the LDAP updates » for the selected diff entries (formerly GristService.applyLdapUpdates).
 * `byId`: current fields of the Annuaire rows (to append to Data_source / Commentaires without overwriting). */
export function ldapUpdatePatches(entries: LdapDiff['aMettreAJour'], byId: Record<number, any>, today: string, encodeDate: FuzzyDateEncoder): RecordPatch[] {
  const patchRecords = entries.map((e) => {
    const gid = parseInt(e.id.replace('G-', ''));
    const cur = byId[gid] || {};
    const fields: Record<string, any> = {};

    for (const c of e.changes) {
      if (c.field === 'employment_end_date') {
        const cell = encodeDate(c.field, c.after);   // fuzzy-date column (text once migrated, else epoch)
        if (cell !== null) fields[c.field] = cell;
      } else if (c.field === 'DATE_DE_NAISSANCE_JJ_MM_AAAA') {
        const ep = toGristEpoch(c.after);
        if (ep !== null) fields[c.field] = ep; // Date column = epoch seconds
      } else if (c.field === HR_ID_COLUMN) {
        fields[c.field] = hrIdCell(c.after);   // Numeric column
      } else if (c.field === 'validated_status') {
        // Explicit arbitration (record checked despite the conflict): the validated status follows LDAP,
        // the validation is re-dated; original source and author kept (traceability).
        fields[c.field] = c.after;
        fields['validation_date'] = toGristEpoch(today);
      } else {
        fields[c.field] = c.after; // Civilite/Corps_grade (Choice), TYPE_EMPLOI/statut_dyna (Text)
      }
    }

    // Traceability
    const curSrc = (cur['Data_source'] || '').toString();
    const hasLdap = curSrc.split(/[|,]/).map((s: string) => s.trim().toUpperCase()).includes('LDAP');
    fields['Data_source'] = hasLdap ? curSrc : (curSrc ? `${curSrc}|LDAP` : 'LDAP');
    fields['LDAP_derniere_maj'] = today;
    fields['LDAP_champs_modifies'] = e.changes.map((c) => c.field).join('|');
    const note = `[${today}] MAJ LDAP: ${e.changes.map((c) => c.label).join(', ')}`;
    const curCom = (cur['Commentaires'] || '').toString();
    fields['Commentaires'] = curCom ? `${curCom}\n${note}` : note;

    return { id: gid, fields };
  });
  return patchRecords;
}

/** « Mark as left » (LDAP « Arrivals and departures » tab): statut_dyna = DEPART and employment / membership end = the
 * date the account left (unless an earlier end is recorded), with LDAP traceability (formerly GristService.markLdapDeparted). */
export function markDepartedPatches(rows: { rowId: number; fields: Record<string, any> }[], date: string, accountLabel: string, today: string, encodeDate: FuzzyDateEncoder): RecordPatch[] {
  const patches: RecordPatch[] = [];
  for (const { rowId, fields: cur } of rows) {
    const fields: Record<string, any> = {};
    const changed: string[] = [];
    if (String(cur['statut_dyna'] ?? '').trim().toUpperCase().charAt(0) !== 'D') { fields['statut_dyna'] = STATUT_DYNA_MAP.D; changed.push('statut_dyna'); }
    for (const col of ['employment_end_date', AFFILIATION_END_COL]) {
      const end = fromGristFuzzyDate(cur[col]);
      if (end && fuzzyDateUpperBound(end) <= date) continue;
      const cell = encodeDate(col, date);
      if (cell !== null) { fields[col] = cell; changed.push(col); }
    }
    if (changed.length === 0) continue;
    const curSrc = (cur['Data_source'] || '').toString();
    const hasLdap = curSrc.split(/[|,]/).map((s: string) => s.trim().toUpperCase()).includes('LDAP');
    fields['Data_source'] = hasLdap ? curSrc : (curSrc ? `${curSrc}|LDAP` : 'LDAP');
    fields['LDAP_derniere_maj'] = today;
    fields['LDAP_champs_modifies'] = changed.join('|');
    const note = `[${today}] Départ LDAP : ${accountLabel} depuis le ${date}`;
    const curCom = (cur['Commentaires'] || '').toString();
    fields['Commentaires'] = curCom ? `${curCom}\n${note}` : note;
    patches.push({ id: rowId, fields });
  }
  return patches;
}

/** Candidates cache (ldap_candidates_cache.json) minus the records attached since, with the uid already carried in the
 * same lab flagged (formerly GristService.computeLdapCandidatesDiff). */
export function computeLdapCandidatesDiffFrom(cache: any, records: GristRecord[]): LdapCandidatesDiff {
  const proposals: LdapCandidate[] = Array.isArray(cache?.proposals) ? cache.proposals : [];
  const ambiguous: LdapAmbiguous[] = Array.isArray(cache?.ambiguous) ? cache.ambiguous : [];
  const linked = new Set<number>();
  // uid::LABO → row already carrying this uid in this lab (duplicate prevention)
  const uidTaken: Record<string, { gristRowId: number; name: string }> = {};
  for (const rec of records) {
    const uid = String(rec.fields['uid_dyna'] || '').trim();
    if (!uid) continue;
    linked.add(rec.id);
    const key = `${uid}::${String(rec.fields['LABO'] || '').trim()}`;
    if (!uidTaken[key]) uidTaken[key] = { gristRowId: rec.id, name: `${String(rec.fields['Nom'] || '').toUpperCase()} ${rec.fields['Prenom'] || ''}`.trim() };
  }
  const freshP = proposals.filter((p) => !linked.has(p.gristRowId)).map((p) => {
    const dup = uidTaken[`${p.ldap.uid}::${String(p.labo || '').trim()}`];
    return dup && dup.gristRowId !== p.gristRowId ? { ...p, duplicateOf: dup } : p;
  });
  const freshA = ambiguous.filter((a) => !linked.has(a.gristRowId));
  const alreadyLinked = (proposals.length - freshP.length) + (ambiguous.length - freshA.length);
  return { generatedAt: cache?.generatedAt, proposals: freshP, ambiguous: freshA, alreadyLinked, uidTaken };
}

/** Cells written by « attach to LDAP » for resolved entries: uid_dyna, and Civilite / Corps_grade / birth date only when
 * empty; a uid already carried by another row of the same lab is skipped (formerly GristService.applyLdapCandidates). */
export function ldapCandidatePatches(entries: LdapResolved[], records: GristRecord[], today: string): { patches: RecordPatch[]; skippedDuplicates: { gristRowId: number; uid: string; existingRowId: number }[] } {
  const byId: Record<number, any> = {};
  records.forEach((r: any) => { byId[r.id] = r.fields; });

  // Duplicate guard (lot 4): a uid already carried by another row of the SAME lab is
  // not reassigned — the right action is merging the two rows, not a 2nd attachment.
  const uidByLabo: Record<string, number> = {};
  for (const r of records) {
    const uid = String(r.fields['uid_dyna'] || '').trim();
    if (uid) uidByLabo[`${uid}::${String(r.fields['LABO'] || '').trim()}`] ??= r.id;
  }
  const skippedDuplicates: { gristRowId: number; uid: string; existingRowId: number }[] = [];
  entries = entries.filter((p) => {
    const labo = String(byId[p.gristRowId]?.['LABO'] || '').trim();
    const existing = uidByLabo[`${p.ldap.uid}::${labo}`];
    if (existing && existing !== p.gristRowId) { skippedDuplicates.push({ gristRowId: p.gristRowId, uid: p.ldap.uid, existingRowId: existing }); return false; }
    return true;
  });
  if (entries.length === 0) return { patches: [], skippedDuplicates };

  const normBirth = (b: string): string | null => {
    const s = String(b || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  };

  const patchRecords = entries.map((p) => {
    const cur = byId[p.gristRowId] || {};
    const fields: Record<string, any> = { uid_dyna: p.ldap.uid };
    const setIfEmpty = (col: string, val: any) => {
      if (val && !String(cur[col] || '').trim()) fields[col] = val;
    };
    setIfEmpty('Civilite', normalizeCivility(p.ldap.civilite || ''));
    // supannEmpCorps = BCN N_CORPS code (e.g. « 057 ») → mapped to a Druid grade (MCF/PR/TECH…),
    // transposed to an emeritus code when dynaCategorie says emeritus (see lib/emeritus.ts).
    const grade = ldapGradeFor(p.ldap.categorie, p.ldap.empCorps);
    setIfEmpty('Corps_grade', grade);
    if (!String(cur['DATE_DE_NAISSANCE_JJ_MM_AAAA'] || '').trim()) {
      const nb = normBirth(p.ldap.birthDate || '');
      const ep = nb ? toGristEpoch(nb) : null;
      if (ep !== null) fields['DATE_DE_NAISSANCE_JJ_MM_AAAA'] = ep;
    }
    // Traceability (same convention as the LDAP status sync)
    const curSrc = (cur['Data_source'] || '').toString();
    const hasLdap = curSrc.split(/[|,]/).map((s: string) => s.trim().toUpperCase()).includes('LDAP');
    fields['Data_source'] = hasLdap ? curSrc : (curSrc ? `${curSrc}|LDAP` : 'LDAP');
    fields['LDAP_derniere_maj'] = today;
    const via = p.email && p.email.includes('@') ? `email (${p.email})` : 'nom';
    const note = `[${today}] Rattachement LDAP par ${via} → uid ${p.ldap.uid}`;
    const curCom = (cur['Commentaires'] || '').toString();
    fields['Commentaires'] = curCom ? `${curCom}\n${note}` : note;
    return { id: p.gristRowId, fields };
  });
  return { patches: patchRecords, skippedDuplicates };
}

/** Diff LDAP structures cache (structures_ldap_cache.json, supannEntite) ↔ Structures rows (formerly
 * GristService.computeStructuresLdapDiff). */
export function computeStructuresLdapDiffFrom(records: GristRecord[], cache: Record<string, any>, today: string): StructuresLdapDiff {

  const byLid: Record<string, any> = {};
  records.forEach((r: any) => { const l = r.fields['local_id']; if (l !== undefined && l !== null && String(l) !== '') byLid[String(l)] = r; });

  const parseOuLeaf = (leaf: string) => {
    const tk = (leaf || '').split(/\s+/).filter(Boolean);
    const last = tk[tk.length - 1] || '';
    return { acronym: /[A-Za-zÀ-ÿ]/.test(last) ? last : '', name: leaf || '' };
  };

  // Index by supannCodeEntite to resolve the direct hierarchical parent (supannCodeEntiteParent).
  // In LDAP: team (ER) → lab (UMR/UR) → faculty (UFR). Poles are standalone.
  // Only resolved when the parent is within scope (administrative parents — DGS… — are ignored).
  const byCode: Record<string, any> = {};
  for (const e of Object.values(cache)) { const c = (e as any).code; if (c) byCode[String(c)] = e; }
  const resolveParentRef = (e: any): string => {
    if (!e.parent) return '';
    const p = byCode[String(e.parent)];
    if (!p) return '';
    const { acronym, name } = parseOuLeaf(p.ouLeaf);
    return acronym || name || '';
  };

  const aMettreAJour: StructuresLdapDiff['aMettreAJour'] = [];
  const aCreer: StructuresLdapDiff['aCreer'] = [];
  const orphelins: StructuresLdapDiff['orphelins'] = [];
  const seen = new Set<string>();

  for (const entry of Object.values(cache)) {
    const e: any = entry;
    const lid = String(e.code || ''); // local_id Grist = supannCodeEntite
    if (!lid) continue;
    const rec = byLid[lid];
    const { acronym, name } = parseOuLeaf(e.ouLeaf);
    const parentLab = resolveParentRef(e); // direct parent (acronym): ER→lab, UMR/UR→UFR
    if (rec) {
      seen.add(lid);
      const f = rec.fields;
      const changes: LdapFieldChange[] = [];
      if (e.type && String(f['type'] || '') !== e.type) changes.push({ field: 'type', label: 'Type', before: String(f['type'] || ''), after: e.type });
      if (e.code && !String(f['supann_code_entite'] || '').trim()) changes.push({ field: 'supann_code_entite', label: 'Code entité LDAP', before: '', after: e.code });
      // Name: only when the Grist label is empty (the bridge labels are better)
      if (acronym && !String(f['short_labels'] || '').trim()) changes.push({ field: 'short_labels', label: 'Sigle', before: '', after: `${acronym}[fr]` });
      if (name && !String(f['long_labels'] || '').trim()) changes.push({ field: 'long_labels', label: 'Nom', before: '', after: `${name}[fr]` });
      // Hierarchical parent (direct LDAP parent): filled / fixed when different
      if (parentLab && String(f['parent_structure'] || '').trim() !== parentLab) changes.push({ field: 'parent_structure', label: 'Rattachement (parent)', before: String(f['parent_structure'] || ''), after: parentLab });
      if (changes.length) aMettreAJour.push({ id: `S-${rec.id}`, local_id: lid, displayName: parseMultiLabel(f['short_labels']) || name || lid, rattachement: parentLab, changes });
    } else {
      // Creation: always set the same keys (uniform POST batch)
      const fields: Record<string, any> = {
        local_id: lid,
        supann_code_entite: lid,
        generic_type: 'unit',
        type: e.type || '',
        short_labels: acronym ? `${acronym}[fr]` : '',
        long_labels: name ? `${name}[fr]` : '',
        parent_structure: parentLab,
        LDAP_derniere_maj: today,
        LDAP_champs_modifies: 'création',
      };
      aCreer.push({ local_id: lid, displayName: acronym || name || lid, type: e.type || '', rattachement: parentLab, fields });
    }
  }

  for (const [lid, rec] of Object.entries(byLid)) {
    if (!seen.has(lid)) orphelins.push({ id: `S-${rec.id}`, local_id: lid, displayName: parseMultiLabel(rec.fields['short_labels']) || lid });
  }

  return {
    generatedAt: new Date().toISOString(),
    stats: { ldapTotal: Object.keys(cache).length, gristTotal: records.length, aMettreAJour: aMettreAJour.length, aCreer: aCreer.length, orphelins: orphelins.length },
    aMettreAJour, aCreer, orphelins,
  };
}

/** Writes of « apply the structure updates »: PATCHes of the selected updates, POSTs of the selected creations
 * (formerly GristService.applyStructuresLdapUpdates). */
export function structuresLdapWrites(diff: StructuresLdapDiff, updateIds: string[], createKeys: string[], today: string): { updates: RecordPatch[]; creates: { fields: Record<string, any> }[] } {
  const upSel = new Set(updateIds);
  const crSel = new Set(createKeys);
  const ups = diff.aMettreAJour.filter((r) => upSel.has(r.id)).map((r) => {
    const fields: Record<string, any> = {};
    for (const c of r.changes) fields[c.field] = c.after;
    fields['LDAP_derniere_maj'] = today;
    fields['LDAP_champs_modifies'] = r.changes.map((c) => c.field).join('|');
    return { id: parseInt(r.id.replace('S-', '')), fields };
  });

  const crs = diff.aCreer.filter((c) => crSel.has(c.local_id)).map((c) => ({ fields: { ...c.fields, LDAP_derniere_maj: today } }));
  return { updates: ups, creates: crs };
}
