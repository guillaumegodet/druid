// Identifier actions coming back from the CRISalid graph bus (lot 2 of druid-internal
// docs/plan-retour-identifiants-sovisuplus.md). Since CRISalid 1.7, researchers and library staff manage identifiers in
// SoVisu+, which publishes `task.people.person.<add|remove>.interactive` on the exchange `graph`. Druid reads them from
// its own queue (druid-person-actions) and takes the choice over, otherwise its next people.csv would revert it (the
// IKG replaces every identifier of a person on an `updated` directory event).
//
// Pure module: parses a message, then derives the effects on the record from its current identifiers, their sources
// (person_identifier_source), the values set aside (« Rejeté ») and the other records carrying the value. The consumer
// (lot 3) loads that state and applies the effects through lib/directory/pg/identifierProvenance.ts.
import { comparableValue, isReadableValue, type GraphIdentifierType } from './identifierActions';

/** Identifier type of a SoVisu+ action → directory scheme (person_identifier.scheme). */
export const SCHEME_OF_SOVISUPLUS_TYPE = {
  orcid: 'orcid',
  idref: 'idref',
  idhals: 'idhal',
  idhali: 'idhal_i',
} as const satisfies Partial<Record<GraphIdentifierType, string>>;

export type SovisuplusIdentifierType = keyof typeof SCHEME_OF_SOVISUPLUS_TYPE;
export type InboundScheme = (typeof SCHEME_OF_SOVISUPLUS_TYPE)[SovisuplusIdentifierType];

/**
 * Schemes whose « Rejeté » decision lives in alignment_candidate (same table as ALIGN_SOURCE_OF_SCHEME of
 * identifierProvenance.ts). IdHAL_s has no alignment of its own: SoVisu+ removes both forms of an IdHAL together, and
 * the rejection of the IdHAL_i also keeps sync_hal from writing back the IdHAL_s derived from it.
 */
const REJECTABLE: ReadonlySet<InboundScheme> = new Set<InboundScheme>(['orcid', 'idref', 'idhal_i']);

/** Source written in person_identifier_source for a value brought by SoVisu+. */
export const SOVISUPLUS_SOURCE = 'sovisuplus';
export const SOVISUPLUS_AUTH_SOURCE = 'sovisuplus:auth';

export interface InboundAction {
  /** Action id from SoVisu+: key of idempotence (inbound_graph_action, lot 3). */
  id: string;
  actionType: 'ADD' | 'REMOVE';
  /** Directory uid (`local-<uid>` in the graph). */
  uid: string;
  /** Person the action is about, as the message names it (`local-<uid>`): author of the decision in the journal. */
  personUid: string;
  sovisuplusType: SovisuplusIdentifierType;
  scheme: InboundScheme;
  /** Value in the form the directory stores. */
  value: string;
  authenticated: boolean;
  application: string;
  timestamp: string | null;
}

export type InboundIgnoreReason =
  | 'not_json'
  | 'missing_id'
  /** Druid's own removals (lot 11), read back from the same routing keys. */
  | 'own_action'
  | 'not_a_person_identifier'
  /** SoVisu+ sends ADD and REMOVE only for identifiers; UPDATE is never applied blindly. */
  | 'unsupported_action'
  | 'not_a_directory_person'
  | 'unsupported_type'
  | 'missing_value'
  | 'invalid_value'
  | 'unknown_person'
  /** A removal of a value the directory does not hold, for a scheme without a rejection to keep. */
  | 'not_in_directory'
  /** An unauthenticated addition of a value set aside in Druid: not written; the source row raises the conflict. */
  | 'rejected_in_directory'
  /** The value is already there, nothing to change (the source is still recorded). */
  | 'already_present';

export type ParseResult = { ok: true; action: InboundAction } | { ok: false; reason: InboundIgnoreReason; detail?: string };

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** Form the directory stores: bare ORCID / IdRef with an upper-case check character, IdHAL_s in lower case (SoVisu+
 * upper-cases what is typed), digits for the IdHAL_i. */
export const storedValue = (scheme: InboundScheme, value: string): string => {
  const v = comparableValue(value);
  if (scheme === 'orcid' || scheme === 'idref') return v.toUpperCase();
  return v;
};

