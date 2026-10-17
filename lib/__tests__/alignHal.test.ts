// HAL in the unified alignment view (druid-internal docs/plan-alignement-idhal-i.md, lot 3): one researcher, several HAL
// persons — the first checked one is the primary IdHAL_i, the others secondary. Fictitious data.
import { describe, it, expect } from 'vitest';
import { tokenAlignTexts } from '../directory/alignTexts';
import {
  computeAlignDiffFrom, pivotUnifiedAlignDiffs, buildUnifiedUpdates, halPatchFields, unifiedFillKey, unifiedAmbigKey, unifiedUpdatePatches,
} from '../directory/alignments';
import type { AnnuaireColumnMeta } from '../directory/annuaireWrite';

const person = (idhalI: string, idhal: string, score: string, extra: Record<string, unknown> = {}) => ({
  idhal, idhalI, fullName: 'Claire Durand', forms: ['Claire Durand'], emailDomains: [], orcid: '', idref: '', labs: [], score,
  evidence: [], matchedIds: score === 'fort' ? ['IdRef'] : [], nameMatch: 'exact', suspect: [], ...extra,
});
const rec = (fields: Record<string, unknown>) => ({ id: 1, fields: { uid_dyna: 'durand-c', Nom: 'Durand', Prenom: 'Claire', LABO: 'LAB1', ...fields } });
const COLS = (withSecondaries = true): AnnuaireColumnMeta[] => ['IdHAL', 'IdHAL_i', 'Data_source', 'Commentaires', ...(withSecondaries ? ['IdHAL_i_secondaires'] : [])]
  .map((id) => ({ id, label: id, type: 'Text', isFormula: false }));

describe('HAL diff: persons with or without an IdHAL', () => {
  it('search: one checkable row per strong person (primary first), the other candidates arbitrated', () => {
    const cache = { 'durand-c': { mode: 'search', status: 'found', best: '200003', others: ['100001'], candidates: [
      person('100001', '', 'fort'), person('200003', 'claire-durand', 'fort'), person('300002', '', 'faible'),
    ] } };
    const d = computeAlignDiffFrom('hal', 'search', { records: [rec({})], cache, reviewRecords: null }, tokenAlignTexts);
    expect(d.aRenseigner.map((r) => [r.id, r.proposals.map((p) => `${p.field}=${p.after}`)])).toEqual([
      ['G-1#200003', ['IdHAL=claire-durand', 'IdHAL_i=200003']],
      ['G-1#100001', ['IdHAL_i=100001']],
    ]);
    expect(d.ambigus.map((a) => a.candidates.map((c) => c.id))).toEqual([['300002']]);
    expect(d.aRenseigner[0].candidate.url).toContain('authIdHal_i/200003');
  });

  it('search: a record that already has an IdHAL_i is left out', () => {
    const cache = { 'durand-c': { mode: 'search', status: 'found', best: '100001', others: [], candidates: [person('100001', '', 'fort')] } };
    expect(computeAlignDiffFrom('hal', 'search', { records: [rec({ IdHAL_i: '100001' })], cache, reviewRecords: null }, tokenAlignTexts).aRenseigner).toEqual([]);
  });

  it('search: a rejected person (blacklist keyed by idHal_i) is not proposed again', () => {
    const cache = { 'durand-c': { mode: 'search', status: 'found', best: '100001', others: [], candidates: [person('100001', '', 'fort')] } };
    const reviewRecords = [{ id: 9, fields: { uid_dyna: 'durand-c', IdHAL_i_candidat: '100001', Decision: 'Rejeté' } }];
    const d = computeAlignDiffFrom('hal', 'search', { records: [rec({})], cache, reviewRecords }, tokenAlignTexts);
    expect(d.aRenseigner).toEqual([]);
    expect(d.nonTrouves.map((n) => n.uid)).toEqual(['durand-c']);
  });

  it('verify: the secondary persons proposed by the script, minus the known ones', () => {
    const cache = { 'durand-c': { mode: 'verify', status: 'checked', idhalI: '200003', nameMatch: 'exact',
      candidate: { idhal: 'claire-durand', idhalI: '200003', fullName: 'Claire Durand', forms: [], suspect: [] },
      secondaries: [person('100001', '', 'moyen'), person('400004', '', 'moyen')] } };
    const d = computeAlignDiffFrom('hal', 'verify', { records: [rec({ IdHAL: 'claire-durand', IdHAL_i: '200003', IdHAL_i_secondaires: '400004' })], cache, reviewRecords: null }, tokenAlignTexts);
    expect(d.aEnrichir.map((r) => [r.id, r.proposals])).toEqual([
      ['G-1#100001', [{ field: 'IdHAL_i_secondaires', label: 'IdHAL_i_secondaires', after: '100001' }]],
    ]);
  });
});

