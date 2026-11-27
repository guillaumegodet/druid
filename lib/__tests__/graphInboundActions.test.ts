// Identifier actions coming back from SoVisu+ (lib/graph/inboundActions.ts, lot 2 of druid-internal
// docs/plan-retour-identifiants-sovisuplus.md): message parsing, primary choice, effects of decisions D2-D5 and D8.
// Messages shaped like the ones captured on the bus (CRISalid 1.7); identifiers are fictitious.
import { describe, expect, it } from 'vitest';
import {
  REMOVED_IN_SOVISUPLUS, choosePrimary, parseInboundMessage, planInboundEffects, sourceRank, storedValue,
  type InboundAction, type InboundPersonState, type IdentifierWithSources,
} from '../graph/inboundActions';

const ORCID = '0000-0002-1825-0097';
// Fictitious values with a wrong check digit (only the official test record is real): the rules check the shape only.
const ORCID_2 = '0000-0001-0000-0001';

const addMessage = (type: string, value: string, authenticated = false, extra: Record<string, unknown> = {}) => ({
  id: '40ac010a-0000-4000-8000-000000000001', actionType: 'ADD', targetType: 'PERSON', targetUid: 'local-ada-l',
  path: 'identifiers', parameters: { identifier: { type, value, authenticated } }, timestamp: '2026-11-27T21:01:57.217Z',
  personUid: 'local-ada-l', application: 'sovisuplus', ...extra,
});
const removeMessage = (type: string, value: string, extra: Record<string, unknown> = {}) => ({
  id: 'c9157f3f-0000-4000-8000-000000000002', actionType: 'REMOVE', targetType: 'PERSON', targetUid: 'local-ada-l',
  path: 'identifiers', parameters: { type, value }, timestamp: '2026-11-27T20:59:30.696Z',
  personUid: 'local-ada-l', application: 'sovisuplus', ...extra,
});

const parsed = (raw: unknown): InboundAction => {
  const r = parseInboundMessage(raw);
  if (!r.ok) throw new Error(`not parsed: ${r.reason}`);
  return r.action;
};
const ident = (value: string, isPrimary: boolean, ...sources: string[]): IdentifierWithSources => ({ value, isPrimary, sources });
const state = (identifiers: IdentifierWithSources[], extra: Partial<InboundPersonState> = {}): InboundPersonState =>
  ({ identifiers, rejected: [], otherHolders: [], ...extra });

