import { describe, it, expect } from 'vitest';
import {
  parseOpenalexIds, groupQualifiedRows, planAffiliationRows, alignGroupOf, gristDateToIso, pivotUnifiedAlignDiffs,
  buildUnifiedUpdates, unifiedFillKey, unifiedAmbigKey, resolveNewStructureLocalId,
} from '../gristService';
import type { AlignDiff, IdrefDiff, UnifiedAlignDiff, PersonAlignRow } from '../gristService';

// lib/gristService.ts (3337 lines) keeps most of its logic inside the GristService
// object (methods not exported individually, see docs/archive/plan-fusion-demo-2026-09.md
// § 5) — unlike docker/druid-demo where gristService.ts exports named pure functions
// (fromGristDate, mapStatus…) that are directly testable. This file covers the few
// pure functions already exported at module level; it is not a port of the demo's
// gristService.test.ts (names/scopes do not match).

describe('gristDateToIso', () => {
  it('empty for a missing value', () => {
    expect(gristDateToIso(null)).toBe('');
    expect(gristDateToIso(undefined)).toBe('');
    expect(gristDateToIso('')).toBe('');
  });

  it('timestamp Grist (secondes) vers AAAA-MM-JJ', () => {
    // 2026-01-15T00:00:00Z
    expect(gristDateToIso(1768435200)).toBe('2026-01-15');
  });

  it('JJ-MM-AAAA vers AAAA-MM-JJ', () => {
    expect(gristDateToIso('15-01-2026')).toBe('2026-01-15');
  });

  it('already in YYYY-MM-DD format: unchanged', () => {
    expect(gristDateToIso('2026-01-15')).toBe('2026-01-15');
  });

  it('unrecognized value: converted to a string as is', () => {
    expect(gristDateToIso(42)).toBe('1970-01-01'); // not a real use case, but documents the behavior
  });
});

describe('parseOpenalexIds', () => {
  it('extrait un seul A-id', () => {
    expect(parseOpenalexIds('A5023888391')).toEqual(['A5023888391']);
  });

  it('deduplicates and keeps the order, case-insensitive', () => {
    expect(parseOpenalexIds('a5023888391|A5023888391,A5000000002')).toEqual(['A5023888391', 'A5000000002']);
  });

  it('tolerates a full OpenAlex URL', () => {
    expect(parseOpenalexIds('https://openalex.org/A5023888391')).toEqual(['A5023888391']);
  });

  it('vide si rien de reconnaissable', () => {
    expect(parseOpenalexIds('')).toEqual([]);
    expect(parseOpenalexIds(null)).toEqual([]);
    expect(parseOpenalexIds('bruit sans identifiant')).toEqual([]);
  });
});

describe('alignGroupOf', () => {
  it('doctorant (TYPE_EMPLOI prioritaire)', () => {
    expect(alignGroupOf({ TYPE_EMPLOI: 'DOCTORANT' })).toBe('doctorants');
  });

  it('no research duty (HR label, curly apostrophe tolerated)', () => {
    expect(alignGroupOf({ LIB_TYPE_EMPLOI: "Personnel n’ayant pas d'obligation statutaire de recherche" })).toBe('hors_recherche');
  });

  it('staff by default', () => {
    expect(alignGroupOf({})).toBe('personnel');
    expect(alignGroupOf({ TYPE_EMPLOI: 'MCF', LIB_TYPE_EMPLOI: 'Maître de conférences' })).toBe('personnel');
  });

  it('PhD student takes precedence over the « sans obligation de recherche » label', () => {
    expect(alignGroupOf({ TYPE_EMPLOI: 'DOCTORANT', LIB_TYPE_EMPLOI: "n'ayant pas d'obligation statutaire de recherche" })).toBe('doctorants');
  });
});

