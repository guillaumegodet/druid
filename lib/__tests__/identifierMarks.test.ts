// Marks of the identifiers changed in SoVisu+ (lib/identifierMarks.ts, lot 6 of druid-internal
// docs/plan-retour-identifiants-sovisuplus.md). Identifiers are fictitious.
import { describe, expect, it } from 'vitest';
import { isSovisuplusAuthor, sovisuplusMarks } from '../identifierMarks';
import type { IdentifierSourceDetail } from '../../types';

const detail = (value: string, shown: boolean, primary: boolean, sources: [string, string][], setAside: IdentifierSourceDetail['setAside'] = null): IdentifierSourceDetail => ({
  value, shown, primary, sources: sources.map(([source, at]) => ({ source, by: null, at, lastSeen: at })), setAside,
});

describe('sovisuplusMarks', () => {
  it('marks the primary value SoVisu+ brought, authenticated first', () => {
    expect(sovisuplusMarks({
      orcid: [detail('0000-0001-0000-0001', true, true, [['legacy', '2026-10-01T00:00:00Z'], ['sovisuplus:auth', '2026-11-28T10:00:00Z']])],
      idref: [detail('12345678X', true, true, [['sovisuplus', '2026-11-20T10:00:00Z'], ['sovisuplus', '2026-11-25T10:00:00Z']])],
    })).toEqual({
      orcid: { kind: 'authenticated', value: '0000-0001-0000-0001', at: '2026-11-28T10:00:00Z' },
      idref: { kind: 'added', value: '12345678X', at: '2026-11-25T10:00:00Z' },
    });
  });

  it('a value removed in SoVisu+ that the record no longer shows', () => {
    expect(sovisuplusMarks({
      orcid: [detail('0000-0002-1825-0097', false, false, [['legacy', '2026-10-01T00:00:00Z']],
        { decision: 'Rejeté', by: 'sovisuplus:local-ada-l', at: '2026-11-28T09:00:00Z' })],
    })).toEqual({ orcid: { kind: 'removed', value: '0000-0002-1825-0097', at: '2026-11-28T09:00:00Z' } });
  });

  it('nothing for values that did not come from SoVisu+, a secondary value or a removal by a manager', () => {
    expect(sovisuplusMarks({
      orcid: [detail('0000-0002-1825-0097', true, true, [['align:orcid', '2026-10-01T00:00:00Z']])],
      idref: [detail('12345678X', true, false, [['sovisuplus', '2026-11-20T10:00:00Z']])],
      idhal: [detail('ada-lovelace', false, false, [], { decision: 'Rejeté', by: 'manager-a', at: '2026-11-28T09:00:00Z' })],
    })).toEqual({});
    expect(sovisuplusMarks(null)).toEqual({});
  });

  it('recognises SoVisu+ as the author of a decision', () => {
    expect(isSovisuplusAuthor('sovisuplus:local-ada-l')).toBe(true);
    expect(isSovisuplusAuthor('manager-a')).toBe(false);
    expect(isSovisuplusAuthor(null)).toBe(false);
  });
});
