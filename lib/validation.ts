import { ResearcherStatus } from '../types';

/**
 * @file validation.ts
 * @description "Reliability" layer for the status and the affiliation.
 *
 * The displayed status is normally *derived* from unreliable sources: LDAP
 * (late HR updates) for internal staff, and employment dates for external
 * staff (collected through uneven lab surveys). From time to time a reliable
 * list arrives (e.g. researchers from Centrale, from LPPL): we then want to
 * mark these rows as **manually validated**, with a date and a source, so
 * that this information takes precedence over the derived status and is not
 * overwritten by the next LDAP sync.
 *
 * Validation is an axis **orthogonal** to the status ("reliability" axis vs
 * "state" axis): a person can be "validated INTERNE" or "validated DEPART".
 * So we do NOT create a 5th enum value; we overlay Grist columns instead.
 *
 * This module is deliberately pure (no network / DOM access) so that it is
 * testable and replicated verbatim in both Druids (Nantes U + demo).
 */

/** What a reliable list can validate. */
export type ValidationScope = 'statut' | 'rattachement';

const SCOPE_VALUES: readonly ValidationScope[] = ['statut', 'rattachement'];

/** Manual validation layer applied to a researcher record. */
export interface ValidationInfo {
  /** Has the row been manually validated? */
  validated: boolean;
  /** Authoritative status when `scope` includes 'statut' (takes precedence over LDAP/dates). */
  validatedStatus?: ResearcherStatus;
  /** Validation date (YYYY-MM-DD) — drives staleness. */
  validationDate?: string;
  /** Source: « Liste Centrale 2026-06 », « Enquête LPPL »… (traceability). */
  validationSource?: string;
  /** What the validation covers. Historical default: status + affiliation. */
  validationScope: ValidationScope[];
  /** Author of the validation (application account), optional. */
  validatedBy?: string;
}

/** Beyond this age, a validation is considered "stale" (to be reviewed). */
export const VALIDATION_STALE_MONTHS = 18;

/**
 * Grist column names of the validation layer — **identical** in both Druids
 * so that the code is shared. To be created in the `Annuaire` table
 * (see scripts/add_validation_columns.cjs). `validated` = Bool, `validation_date`
 * = Date, the others = Text.
 */
export const GRIST_VALIDATION_COLUMNS = {
  validated: 'validated',
  validatedStatus: 'validated_status',
  validationDate: 'validation_date',
  validationSource: 'validation_source',
  validationScope: 'validation_scope',
  validatedBy: 'validated_by',
} as const;

/**
 * "Home" institution (the one whose LDAP is synchronized). A person whose Grist employer is known
 * and different (INSERM, CNRS, Centrale Nantes, CHU…) is EXTERNE whatever their LDAP state: they
 * may have an account hosted at Nantes Université (dynaEtat N) without being employed by it, and
 * their LDAP "departure" (dynaEtat D, datefin) says nothing about their actual employment (rule of
 * 2026-09-15, geoffroy-v / INSERM case). Empty employer ⇒ we rely on LDAP as before.
 */
export const HOME_EMPLOYER = { name: 'NANTES UNIVERSITE', uai: '0442953W' } as const;

const normEmployer = (s: any): string =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

/** Employer filled in AND different from the home institution (compared on the UAI, else the label). */
export const isExternalEmployer = (employerName: any, employerUai?: any): boolean => {
  const name = normEmployer(employerName);
  const uai = String(employerUai ?? '').trim().toUpperCase();
  // The « non renseigné » value of the Établissements table = empty employer.
  if ((!name || /^NON RENSEIGNE$/.test(name)) && !uai) return false;
  if (uai) return uai !== HOME_EMPLOYER.uai;
  return name !== normEmployer(HOME_EMPLOYER.name);
};

/** Default status set by a reliable list ("these people are present"). */
export const DEFAULT_VALIDATED_STATUS = ResearcherStatus.INTERNE;

/**
 * Single definition of a "validated cell", shared by `validation.ts` and
 * `mergeProposal.ts` (review lot 3, finding 8: three diverging definitions
 * meant that a `1`/`'true'` cell was validated for `parseValidation`
 * but not for `autoMergeEligibility`).
 */
export const isValidatedCell = (v: any): boolean =>
  v === true || v === 1 || v === 'true' || v === 'OUI' || v === 'oui' || v === 'yes';

const truthy = isValidatedCell;

/** Normalizes a free-form string to a known ResearcherStatus (else undefined). */
export const normStatus = (raw: any): ResearcherStatus | undefined => {
  const s = String(raw ?? '').toUpperCase().trim();
  if (s === 'INTERNE') return ResearcherStatus.INTERNE;
  if (s === 'DEPART' || s === 'DÉPART') return ResearcherStatus.DEPART;
  if (s === 'PARTI') return ResearcherStatus.PARTI;
  if (s === 'EXTERNE') return ResearcherStatus.EXTERNE;
  return undefined;
};

