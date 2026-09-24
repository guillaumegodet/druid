/**
 * @file abesExport.ts
 * @description "IdRef enrichment" export for the ABES
 * (docs/plan-export-abes-idref.md, lot 2). **Pure** module: no network or DOM access,
 * so that it is testable offline and portable to the Druid demo.
 *
 * Inputs: Druid records (status already resolved), structures and institutions (with their
 * IdRef PPN), `idref_align_cache.json` cache produced by `scripts/sync_idref.cjs --mode=verify`
 * (enriched candidates: typed 035, 510, 340, 200 heading).
 * Outputs: the four sheets of the workbook (`enrichissements`, `conflits`, `sans_notice`,
 * `structures`) + statistics. Closed vocabulary of actions: AJOUT / MAJ_DATES / CONFLIT / OK / ''.
 */
import type { Researcher, Structure, Affiliation } from '../types';
import type { Institution, IdrefCandidate } from './gristService';
import { findGradeByCode } from './gradeTypology';
import { isFuzzyDatePast } from './dates';

// ── Business constants ────────────────────────────────────────────────────────
/** Nantes Université (2022-....) and its predecessor Université de Nantes (1962-2021). */
export const PPN_NANTES_UNIVERSITE = '258086599';
export const PPN_UNIVERSITE_DE_NANTES = '026403447';
export const NANTES_U_SPLIT_YEAR = 2022;

export type AbesAction = 'AJOUT' | 'MAJ_DATES' | 'CONFLIT' | 'OK' | '';

export interface AbesExportOptions {
  /** Extraction date (YYYY-MM-DD) — `date_extraction` column and year of the 340 notes. */
  extractionDate: string;
  /** Employer labels (Grist column `Employeur`, e.g. « NANTES UNIVERSITE »); empty = all. */
  employers?: string[];
  /** Lab acronyms (column `LABO`); empty = all. */
  labos?: string[];
  /** Resolved statuses (INTERNE, DEPART…); empty = all. */
  statuses?: string[];
  /** Keep only validated records (`validated`). */
  validatedOnly?: boolean;
  /** Employment types to exclude (column `TYPE_EMPLOI`, e.g. DOCTORANT, VACATAIRE), compared in uppercase. */
  excludeEmploymentTypes?: string[];
  /** Produce the `sans_notice` sheet (records without IdRef but with another strong identifier). */
  includeSansNotice?: boolean;
  /** Propose 340 notes (otherwise only 035 + 510). */
  proposeNotes?: boolean;
  /** Fingerprints already sent (uid → hash): identical rows are discarded unless `includeAlreadySent`. */
  alreadySent?: Record<string, string>;
  includeAlreadySent?: boolean;
}

export interface AbesRow {
  ppn: string;
  nom: string;
  prenom: string;
  id_local: string;
  nom_idref: string;
  orcid: string; orcid_idref: string; orcid_action: AbesAction;
  idhal: string; idhal_idref: string; idhal_action: AbesAction;
  scopus: string; scopus_idref: string; scopus_action: AbesAction;
  etab_ppn: string; etab_nom: string; etab_dates: string; etab_action: AbesAction;
  etab2_ppn: string; etab2_nom: string; etab2_dates: string; etab2_action: AbesAction;
  labo_ppn: string; labo_nom: string; labo_dates: string; labo_role: string; labo_action: AbesAction;
  labo2_ppn: string; labo2_nom: string; labo2_dates: string; labo2_role: string; labo2_action: AbesAction;
  note_340: string; note_340_action: AbesAction;
  fonction: string;
  statut_druid: string;
  date_extraction: string;
  commentaire: string;
}

export interface AbesConflict {
  ppn: string; nom: string; prenom: string; id_local: string;
  champ: 'orcid' | 'idhal' | 'scopus' | 'nom';
  valeur_idref: string; valeur_druid: string; source_druid: string; commentaire: string;
}

export interface AbesSansNotice {
  nom: string; prenom: string; id_local: string;
  orcid: string; idhal: string; scopus: string;
  etab_ppn: string; etab_nom: string; labo_ppn: string; labo_nom: string;
  fonction: string; note_340: string; annee_naissance: string;
}

