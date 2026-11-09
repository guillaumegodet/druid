// IdRef search with the Qualinka engine (HAS_QUALINKA): a record whose IdRef was filled after the run must not keep
// showing the candidates of the stale cache entry. Fictitious data.
import { describe, it, expect } from 'vitest';
import { tokenAlignTexts } from '../directory/alignTexts';
import { computeIdrefQualinkaDiffFrom } from '../directory/alignments';

const rec = (fields: Record<string, unknown>) => ({ id: 7, fields: { uid_dyna: '', Nom: 'Martin', Prenom: 'Paul', LABO: 'LAB1', ...fields } });
const cand = (ppn: string, prefered: string, birth = '') => ({ ppn, prefered, birth, death: '', bioNote: '' });
const ambiguous = { g7: { mode: 'align', status: 'ambiguous', best: null, checkedAt: '2026-09-07', gristId: 7, queryName: 'Paul Martin',
  candidates: [cand('123456789', 'Martin, Paul (1974-....)', '1974'), cand('987654321', 'Martin, Paul (1950-....)', '1950')] } };
const accepted = { g7: { mode: 'align', status: 'accepted', best: '123456789', checkedAt: '2026-09-07', gristId: 7, queryName: 'Paul Martin',
  candidates: [cand('123456789', 'Martin, Paul (1974-....)', '1974')], identifiers: { orcid: '0000-0002-1825-0097' } } };
const diff = (cache: Record<string, unknown>, fields: Record<string, unknown> = {}) =>
  computeIdrefQualinkaDiffFrom({ records: [rec(fields)], cache, reviewRecords: null }, tokenAlignTexts);

describe('IdRef diff (Qualinka, search)', () => {
  it('an ambiguous record without IdRef goes to arbitration', () => {
    expect(diff(ambiguous).ambigus.map((a) => a.candidates.map((c) => c.ppn))).toEqual([['123456789', '987654321']]);
  });

  it('an ambiguous record whose IdRef was filled since the run is left out', () => {
    const d = diff(ambiguous, { IdRef: '123456789' });
    expect(d.ambigus).toEqual([]);
    expect(d.nonTrouves).toEqual([]);
  });

  it('an accepted candidate is proposed on an empty record only', () => {
    expect(diff(accepted).aRenseigner.map((r) => r.proposals.map((p) => p.field))).toEqual([['IdRef', 'ORCID']]);
    const d = diff(accepted, { IdRef: 'https://www.idref.fr/111111111' });
    expect([d.aRenseigner, d.conflits]).toEqual([[], []]);
  });
});