/** Decodes the scope from a Grist cell (text « statut,rattachement » or list). */
export const parseValidationScope = (raw: any): ValidationScope[] => {
  const items: string[] = Array.isArray(raw)
    ? raw.map(String)
    : String(raw ?? '').split(/[,;|]/);
  const out = items
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is ValidationScope => (SCOPE_VALUES as readonly string[]).includes(s));
  return Array.from(new Set(out));
};

/**
 * Reads the validation layer from the raw fields of a Grist record.
 * `decodeDate` injects the GristService date decoder (Grist dates arrive
 * as Unix timestamps) without creating an import cycle.
 */
export const parseValidation = (
  f: Record<string, any>,
  decodeDate: (raw: any) => string = (raw) => (raw ? String(raw) : ''),
): ValidationInfo => {
  const C = GRIST_VALIDATION_COLUMNS;
  const validated = truthy(f[C.validated]);
  let scope = parseValidationScope(f[C.validationScope]);
  // Backward compatibility: a validated row without explicit scope covers both axes.
  if (validated && scope.length === 0) scope = ['statut', 'rattachement'];
  return {
    validated,
    validatedStatus: normStatus(f[C.validatedStatus]),
    validationDate: decodeDate(f[C.validationDate]) || undefined,
    validationSource: f[C.validationSource] ? String(f[C.validationSource]) : undefined,
    validationScope: scope,
    validatedBy: f[C.validatedBy] ? String(f[C.validatedBy]) : undefined,
  };
};

/**
 * Serializes the validation layer to Grist fields. When the row is not
 * validated, the columns are reset to null/false (allows "un-validating").
 * `encodeDate` injects the GristService date encoder (ISO → Grist format).
 */
export const validationToGristFields = (
  v: ValidationInfo | undefined,
  encodeDate: (raw: any) => any = (raw) => raw ?? null,
): Record<string, any> => {
  const C = GRIST_VALIDATION_COLUMNS;
  if (!v || !v.validated) {
    return {
      [C.validated]: false,
      [C.validatedStatus]: null,
      [C.validationDate]: null,
      [C.validationSource]: null,
      [C.validationScope]: null,
      [C.validatedBy]: null,
    };
  }
  return {
    [C.validated]: true,
    [C.validatedStatus]: v.validatedStatus || null,
    [C.validationDate]: v.validationDate ? encodeDate(v.validationDate) : null,
    [C.validationSource]: v.validationSource || null,
    [C.validationScope]: v.validationScope.length ? v.validationScope.join(',') : null,
    [C.validatedBy]: v.validatedBy || null,
  };
};

/**
 * Final status = validation (when it covers the status) ON TOP of the derived one.
 * `derived` is the status computed as today (mapStatus LDAP/Grist):
 * the validation only replaces it when explicitly filled in.
 */
export const resolveStatus = (
  validation: ValidationInfo | undefined,
  derived: ResearcherStatus,
): ResearcherStatus => {
  if (
    validation?.validated &&
    validation.validationScope.includes('statut') &&
    validation.validatedStatus
  ) {
    return validation.validatedStatus;
  }
  return derived;
};

/** Is the affiliation (lab/team) locked by a validation? */
export const isAffiliationValidated = (v?: ValidationInfo): boolean =>
  !!v?.validated && v.validationScope.includes('rattachement');

/**
 * Is a validation stale (older than `months`)? Used to gray out the badge
 * and to prompt a re-check.
 */
export const isValidationStale = (
  validation: ValidationInfo | undefined,
  now: Date,
  months: number = VALIDATION_STALE_MONTHS,
): boolean => {
  if (!validation?.validated || !validation.validationDate) return false;
  const d = new Date(validation.validationDate);
  if (Number.isNaN(d.getTime())) return false;
  const threshold = new Date(d);
  threshold.setMonth(threshold.getMonth() + months);
  return now.getTime() > threshold.getTime();
};

/**
 * Conflict between a validation and the derived source: if the source (LDAP/dates)
 * changed AFTER the validation date and diverges from the validated status, the
 * row is flagged "to review" rather than hiding a real change indefinitely.
 * `sourceChangedAt` = known date of the last source change (optional).
 */
export const hasValidationConflict = (
  validation: ValidationInfo | undefined,
  derived: ResearcherStatus,
): boolean => {
  if (!validation?.validated || !validation.validationScope.includes('statut')) return false;
  if (!validation.validatedStatus) return false;
  return validation.validatedStatus !== derived;
};

// ─── Bulk import of a reliable list ───────────────────────────────────────────

/** A row read from a reliable list (pasted or imported CSV). */
export interface ValidationListRow {
  raw: string;
  name?: string;
  email?: string;
  uid?: string;
  status?: ResearcherStatus;
}

/** A list ↔ record match, ready to be applied. */
export interface ValidationMatch {
  researcherId: string;
  uid?: string;
  displayName: string;
  /** Currently displayed status (before validation). */
  currentStatus: ResearcherStatus;
  /** Proposed validated status. */
  newStatus: ResearcherStatus;
  /** The validated status differs from the current one (info for the user). */
  overrides: boolean;
  matchedBy: 'uid' | 'email' | 'name';
}