/** Reads a message of the queue: a SoVisu+ action on an identifier of a person of the directory, or why it is skipped. */
export const parseInboundMessage = (raw: unknown): ParseResult => {
  let msg: Record<string, unknown> | null;
  try {
    msg = asRecord(typeof raw === 'string' ? JSON.parse(raw) : raw);
  } catch {
    return { ok: false, reason: 'not_json' };
  }
  if (!msg) return { ok: false, reason: 'not_json' };
  const application = String(msg.application ?? '');
  if (application === 'druid') return { ok: false, reason: 'own_action' };
  const id = typeof msg.id === 'string' ? msg.id.trim() : '';
  if (!id) return { ok: false, reason: 'missing_id' };
  if (msg.targetType !== 'PERSON' || msg.path !== 'identifiers') return { ok: false, reason: 'not_a_person_identifier' };
  const actionType = msg.actionType;
  if (actionType !== 'ADD' && actionType !== 'REMOVE') return { ok: false, reason: 'unsupported_action', detail: String(actionType) };
  const target = typeof msg.targetUid === 'string' ? msg.targetUid : '';
  const uid = target.startsWith('local-') ? target.slice('local-'.length).trim() : '';
  if (!uid) return { ok: false, reason: 'not_a_directory_person', detail: target };
  // ADD: parameters.identifier = {type, value, authenticated}; REMOVE: parameters = {type, value}.
  const params = asRecord(msg.parameters) ?? {};
  const ident = actionType === 'ADD' ? asRecord(params.identifier) ?? {} : params;
  const type = String(ident.type ?? '').toLowerCase();
  if (!(type in SCHEME_OF_SOVISUPLUS_TYPE)) return { ok: false, reason: 'unsupported_type', detail: type };
  const sovisuplusType = type as SovisuplusIdentifierType;
  const rawValue = typeof ident.value === 'string' ? ident.value : '';
  // SoVisu+ before 1.7 sent REMOVE with the type only: which value was meant is not known for sure.
  if (!rawValue.trim()) return { ok: false, reason: 'missing_value' };
  if (!isReadableValue(sovisuplusType, rawValue)) return { ok: false, reason: 'invalid_value', detail: rawValue };
  const scheme = SCHEME_OF_SOVISUPLUS_TYPE[sovisuplusType];
  return {
    ok: true,
    action: {
      id, actionType, uid, personUid: String(msg.personUid ?? target), sovisuplusType, scheme,
      value: storedValue(scheme, rawValue),
      authenticated: actionType === 'ADD' && ident.authenticated === true,
      application, timestamp: typeof msg.timestamp === 'string' ? msg.timestamp : null,
    },
  };
};

// ── Primary identifier (decision D16 of the record provenance plan, druid-internal) ─────────────────────────────────

/**
 * Rank of a source for the choice of the primary value, lower is stronger: a person's choice in the record, then an
 * identifier the researcher authenticated, then a validated alignment, then imports and directories, then automatic
 * writers. `legacy` (provenance unknown, before 2026-11-27) sits with the imports.
 */
export const sourceRank = (source: string): number => {
  if (source === 'manual') return 0;
  if (source === SOVISUPLUS_AUTH_SOURCE) return 1;
  if (source.startsWith('align:')) return 2;
  if (source === 'job') return 4;
  if (source === 'graph') return 5;
  return 3;
};

export interface IdentifierWithSources {
  value: string;
  isPrimary: boolean;
  /** Every source that brought or confirmed the value (person_identifier_source.source). */
  sources: string[];
}

const bestRank = (sources: string[]) => (sources.length ? Math.min(...sources.map(sourceRank)) : sourceRank('legacy'));

/**
 * Primary value among the values of one scheme: strongest source; on a tie the current primary stays (a recalculation
 * never moves a primary for nothing), then the first value in alphabetical order (stable).
 */
export const choosePrimary = (values: IdentifierWithSources[]): string | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => bestRank(a.sources) - bestRank(b.sources)
    || Number(b.isPrimary) - Number(a.isPrimary) || a.value.localeCompare(b.value));
  return sorted[0].value;
};

// ── Effects ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type InboundConflictKind =
  /** The researcher removed a value the LDAP or a person in Druid had set: removed anyway, to review (D3). */
  | 'removed_by_researcher'
  /** An authenticated value replaced another primary value: the old one stays as secondary (D2). */
  | 'replaced_by_researcher'
  /** SoVisu+ added a value while Druid has another primary one: not written (D4). people.csv would remove it from
   * the graph at the next export: to settle quickly. */
  | 'differs_from_directory';

export type InboundEffect =
  | { kind: 'record_source'; scheme: InboundScheme; value: string; source: string }
  /** Writes the value; `primary`: it becomes the primary one, the others of the scheme turn secondary. */
  | { kind: 'write'; scheme: InboundScheme; value: string; primary: boolean }
  | { kind: 'set_primary'; scheme: InboundScheme; value: string }
  | { kind: 'remove'; scheme: InboundScheme; value: string }
  /** « Rejeté » in alignment_candidate: the alignments and jobs no longer write or propose it. */
  | { kind: 'reject'; scheme: InboundScheme; value: string; note: string; decidedBy: string }
  | { kind: 'lift_rejection'; scheme: InboundScheme; value: string }
  | { kind: 'conflict'; conflict: InboundConflictKind; scheme: InboundScheme; value: string; other?: string }
  | { kind: 'task'; taskType: 'annuaire_identifiant_partage'; scheme: InboundScheme; value: string; otherUids: string[] };