export interface AbesStructureRow {
  acronyme: string; nom: string; ppn_idref: string; rnsr: string; ror: string; type: string; action: 'OK' | 'A_CREER';
}

export interface AbesDiff {
  enrichissements: AbesRow[];
  conflits: AbesConflict[];
  sansNotice: AbesSansNotice[];
  structures: AbesStructureRow[];
  /** uid → fingerprint of the proposed actions (for the "sent" marking). */
  hashes: Record<string, string>;
  stats: {
    perimetre: number;        // records retained by the filters
    avecIdref: number;        // of which with an IdRef filled in
    sansCache: number;        // IdRef filled in but authority record not re-read (cache missing/stale)
    noticeIllisible: number;
    lignes: number;           // exported rows (≥ 1 action)
    dejaEnvoyees: number;     // discarded because an identical fingerprint was already sent
    actions: Record<string, number>; // e.g. { orcid_AJOUT: 12, labo_MAJ_DATES: 3, … }
    conflits: number;
    sansNotice: number;
    structuresACreer: number;
  };
}

// ── Normalizations ────────────────────────────────────────────────────────────
export const normText = (s: any): string =>
  String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export const normOrcid = (s: any): string => {
  const m = String(s ?? '').toUpperCase().match(/\d{4}-\d{4}-\d{4}-\d{3}[\dX]/);
  return m ? m[0] : '';
};
export const normScopus = (s: any): string => String(s ?? '').replace(/\D/g, '');
export const normIdhal = (s: any): string => String(s ?? '').trim().toLowerCase().replace(/^https?:\/\/[^/]+\/(?:cv\/)?/, '').replace(/\/$/, '');
export const ppnDigits = (s: any): string => String(s ?? '').trim().split('/').pop()!.toUpperCase();

const yearOf = (iso?: string): string => (iso && /^\d{4}/.test(iso) ? iso.slice(0, 4) : '');
/** Whole period elapsed — fuzzy dates (`2023`, `2023-06`) count as past once their last day is (lib/dates.ts). */
const isPast = (iso?: string, today?: string): boolean => !!iso && !!today && isFuzzyDatePast(iso, today);

/** Significant name tokens (≥ 3 letters) for the Druid ↔ authority record match. */
const nameTokens = (s: string): Set<string> => new Set(normText(s).split(' ').filter((t) => t.length >= 3));
const shareToken = (a: string, b: string): boolean => {
  const ta = nameTokens(a); for (const t of nameTokens(b)) if (ta.has(t)) return true; return false;
};

/** Start / end years read from a 510 `$0` (« 2022-.... », « 1996-2021 », « 2024 », « 2025 -.... »). */
export const parseDates510 = (s: string): { start: string; end: string; open: boolean } => {
  const years = String(s || '').match(/\d{4}/g) || [];
  const open = /\.{3,}/.test(s || '') || (years.length === 1 && !/-\s*\d{4}/.test(s || ''));
  return { start: years[0] || '', end: years[1] || '', open: open || years.length < 2 };
};
export const formatDates510 = (startYear: string, endYear: string): string =>
  `${startYear || '....'}-${endYear || '....'}`;

// ── Note 340 ──────────────────────────────────────────────────────────────────
export const gradeLabel = (code?: string): string => {
  const c = String(code || '').trim();
  if (!c) return '';
  return findGradeByCode(c)?.libelle || c;
};

/**
 * « <Grade> au <Labo> (<Employeur>), depuis <AAAA> (en <année d'extraction>) ».
 * The lab is mandatory (a note without a structure brings nothing to the ABES).
 */
export const buildNote340 = (p: {
  grade?: string; laboName: string; employerLabel?: string; startYear?: string; extractionYear: string;
}): string => {
  if (!p.laboName) return '';
  const g = gradeLabel(p.grade);
  const head = g ? `${g} au ${p.laboName}` : `Membre du ${p.laboName}`;
  const emp = p.employerLabel ? ` (${p.employerLabel})` : '';
  const since = p.startYear ? `, depuis ${p.startYear}` : '';
  return `${head}${emp}${since} (en ${p.extractionYear})`;
};