export interface ValidationDiff {
  source: string;
  date: string;
  scope: ValidationScope[];
  matched: ValidationMatch[];
  ambiguous: { row: ValidationListRow; candidateIds: string[] }[];
  unmatched: ValidationListRow[];
}

const deburr = (s: string): string =>
  String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Tolerant name key (tokens ≥ 2 letters, sorted) for matching. */
export const nameKey = (s: string): string =>
  Array.from(new Set(deburr(s).split(/[^a-z]+/).filter((t) => t.length >= 2)))
    .sort()
    .join(' ');

/**
 * Parses a CSV/pasted text into reliable-list rows. Detects the columns by
 * header (nom/name, email/mail/courriel, uid/id/matricule, statut/status).
 * Without a recognizable header, treats each line as a name.
 */
export const parseValidationList = (text: string): ValidationListRow[] => {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const splitLine = (l: string): string[] =>
    l.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ''));

  const header = splitLine(lines[0]).map((h) => deburr(h));
  // Exact match first (« Prénom » must not win the « Nom » column via includes('nom')),
  // fallback to inclusion only when no exact header matches.
  const col = (names: string[]) => {
    const exact = header.findIndex((h) => names.includes(h));
    if (exact >= 0) return exact;
    return header.findIndex((h) => h !== 'prenom' && names.some((n) => h.includes(n)));
  };
  const iName = col(['nom complet', 'displayname', 'nom', 'name']);
  const iEmail = col(['email', 'mail', 'courriel']);
  const iUid = col(['uid', 'matricule', 'identifiant', 'id']);
  const iStatus = col(['statut', 'status', 'etat']);
  const hasHeader = iName >= 0 || iEmail >= 0 || iUid >= 0;

  const body = hasHeader ? lines.slice(1) : lines;
  return body.map((l): ValidationListRow => {
    const cells = splitLine(l);
    if (!hasHeader) return { raw: l, name: l };
    return {
      raw: l,
      name: iName >= 0 ? cells[iName] : undefined,
      email: iEmail >= 0 ? cells[iEmail] : undefined,
      uid: iUid >= 0 ? cells[iUid] : undefined,
      status: iStatus >= 0 ? normStatus(cells[iStatus]) : undefined,
    };
  });
};

/** Matches a reliable list against the records and computes the validations to apply. */
export const computeValidationDiff = (
  researchers: Array<{
    id: string;
    uid?: string;
    email?: string;
    displayName: string;
    status: ResearcherStatus;
  }>,
  rows: ValidationListRow[],
  opts: { source: string; date: string; scope: ValidationScope[]; defaultStatus?: ResearcherStatus },
): ValidationDiff => {
  const byUid = new Map<string, string[]>();
  const byEmail = new Map<string, string[]>();
  const byName = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, id: string) => {
    if (!k) return;
    const arr = m.get(k) || [];
    arr.push(id);
    m.set(k, arr);
  };
  const byId = new Map<string, (typeof researchers)[number]>();
  for (const r of researchers) {
    byId.set(r.id, r);
    push(byUid, String(r.uid || '').trim().toLowerCase(), r.id);
    push(byEmail, String(r.email || '').trim().toLowerCase(), r.id);
    push(byName, nameKey(r.displayName), r.id);
  }

  const defaultStatus = opts.defaultStatus ?? DEFAULT_VALIDATED_STATUS;
  const matched: ValidationMatch[] = [];
  const ambiguous: ValidationDiff['ambiguous'] = [];
  const unmatched: ValidationListRow[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    let ids: string[] | undefined;
    let matchedBy: ValidationMatch['matchedBy'] = 'uid';
    const uidKey = String(row.uid || '').trim().toLowerCase();
    const emailKey = String(row.email || '').trim().toLowerCase();
    const nKey = row.name ? nameKey(row.name) : '';
    if (uidKey && byUid.get(uidKey)) { ids = byUid.get(uidKey); matchedBy = 'uid'; }
    else if (emailKey && byEmail.get(emailKey)) { ids = byEmail.get(emailKey); matchedBy = 'email'; }
    else if (nKey && byName.get(nKey)) { ids = byName.get(nKey); matchedBy = 'name'; }

    if (!ids || ids.length === 0) { unmatched.push(row); continue; }
    if (ids.length > 1) { ambiguous.push({ row, candidateIds: ids }); continue; }

    const id = ids[0];
    if (seen.has(id)) continue; // deduplication: a record is validated only once
    seen.add(id);
    const r = byId.get(id)!;
    const newStatus = row.status ?? defaultStatus;
    matched.push({
      researcherId: id,
      uid: r.uid,
      displayName: r.displayName,
      currentStatus: r.status,
      newStatus,
      overrides: newStatus !== r.status,
      matchedBy,
    });
  }

  return { source: opts.source, date: opts.date, scope: opts.scope, matched, ambiguous, unmatched };
};
