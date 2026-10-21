// Identifiers of the structures and their alignment (druid-internal docs/plan-druid-saas.md, lot 4): normalization of
// the values, the registry parsers on fixtures shaped like the APIs (fictitious values), the states of the cells, the
// projection to the V2 fields, and the engine on a fake registry — bridges, conflicts, search and scoring.
import { describe, expect, it } from 'vitest';
import {
  nameSimilarity, normalizeAcronymKey, normalizeStructureId, parseUnitLabel, significantTokens, structureIdUrl,
} from '../structures/identifiers';
import {
  halCollectionFacet, halStructureRecord, idrefRecord, openalexRecord, rnsrRecord, rnsrTutelleIds, rorRecord, wikidataRecord, type RegistryRecord,
} from '../structures/registries';
import { alignStructure, type StructureFacts } from '../structures/alignEngine';
import { cellStatus } from '../structures/alignView';
import { projectedFields } from '../structures/pg/identifiers';
import type { Registry } from '../structures/registryClient';

describe('structure identifiers: shapes', () => {
  it('normalizes values given as ids or URLs', () => {
    expect(normalizeStructureId('rnsr', ' 200012345a ')).toBe('200012345A');
    expect(normalizeStructureId('rnsr', 'nope')).toBeNull();
    expect(normalizeStructureId('ror', 'https://ror.org/01ABCDE23')).toBe('01abcde23');
    expect(normalizeStructureId('ror', 'https://ror.org/01abcde23/')).toBe('01abcde23');
    expect(normalizeStructureId('hal_struct', 'https://aurehal.archives-ouvertes.fr/structure/read/id/473973')).toBe('473973');
    expect(normalizeStructureId('hal_collection', 'https://hal.science/LAB-ONE/')).toBe('LAB-ONE');
    expect(normalizeStructureId('hal_collection', 'https://hal.science/lab one')).toBeNull();
    expect(normalizeStructureId('openalex', 'https://openalex.org/i4210000001')).toBe('I4210000001');
    expect(normalizeStructureId('idref', 'https://www.idref.fr/02873603X.xml')).toBe('02873603X');
    expect(normalizeStructureId('wikidata', 'http://www.wikidata.org/entity/Q42')).toBe('Q42');
    expect(normalizeStructureId('isni', '0000 0001 2189 0784')).toBe('0000000121890784');
    expect(normalizeStructureId('uai', '0442953w')).toBe('0442953W');
    expect(normalizeStructureId('siret', '130 029 747 00016')).toBe('13002974700016');
    expect(normalizeStructureId('grid', 'grid.4817.a')).toBe('grid.4817.a');
    expect(normalizeStructureId('scopus_affil', '60028048.0')).toBe('60028048');
    expect(structureIdUrl('ror', '01abcde23')).toBe('https://ror.org/01abcde23');
  });
  it('compares names, acronyms and unit labels', () => {
    expect(significantTokens('Laboratoire des Sciences du Numérique de Nantes')).toEqual(['sciences', 'numerique', 'nantes']);
    expect(nameSimilarity('Laboratoire des Sciences du Numérique de Nantes', 'Sciences du numérique (Nantes)')).toBe(1);
    expect(nameSimilarity('Institut de Chimie', 'Institut de Physique')).toBeLessThanOrEqual(0.5);
    expect(normalizeAcronymKey('L.S.2.N')).toBe('ls2n');
    expect(parseUnitLabel('UMR 6004')).toEqual({ labelType: 'UMR', code: '6004' });
    expect(parseUnitLabel('umr_s 1087')).toEqual({ labelType: 'UMR-S', code: '1087' });
    expect(parseUnitLabel('Unité mixte')).toBeNull();
  });
});