describe('parseInboundMessage', () => {
  it('reads an ADD and a REMOVE as SoVisu+ 1.7 sends them', () => {
    expect(parseInboundMessage(JSON.stringify(addMessage('idref', '12345678x')))).toEqual({
      ok: true,
      action: {
        id: '40ac010a-0000-4000-8000-000000000001', actionType: 'ADD', uid: 'ada-l', personUid: 'local-ada-l',
        sovisuplusType: 'idref', scheme: 'idref', value: '12345678X', authenticated: false,
        application: 'sovisuplus', timestamp: '2026-11-27T21:01:57.217Z',
      },
    });
    const r = parsed(removeMessage('orcid', ORCID));
    expect([r.actionType, r.scheme, r.value, r.authenticated]).toEqual(['REMOVE', 'orcid', ORCID, false]);
  });

  it('maps the SoVisu+ types onto the directory schemes and stores the value in the directory form', () => {
    expect(parsed(addMessage('idhals', 'ADA-LOVELACE')).scheme).toBe('idhal');
    expect(parsed(addMessage('idhals', 'ADA-LOVELACE')).value).toBe('ada-lovelace');
    expect(parsed(addMessage('idhali', '100001')).scheme).toBe('idhal_i');
    expect(parsed(addMessage('orcid', `https://orcid.org/0000-0002-1825-009x`, true)).value).toBe('0000-0002-1825-009X');
    expect(storedValue('idref', ' 12345678x ')).toBe('12345678X');
  });

  it('an ADD is authenticated only when SoVisu+ says so', () => {
    expect(parsed(addMessage('orcid', ORCID, true)).authenticated).toBe(true);
    expect(parsed(addMessage('orcid', ORCID, 'true' as unknown as boolean)).authenticated).toBe(false);
  });

  it('skips what is not a SoVisu+ action on an identifier of a directory person', () => {
    const reason = (raw: unknown) => { const r = parseInboundMessage(raw); return r.ok ? 'ok' : r.reason; };
    expect(reason('{not json')).toBe('not_json');
    expect(reason([1, 2])).toBe('not_json');
    expect(reason(removeMessage('orcid', ORCID, { application: 'druid' }))).toBe('own_action');
    expect(reason(removeMessage('orcid', ORCID, { id: '' }))).toBe('missing_id');
    expect(reason(removeMessage('orcid', ORCID, { path: 'contributions' }))).toBe('not_a_person_identifier');
    expect(reason(removeMessage('orcid', ORCID, { targetType: 'DOCUMENT' }))).toBe('not_a_person_identifier');
    expect(reason(removeMessage('orcid', ORCID, { actionType: 'UPDATE' }))).toBe('unsupported_action');
    expect(reason(removeMessage('orcid', ORCID, { targetUid: 'ada-l' }))).toBe('not_a_directory_person');
    expect(reason(removeMessage('scopus', '12345678900'))).toBe('unsupported_type');
    // SoVisu+ before 1.7: REMOVE with the type only.
    expect(reason({ ...removeMessage('orcid', ORCID), parameters: { type: 'orcid' } })).toBe('missing_value');
    expect(reason(addMessage('orcid', '0000-0002-1825'))).toBe('invalid_value');
    expect(reason(addMessage('idref', 'abc'))).toBe('invalid_value');
  });
});

describe('choosePrimary (D16)', () => {
  it('ranks a person\'s choice, then an authenticated identifier, then an alignment, then imports, then jobs', () => {
    expect(sourceRank('manual')).toBeLessThan(sourceRank('sovisuplus:auth'));
    expect(sourceRank('sovisuplus:auth')).toBeLessThan(sourceRank('align:orcid'));
    expect(sourceRank('align:orcid')).toBeLessThan(sourceRank('lab_file'));
    expect(sourceRank('ldap')).toBe(sourceRank('legacy'));
    expect(sourceRank('sovisuplus')).toBe(sourceRank('lab_file'));
    expect(sourceRank('lab_file')).toBeLessThan(sourceRank('job'));
    expect(sourceRank('job')).toBeLessThan(sourceRank('graph'));
  });

  it('strongest source first; on a tie the current primary stays', () => {
    expect(choosePrimary([ident('A', true, 'legacy'), ident('B', false, 'sovisuplus:auth')])).toBe('B');
    expect(choosePrimary([ident('A', false, 'manual'), ident('B', true, 'sovisuplus:auth')])).toBe('A');
    expect(choosePrimary([ident('B', true, 'lab_file'), ident('A', false, 'legacy')])).toBe('B');
    expect(choosePrimary([ident('B', false, 'job'), ident('A', false, 'job')])).toBe('A');
    expect(choosePrimary([ident('A', false)])).toBe('A');
    expect(choosePrimary([])).toBeNull();
  });
});

