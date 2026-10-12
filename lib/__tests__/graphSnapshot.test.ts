// Snapshot of the identifiers held by the CRISalid knowledge graph (lib/graph/snapshot.ts, lot 11 c of druid-internal
// docs/plan-migration-postgresql.md): reading of the cypher-shell export, difference with the state, unapplied removals.
import { describe, expect, it } from 'vitest';
import { compareGraphStates, parseGraphSnapshot, unappliedRemovals } from '../graph/snapshot';
import type { GraphIdentifier } from '../graph/identifierActions';

const id = (uid: string, type: GraphIdentifier['type'], value: string): GraphIdentifier => ({ uid, type, value });

describe('parseGraphSnapshot', () => {
  it('reads the plain output of cypher-shell: header, quoted fields, local persons and followed types only', () => {
    const parsed = parseGraphSnapshot([
      'uid, type, value',
      '"local-ada-l", "orcid", "0000-0002-1825-0097"',
      '"local-E012345X", "idhals", "ada-\\"the\\"-lovelace"',
      '"scanr-anon:doi10.1/x:ada", "orcid", "0000-0002-1825-0097"',
      '"local-ada-l", "eppn", "ada@example.org"',
      '"local-ada-l", "idref", NULL',
      '"local-", "orcid", "0000-0002-1825-0097"',
      '"local-babbage-c", "scopus", " "',
      '',
    ].join('\n'));
    expect(parsed).toEqual({
      identifiers: [id('ada-l', 'orcid', '0000-0002-1825-0097'), id('E012345X', 'idhals', 'ada-"the"-lovelace')],
      unreadableLines: 2, notLocal: 2, otherTypes: 1, conflicts: [],
    });
  });

  it('a person holding several values of one type is left out: a removal must name the value the graph holds', () => {
    const parsed = parseGraphSnapshot([
      '"local-ada-l", "idref", "012345678"', '"local-ada-l", "idref", "123456789"',
      '"local-ada-l", "orcid", "0000-0002-1825-009X"', '"local-ada-l", "orcid", "0000-0002-1825-009x"',
    ].join('\n'));
    expect(parsed.conflicts).toEqual([{ uid: 'ada-l', type: 'idref' }]);
    expect(parsed.identifiers).toEqual([id('ada-l', 'orcid', '0000-0002-1825-009X')]);
  });
});

describe('compareGraphStates', () => {
  it('counts the rows added, gone, changed and identical (values compared in comparison form)', () => {
    expect(compareGraphStates(
      [id('a', 'orcid', '0000-0002-1825-009x'), id('a', 'idref', '012345678'), id('b', 'idref', '123456789')],
      [id('a', 'orcid', '0000-0002-1825-009X'), id('a', 'idref', '02345678X'), id('c', 'scopus', '11111111111')],
    )).toEqual({ added: 1, removed: 1, changed: 1, unchanged: 1 });
  });
});

describe('unappliedRemovals', () => {
  it('keeps the sent removals whose value the graph still holds', () => {
    const sent = [{ ...id('a', 'idref', '012345678'), id: 's1' }, { ...id('a', 'orcid', '0000-0002-1825-0097'), id: 's2' }];
    expect(unappliedRemovals(sent, [id('a', 'idref', '012345678'), id('a', 'orcid', '0000-0003-1111-2222')]).map((a) => a.id)).toEqual(['s1']);
  });
});