/** Does an existing 340 already cite the lab (acronym or full name, accents stripped)? */
export const noteMentionsLab = (notes: string[], acronym: string, laboName: string): boolean => {
  const acr = normText(acronym), name = normText(laboName);
  return notes.some((n) => {
    const t = ` ${normText(n)} `;
    return (acr.length >= 3 && t.includes(` ${acr} `)) || (name.length >= 8 && t.includes(name));
  });
};

// ── Expected affiliations ─────────────────────────────────────────────────────
export interface ExpectedAffiliation {
  kind: 'etab' | 'etab2' | 'labo' | 'labo2';
  ppn: string;            // empty when the structure has no known PPN
  name: string;
  acronym?: string;
  startYear: string;
  endYear: string;        // empty = open-ended
  role?: string;          // PRINCIPAL / SECONDAIRE
  dateEstimated?: boolean;
}

/**
 * Employer(s). Observed ABES practice (2026-09-11, 1,200 authority records): a single 510 « Nantes
 * Université » covering the whole career (« 1995-.... ») in most records; the split form
 * « Université de Nantes 1995-2021 » + « Nantes Université 2022-.... » only exists on a
 * minority. So « Université de Nantes » is only proposed when the record has NO 510 Nantes
 * Université covering the start of the employment (missing, or starting in 2022 while the
 * employment is earlier) — never when the 510 Nantes Université already covers the period.
 */
export const expectedEmployers = (
  r: Researcher, etab: Institution | undefined, today: string,
  noticeAffs: NonNullable<IdrefCandidate['affiliations']> = [],
): ExpectedAffiliation[] => {
  if (!etab) return [];
  const start = yearOf(r.employment?.startDate);
  const ended = isPast(r.employment?.endDate, today);
  const end = ended ? yearOf(r.employment?.endDate) : '';
  const isNantesU = ppnDigits(etab.idref) === PPN_NANTES_UNIVERSITE;
  if (!isNantesU || !start || parseInt(start, 10) >= NANTES_U_SPLIT_YEAR) {
    return [{ kind: 'etab', ppn: ppnDigits(etab.idref), name: etab.label || etab.name, startYear: start, endYear: end }];
  }
  // Employment before 2022 at Nantes Université.
  if (ended && parseInt(end, 10) < NANTES_U_SPLIT_YEAR) {
    return [{ kind: 'etab2', ppn: PPN_UNIVERSITE_DE_NANTES, name: 'Université de Nantes', startYear: start, endYear: end }];
  }
  const nuHit = noticeAffs.find((a) => ppnDigits(a.ppn) === PPN_NANTES_UNIVERSITE);
  const udnHit = noticeAffs.find((a) => ppnDigits(a.ppn) === PPN_UNIVERSITE_DE_NANTES);
  const nuStart = nuHit ? parseDates510(nuHit.dates).start : '';
  const nuCovers = !!nuHit && (!nuStart || parseInt(nuStart, 10) <= parseInt(start, 10));
  if (nuCovers && !udnHit) {
    // "Whole career" form already in place: we conform to it.
    return [{ kind: 'etab', ppn: PPN_NANTES_UNIVERSITE, name: 'Nantes Université', startYear: start, endYear: end }];
  }
  // Split form (already started, or record without a 510 Nantes Université): both fields.
  return [
    { kind: 'etab', ppn: PPN_NANTES_UNIVERSITE, name: 'Nantes Université', startYear: String(NANTES_U_SPLIT_YEAR), endYear: end },
    { kind: 'etab2', ppn: PPN_UNIVERSITE_DE_NANTES, name: 'Université de Nantes', startYear: start, endYear: String(NANTES_U_SPLIT_YEAR - 1) },
  ];
};