const RNSR = {
  numero_national_de_structure: '200012345A', libelle: 'Laboratoire Un', sigle: 'LAB1', type_de_structure: 'Unité mixte', code_de_niveau_de_structure: '2',
  site_web: 'https://lab1.example.org', commune: 'Démoville Cedex 3', label_numero: ['UMR 0001', 'UMR 0001'], tutelles: ['Université de Démonstration', 'Centre national de la recherche scientifique'],
  sigles_des_tutelles: ['UDEMO', 'CNRS'], uai_des_tutelles: ['0000000A', '0753639Y'], siret_des_tutelles: ['00000000000001', '18008901303720'], numero_de_structure_parent: null,
};
const ROR = {
  id: 'https://ror.org/01abcde23', status: 'active', types: ['facility'],
  names: [{ value: 'Laboratoire Un', types: ['ror_display', 'label'], lang: 'fr' }, { value: 'Laboratory One', types: ['label'], lang: 'en' }, { value: 'LAB1', types: ['acronym'] }],
  locations: [{ geonames_details: { name: 'Démoville', country_code: 'FR' } }],
  external_ids: [{ type: 'wikidata', all: ['Q9999991'], preferred: null }, { type: 'grid', all: ['grid.000001.0'], preferred: 'grid.000001.0' }, { type: 'isni', all: ['0000 0001 0000 0001'], preferred: null }],
  relationships: [{ type: 'parent', id: 'https://ror.org/05abcde12', label: 'Université de Démonstration' }, { type: 'child', id: 'https://ror.org/09zzzzz99', label: 'Team' }],
};
const HAL = {
  docid: '473973', label_s: 'Laboratoire Un [LAB1]', name_s: 'Laboratoire Un', acronym_s: 'LAB1', rnsr_s: ['200012345A'], ror_s: ['https://ror.org/01abcde23'], idref_s: ['203637585'],
  parentDocid_i: ['300009', '441569'], parentName_s: ['Université de Démonstration', 'Centre National de la Recherche Scientifique'], valid_s: 'VALID', type_s: 'laboratory',
  address_s: '2 chemin de la Houssinière, 44322 Démoville Cedex 3', country_s: 'fr', url_s: 'https://lab1.example.org',
};
const OA = {
  id: 'https://openalex.org/I4210000001', display_name: 'Laboratoire Un', display_name_acronyms: ['LAB1'], ror: 'https://ror.org/01abcde23', ids: { grid: 'grid.000001.0', wikidata: 'https://www.wikidata.org/entity/Q9999991' },
  country_code: 'FR', type: 'facility', works_count: 3456, geo: { city: 'Démoville' }, associated_institutions: [{ id: 'https://openalex.org/I97000000', ror: 'https://ror.org/05abcde12', display_name: 'Université de Démonstration', relationship: 'parent' }],
};
const WD = {
  id: 'Q9999991', labels: { fr: { value: 'Laboratoire Un' }, en: { value: 'Laboratory One' } }, aliases: { fr: [{ value: 'LAB1' }] },
  claims: { P6782: [{ mainsnak: { datavalue: { value: '01abcde23' } } }], P269: [{ mainsnak: { datavalue: { value: '203637585' } } }], P749: [{ mainsnak: { datavalue: { value: { id: 'Q259388' } } } }] },
};