describe('groupQualifiedRows', () => {
  const row = (gristRowId: number, uid: string, over: any = {}) => ({
    gristRowId, uid, affiliations: [{ structureName: 'LS2N', endDate: '' }], ...over,
  });

  it('unchanged if a single role per uid (nothing to qualify)', () => {
    const rows = [row(1, 'u1')];
    expect(groupQualifiedRows(rows, {}, {})).toBe(rows); // same reference: no filtering
  });

  it('merges the qualified rows (1 PRINCIPAL + rest with a role) on the same uid', () => {
    const rows = [row(1, 'u1'), row(2, 'u1'), row(3, 'u1')];
    const rowRole = { 1: 'PRINCIPAL' as const, 2: 'SECONDAIRE' as const, 3: 'HISTORIQUE' as const };
    const result = groupQualifiedRows(rows, rowRole, { 3: '2024-06-30' });
    expect(result).toHaveLength(1); // the 2 secondary rows are removed from the top-level list
    expect(result[0].gristRowId).toBe(1);
    expect(result[0].affiliations).toHaveLength(3); // but grouped under affiliations
    expect(result[0].affiliations[0]).toMatchObject({ isPrimary: true, role: 'PRINCIPAL' });
    const historique = result[0].affiliations.find((a: any) => a.role === 'HISTORIQUE');
    expect(historique.endDate).toBe('2024-06-30'); // end date taken from rowEnd
  });

  it('unchanged if several PRINCIPAL for the same uid (not qualified)', () => {
    const rows = [row(1, 'u1'), row(2, 'u1')];
    const rowRole = { 1: 'PRINCIPAL' as const, 2: 'PRINCIPAL' as const };
    expect(groupQualifiedRows(rows, rowRole, {})).toBe(rows);
  });

  it('unchanged if a row of the group has no role assigned', () => {
    const rows = [row(1, 'u1'), row(2, 'u1'), row(3, 'u1')];
    const rowRole = { 1: 'PRINCIPAL' as const, 2: 'SECONDAIRE' as const }; // 3 without role
    expect(groupQualifiedRows(rows, rowRole, {})).toBe(rows);
  });

  it('ignores records without uid', () => {
    const rows = [row(1, ''), row(2, '')];
    expect(groupQualifiedRows(rows, { 1: 'PRINCIPAL' as const, 2: 'SECONDAIRE' as const }, {})).toBe(rows);
  });
});

describe('planAffiliationRows', () => {
  const TODAY = '2026-09-25';
  const aff = (structureName: string, over: any = {}) => ({ structureName, team: '', startDate: '', isPrimary: false, ...over });

  it('single membership, no other row: only the record row, rattachement untouched', () => {
    const plan = planAffiliationRows(10, [aff('DCS', { isPrimary: true })], [], TODAY);
    expect(plan.primary?.structureName).toBe('DCS');
    expect(plan).toMatchObject({ mainRole: undefined, patches: [], creates: [], deletes: [] });
  });

  it('new past membership → created as HISTORIQUE, record row becomes PRINCIPAL', () => {
    const plan = planAffiliationRows(10, [
      aff('DCS', { isPrimary: true, startDate: '2023' }),
      aff('CDMO', { startDate: '2004', endDate: '2022' }),
    ], [], TODAY);
    expect(plan.primary?.structureName).toBe('DCS');
    expect(plan.mainRole).toBe('PRINCIPAL');
    expect(plan.creates).toEqual([{ affiliation: expect.objectContaining({ structureName: 'CDMO' }), role: 'HISTORIQUE' }]);
  });

  it('primary is the isPrimary one, not the first; an ongoing one is SECONDAIRE', () => {
    const plan = planAffiliationRows(10, [aff('CDMO'), aff('DCS', { isPrimary: true })], [], TODAY);
    expect(plan.primary?.structureName).toBe('DCS');
    expect(plan.creates[0]).toMatchObject({ role: 'SECONDAIRE' });
  });

  it('existing rows reused by gristRowId, removed ones deleted', () => {
    const plan = planAffiliationRows(10, [
      aff('LS2N', { isPrimary: true, gristRowId: 10 }),
      aff('GeM', { gristRowId: 12, endDate: '2020' }),
    ], [11, 12], TODAY);
    expect(plan.patches).toEqual([{ rowId: 12, affiliation: expect.objectContaining({ structureName: 'GeM' }), role: 'HISTORIQUE' }]);
    expect(plan.creates).toEqual([]);
    expect(plan.deletes).toEqual([11]);
  });

  it('primary switch: the freed row receives the former primary membership (no create/delete)', () => {
    const plan = planAffiliationRows(10, [
      aff('LS2N', { gristRowId: 10 }),
      aff('GeM', { isPrimary: true, gristRowId: 12 }),
    ], [12], TODAY);
    expect(plan.primary?.structureName).toBe('GeM');
    expect(plan.patches).toEqual([{ rowId: 12, affiliation: expect.objectContaining({ structureName: 'LS2N' }), role: 'SECONDAIRE' }]);
    expect(plan).toMatchObject({ creates: [], deletes: [], mainRole: 'PRINCIPAL' });
  });

  it('back to a single membership: other rows deleted, rattachement cleared', () => {
    const plan = planAffiliationRows(10, [aff('LS2N', { isPrimary: true, gristRowId: 10 })], [12], TODAY);
    expect(plan).toMatchObject({ mainRole: '', patches: [], creates: [], deletes: [12] });
  });
});

