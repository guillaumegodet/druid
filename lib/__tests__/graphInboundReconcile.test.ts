// Reconciliation with the SoVisu+ action table (lib/graph/inboundReconcile.ts, lot 5 of druid-internal
// docs/plan-retour-identifiants-sovisuplus.md): shape check, messages rebuilt from rows, superseded actions.
import { describe, expect, it } from 'vitest';
import { actionRowToMessage, actionSchemaProblems, isoTimestamp, selectReplays, type ActionRow } from '../graph/inboundReconcile';

const COLUMNS = [
  { name: 'id', type: 'text' }, { name: 'actionType', type: '"ActionType"' }, { name: 'targetType', type: '"ActionTargetType"' },
  { name: 'targetUid', type: 'text' }, { name: 'path', type: 'text' }, { name: 'parameters', type: 'jsonb' },
  { name: 'timestamp', type: 'timestamp(3) without time zone' }, { name: 'dispatched', type: 'boolean' }, { name: 'personUid', type: 'text' },
];
const row = (id: string, actionType: string, type: string, value: string, timestamp: string, extra: Partial<ActionRow> = {}): ActionRow => ({
  id, actionType, targetType: 'PERSON', targetUid: 'local-ada-l', path: 'identifiers',
  parameters: actionType === 'ADD' ? { identifier: { type, value, authenticated: false } } : { type, value },
  timestamp, dispatched: true, personUid: 'local-ada-l', ...extra,
});

describe('actionSchemaProblems', () => {
  it('accepts the table of SoVisu+ 1.7 (enums, or text in a copy)', () => {
    expect(actionSchemaProblems(COLUMNS)).toEqual([]);
    expect(actionSchemaProblems(COLUMNS.map((c) => (c.type.startsWith('"') ? { ...c, type: 'text' } : c)))).toEqual([]);
    expect(actionSchemaProblems([...COLUMNS, { name: 'newColumn', type: 'integer' }])).toEqual([]);
  });

  it('refuses a table it would misread', () => {
    expect(actionSchemaProblems([])).toEqual(['table "Action" not found']);
    expect(actionSchemaProblems(COLUMNS.filter((c) => c.name !== 'parameters'))).toEqual(['column "parameters" missing']);
    expect(actionSchemaProblems(COLUMNS.map((c) => (c.name === 'timestamp' ? { ...c, type: 'bigint' } : c)))).toEqual(['column "timestamp" is bigint']);
  });
});

describe('messages rebuilt from the table', () => {
  it('a timestamp without time zone is UTC', () => {
    expect(isoTimestamp('2026-11-27 20:59:30.696')).toBe('2026-11-27T20:59:30.696Z');
    expect(isoTimestamp('2026-11-27 20:59:30')).toBe('2026-11-27T20:59:30.000Z');
    expect(isoTimestamp('2026-11-27T20:59:30.696Z')).toBe('2026-11-27T20:59:30.696Z');
  });

  it('the message is the one SoVisu+ publishes', () => {
    expect(actionRowToMessage(row('a-1', 'REMOVE', 'orcid', '0000-0002-1825-0097', '2026-11-27 20:59:30.696'))).toEqual({
      id: 'a-1', actionType: 'REMOVE', targetType: 'PERSON', targetUid: 'local-ada-l', path: 'identifiers',
      parameters: { type: 'orcid', value: '0000-0002-1825-0097' }, timestamp: '2026-11-27T20:59:30.696Z',
      personUid: 'local-ada-l', application: 'sovisuplus',
    });
  });
});

describe('selectReplays', () => {
  const add = actionRowToMessage(row('a-add', 'ADD', 'idref', '12345678X', '2026-11-20 10:00:00'));
  const remove = actionRowToMessage(row('a-rem', 'REMOVE', 'idref', '12345678X', '2026-11-21 10:00:00'));

  it('replays in the order of the table', () => {
    expect(selectReplays([remove, add], new Map()).replay.map((m) => m.id)).toEqual(['a-add', 'a-rem']);
  });

  it('an action older than one already handled on the same identifier is superseded, not replayed', () => {
    const handled = new Map([['ada-l|idref', '2026-11-21T10:00:00.000Z']]);
    expect(selectReplays([add], handled)).toEqual({ replay: [], superseded: [add] });
    // Another identifier of the same person, or a later action, is replayed.
    expect(selectReplays([add], new Map([['ada-l|orcid', '2026-11-21T10:00:00.000Z']])).replay).toEqual([add]);
    expect(selectReplays([remove], new Map([['ada-l|idref', '2026-11-20T10:00:00.000Z']])).replay).toEqual([remove]);
  });
});