/** Labs: PRINCIPAL + at most one SECONDAIRE; HISTORIQUE ignored unless dated (closed). */
export const expectedLabs = (
  r: Researcher, structureByAcronym: Map<string, Structure>, today: string,
): ExpectedAffiliation[] => {
  const affs = (r.affiliations || []).filter((a: Affiliation) => a && a.structureName);
  const primary = affs.find((a) => a.isPrimary || a.role === 'PRINCIPAL') || affs[0];
  const secondary = affs.find((a) => a !== primary && a.role === 'SECONDAIRE');
  const empStart = yearOf(r.employment?.startDate);
  const out: ExpectedAffiliation[] = [];
  for (const [kind, a] of [['labo', primary], ['labo2', secondary]] as const) {
    if (!a) continue;
    const s = structureByAcronym.get(a.structureName.trim().toUpperCase());
    const start = yearOf(a.startDate) || empStart;
    const ended = isPast(a.endDate, today) || isPast(r.employment?.endDate, today);
    const end = ended ? (yearOf(a.endDate) || yearOf(r.employment?.endDate)) : '';
    out.push({
      kind, ppn: ppnDigits(s?.identifiers?.idrefId || ''), name: s?.officialName || a.structureName,
      acronym: s?.acronym || a.structureName, startYear: start, endYear: end, role: a.role || 'PRINCIPAL',
      dateEstimated: !yearOf(a.startDate) || a.startDate === r.employment?.startDate,
    });
  }
  return out;
};

/** Compares an expected affiliation with the 510s of the authority record. */
export const compareAffiliation = (
  exp: ExpectedAffiliation, notice: NonNullable<IdrefCandidate['affiliations']>,
): { action: AbesAction; dates: string; comment: string } => {
  const dates = formatDates510(exp.startYear, exp.endYear);
  if (!exp.ppn) return { action: '', dates, comment: `structure ${exp.acronym || exp.name} sans PPN IdRef` };
  const hit = notice.find((n) => ppnDigits(n.ppn) === exp.ppn);
  if (!hit) return { action: 'AJOUT', dates, comment: '' };
  const nd = parseDates510(hit.dates);
  if (!hit.dates || !nd.start) return { action: 'MAJ_DATES', dates, comment: '510 sans $0' };
  if (exp.endYear && nd.open) return { action: 'MAJ_DATES', dates, comment: `510 encore ouverte, fin ${exp.endYear}` };
  const comments: string[] = [];
  if (exp.startYear && nd.start !== exp.startYear) comments.push(`début notice ${nd.start} ≠ Druid ${exp.startYear} (non modifié)`);
  // 510 closed but Druid ongoing, or closed in another year: reported like the start gap,
  // otherwise the gap goes unnoticed (neither action nor comment).
  if (!nd.open && nd.end && nd.end !== (exp.endYear || '')) {
    comments.push(exp.endYear
      ? `fin notice ${nd.end} ≠ Druid ${exp.endYear} (non modifié)`
      : `notice close en ${nd.end}, Druid en cours (non modifié)`);
  }
  return { action: 'OK', dates: hit.dates, comment: comments.join(' ; ') };
};

// ── Fingerprint ───────────────────────────────────────────────────────────────
export const rowHash = (row: AbesRow): string => {
  // `nom_idref` always included: an update of the name form (soft conflict, see `entry.nameMismatch`)
  // changes no `_action` but changes the comment — without this, it would never be resent.
  const parts: string[] = [`nom_idref=${row.nom_idref || ''}`];
  for (const k of Object.keys(row).sort()) {
    if (!k.endsWith('_action')) continue;
    const a = (row as any)[k];
    if (a && a !== 'OK') {
      const base = k.replace(/_action$/, '');
      const value = (row as any)[base] || (row as any)[`${base}_ppn`] || '';
      // `<kind>_dates` (MAJ_DATES): without this, two different dates hash the same.
      const dates = (row as any)[`${base}_dates`] || '';
      parts.push(`${k}=${a}:${value}:${dates}`);
    }
  }
  let h = 5381;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
};

// ── Filters ───────────────────────────────────────────────────────────────────
const inList = (v: string, list?: string[]): boolean =>
  !list || list.length === 0 || list.map((x) => x.trim().toUpperCase()).includes(String(v || '').trim().toUpperCase());