export interface InboundPlan {
  /** applied: the record changed; task: a person has to decide (task or conflict, possibly with changes); ignored. */
  outcome: 'applied' | 'task' | 'ignored';
  reason?: InboundIgnoreReason;
  effects: InboundEffect[];
}

export interface InboundPersonState {
  /** Identifiers of the record for the scheme of the action. */
  identifiers: IdentifierWithSources[];
  /** Values of the scheme set aside (« Rejeté »), any form. */
  rejected: string[];
  /** Other records carrying the value of the action (uids). */
  otherHolders: string[];
}

export const REMOVED_IN_SOVISUPLUS = 'Retiré dans SoVisu+';

/** Effects of an action on the record (decisions D2-D5 and D8 of the plan). `person` null: no record with that uid. */
export const planInboundEffects = (a: InboundAction, person: InboundPersonState | null): InboundPlan => {
  if (!person) return { outcome: 'ignored', reason: 'unknown_person', effects: [] };
  const same = (v: string) => comparableValue(v) === comparableValue(a.value);
  const match = person.identifiers.find((i) => same(i.value));
  const primary = person.identifiers.find((i) => i.isPrimary);
  const rejected = person.rejected.some(same);
  const decidedBy = `sovisuplus:${a.personUid}`;
  const effects: InboundEffect[] = [];

  if (a.actionType === 'REMOVE') {
    // D3: the researcher's removal is applied, and set aside so that no alignment brings it back.
    if (REJECTABLE.has(a.scheme)) effects.push({ kind: 'reject', scheme: a.scheme, value: a.value, note: REMOVED_IN_SOVISUPLUS, decidedBy });
    if (!match) {
      return effects.length ? { outcome: 'applied', reason: 'not_in_directory', effects } : { outcome: 'ignored', reason: 'not_in_directory', effects };
    }
    effects.push({ kind: 'remove', scheme: a.scheme, value: match.value });
    if (match.isPrimary) {
      const next = choosePrimary(person.identifiers.filter((i) => i !== match && !person.rejected.some((r) => comparableValue(r) === comparableValue(i.value))));
      if (next) effects.push({ kind: 'set_primary', scheme: a.scheme, value: next });
    }
    if (match.sources.some((s) => s === 'ldap' || s === 'manual')) {
      effects.push({ kind: 'conflict', conflict: 'removed_by_researcher', scheme: a.scheme, value: match.value });
      return { outcome: 'task', effects };
    }
    return { outcome: 'applied', effects };
  }

  // ADD — the source is recorded in every case (D4), so that the « Sources » panel and the conflicts know it.
  const source = a.authenticated ? SOVISUPLUS_AUTH_SOURCE : SOVISUPLUS_SOURCE;
  effects.push({ kind: 'record_source', scheme: a.scheme, value: match?.value ?? a.value, source });

  // D5: a value another record carries is never written here.
  const others = person.otherHolders.filter(Boolean);
  if (!match && others.length) {
    effects.push({ kind: 'task', taskType: 'annuaire_identifiant_partage', scheme: a.scheme, value: a.value, otherUids: others });
    return { outcome: 'task', effects };
  }

  if (a.authenticated) {
    // D2: the researcher proved the identifier is theirs: it becomes the primary one, even over a rejection.
    if (rejected) effects.push({ kind: 'lift_rejection', scheme: a.scheme, value: a.value });
    if (match) {
      if (match.isPrimary) return rejected ? { outcome: 'applied', effects } : { outcome: 'ignored', reason: 'already_present', effects };
      effects.push({ kind: 'set_primary', scheme: a.scheme, value: match.value });
      return { outcome: 'applied', effects };
    }
    effects.push({ kind: 'write', scheme: a.scheme, value: a.value, primary: true });
    if (primary) {
      effects.push({ kind: 'conflict', conflict: 'replaced_by_researcher', scheme: a.scheme, value: a.value, other: primary.value });
      return { outcome: 'task', effects };
    }
    return { outcome: 'applied', effects };
  }

  // D4: an unauthenticated addition (library staff) only fills an empty scheme.
  if (match) return { outcome: 'ignored', reason: 'already_present', effects };
  if (rejected) return { outcome: 'ignored', reason: 'rejected_in_directory', effects };
  if (!primary) {
    effects.push({ kind: 'write', scheme: a.scheme, value: a.value, primary: true });
    return { outcome: 'applied', effects };
  }
  effects.push({ kind: 'conflict', conflict: 'differs_from_directory', scheme: a.scheme, value: a.value, other: primary.value });
  return { outcome: 'task', effects };
};