describe('HAL checked persons → fields', () => {
  const cache = { 'durand-c': { mode: 'search', status: 'found', best: '200003', others: ['100001'], candidates: [
    person('100001', '', 'fort'), person('200003', 'claire-durand', 'fort'), person('300002', 'claire-durand-2', 'moyen'), person('500005', '', 'faible'),
  ] } };
  const unified = () => {
    const records = [rec({})];
    const hal = computeAlignDiffFrom('hal', 'search', { records, cache, reviewRecords: null }, tokenAlignTexts);
    return pivotUnifiedAlignDiffs(records, ['hal'], 'search', { hal });
  };

  it('the first checked person gives every field, the next ones become secondary (without their IdHAL)', () => {
    const selected = new Set([unifiedFillKey('G-1', 'hal', '200003'), unifiedFillKey('G-1', 'hal', '100001')]);
    const chosen = { [unifiedAmbigKey('G-1', 'hal')]: '300002' };
    expect(buildUnifiedUpdates(unified(), selected, chosen)[0].fields)
      .toEqual({ IdHAL: 'claire-durand', IdHAL_i: '200003', IdHAL_i_secondaires: '100001|300002' });
  });

  it('an arbitrated person alone is the primary one, with its IdHAL', () => {
    expect(buildUnifiedUpdates(unified(), new Set(), { [unifiedAmbigKey('G-1', 'hal')]: '500005|300002' })[0].fields)
      .toEqual({ IdHAL_i: '300002', IdHAL: 'claire-durand-2', IdHAL_i_secondaires: '500005' });
  });
});

describe('HAL write against the current record', () => {
  it('adds, never overwrites: current primary kept, the checked one secondary without its IdHAL', () => {
    expect(halPatchFields({ IdHAL_i: '900009' }, { IdHAL_i: '200003', IdHAL: 'claire-durand', IdHAL_i_secondaires: '100001' }, COLS()))
      .toEqual({ IdHAL_i_secondaires: '100001|200003' });
    expect(halPatchFields({ IdHAL: 'autre' }, { IdHAL_i: '200003', IdHAL: 'claire-durand' }, COLS())).toEqual({ IdHAL_i: '200003' });
    expect(halPatchFields({ IdHAL_i_secondaires: '400004' }, { IdHAL_i_secondaires: '100001|400004' }, COLS()))
      .toEqual({ IdHAL_i_secondaires: '100001|400004' });
    expect(halPatchFields({ IdHAL_i_secondaires: '100001' }, { IdHAL_i_secondaires: '100001' }, COLS())).toEqual({});
  });

  it('leaves the secondaries out when the Grist document has no column for them', () => {
    expect(halPatchFields({}, { IdHAL_i: '200003', IdHAL_i_secondaires: '100001' }, COLS(false))).toEqual({ IdHAL_i: '200003' });
  });

  it('traces the write once for HAL', () => {
    const [patch] = unifiedUpdatePatches([{ id: 'G-1', uid: 'durand-c', displayName: 'DURAND Claire', sources: ['hal'],
      fields: { IdHAL_i: '200003', IdHAL_i_secondaires: '100001' }, fieldsBySource: { hal: { IdHAL_i: '200003', IdHAL_i_secondaires: '100001' } } }],
    { 1: {} }, COLS(), '2026-10-17');
    expect(patch.fields.IdHAL_i).toBe('200003');
    expect(patch.fields.IdHAL_i_secondaires).toBe('100001');
    expect(patch.fields.Data_source).toBe('HAL');
    expect(patch.fields.Commentaires).toBe('[2026-10-17] MAJ HAL: IdHAL_i, IdHAL_i_secondaires');
  });
});