describe('planInboundEffects', () => {
  it('no record with that uid: ignored', () => {
    expect(planInboundEffects(parsed(removeMessage('orcid', ORCID)), null)).toEqual({ outcome: 'ignored', reason: 'unknown_person', effects: [] });
  });

  describe('D3 — removal by the researcher', () => {
    it('applied at once and set aside, so that no alignment brings it back', () => {
      const p = planInboundEffects(parsed(removeMessage('orcid', ORCID)), state([ident(ORCID, true, 'legacy')]));
      expect(p).toEqual({
        outcome: 'applied',
        effects: [
          { kind: 'reject', scheme: 'orcid', value: ORCID, note: REMOVED_IN_SOVISUPLUS, decidedBy: 'sovisuplus:local-ada-l' },
          { kind: 'remove', scheme: 'orcid', value: ORCID },
        ],
      });
    });

    it('the value is matched whatever its form, and the stored form is removed', () => {
      const p = planInboundEffects(parsed(removeMessage('idref', '12345678x')), state([ident('12345678X', true, 'align:idref')]));
      expect(p.effects).toContainEqual({ kind: 'remove', scheme: 'idref', value: '12345678X' });
    });

    it('removing the primary value promotes the best remaining one, never a value set aside', () => {
      const ids = [ident(ORCID, true, 'legacy'), ident(ORCID_2, false, 'align:orcid'), ident('0000-0003-1415-9260', false, 'manual')];
      const p = planInboundEffects(parsed(removeMessage('orcid', ORCID)), state(ids, { rejected: ['0000-0003-1415-9260'] }));
      expect(p.effects).toContainEqual({ kind: 'set_primary', scheme: 'orcid', value: ORCID_2 });
    });

    it('a value the LDAP or a person had set is removed anyway, with a conflict to review', () => {
      for (const source of ['ldap', 'manual']) {
        const p = planInboundEffects(parsed(removeMessage('idref', '12345678X')), state([ident('12345678X', true, 'legacy', source)]));
        expect(p.outcome).toBe('task');
        expect(p.effects).toContainEqual({ kind: 'remove', scheme: 'idref', value: '12345678X' });
        expect(p.effects).toContainEqual({ kind: 'conflict', conflict: 'removed_by_researcher', scheme: 'idref', value: '12345678X' });
      }
    });

    it('a value the directory does not hold is still set aside (the researcher said it is not theirs)', () => {
      expect(planInboundEffects(parsed(removeMessage('idref', '12345678X')), state([]))).toEqual({
        outcome: 'applied', reason: 'not_in_directory',
        effects: [{ kind: 'reject', scheme: 'idref', value: '12345678X', note: REMOVED_IN_SOVISUPLUS, decidedBy: 'sovisuplus:local-ada-l' }],
      });
    });
  });

  describe('D8 — IdHAL', () => {
    it('the IdHAL_i carries the rejection; the IdHAL_s is only removed', () => {
      const i = planInboundEffects(parsed(removeMessage('idhali', '100001')), state([ident('100001', true, 'align:hal')]));
      expect(i.effects.map((e) => e.kind)).toEqual(['reject', 'remove']);
      const s = planInboundEffects(parsed(removeMessage('idhals', 'ADA-LOVELACE')), state([ident('ada-lovelace', true, 'legacy')]));
      expect(s).toEqual({ outcome: 'applied', effects: [{ kind: 'remove', scheme: 'idhal', value: 'ada-lovelace' }] });
    });

    it('an IdHAL_s the directory does not hold: nothing to do', () => {
      expect(planInboundEffects(parsed(removeMessage('idhals', 'someone-else')), state([]))).toEqual({ outcome: 'ignored', reason: 'not_in_directory', effects: [] });
    });
  });

  describe('D2 — authenticated addition', () => {
    const auth = () => parsed(addMessage('orcid', ORCID_2, true));

    it('becomes the primary value; the old primary stays as secondary, with a conflict to know it was replaced', () => {
      const p = planInboundEffects(auth(), state([ident(ORCID, true, 'legacy')]));
      expect(p).toEqual({
        outcome: 'task',
        effects: [
          { kind: 'record_source', scheme: 'orcid', value: ORCID_2, source: 'sovisuplus:auth' },
          { kind: 'write', scheme: 'orcid', value: ORCID_2, primary: true },
          { kind: 'conflict', conflict: 'replaced_by_researcher', scheme: 'orcid', value: ORCID_2, other: ORCID },
        ],
      });
    });

    it('fills an empty scheme', () => {
      expect(planInboundEffects(auth(), state([])).effects.map((e) => e.kind)).toEqual(['record_source', 'write']);
    });

    it('wins over a rejection in Druid: the decision is lifted', () => {
      const p = planInboundEffects(auth(), state([], { rejected: [ORCID_2] }));
      expect(p.outcome).toBe('applied');
      expect(p.effects.map((e) => e.kind)).toEqual(['record_source', 'lift_rejection', 'write']);
    });

    it('a secondary value already in the record becomes primary', () => {
      const p = planInboundEffects(auth(), state([ident(ORCID, true, 'legacy'), ident(ORCID_2, false, 'align:orcid')]));
      expect(p.effects).toEqual([
        { kind: 'record_source', scheme: 'orcid', value: ORCID_2, source: 'sovisuplus:auth' },
        { kind: 'set_primary', scheme: 'orcid', value: ORCID_2 },
      ]);
    });

    it('the primary value already: only the source is recorded', () => {
      expect(planInboundEffects(auth(), state([ident(ORCID_2, true, 'legacy')]))).toEqual({
        outcome: 'ignored', reason: 'already_present',
        effects: [{ kind: 'record_source', scheme: 'orcid', value: ORCID_2, source: 'sovisuplus:auth' }],
      });
    });

    it('applies to an IdHAL authenticated through HAL as well', () => {
      const p = planInboundEffects(parsed(addMessage('idhali', '100002', true)), state([ident('100001', true, 'align:hal')]));
      expect(p.effects).toContainEqual({ kind: 'write', scheme: 'idhal_i', value: '100002', primary: true });
    });
  });

  describe('D4 — unauthenticated addition (library staff)', () => {
    const add = () => parsed(addMessage('idref', '12345678X'));

    it('fills an empty scheme as primary', () => {
      expect(planInboundEffects(add(), state([]))).toEqual({
        outcome: 'applied',
        effects: [
          { kind: 'record_source', scheme: 'idref', value: '12345678X', source: 'sovisuplus' },
          { kind: 'write', scheme: 'idref', value: '12345678X', primary: true },
        ],
      });
    });

    it('never replaces another primary value: conflict, nothing written', () => {
      expect(planInboundEffects(add(), state([ident('87654321X', true, 'legacy')]))).toEqual({
        outcome: 'task',
        effects: [
          { kind: 'record_source', scheme: 'idref', value: '12345678X', source: 'sovisuplus' },
          { kind: 'conflict', conflict: 'differs_from_directory', scheme: 'idref', value: '12345678X', other: '87654321X' },
        ],
      });
    });

    it('a value set aside in Druid is not written; the recorded source raises the existing conflict', () => {
      expect(planInboundEffects(add(), state([], { rejected: ['12345678x'] }))).toEqual({
        outcome: 'ignored', reason: 'rejected_in_directory',
        effects: [{ kind: 'record_source', scheme: 'idref', value: '12345678X', source: 'sovisuplus' }],
      });
    });

    it('the same value typed again (SoVisu+ « edit » = REMOVE then ADD): only the source is recorded', () => {
      expect(planInboundEffects(add(), state([ident('12345678X', true, 'legacy')]))).toEqual({
        outcome: 'ignored', reason: 'already_present',
        effects: [{ kind: 'record_source', scheme: 'idref', value: '12345678X', source: 'sovisuplus' }],
      });
    });
  });

  describe('D5 — value carried by another record', () => {
    it('never written here, authenticated or not: task « identifier carried by two people »', () => {
      for (const authenticated of [false, true]) {
        const p = planInboundEffects(parsed(addMessage('orcid', ORCID, authenticated)), state([], { otherHolders: ['babbage-c'] }));
        expect(p.outcome).toBe('task');
        expect(p.effects.map((e) => e.kind)).toEqual(['record_source', 'task']);
        expect(p.effects[1]).toEqual({ kind: 'task', taskType: 'annuaire_identifiant_partage', scheme: 'orcid', value: ORCID, otherUids: ['babbage-c'] });
      }
    });
  });
});
