// Snapshot of the identifiers the CRISalid knowledge graph holds for the directory's persons (lot 11 c of druid-internal
// docs/plan-migration-postgresql.md). Pure module: reads the export of scripts/graph/export_graph_identifiers.sh
// (cypher-shell, plain format), compares it with the state Druid kept (graph_identifier_state) and finds the removals
// sent that the graph still holds: the IKG acknowledges no identifier action, the next snapshot is the only check.
import { GRAPH_TYPE_OF_SCHEME, comparableValue, type GraphIdentifier, type GraphIdentifierType } from './identifierActions';

const GRAPH_TYPES = new Set<string>(Object.values(GRAPH_TYPE_OF_SCHEME));
const LOCAL_PREFIX = 'local-';

export interface ParsedSnapshot {
  identifiers: GraphIdentifier[];
  /** Lines that are not three quoted fields (header aside). */
  unreadableLines: number;
  /** Persons of the graph that do not come from the directory (uid without `local-`). */
  notLocal: number;
  /** Identifier types Druid does not follow (eppn, local…). */
  otherTypes: number;
  /** Persons holding several values of one type: none is kept, a removal must name the value the graph holds. */
  conflicts: { uid: string; type: GraphIdentifierType }[];
}

/**
 * Reads the cypher-shell plain output of `RETURN uid, type, value`: a header line, then `"a", "b", "c"` per row
 * (cypher-shell escapes a quote inside a string as \" and nothing else).
 */
export const parseGraphSnapshot = (text: string): ParsedSnapshot => {
  const out: ParsedSnapshot = { identifiers: [], unreadableLines: 0, notLocal: 0, otherTypes: 0, conflicts: [] };
  const byKey = new Map<string, GraphIdentifier[]>();
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  for (const [i, line] of lines.entries()) {
    if (i === 0 && /^uid\s*,\s*type\s*,\s*value$/i.test(line.trim())) continue;
    const m = /^"((?:[^"\\]|\\.)*)", "((?:[^"\\]|\\.)*)", "((?:[^"\\]|\\.)*)"$/.exec(line.trim());
    if (!m) { out.unreadableLines++; continue; }
    const [uid, type, value] = m.slice(1).map((f) => f.replace(/\\"/g, '"'));
    if (!uid.startsWith(LOCAL_PREFIX) || uid.length === LOCAL_PREFIX.length) { out.notLocal++; continue; }
    if (!GRAPH_TYPES.has(type)) { out.otherTypes++; continue; }
    if (!value.trim()) { out.unreadableLines++; continue; }
    const id: GraphIdentifier = { uid: uid.slice(LOCAL_PREFIX.length), type: type as GraphIdentifierType, value };
    const k = `${id.uid}\u0000${id.type}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(id);
  }
  for (const ids of byKey.values()) {
    const values = new Set(ids.map((id) => comparableValue(id.value)));
    if (values.size > 1) out.conflicts.push({ uid: ids[0].uid, type: ids[0].type });
    else out.identifiers.push(ids[0]);
  }
  return out;
};

export interface StateDifference {
  added: number;
  removed: number;
  changed: number;
  unchanged: number;
}

/** What the snapshot changes in the state Druid kept: rows added, gone, with another value. */
export const compareGraphStates = (previous: GraphIdentifier[], next: GraphIdentifier[]): StateDifference => {
  const before = new Map(previous.map((s) => [`${s.uid}\u0000${s.type}`, comparableValue(s.value)]));
  const diff: StateDifference = { added: 0, removed: 0, changed: 0, unchanged: 0 };
  const seen = new Set<string>();
  for (const s of next) {
    const k = `${s.uid}\u0000${s.type}`;
    seen.add(k);
    const old = before.get(k);
    if (old === undefined) diff.added++;
    else if (old === comparableValue(s.value)) diff.unchanged++;
    else diff.changed++;
  }
  diff.removed = [...before.keys()].filter((k) => !seen.has(k)).length;
  return diff;
};

/**
 * Removals sent before the snapshot was taken whose identifier the graph still holds: not applied (refused by the
 * IKG, or never consumed). Restoring them in the state makes the next pass queue them again, once per snapshot.
 */
export const unappliedRemovals = <A extends GraphIdentifier>(sent: A[], snapshot: GraphIdentifier[]): A[] => {
  const held = new Set(snapshot.map((s) => `${s.uid}\u0000${s.type}\u0000${comparableValue(s.value)}`));
  return sent.filter((a) => held.has(`${a.uid}\u0000${a.type}\u0000${comparableValue(a.value)}`));
};