export const inScope = (r: Researcher, o: AbesExportOptions): boolean => {
  if (!inList(r.employment?.employer || '', o.employers)) return false;
  if (o.labos && o.labos.length && !(r.affiliations || []).some((a) => inList(a.structureName, o.labos))) return false;
  if (!inList(r.status, o.statuses)) return false;
  if (o.validatedOnly && !r.validation?.validated) return false;
  if (o.excludeEmploymentTypes && o.excludeEmploymentTypes.length) {
    const t = String(r.employment?.contractType || '').toUpperCase();
    if (o.excludeEmploymentTypes.some((x) => t === x.toUpperCase())) return false;
  }
  return true;
};

// ── Main diff ─────────────────────────────────────────────────────────────────
export const computeAbesDiff = (
  researchers: Researcher[],
  structures: Structure[],
  etablissements: Institution[],
  cache: Record<string, any>,
  options: AbesExportOptions,
): AbesDiff => {
  const today = options.extractionDate;
  const extractionYear = today.slice(0, 4);
  const structureByAcronym = new Map<string, Structure>();
  for (const s of structures) if (s.acronym) structureByAcronym.set(s.acronym.trim().toUpperCase(), s);
  const etabByName = new Map<string, Institution>();
  for (const e of etablissements) if (e.name) etabByName.set(e.name.trim().toUpperCase(), e);

  const diff: AbesDiff = {
    enrichissements: [], conflits: [], sansNotice: [], structures: [], hashes: {},
    stats: { perimetre: 0, avecIdref: 0, sansCache: 0, noticeIllisible: 0, lignes: 0, dejaEnvoyees: 0, actions: {}, conflits: 0, sansNotice: 0, structuresACreer: 0 },
  };
  const bump = (k: string) => { diff.stats.actions[k] = (diff.stats.actions[k] || 0) + 1; };
  const citedStructures = new Map<string, AbesStructureRow>();
  const cite = (exp: ExpectedAffiliation, s?: Structure) => {
    const key = exp.ppn || `A_CREER:${exp.acronym || exp.name}`;
    if (citedStructures.has(key)) return;
    citedStructures.set(key, {
      acronyme: exp.acronym || '', nom: exp.name, ppn_idref: exp.ppn, rnsr: s?.rnsrId || '', ror: s?.rorId || '',
      type: s?.type || (exp.kind.startsWith('etab') ? 'ETABLISSEMENT' : ''), action: exp.ppn ? 'OK' : 'A_CREER',
    });
  };

  for (const r of researchers) {
    if (!inScope(r, options)) continue;
    diff.stats.perimetre++;
    const uid = r.uid || r.id;
    const etab = etabByName.get(String(r.employment?.employer || '').trim().toUpperCase());
    const labs = expectedLabs(r, structureByAcronym, today);
    // Employers depend on the form already present in the authority record (see expectedEmployers);
    // without a re-read record (sans_notice sheet), we start from the reference split form.
    const entryPeek = cache[r.uid || r.id] || cache[`g${r.gristRowId}`];
    const noticeAffs = entryPeek?.mode === 'verify' ? (entryPeek.candidates?.[0]?.affiliations || []) : [];
    const emps = expectedEmployers(r, etab, today, noticeAffs);
    const fonction = gradeLabel(r.employment?.grade);
    const primaryLab = labs.find((l) => l.kind === 'labo');
    const note = options.proposeNotes !== false && primaryLab
      ? buildNote340({ grade: r.employment?.grade, laboName: primaryLab.name, employerLabel: etab?.label || etab?.name, startYear: primaryLab.startYear, extractionYear })
      : '';

    const ppn = ppnDigits(r.identifiers?.idref || '');
    if (!ppn) {
      if (options.includeSansNotice && (r.identifiers?.orcid || r.identifiers?.halId || r.identifiers?.scopusId)) {
        diff.sansNotice.push({
          nom: r.lastName, prenom: r.firstName, id_local: uid,
          orcid: normOrcid(r.identifiers?.orcid), idhal: normIdhal(r.identifiers?.halId), scopus: normScopus(r.identifiers?.scopusId),
          etab_ppn: emps.find((e) => e.kind === 'etab')?.ppn || '', etab_nom: etab?.label || etab?.name || '',
          labo_ppn: primaryLab?.ppn || '', labo_nom: primaryLab?.name || '', fonction, note_340: note,
          annee_naissance: yearOf(r.birthDate),
        });
      }
      continue;
    }
    diff.stats.avecIdref++;
    const entry = cache[uid] || cache[`g${r.gristRowId}`];
    const cand: IdrefCandidate | undefined = entry?.mode === 'verify' ? entry.candidates?.[0] : undefined;
    if (!entry || entry.status === 'notice_error') { diff.stats.noticeIllisible += entry ? 1 : 0; diff.stats.sansCache += entry ? 0 : 1; continue; }
    if (!cand || !cand.affiliations || !cand.externalIds || ppnDigits(entry.ppn) !== ppn) { diff.stats.sansCache++; continue; }

    const nomDruid = `${r.firstName} ${r.lastName}`;
    if (cand.fullName && !shareToken(nomDruid, cand.fullName)) {
      diff.conflits.push({ ppn, nom: r.lastName, prenom: r.firstName, id_local: uid, champ: 'nom', valeur_idref: cand.nameIdref || cand.fullName, valeur_druid: nomDruid, source_druid: 'Annuaire', commentaire: 'aucun token de nom commun : IdRef probablement erroné, aucun enrichissement proposé' });
      continue;
    }

    const row: AbesRow = {
      ppn, nom: r.lastName, prenom: r.firstName, id_local: uid, nom_idref: cand.nameIdref || cand.fullName,
      orcid: '', orcid_idref: '', orcid_action: '', idhal: '', idhal_idref: '', idhal_action: '', scopus: '', scopus_idref: '', scopus_action: '',
      etab_ppn: '', etab_nom: '', etab_dates: '', etab_action: '', etab2_ppn: '', etab2_nom: '', etab2_dates: '', etab2_action: '',
      labo_ppn: '', labo_nom: '', labo_dates: '', labo_role: '', labo_action: '', labo2_ppn: '', labo2_nom: '', labo2_dates: '', labo2_role: '', labo2_action: '',
      note_340: '', note_340_action: '', fonction,
      statut_druid: `${r.status}${r.validation?.validated ? ` (validé${r.validation.validationSource ? `, ${r.validation.validationSource}` : ''})` : ''}`,
      date_extraction: today, commentaire: '',
    };
    const comments: string[] = [];
    if (entry.nameMismatch) comments.push(`forme du nom différente dans la notice (${cand.nameIdref || cand.fullName})`);

    // Identifiers
    const ids: Array<['orcid' | 'idhal' | 'scopus', string, string[], string]> = [
      ['orcid', normOrcid(r.identifiers?.orcid), (cand.externalIds.ORCID || []).map(normOrcid), 'ORCID'],
      ['idhal', normIdhal(r.identifiers?.halId), (cand.externalIds.HAL || []).map(normIdhal), 'IdHAL'],
      ['scopus', normScopus(r.identifiers?.scopusId), (cand.externalIds.SCOPUSID || []).map(normScopus), 'ID_SCOPUS'],
    ];
    for (const [key, mine, theirs, label] of ids) {
      (row as any)[key] = mine;
      (row as any)[`${key}_idref`] = theirs.filter(Boolean).join('|');
      let action: AbesAction = '';
      if (mine) {
        if (theirs.includes(mine)) action = 'OK';
        else if (theirs.filter(Boolean).length === 0) action = 'AJOUT';
        else {
          action = 'CONFLIT';
          diff.conflits.push({ ppn, nom: r.lastName, prenom: r.firstName, id_local: uid, champ: key, valeur_idref: theirs.join('|'), valeur_druid: mine, source_druid: `Annuaire.${label}`, commentaire: '' });
        }
      }
      (row as any)[`${key}_action`] = action;
      if (action && action !== 'OK') bump(`${key}_${action}`);
    }

    // Affiliations
    for (const exp of [...emps, ...labs]) {
      const s = exp.acronym ? structureByAcronym.get(exp.acronym.toUpperCase()) : undefined;
      cite(exp, s);
      const cmp = compareAffiliation(exp, cand.affiliations);
      (row as any)[`${exp.kind}_ppn`] = exp.ppn;
      (row as any)[`${exp.kind}_nom`] = exp.name;
      (row as any)[`${exp.kind}_dates`] = cmp.dates;
      (row as any)[`${exp.kind}_action`] = cmp.action;
      if (exp.kind.startsWith('labo')) (row as any)[`${exp.kind}_role`] = exp.role || '';
      if (cmp.comment) comments.push(`${exp.kind} : ${cmp.comment}`);
      if (exp.kind.startsWith('labo') && exp.dateEstimated && cmp.action && cmp.action !== 'OK') comments.push(`${exp.kind} : date d'entrée estimée (= emploi)`);
      if (cmp.action && cmp.action !== 'OK') bump(`${exp.kind}_${cmp.action}`);
    }

    // Note 340
    if (note && primaryLab) {
      row.note_340 = note;
      const already = noteMentionsLab(cand.notes || [], primaryLab.acronym || '', primaryLab.name);
      row.note_340_action = already ? 'OK' : 'AJOUT';
      if (!already) bump((cand.notes || []).length ? 'note_340_AJOUT_notice_avec_340' : 'note_340_AJOUT_notice_sans_340');
    }

    row.commentaire = comments.join(' ; ');
    const hasAction = (Object.keys(row) as (keyof AbesRow)[]).some((k) => k.endsWith('_action') && row[k] && row[k] !== 'OK');
    if (!hasAction) continue;
    const h = rowHash(row);
    diff.hashes[uid] = h;
    if (!options.includeAlreadySent && options.alreadySent && options.alreadySent[uid] === h) { diff.stats.dejaEnvoyees++; continue; }
    diff.enrichissements.push(row);
  }

  diff.structures = Array.from(citedStructures.values()).sort((a, b) => a.action.localeCompare(b.action) || a.acronyme.localeCompare(b.acronyme, 'fr'));
  diff.stats.lignes = diff.enrichissements.length;
  diff.stats.conflits = diff.conflits.length;
  diff.stats.sansNotice = diff.sansNotice.length;
  diff.stats.structuresACreer = diff.structures.filter((s) => s.action === 'A_CREER').length;
  return diff;
};