describe('structure identifiers: registry records', () => {
  it('RNSR', () => {
    const r = rnsrRecord(RNSR)!;
    expect(r).toMatchObject({ type: 'rnsr', id: '200012345A', label: 'Laboratoire Un', acronym: 'LAB1', unitLabel: 'UMR 0001', kind: 'Unité mixte', city: 'Démoville', countryCode: 'FR' });
    expect(r.tutelles).toContain('CNRS');
    expect(rnsrTutelleIds(RNSR)).toEqual({ uai: ['0000000A', '0753639Y'], siret: ['00000000000001', '18008901303720'] });
    expect(rnsrRecord({ sigle: 'X' })).toBeNull();
  });
  it('ROR v2', () => {
    const r = rorRecord(ROR)!;
    expect(r).toMatchObject({ type: 'ror', id: '01abcde23', label: 'Laboratoire Un', acronym: 'LAB1', city: 'Démoville', countryCode: 'FR', kind: 'facility', closed: false });
    expect(r.altNames).toEqual(['Laboratory One', 'LAB1']);
    expect(r.links).toEqual({ wikidata: ['Q9999991'], grid: ['grid.000001.0'], isni: ['0000000100000001'] });
    expect(r.parentIds).toEqual({ ror: ['05abcde12'] });
    expect(r.tutelles).toEqual(['Université de Démonstration']);
    expect(rorRecord({ ...ROR, status: 'withdrawn' })!.closed).toBe(true);
  });
  it('AureHAL structure and collections', () => {
    const r = halStructureRecord(HAL)!;
    expect(r).toMatchObject({ type: 'hal_struct', id: '473973', label: 'Laboratoire Un', acronym: 'LAB1', kind: 'laboratory', closed: false, countryCode: 'FR' });
    expect(r.links).toEqual({ rnsr: ['200012345A'], ror: ['01abcde23'], idref: ['203637585'] });
    expect(r.parentIds).toEqual({ hal_struct: ['300009', '441569'] });
    expect(halStructureRecord({ ...HAL, valid_s: 'OLD' })!.closed).toBe(true);
    expect(halStructureRecord({ ...HAL, label_s: 'LAB1 - UMR 0001 [LAB1]' })!.unitLabel).toBe('UMR 0001');
    expect(halCollectionFacet({ facet_counts: { facet_fields: { collCode_s: ['LAB1', 3796, 'CNRS', 3803, 'bad code!', 2] } } })).toEqual([{ code: 'LAB1', count: 3796 }, { code: 'CNRS', count: 3803 }]);
  });
  it('OpenAlex institution', () => {
    const r = openalexRecord(OA)!;
    expect(r).toMatchObject({ type: 'openalex', id: 'I4210000001', label: 'Laboratoire Un', acronym: 'LAB1', worksCount: 3456, city: 'Démoville', countryCode: 'FR', kind: 'facility' });
    expect(r.links).toEqual({ ror: ['01abcde23'], grid: ['grid.000001.0'], wikidata: ['Q9999991'] });
    expect(r.parentIds).toEqual({ openalex: ['I97000000'], ror: ['05abcde12'] });
  });
  it('IdRef corporate body and Wikidata entity', () => {
    expect(idrefRecord({ ppn_z: '203637585', affcourt_z: 'Laboratoire Un (2017-....)' })).toMatchObject({ type: 'idref', id: '203637585', label: 'Laboratoire Un', closed: false });
    expect(idrefRecord({ ppn_z: '145273792', affcourt_z: 'Université de Démonstration. Laboratoire de biologie (Démoville)' })).toMatchObject({ label: 'Université de Démonstration. Laboratoire de biologie (Démoville)', city: 'Démoville' });
    expect(idrefRecord({ ppn_z: '145273792', affcourt_z: 'Ancien labo (1990-2005)' })!.closed).toBe(true);
    const w = wikidataRecord(WD)!;
    expect(w).toMatchObject({ type: 'wikidata', id: 'Q9999991', label: 'Laboratoire Un' });
    expect(w.altNames).toEqual(['Laboratory One', 'LAB1']);
    expect(w.links).toEqual({ ror: ['01abcde23'], idref: ['203637585'] });
    expect(w.parentIds).toEqual({ wikidata: ['Q259388'] });
  });
});

describe('structure identifiers: cells and projection', () => {
  const id = (type: any, value: string, isPrimary = true) => ({ type, value, isPrimary, status: 'confirmed' as const, source: 'x', note: null, decidedBy: null, checkedAt: null, checkResult: null, url: '' });
  const cand = (strength: any, candidateId = 'x') => ({ candidateId, score: 0.8, strength, evidence: {} as any, mode: 'search' as const, seenAt: '' });
  it('states', () => {
    expect(cellStatus([], [], false, false)).toBe('none');
    expect(cellStatus([], [], true, false)).toBe('absent');
    expect(cellStatus([], [cand('weak')], true, false)).toBe('absent');
    expect(cellStatus([], [cand('medium')], true, false)).toBe('arbitrate');
    expect(cellStatus([], [cand('strong')], true, false)).toBe('strong');
    expect(cellStatus([], [cand('strong', 'a'), cand('strong', 'b')], true, false)).toBe('ambiguous');
    expect(cellStatus([id('ror', '01abcde23')], [cand('strong')], true, false)).toBe('present');
    expect(cellStatus([id('ror', '01abcde23')], [cand('conflict')], true, false)).toBe('conflict');
    expect(cellStatus([{ ...id('ror', '01abcde23'), checkResult: { ok: false, exists: false } }], [], true, false)).toBe('conflict');
    expect(cellStatus([id('hal_struct', '1')], [cand('strong')], true, true)).toBe('strong');
    // Two HAL records (before and after a merger) are both to accept: strong, not ambiguous.
    expect(cellStatus([], [cand('strong', 'a'), cand('strong', 'b')], true, true)).toBe('strong');
    expect(cellStatus([id('hal_struct', '1')], [cand('strong', 'a'), cand('strong', 'b')], true, true)).toBe('strong');
  });
  it('projection to the V2 fields', () => {
    const fields = projectedFields([
      id('rnsr', '200012345A'), id('ror', '01abcde23'), id('hal_struct', '473973'), id('hal_struct', '1088564', false), id('openalex', 'I4210000001'),
      id('hal_collection', 'LAB1'), id('scopus_affil', '60028048'), { ...id('idref', '000000001'), status: 'rejected' as const },
    ], { hal_collection: 'https://hal-demo.example.org/LAB1' });
    expect(fields).toMatchObject({ nns: '200012345A', ror: '01abcde23', idref: '', hal_struct_ids: '473973|1088564', openalex_ids: 'I4210000001', hal_collection: 'https://hal-demo.example.org/LAB1', scopus: 60028048, uai: '', isni: '', wikidata: '' });
    expect(projectedFields([id('hal_collection', 'LAB1')], { hal_collection: '' }).hal_collection).toBe('https://hal.science/LAB1');
    expect(projectedFields([], {}).scopus).toBeNull();
  });
});

