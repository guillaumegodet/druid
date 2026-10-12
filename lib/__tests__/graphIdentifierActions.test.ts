// Removals carried to the CRISalid knowledge graph (lib/graph/identifierActions.ts, lot 11 b of druid-internal
// docs/plan-migration-postgresql.md): plan derived from the directory and the state of the graph, message format.
import { describe, expect, it } from 'vitest';
import {
  comparableValue, planGraphActions, removalMessage, removalRoutingKey,
  type GraphIdentifier, type OpenAction,
} from '../graph/identifierActions';
import { acceptedTypesFromEnv, graphActionsModeFromEnv } from '../graph/publisher';

const id = (uid: string, type: GraphIdentifier['type'], value: string): GraphIdentifier => ({ uid, type, value });
const open = (a: GraphIdentifier, status: OpenAction['status'], actionId = `a-${a.uid}-${a.type}`): OpenAction => ({ ...a, id: actionId, status });
const plan = (input: Partial<Parameters<typeof planGraphActions>[0]>) =>
  planGraphActions({ directory: [], uids: ['ada-l', 'babbage-c'], state: [], open: [], ...input });

describe('planGraphActions', () => {
  it('nothing to do when the graph holds what the directory holds', () => {
    const ids = [id('ada-l', 'orcid', '0000-0002-1825-0097'), id('ada-l', 'idhals', 'ada-lovelace')];
    expect(plan({ directory: ids, state: ids })).toEqual({ removals: [], unblocked: [], cancelled: [], unreadable: [], orphans: [] });
  });

  it('an identifier removed from the directory, or replaced by another value, is removed from the graph', () => {
    const p = plan({
      directory: [id('ada-l', 'idref', '012345678')],
      state: [id('ada-l', 'idref', '123456789'), id('ada-l', 'idhals', 'someone-else')],
    });
    expect(p.removals).toEqual([
      { ...id('ada-l', 'idref', '123456789'), status: 'pending' },
      { ...id('ada-l', 'idhals', 'someone-else'), status: 'pending' },
    ]);
  });

  it('additions are left to people.csv: an identifier missing from the graph gives no action', () => {
    expect(plan({ directory: [id('ada-l', 'orcid', '0000-0002-1825-0097')] }).removals).toEqual([]);
  });

  it('the same identifier written differently is never taken for a correction', () => {
    const p = plan({
      directory: [id('ada-l', 'orcid', 'https://orcid.org/0000-0002-1825-009X'), id('ada-l', 'idref', '02345678x ')],
      state: [id('ada-l', 'orcid', '0000-0002-1825-009x'), id('ada-l', 'idref', '02345678X')],
    });
    expect(p.removals).toEqual([]);
    expect(comparableValue(' https://www.idref.fr/02345678X')).toBe('02345678x');
  });

  it('an unreadable directory value (two ORCIDs in one cell) leaves the graph value alone', () => {
    const dirty = id('ada-l', 'orcid', '0000-0003-1111-2222\nou\n0000-0003-3333-4444');
    const held = id('ada-l', 'orcid', '0000-0003-1111-2222');
    const p = plan({ directory: [dirty], state: [held], open: [open(held, 'pending', 'queued-before')] });
    expect(p).toMatchObject({ removals: [], unreadable: [dirty], cancelled: ['queued-before'] });
  });

  it('a type the IKG refuses (Scopus) is kept blocked, and unblocked once accepted', () => {
    const scopus = id('ada-l', 'scopus', '11111111111');
    expect(plan({ state: [scopus] }).removals).toEqual([{ ...scopus, status: 'blocked' }]);
    const blocked = open(scopus, 'blocked');
    expect(plan({ state: [scopus], open: [blocked] })).toMatchObject({ removals: [], unblocked: [] });
    expect(plan({ state: [scopus], open: [blocked], accepted: ['orcid', 'idref', 'idhals', 'idhali', 'scopus'] }))
      .toMatchObject({ removals: [], unblocked: [blocked.id] });
  });

  it('an open action is not queued twice', () => {
    const wrong = id('ada-l', 'orcid', '0000-0001-2345-6780');
    for (const status of ['pending', 'failed'] as const) {
      expect(plan({ state: [wrong], open: [open(wrong, status)] })).toMatchObject({ removals: [], cancelled: [] });
    }
  });

  it('an open action is cancelled when the directory holds the value again, or the graph no longer holds it', () => {
    const v = id('ada-l', 'orcid', '0000-0001-2345-6780');
    expect(plan({ directory: [v], state: [v], open: [open(v, 'failed', 'back')] }).cancelled).toEqual(['back']);
    expect(plan({ state: [], open: [open(v, 'pending', 'gone')] }).cancelled).toEqual(['gone']);
  });

  it('persons of the graph without a record in the directory are listed, never touched', () => {
    const p = plan({ state: [id('gone-y', 'orcid', '0000-0003-5555-6660'), id('gone-y', 'idref', '234567890')] });
    expect(p).toEqual({ removals: [], unblocked: [], cancelled: [], unreadable: [], orphans: ['gone-y'] });
    expect(plan({ state: [id('gone-x', 'orcid', 'x')], open: [open(id('gone-x', 'orcid', 'x'), 'pending', 'o')] }).cancelled).toEqual(['o']);
  });

  it('several primary values of one type in the directory: only a value outside them is removed', () => {
    const p = plan({
      directory: [id('ada-l', 'idref', '012345678'), id('ada-l', 'idref', '02345678X')],
      state: [id('ada-l', 'idref', '02345678X'), id('babbage-c', 'idref', '123456789')],
    });
    expect(p.removals).toEqual([{ ...id('babbage-c', 'idref', '123456789'), status: 'pending' }]);
  });
});