/** Preset « ABES — Nantes U validés » (docs/plan-export-abes-idref.md §6). */
/**
 * Task types (« À traiter › Tâches », docs/plan-chantiers-taches.md, lot 6) that an exported row
 * covers: once the row is marked as sent, the open `lot_abes` tasks of these types for the same
 * person are closed (scripts/lib/tasks_schema.cjs abesSentPatches).
 */
export const abesTaskTypes = (row: AbesRow): string[] => {
  const out: string[] = [];
  const acts = (...a: AbesAction[]) => a.filter((x) => x === 'AJOUT' || x === 'MAJ_DATES');
  if (row.orcid_action === 'AJOUT') out.push('idref_ajouter_orcid');
  if (row.idhal_action === 'AJOUT') out.push('idref_ajouter_idhal');
  const aff = acts(row.etab_action, row.etab2_action, row.labo_action, row.labo2_action, row.note_340_action);
  if (aff.length) out.push('idref_corriger_affiliation');
  if (aff.includes('MAJ_DATES')) out.push('idref_corriger_dates');
  return out;
};

export const ABES_DEFAULT_OPTIONS = (extractionDate: string): AbesExportOptions => ({
  extractionDate,
  employers: ['NANTES UNIVERSITE'],
  statuses: ['INTERNE'],
  validatedOnly: true,
  excludeEmploymentTypes: ['DOCTORANT', 'VACATAIRE'],
  includeSansNotice: false,
  proposeNotes: true,
  includeAlreadySent: false,
});