describe('pivotUnifiedAlignDiffs (docs/plan-alignement-unifie.md, lot 0)', () => {
  // Minimal Annuaire record (same keys as rec.fields on the Grist side).
  const rec = (id: number, fields: Record<string, any> = {}) => ({ id, fields: { Nom: 'DUPONT', Prenom: 'Jean', uid_dyna: `u${id}`, ...fields } });

  // Per-source diff reduced to the buckets read by the pivot (the other AlignDiff/IdrefDiff
  // fields are irrelevant here — cast, not filled).
  const diff = (over: Partial<AlignDiff>): AlignDiff => ({
    source: 'orcid', mode: 'search', generatedAt: '', stats: {} as any, labos: [],
    aRenseigner: [], ambigus: [], aEnrichir: [], conflits: [], nonTrouves: [], ...over,
  }) as AlignDiff;
  const idrefDiff = (over: Partial<IdrefDiff>): IdrefDiff => ({
    generatedAt: '', mode: 'search', stats: {} as any, labos: [],
    aRenseigner: [], ambigus: [], aEnrichir: [], aArbitrer: [], conflits: [], nonTrouves: [], ...over,
  }) as IdrefDiff;

  it('record missing from every source: status "none" everywhere', () => {
    const records = [rec(1)];
    const out = pivotUnifiedAlignDiffs(records, ['orcid', 'hal'], 'search', { orcid: diff({}), hal: diff({}) });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0].sources.orcid?.status).toBe('none');
    expect(out.rows[0].sources.hal?.status).toBe('none');
  });

  it('identifier already present, nothing to propose: "present" with the value', () => {
    const records = [rec(1, { ORCID: '0000-0001-9900-9054' })];
    const out = pivotUnifiedAlignDiffs(records, ['orcid'], 'search', { orcid: diff({}) });
    expect(out.rows[0].sources.orcid).toEqual({ status: 'present', existing: ['0000-0001-9900-9054'] });
  });

  it('identifier already present AND additions to make (verify/aEnrichir): "strong", existing kept', () => {
    const records = [rec(1, { IdHAL: 'jdupont' })];
    const hal = diff({ source: 'hal', mode: 'verify', aEnrichir: [{ id: 'G-1', uid: 'u1', displayName: 'DUPONT Jean', labo: '', candidate: { id: 'jdupont' } as any, proposals: [{ field: 'IdHAL_i', label: 'IdHAL_i', after: '12345' }] }] });
    const out = pivotUnifiedAlignDiffs(records, ['hal'], 'verify', { hal });
    expect(out.rows[0].sources.hal?.status).toBe('strong');
    expect(out.rows[0].sources.hal?.existing).toEqual(['jdupont']);
    expect(out.rows[0].sources.hal?.fill?.[0].proposals).toEqual([{ field: 'IdHAL_i', label: 'IdHAL_i', after: '12345' }]);
  });

  it('strong candidate AND conflict on a secondary field for the same record: both are kept', () => {
    const records = [rec(1)];
    const idref = idrefDiff({
      aRenseigner: [{ id: 'G-1', uid: 'u1', displayName: 'DUPONT Jean', labo: '', candidate: { ppn: '123' } as any, proposals: [{ field: 'IdRef', label: 'IdRef', after: '123' }] }],
      conflits: [{ id: 'G-1', uid: 'u1', displayName: 'DUPONT Jean', labo: '', reason: 'Divergence identifiant', detail: 'ORCID: Grist «a» ≠ notice «b»' }],
    });
    const out = pivotUnifiedAlignDiffs(records, ['idref'], 'search', { idref });
    expect(out.rows[0].sources.idref?.status).toBe('strong');
    expect(out.rows[0].sources.idref?.conflicts).toHaveLength(1);
  });

  it('a strong candidate on one source, ambiguous on another, for the same record', () => {
    const records = [rec(1)];
    const orcid = diff({ aRenseigner: [{ id: 'G-1', uid: 'u1', displayName: 'DUPONT Jean', labo: '', candidate: { id: '0000-...' } as any, proposals: [{ field: 'ORCID', label: 'ORCID', after: '0000-...' }] }] });
    const hal = diff({ ambigus: [{ id: 'G-1', uid: 'u1', displayName: 'DUPONT Jean', labo: '', candidates: [{ id: 'a' } as any, { id: 'b' } as any] }] });
    const out = pivotUnifiedAlignDiffs(records, ['orcid', 'hal'], 'search', { orcid, hal });
    expect(out.rows[0].sources.orcid?.status).toBe('strong');
    expect(out.rows[0].sources.orcid?.fill).toHaveLength(1);
    expect(out.rows[0].sources.hal?.status).toBe('ambiguous');
    expect(out.rows[0].sources.hal?.ambiguous?.candidates).toHaveLength(2);
  });

  it('conflicts (manual review): several reasons kept for the same record', () => {
    const records = [rec(1)];
    const hal = diff({ conflits: [
      { id: 'G-1', uid: 'u1', displayName: 'DUPONT Jean', labo: '', reason: 'Nom divergent', detail: 'xyz' },
      { id: 'G-1', uid: 'u1', displayName: 'DUPONT Jean', labo: '', reason: 'Identité mêlée suspectée', detail: 'abc' },
    ] });
    const out = pivotUnifiedAlignDiffs(records, ['hal'], 'search', { hal });
    expect(out.rows[0].sources.hal?.status).toBe('conflict');
    expect(out.rows[0].sources.hal?.conflicts?.map((c) => c.reason)).toEqual(['Nom divergent', 'Identité mêlée suspectée']);
  });

  it('not found (indexed by uid, not by record id)', () => {
    const records = [rec(1)];
    const orcid = diff({ nonTrouves: [{ uid: 'u1', displayName: 'DUPONT Jean', labo: '' }] });
    const out = pivotUnifiedAlignDiffs(records, ['orcid'], 'search', { orcid });
    expect(out.rows[0].sources.orcid?.status).toBe('not_found');
  });

  it('OpenAlex: several strong candidates for the same record (id "G-<row>#<A-id>") grouped', () => {
    const records = [rec(1)];
    const openalex = diff({
      source: 'openalex',
      aRenseigner: [
        { id: 'G-1#A1', uid: 'u1', displayName: 'DUPONT Jean', labo: '', candidate: { id: 'A1' } as any, proposals: [] },
        { id: 'G-1#A2', uid: 'u1', displayName: 'DUPONT Jean', labo: '', candidate: { id: 'A2' } as any, proposals: [] },
      ],
    });
    const out = pivotUnifiedAlignDiffs(records, ['openalex'], 'search', { openalex });
    expect(out.rows[0].sources.openalex?.status).toBe('strong');
    expect(out.rows[0].sources.openalex?.fill).toHaveLength(2);
    expect(out.rows[0].sources.openalex?.fill?.map((f) => (f.candidate as { id: string }).id)).toEqual(['A1', 'A2']);
  });

  it('OpenAlex already multi-valued in the Annuaire: "present" with every value', () => {
    // parseOpenalexIds requires ≥4 digits after the "A" (see its dedicated test above) — realistic ids here.
    const records = [rec(1, { OpenAlex_ids: 'A1234567890|A1234567891' })];
    const out = pivotUnifiedAlignDiffs(records, ['openalex'], 'search', { openalex: diff({ source: 'openalex' }) });
    expect(out.rows[0].sources.openalex).toEqual({ status: 'present', existing: ['A1234567890', 'A1234567891'] });
  });

  it('IdRef (Qualinka, search mode): same pivot as the generic sources', () => {
    const records = [rec(1)];
    const idref = idrefDiff({ aRenseigner: [{ id: 'G-1', uid: 'u1', displayName: 'DUPONT Jean', labo: '', candidate: { ppn: '123' } as any, proposals: [{ field: 'IdRef', label: 'IdRef', after: '123' }] }] });
    const out = pivotUnifiedAlignDiffs(records, ['idref'], 'search', { idref });
    expect(out.rows[0].sources.idref?.status).toBe('strong');
    expect(out.rows[0].sources.idref?.fill?.[0].candidate).toEqual({ ppn: '123' });
  });

  it('source requested but not covered for this mode (e.g. idref/verify): no cell at all', () => {
    const records = [rec(1)];
    const out = pivotUnifiedAlignDiffs(records, ['idref', 'orcid'], 'verify', { orcid: diff({ mode: 'verify' }) });
    expect(out.rows[0].sources.idref).toBeUndefined();
    expect(out.rows[0].sources.orcid?.status).toBe('none');
  });
});