// ── Engine on a fake registry ────────────────────────────────────────────────────────────────────────────────────────
const rec = (partial: Partial<RegistryRecord> & Pick<RegistryRecord, 'type' | 'id' | 'label'>): RegistryRecord => ({
  acronym: null, altNames: [], city: null, countryCode: 'FR', kind: null, unitLabel: null, closed: false, worksCount: null, tutelles: [], parentIds: {}, links: {}, url: `u:${partial.id}`, address: null, ...partial,
});
const lookup = (records: RegistryRecord[], search: (q: { name: string; acronym?: string | null }) => RegistryRecord[] = () => []) => ({
  get: async (id: string) => records.find((r) => r.id === id) ?? null,
  search: async (q: any) => search(q),
});
const fakeRegistry = (): Registry & { calls: string[] } => {
  const calls: string[] = [];
  const rnsr = rec({ type: 'rnsr', id: '200012345A', label: 'Laboratoire Un', acronym: 'LAB1', unitLabel: 'UMR 0001', city: 'Démoville', tutelles: ['Université de Démonstration'] });
  const ror = rec({ type: 'ror', id: '01abcde23', label: 'Laboratoire Un', acronym: 'LAB1', links: { wikidata: ['Q9999991'] } });
  const rorOther = rec({ type: 'ror', id: '09zzzzz99', label: 'Laboratoire Autre', acronym: 'AUTRE', links: {} });
  const hal = rec({ type: 'hal_struct', id: '473973', label: 'Laboratoire Un', acronym: 'LAB1', kind: 'laboratory', links: { rnsr: ['200012345A'], ror: ['01abcde23'], idref: ['203637585'] } });
  const halOld = rec({ type: 'hal_struct', id: '111', label: 'Laboratoire Un', acronym: 'LAB1', kind: 'laboratory', closed: true, links: { rnsr: ['200012345A'] } });
  const halTeam = rec({ type: 'hal_struct', id: '222', label: 'Équipe X', acronym: 'LAB1 - équipe X', kind: 'researchteam' });
  const oa = rec({ type: 'openalex', id: 'I4210000001', label: 'Laboratoire Un', acronym: 'LAB1', worksCount: 3456, kind: 'facility', links: { ror: ['01abcde23'] } });
  const oaUniv = rec({ type: 'openalex', id: 'I97000000', label: 'Université de Démonstration', worksCount: 90000, kind: 'education' });
  const idref = rec({ type: 'idref', id: '203637585', label: 'Laboratoire Un' });
  const wd = rec({ type: 'wikidata', id: 'Q9999991', label: 'Laboratoire Un', links: { ror: ['01abcde23'], idref: ['203637585'] } });
  return {
    calls,
    rnsr: lookup([rnsr], () => { calls.push('rnsr.search'); return [rnsr]; }),
    ror: lookup([ror, rorOther], () => { calls.push('ror.search'); return [ror, rorOther]; }),
    hal: {
      ...lookup([hal, halOld, halTeam], () => { calls.push('hal.search'); return [hal, halTeam]; }),
      byLink: async (type, value) => { calls.push(`hal.by${type}:${value}`); return type === 'rnsr' && value === '200012345A' ? [hal, halOld] : type === 'ror' && value === '01abcde23' ? [hal] : []; },
      collections: async (docid) => { calls.push(`hal.collections:${docid}`); return docid === '473973' ? { total: 3803, codes: [{ code: 'CNRS', count: 3803 }, { code: 'UDEMO', count: 3803 }, { code: 'LAB1', count: 3796 }, { code: 'LAB1-TEAMX', count: 486 }, { code: 'ANR', count: 668 }] } : { total: 0, codes: [] }; },
      collectionSize: async () => 0,
    },
    openalex: { ...lookup([oa, oaUniv], () => { calls.push('openalex.search'); return [oaUniv, oa]; }), byRor: async (r) => { calls.push(`openalex.byRor:${r}`); return r === '01abcde23' ? [oa] : []; } },
    idref: lookup([idref], () => { calls.push('idref.search'); return [idref]; }),
    wikidata: { ...lookup([wd], () => { calls.push('wikidata.search'); return [wd]; }), byLink: async (type, value) => { calls.push(`wikidata.by${type}:${value}`); return type === 'ror' && value === '01abcde23' ? [wd] : []; } },
  };
};
const facts = (ids: StructureFacts['ids']): StructureFacts => ({ id: 10, acronym: 'LAB1', name: 'Laboratoire Un', level: 'lab', unitLabel: 'UMR 0001', city: 'Démoville', countryCode: 'FR', tutelles: ['Université de Démonstration', 'CNRS'], ids });
const by = (r: { candidates: any[] }, type: string) => r.candidates.filter((c) => c.type === type).sort((a, b) => b.score - a.score);