describe('removalMessage', () => {
  it('has the fields of a SoVisu+ user action, the graph uid and the author of the correction', () => {
    const msg = removalMessage({ id: 'u-1', ...id('Ada-L', 'idhals', 'ada-lovelace'), actor: 'manager-a' }, '2026-10-12T10:00:00.000Z');
    expect(msg).toEqual({
      id: 'u-1', actionType: 'REMOVE', targetType: 'PERSON', targetUid: 'local-Ada-L', path: 'identifiers',
      parameters: { type: 'idhals', value: 'ada-lovelace' }, timestamp: '2026-10-12T10:00:00.000Z',
      personUid: 'manager-a', application: 'druid',
    });
    expect(removalMessage({ id: 'u-2', ...id('a', 'orcid', 'x') }, 't').personUid).toBe('druid');
    expect(removalRoutingKey).toBe('task.people.person.remove.interactive');
  });
});

describe('publisher settings', () => {
  it('DRUID_GRAPH_ACTIONS: off by default, refused when unknown', () => {
    expect(graphActionsModeFromEnv({})).toBe('off');
    expect(graphActionsModeFromEnv({ DRUID_GRAPH_ACTIONS: ' Dry-Run ' })).toBe('dry-run');
    expect(() => graphActionsModeFromEnv({ DRUID_GRAPH_ACTIONS: 'yes' })).toThrow(/off, dry-run, on/);
  });

  it('DRUID_GRAPH_ACCEPTED_TYPES: the IKG list by default, Scopus can be added, unknown types refused', () => {
    expect(acceptedTypesFromEnv({})).toEqual(['orcid', 'idref', 'idhals', 'idhali']);
    expect(acceptedTypesFromEnv({ DRUID_GRAPH_ACCEPTED_TYPES: 'orcid, idref,idhals,idhali,Scopus' })).toContain('scopus');
    expect(() => acceptedTypesFromEnv({ DRUID_GRAPH_ACCEPTED_TYPES: 'orcid,openalex' })).toThrow(/openalex/);
  });
});