describe('buildUnifiedUpdates (docs/plan-alignement-unifie.md, lot 2)', () => {
  const row = (over: Partial<PersonAlignRow> = {}): PersonAlignRow => ({
    id: 'G-1', uid: 'u1', displayName: 'DUPONT Jean', labo: 'GEPEA', ...over, sources: over.sources || {},
  });
  const unifiedDiff = (rows: PersonAlignRow[], sources: UnifiedAlignDiff['sources'] = ['idref', 'orcid', 'openalex']): UnifiedAlignDiff => ({
    generatedAt: '', mode: 'search', sources, rows,
  });

  it('null diff: no write', () => {
    expect(buildUnifiedUpdates(null, new Set(), {})).toEqual([]);
  });

  it('nothing checked: no write', () => {
    const r = row({ sources: { orcid: { status: 'strong', fill: [{ candidate: { id: '0000-1' } as any, proposals: [{ field: 'ORCID', label: 'ORCID', after: '0000-1' }] }] } } });
    expect(buildUnifiedUpdates(unifiedDiff([r]), new Set(), {})).toEqual([]);
  });

  it('a strong candidate checked on one source: one write', () => {
    const r = row({ sources: { orcid: { status: 'strong', fill: [{ candidate: { id: '0000-1' } as any, proposals: [{ field: 'ORCID', label: 'ORCID', after: '0000-1' }] }] } } });
    const selected = new Set([unifiedFillKey('G-1', 'orcid', '0000-1')]);
    expect(buildUnifiedUpdates(unifiedDiff([r]), selected, {})).toEqual([
      { id: 'G-1', uid: 'u1', displayName: 'DUPONT Jean', fields: { ORCID: '0000-1' }, fieldsBySource: { orcid: { ORCID: '0000-1' } }, sources: ['orcid'] },
    ]);
  });

  it('two sources checked for the same record: merged into ONE write (a single PATCH), per-source traceability kept', () => {
    const r = row({
      sources: {
        idref: { status: 'strong', fill: [{ candidate: { ppn: '123' } as any, proposals: [{ field: 'IdRef', label: 'IdRef', after: '123' }] }] },
        orcid: { status: 'strong', fill: [{ candidate: { id: '0000-1' } as any, proposals: [{ field: 'ORCID', label: 'ORCID', after: '0000-1' }] }] },
      },
    });
    const selected = new Set([unifiedFillKey('G-1', 'idref', '123'), unifiedFillKey('G-1', 'orcid', '0000-1')]);
    const out = buildUnifiedUpdates(unifiedDiff([r]), selected, {});
    expect(out).toHaveLength(1);
    expect(out[0].fields).toEqual({ IdRef: '123', ORCID: '0000-1' });
    expect(out[0].fieldsBySource).toEqual({ idref: { IdRef: '123' }, orcid: { ORCID: '0000-1' } });
    expect(out[0].sources.sort()).toEqual(['idref', 'orcid']);
  });

  it('OpenAlex multi-strong: only the checked candidate is written', () => {
    const r = row({
      sources: {
        openalex: {
          status: 'strong',
          fill: [
            { candidate: { id: 'A1' } as any, proposals: [{ field: 'OpenAlex_ids', label: 'OpenAlex', after: 'A1' }] },
            { candidate: { id: 'A2' } as any, proposals: [{ field: 'OpenAlex_ids', label: 'OpenAlex', after: 'A2' }] },
          ],
        },
      },
    });
    const selected = new Set([unifiedFillKey('G-1', 'openalex', 'A2')]);
    const out = buildUnifiedUpdates(unifiedDiff([r]), selected, {});
    expect(out).toEqual([{ id: 'G-1', uid: 'u1', displayName: 'DUPONT Jean', fields: { OpenAlex_ids: 'A2' }, fieldsBySource: { openalex: { OpenAlex_ids: 'A2' } }, sources: ['openalex'] }]);
  });

  it('OpenAlex multi-strong, TWO checked for the same record: union of the ids (no overwrite)', () => {
    const r = row({
      sources: {
        openalex: {
          status: 'strong',
          fill: [
            { candidate: { id: 'A1' } as any, proposals: [{ field: 'OpenAlex_ids', label: 'OpenAlex', after: 'A1' }] },
            { candidate: { id: 'A2' } as any, proposals: [{ field: 'OpenAlex_ids', label: 'OpenAlex', after: 'A2' }] },
          ],
        },
      },
    });
    const selected = new Set([unifiedFillKey('G-1', 'openalex', 'A1'), unifiedFillKey('G-1', 'openalex', 'A2')]);
    const out = buildUnifiedUpdates(unifiedDiff([r]), selected, {});
    expect(out[0].fields.OpenAlex_ids).toBe('A1|A2');
  });

  it('arbitrated ambiguous case: writes the target column of the source', () => {
    const r = row({ sources: { hal: { status: 'ambiguous', ambiguous: { candidates: [{ id: 'jdupont' } as any] } } } });
    const chosen = { [unifiedAmbigKey('G-1', 'hal')]: 'jdupont' };
    const out = buildUnifiedUpdates(unifiedDiff([r], ['hal']), new Set(), chosen);
    expect(out).toEqual([{ id: 'G-1', uid: 'u1', displayName: 'DUPONT Jean', fields: { IdHAL: 'jdupont' }, fieldsBySource: { hal: { IdHAL: 'jdupont' } }, sources: ['hal'] }]);
  });

  it('arbitrated OpenAlex ambiguous case (several chosen, multi-valued target): ids joined with "|"', () => {
    const r = row({ sources: { openalex: { status: 'ambiguous', ambiguous: { candidates: [{ id: 'A1' } as any, { id: 'A2' } as any] } } } });
    const chosen = { [unifiedAmbigKey('G-1', 'openalex')]: 'A1|A2' };
    const out = buildUnifiedUpdates(unifiedDiff([r], ['openalex']), new Set(), chosen);
    expect(out[0].fields).toEqual({ OpenAlex_ids: 'A1|A2' });
  });

  it('IdRef name mismatch (verify): confirm writes IdRef_nom_valide + additions, detach clears IdRef, ignore writes nothing', () => {
    const arb = { id: 'G-1', uid: 'u1', displayName: 'DUPONT Jean', labo: '', ppn: '123', notice: { ppn: '123', fullName: 'Dupont, J.' } as any, grist: { orcid: '', idhal: '' }, proposals: [{ field: 'ORCID' as const, label: 'ORCID', after: '0000-1' }], suspect: false };
    const r = row({ sources: { idref: { status: 'arbitrate', existing: ['123'], arbitrate: arb } } });
    const d = unifiedDiff([r], ['idref']);
    const k = unifiedAmbigKey('G-1', 'idref');
    expect(buildUnifiedUpdates(d, new Set(), {}, { [k]: 'confirm' })[0].fields).toEqual({ IdRef_nom_valide: '123', ORCID: '0000-1' });
    expect(buildUnifiedUpdates(d, new Set(), {}, { [k]: 'detach' })[0].fields).toEqual({ IdRef: '' });
    expect(buildUnifiedUpdates(d, new Set(), {}, { [k]: 'ignore' })).toEqual([]);
    expect(buildUnifiedUpdates(d, new Set(), {}, {})).toEqual([]);
  });

  it('ambiguous case not arbitrated (no chosen): no write for this source', () => {
    const r = row({ sources: { hal: { status: 'ambiguous', ambiguous: { candidates: [{ id: 'jdupont' } as any] } } } });
    expect(buildUnifiedUpdates(unifiedDiff([r], ['hal']), new Set(), {})).toEqual([]);
  });
});

describe('resolveNewStructureLocalId (entity code entered on creation)', () => {
  const generate = () => 'D-SCD';

  it('keeps the entered supannCodeEntite (trimmed)', () => {
    expect(resolveNewStructureLocalId(' 1485 ', generate)).toBe('1485');
    expect(resolveNewStructureLocalId('UMR_6183.a-1', generate)).toBe('UMR_6183.a-1');
  });

  it('falls back to the generated D-/T- id when nothing is entered', () => {
    expect(resolveNewStructureLocalId('', generate)).toBe('D-SCD');
    expect(resolveNewStructureLocalId(undefined, generate)).toBe('D-SCD');
  });

  it('rejects a code that cannot become a graph uid (spaces, accents, slashes)', () => {
    expect(() => resolveNewStructureLocalId('14 85', generate)).toThrow();
    expect(() => resolveNewStructureLocalId('SCD/BU', generate)).toThrow();
    expect(() => resolveNewStructureLocalId('é1485', generate)).toThrow();
    expect(() => resolveNewStructureLocalId('-1485', generate)).toThrow();
  });
});