describe('structure alignment engine', () => {
  it('bridges from one confirmed RNSR: HAL, ROR, IdRef, Wikidata and OpenAlex follow, the old HAL record is weaker', async () => {
    const registry = fakeRegistry();
    const r = await alignStructure(facts({ rnsr: ['200012345A'] }), registry, { mode: 'search' });
    const hal = by(r, 'hal_struct');
    expect(hal.map((c) => c.candidateId)).toEqual(['473973', '111']);
    expect(hal[0].strength).toBe('strong');
    expect(hal[0].evidence.paths).toContain('rnsr:200012345A → hal_struct');
    expect(hal[1].evidence.closed).toBe(true);
    expect(hal[1].score).toBeLessThan(hal[0].score);
    const ror = by(r, 'ror');
    expect(ror).toHaveLength(1);
    expect(ror[0].candidateId).toBe('01abcde23');
    // Reached from HAL (hop 1) and from Wikidata (reached through HAL → ROR, whose record links back to the ROR).
    expect(ror[0].strength).toBe('strong');
    expect(by(r, 'idref')[0]).toMatchObject({ candidateId: '203637585', strength: 'strong' });
    expect(by(r, 'wikidata')[0]).toMatchObject({ candidateId: 'Q9999991', strength: 'strong' });
    expect(by(r, 'openalex')[0]).toMatchObject({ candidateId: 'I4210000001', strength: 'strong' });
    // The lab's collection: exact acronym, 99 % of the documents; the parents' collections (every document) are skipped.
    const coll = by(r, 'hal_collection');
    expect(coll[0]).toMatchObject({ candidateId: 'LAB1', strength: 'strong' });
    expect(coll.map((c) => c.candidateId)).not.toContain('CNRS');
    // Nothing searched by name: every type had a strong bridge.
    expect(registry.calls.filter((c) => c.endsWith('.search'))).toEqual([]);
    expect(r.verifications).toEqual([expect.objectContaining({ type: 'rnsr', value: '200012345A', ok: true })]);
    expect(r.searched.find((s) => s.type === 'ror')?.candidates).toBe(1);
  });

  it('searches by name when nothing is confirmed, scoring the acronym, the unit label and the kind', async () => {
    const registry = fakeRegistry();
    const r = await alignStructure(facts({}), registry, { mode: 'search' });
    expect(registry.calls).toContain('rnsr.search');
    const rnsr = by(r, 'rnsr');
    expect(rnsr[0]).toMatchObject({ candidateId: '200012345A', strength: 'strong' });
    expect(rnsr[0].evidence.reasons).toEqual(expect.arrayContaining(['acronym', 'name', 'unit_label', 'city', 'supervisor']));
    const ror = by(r, 'ror');
    expect(ror[0].candidateId).toBe('01abcde23');
    expect(ror.find((c) => c.candidateId === '09zzzzz99')?.strength ?? 'dropped').toMatch(/weak|dropped/);
    const oa = by(r, 'openalex');
    expect(oa[0].candidateId).toBe('I4210000001');
    // A university is not a lab: penalized below the lab's own institution.
    const univ = oa.find((c) => c.candidateId === 'I97000000');
    expect(!univ || univ.score < oa[0].score).toBe(true);
    // A team record proposed for a lab is penalized.
    const team = by(r, 'hal_struct').find((c) => c.candidateId === '222');
    expect(!team || team.strength !== 'strong').toBe(true);
  });

  it('a value refused by a user is never proposed again, a confirmed one is not a candidate', async () => {
    const registry = fakeRegistry();
    const r = await alignStructure(facts({ rnsr: ['200012345A'], ror: ['01abcde23'] }), registry, { mode: 'search', rejected: new Set(['hal_struct:111']) });
    expect(by(r, 'hal_struct').map((c) => c.candidateId)).toEqual(['473973']);
    expect(by(r, 'ror')).toEqual([]);
  });

  it('verify: a confirmed value contradicted by the bridges is a conflict, a missing record is reported', async () => {
    const registry = fakeRegistry();
    const r = await alignStructure(facts({ rnsr: ['200012345A'], ror: ['09zzzzz99'], idref: ['999999999'] }), registry, { mode: 'verify' });
    const ror = by(r, 'ror');
    expect(ror[0]).toMatchObject({ candidateId: '01abcde23', strength: 'conflict' });
    expect(ror[0].evidence.conflictWith).toBe('09zzzzz99');
    expect(r.verifications.find((v) => v.type === 'idref')).toMatchObject({ ok: false, result: { exists: false } });
    expect(r.verifications.find((v) => v.type === 'ror')).toMatchObject({ ok: false });
    expect(r.verifications.find((v) => v.type === 'rnsr')).toMatchObject({ ok: true });
    // verify does not search by name.
    expect(registry.calls.filter((c) => c.endsWith('.search'))).toEqual([]);
  });

  it('a general registry (Wikidata, IdRef) never makes a strong candidate from a name alone; a team is only searched on HAL', async () => {
    const registry = fakeRegistry();
    // Wikidata item literally called like the team, nothing else in common.
    registry.wikidata.search = async () => { registry.calls.push('wikidata.search'); return [rec({ type: 'wikidata', id: 'Q1', label: 'Sourire', altNames: ['Le Sourire'] })]; };
    const team = await alignStructure({ ...facts({}), acronym: 'SOURIRE', name: 'Équipe Sourire', level: 'team', unitLabel: null }, registry, { mode: 'search' });
    expect(registry.calls.filter((c) => c.endsWith('.search'))).toEqual(['hal.search']);
    expect(by(team, 'wikidata')).toEqual([]);
    const lab = await alignStructure({ ...facts({}), acronym: 'SOURIRE', name: 'Sourire', unitLabel: null }, registry, { mode: 'search' });
    const wd = by(lab, 'wikidata');
    expect(wd[0]?.strength ?? 'none').not.toBe('strong');
    // The same item linking back to the lab's ROR is strong.
    registry.wikidata.search = async () => [rec({ type: 'wikidata', id: 'Q1', label: 'Sourire', links: { ror: ['01abcde23'] } })];
    const linked = await alignStructure({ ...facts({ ror: ['01abcde23'] }), acronym: 'SOURIRE', name: 'Sourire', unitLabel: null }, { ...registry, hal: { ...registry.hal, byLink: async () => [] }, openalex: { ...registry.openalex, byRor: async () => [] }, wikidata: { ...registry.wikidata, byLink: async () => [] } }, { mode: 'search' });
    expect(by(linked, 'wikidata')[0]).toMatchObject({ candidateId: 'Q1', strength: 'strong' });
    expect(by(linked, 'wikidata')[0].evidence.reasons).toContain('links_back');
  });

  it('verify: a record naming the structure within a longer label is consistent', async () => {
    const registry = fakeRegistry();
    registry.idref.get = async () => rec({ type: 'idref', id: '000000009', label: 'Nantes Université. Pôle Humanités. Faculté de Psychologie (Nantes)' });
    const r = await alignStructure({ ...facts({ idref: ['000000009'] }), acronym: 'PSYCHOLOGIE', name: 'Psychologie', unitLabel: null }, registry, { mode: 'verify' });
    expect(r.verifications[0]).toMatchObject({ type: 'idref', ok: true });
  });

  it('a registry failure is reported on its type and does not stop the others', async () => {
    const registry = fakeRegistry();
    registry.hal.byLink = async () => { throw new Error('HAL down'); };
    const r = await alignStructure(facts({ rnsr: ['200012345A'] }), registry, { mode: 'search' });
    expect(r.searched.find((s) => s.type === 'hal_struct')?.error).toMatch(/HAL down/);
    expect(by(r, 'rnsr')).toEqual([]);
    expect(r.verifications[0].ok).toBe(true);
  });
});
