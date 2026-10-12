// Corrections of identifiers carried to the CRISalid knowledge graph (IKG), lot 11 of druid-internal
// docs/plan-migration-postgresql.md (D12). Pure module: compares the primary identifiers of the directory with what
// Druid believes the graph holds (graph_identifier_state) and derives the user actions to send, in the format
// SoVisu+ sends them (exchange `graph`). Only removals for now: additions still go through people.csv. A removal is
// what makes the IKG clean up the publications harvested with a wrong identifier; people.csv only drops the
// identifier from the person.

/** Directory scheme (person_identifier.scheme) → identifier type of a person in the graph. */
export const GRAPH_TYPE_OF_SCHEME = {
  orcid: 'orcid',
  idref: 'idref',
  idhal: 'idhals',
  idhal_i: 'idhali',
  scopus: 'scopus',
} as const;

export type GraphIdentifierType = (typeof GRAPH_TYPE_OF_SCHEME)[keyof typeof GRAPH_TYPE_OF_SCHEME];

/** Types the IKG accepts in a user action (crisalid-ikg:dev, 2026-10-12): Scopus is refused, request 1 of
 * druid-internal docs/demandes-ikg-lot11.md. A removal of another type is kept `blocked` until the IKG accepts it. */
export const IKG_ACCEPTED_TYPES: readonly GraphIdentifierType[] = ['orcid', 'idref', 'idhals', 'idhali'];

export interface GraphIdentifier {
  /** Directory uid; the person of the graph is `local-<uid>`. */
  uid: string;
  type: GraphIdentifierType;
  value: string;
}

export type OpenActionStatus = 'pending' | 'blocked' | 'failed';

export interface OpenAction extends GraphIdentifier {
  id: string;
  status: OpenActionStatus;
}

export interface GraphActionPlan {
  /** Removals to queue: `pending` (to send) or `blocked` (type refused by the IKG). */
  removals: (GraphIdentifier & { status: 'pending' | 'blocked' })[];
  /** Blocked actions whose type the IKG now accepts: back to `pending`. */
  unblocked: string[];
  /** Open actions no longer needed: the directory holds the value again, or the graph no longer does. */
  cancelled: string[];
  /** Directory values that cannot be read as an identifier of their type (two ORCIDs in one cell…): the graph value
   * of that person and type is left alone, the record is to fix first. */
  unreadable: GraphIdentifier[];
  /** Persons of the graph with no record in the directory (merged, uid changed, deleted): never handled
   * automatically, removing their identifiers would delete their publications instead of moving them. */
  orphans: string[];
}

/**
 * Comparison form of an identifier value: the same identifier written differently (URL form, case of the ORCID / IdRef
 * check character, spaces) must never be taken for a correction, a wrong removal deletes publications.
 */
export const comparableValue = (value: string): string =>
  value.trim().replace(/^https?:\/\/(www\.)?(orcid\.org|idref\.fr)\//i, '').toLowerCase();

/** Shape of a valid value, in comparison form. */
const VALID_VALUE: Record<GraphIdentifierType, RegExp> = {
  orcid: /^\d{4}-\d{4}-\d{4}-\d{3}[\dx]$/,
  idref: /^\d{8}[\dx]$/,
  idhals: /^[^\s,;|]+$/,
  idhali: /^\d+$/,
  scopus: /^\d+$/,
};

export const isReadableValue = (type: GraphIdentifierType, value: string) => VALID_VALUE[type].test(comparableValue(value));

const key = (uid: string, type: string) => `${uid}\u0000${type}`;

export interface PlanInput {
  /** Primary identifiers of the directory, already typed for the graph (persons with a uid). */
  directory: GraphIdentifier[];
  /** Every uid of the directory, with or without identifiers. */
  uids: Iterable<string>;
  /** What Druid believes the graph holds. */
  state: GraphIdentifier[];
  /** Actions not sent yet (pending, blocked, failed). */
  open: OpenAction[];
  accepted?: Iterable<GraphIdentifierType>;
}

/** Actions that bring the graph to the identifiers of the directory, removals only (see the header). */
export const planGraphActions = ({ directory, uids, state, open, accepted = IKG_ACCEPTED_TYPES }: PlanInput): GraphActionPlan => {
  const acceptedTypes = new Set<string>(accepted);
  const directoryUids = new Set(uids);
  const wanted = new Map<string, Set<string>>();
  const unreadable: GraphIdentifier[] = [];
  const unreadableKeys = new Set<string>();
  for (const id of directory) {
    const k = key(id.uid, id.type);
    if (!isReadableValue(id.type, id.value)) { unreadable.push(id); unreadableKeys.add(k); }
    if (!wanted.has(k)) wanted.set(k, new Set());
    wanted.get(k)!.add(comparableValue(id.value));
  }
  const isWanted = (id: GraphIdentifier) => wanted.get(key(id.uid, id.type))?.has(comparableValue(id.value)) ?? false;
  const held = new Set(state.map((s) => `${key(s.uid, s.type)}\u0000${comparableValue(s.value)}`));
  const isHeld = (id: GraphIdentifier) => held.has(`${key(id.uid, id.type)}\u0000${comparableValue(id.value)}`);

  const plan: GraphActionPlan = { removals: [], unblocked: [], cancelled: [], unreadable, orphans: [] };
  const openByIdentifier = new Map<string, OpenAction>();
  for (const a of open) {
    // Still needed while the graph holds the value and the directory does not.
    if (isHeld(a) && !isWanted(a) && directoryUids.has(a.uid) && !unreadableKeys.has(key(a.uid, a.type))) {
      openByIdentifier.set(`${key(a.uid, a.type)}\u0000${comparableValue(a.value)}`, a);
      if (a.status === 'blocked' && acceptedTypes.has(a.type)) plan.unblocked.push(a.id);
    } else {
      plan.cancelled.push(a.id);
    }
  }

  const orphans = new Set<string>();
  for (const s of state) {
    if (!directoryUids.has(s.uid)) { orphans.add(s.uid); continue; }
    if (isWanted(s) || unreadableKeys.has(key(s.uid, s.type))) continue;
    if (openByIdentifier.has(`${key(s.uid, s.type)}\u0000${comparableValue(s.value)}`)) continue;
    plan.removals.push({ uid: s.uid, type: s.type, value: s.value, status: acceptedTypes.has(s.type) ? 'pending' : 'blocked' });
  }
  plan.orphans = [...orphans].sort();
  return plan;
};

/** Graph uid of a directory person (people.csv: `local_identifier` = uid, the IKG prefixes it). */
export const graphPersonUid = (uid: string) => `local-${uid}`;

export interface UserActionMessage {
  id: string;
  actionType: 'REMOVE';
  targetType: 'PERSON';
  targetUid: string;
  path: 'identifiers';
  parameters: { type: string; value: string };
  timestamp: string;
  personUid: string;
  application: 'druid';
}

/** Message of a removal, same fields as SoVisu+ (ActionDispatchService); `personUid` = author of the correction. */
export const removalMessage = (action: GraphIdentifier & { id: string; actor?: string | null }, timestamp: string): UserActionMessage => ({
  id: action.id,
  actionType: 'REMOVE',
  targetType: 'PERSON',
  targetUid: graphPersonUid(action.uid),
  path: 'identifiers',
  parameters: { type: action.type, value: action.value },
  timestamp,
  personUid: action.actor || 'druid',
  application: 'druid',
});

/** Routing key on the `graph` exchange (SoVisu+: task.people.person.<action> + `.interactive`). */
export const removalRoutingKey = 'task.people.person.remove.interactive';
