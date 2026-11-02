// Fictitious identifiers of the labs of a demo instance and the candidates its « Structures » alignment tab shows
// (druid-internal docs/plan-druid-saas.md, § 4.5): what a run of the alignment job (lib/structures/alignEngine.ts) would
// have left behind — confirmed values checked against their registry, strong candidates reached through the bridges,
// an ambiguity between two records, records to review by hand, a confirmed value contradicted by the registries,
// searches that found nothing, a type never searched. Nothing here is real: the RNSR numbers start with 0000 (the
// register numbers its units by year of creation), the ROR ids carry letters its alphabet excludes, the HAL structure
// ids have nine digits, the OpenAlex and Wikidata ids are beyond the ranges assigned, the IdRef numbers carry a wrong
// check character (as the people of instances/demo/demo-data.mjs), the HAL collections are UDEMO-*. Pure; the database
// part is lib/migration/loadDemoExtras.ts.
import type { CandidateEvidence, CandidateStrength } from '../structures/alignEngine';
import { structureIdUrl, type StructureIdType } from '../structures/identifiers';

export interface DemoStructureIdentifier {
  type: StructureIdType;
  value: string;
  /** Primary of its type (default: the rule of confirmIdentifier — single-valued type, or first value). */
  isPrimary?: boolean;
  source: 'import' | 'manual' | 'alignment';
  /** What the verification of the record saw (lib/structures/alignEngine.ts IdentifierVerification). */
  check?: { ok: boolean; exists: boolean; label?: string; closed?: boolean; nameScore?: number; acronymMatch?: boolean };
}

export interface DemoStructureCandidate {
  type: StructureIdType;
  candidateId: string;
  score: number;
  strength: CandidateStrength;
  mode: 'search' | 'verify';
  evidence: CandidateEvidence;
}

export interface DemoStructureAlignment {
  /** `local_id` of the structure in demo-data.mjs (STRUCTURES). */
  localId: string;
  identifiers: DemoStructureIdentifier[];
  candidates: DemoStructureCandidate[];
  /** Types the job looked at (structure_alignment_search): tells « nothing found » from « never searched ». */
  searched: { type: StructureIdType; mode: 'search' | 'verify'; candidates: number }[];
}

/** IdRef PPN check character (weights 9..2 on the first 8 digits, modulo 11) — same rule as demo-data.mjs. */
export const ppnCheck = (digits8: string): string => {
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(digits8[i]) * (9 - i);
  const r = (11 - (sum % 11)) % 11;
  return r === 10 ? 'X' : String(r);
};
/** Fictitious PPN of a structure: 9 characters, WRONG check character (the people use the 99… range, structures 98…). */
export const fakeStructurePpn = (n: number): string => {
  const d8 = `98${String(n).padStart(6, '0')}`;
  const good = ppnCheck(d8);
  const bad = good === 'X' ? '0' : String((Number(good) + 1) % 10);
  return d8 + bad;
};

const UDEMO = 'Université de Démonstration';
const ENS = 'École Nationale Supérieure de Démonstration';
const CNRD = 'Centre National de Recherche de Démonstration';
const CITY = 'Démoville';

const evidence = (type: StructureIdType, id: string, e: Partial<CandidateEvidence> & { label: string; reasons: string[] }): CandidateEvidence => ({
  acronym: null, city: CITY, kind: null, unitLabel: null, tutelles: [], worksCount: null, closed: false, url: structureIdUrl(type, id), paths: [], nameScore: 1, ...e,
});
const candidate = (type: StructureIdType, candidateId: string, score: number, strength: CandidateStrength, mode: 'search' | 'verify', e: Partial<CandidateEvidence> & { label: string; reasons: string[] }): DemoStructureCandidate =>
  ({ type, candidateId, score, strength, mode, evidence: evidence(type, candidateId, e) });

const LIRA_NAME = "Laboratoire d'Informatique et Réseaux Appliqués";
const BIOS_NAME = 'Biologie des Organismes et des Systèmes';
const LMD_NAME = 'Laboratoire de Mathématiques de Démonstration';

/**
 * The three labs of instances/demo/demo-data.mjs. LIRA is well identified (RNSR, HAL, collection) and the bridges from
 * these values reach its ROR, two OpenAlex institutions, an older HAL record and its IdRef authority; its Wikidata item
 * is a name match to review. BIOS has a confirmed RNSR that the register now gives to another unit (conflict, the right
 * number proposed), two IdRef authorities for one lab (ambiguous), nothing in HAL collections nor Wikidata. LMD, young
 * and small, has no identifier yet: a strong RNSR found by name, HAL and IdRef records to review, no ROR, a weak
 * OpenAlex match on its university, Wikidata never searched.
 */
export const demoStructureAlignment = (): DemoStructureAlignment[] => [
  {
    localId: 'LIRA',
    identifiers: [
      { type: 'rnsr', value: '000000001A', source: 'import', check: { ok: true, exists: true, label: LIRA_NAME, nameScore: 1, acronymMatch: true } },
      { type: 'hal_struct', value: '900000101', source: 'import', check: { ok: true, exists: true, label: `LIRA - ${LIRA_NAME}`, nameScore: 1, acronymMatch: true } },
      { type: 'hal_collection', value: 'UDEMO-LIRA', source: 'manual' },
    ],
    candidates: [
      candidate('ror', '0demo0001', 0.96, 'strong', 'search', {
        label: LIRA_NAME, acronym: 'LIRA', kind: 'facility', tutelles: [UDEMO, ENS, CNRD],
        paths: ['rnsr:000000001A → hal_struct → ror', 'hal_struct:900000101 → ror'], reasons: ['bridge', 'acronym', 'name', 'city', 'supervisor'],
      }),
      candidate('hal_struct', '900000102', 0.82, 'strong', 'search', {
        label: `${LIRA_NAME} (2016-2020)`, acronym: 'LIRA', kind: 'laboratory', unitLabel: 'UMR 0001', tutelles: [UDEMO, CNRD], closed: true,
        paths: ['rnsr:000000001A → hal_struct'], reasons: ['bridge', 'acronym', 'name', 'unit_label', 'closed'],
      }),
      candidate('openalex', 'I99000000001', 0.93, 'strong', 'search', {
        label: LIRA_NAME, acronym: 'LIRA', kind: 'facility', worksCount: 1240, tutelles: [UDEMO, CNRD],
        paths: ['ror:0demo0001 → openalex'], reasons: ['bridge', 'acronym', 'name', 'city'],
      }),
      candidate('openalex', 'I99000000002', 0.79, 'strong', 'search', {
        label: `${LIRA_NAME} - ENS-Démo`, acronym: 'LIRA', kind: 'facility', worksCount: 310, tutelles: [ENS],
        paths: ['ror:0demo0001 → openalex'], reasons: ['bridge', 'acronym', 'name'],
      }),
      candidate('idref', fakeStructurePpn(101), 0.88, 'strong', 'search', {
        label: `Laboratoire d'informatique et réseaux appliqués (${CITY})`, kind: 'Collectivité', tutelles: [UDEMO], nameScore: 0.92,
        paths: ['hal_struct:900000101 → idref'], reasons: ['bridge', 'name', 'links_back'],
      }),
      candidate('wikidata', 'Q99000000001', 0.52, 'medium', 'search', {
        label: LIRA_NAME, kind: 'research institute', reasons: ['name', 'city'],
      }),
    ],
    searched: [
      { type: 'rnsr', mode: 'verify', candidates: 0 }, { type: 'ror', mode: 'search', candidates: 1 }, { type: 'hal_struct', mode: 'verify', candidates: 1 },
      { type: 'hal_collection', mode: 'verify', candidates: 0 }, { type: 'openalex', mode: 'search', candidates: 2 }, { type: 'idref', mode: 'search', candidates: 1 },
      { type: 'wikidata', mode: 'search', candidates: 1 },
    ],
  },
  {
    localId: 'BIOS',
    identifiers: [
      { type: 'rnsr', value: '000000002B', source: 'import', check: { ok: false, exists: true, label: 'Biologie des Systèmes Intégrés et Synthétiques', nameScore: 0.33, acronymMatch: false } },
      { type: 'ror', value: '0demo0002', source: 'import', check: { ok: true, exists: true, label: BIOS_NAME, nameScore: 1, acronymMatch: true } },
      { type: 'hal_struct', value: '900000201', source: 'import', check: { ok: true, exists: true, label: `BIOS - ${BIOS_NAME}`, nameScore: 1, acronymMatch: true } },
    ],
    candidates: [
      candidate('rnsr', '000000012B', 0.97, 'conflict', 'verify', {
        label: BIOS_NAME, acronym: 'BIOS', kind: 'Unité mixte de recherche', unitLabel: 'UMR 0002', tutelles: [UDEMO, CNRD],
        paths: ['hal_struct:900000201 → rnsr', 'ror:0demo0002 → rnsr'], reasons: ['bridge', 'acronym', 'name', 'unit_label', 'city', 'supervisor'], conflictWith: '000000002B',
      }),
      candidate('openalex', 'I99000000003', 0.9, 'strong', 'search', {
        label: BIOS_NAME, acronym: 'BIOS', kind: 'facility', worksCount: 860, tutelles: [UDEMO, CNRD],
        paths: ['ror:0demo0002 → openalex'], reasons: ['bridge', 'acronym', 'name', 'city'],
      }),
      candidate('idref', fakeStructurePpn(201), 0.86, 'strong', 'search', {
        label: `Biologie des organismes et des systèmes (${CITY})`, kind: 'Collectivité', tutelles: [UDEMO, CNRD], nameScore: 0.95,
        paths: ['hal_struct:900000201 → idref'], reasons: ['bridge', 'name', 'links_back'],
      }),
      candidate('idref', fakeStructurePpn(202), 0.8, 'strong', 'search', {
        label: `Unité de biologie des organismes et des systèmes (${CITY})`, kind: 'Collectivité', tutelles: [CNRD], nameScore: 0.9,
        paths: ['ror:0demo0002 → wikidata → idref'], reasons: ['bridge', 'name', 'links_back'],
      }),
    ],
    searched: [
      { type: 'rnsr', mode: 'verify', candidates: 1 }, { type: 'ror', mode: 'verify', candidates: 0 }, { type: 'hal_struct', mode: 'verify', candidates: 0 },
      { type: 'hal_collection', mode: 'search', candidates: 0 }, { type: 'openalex', mode: 'search', candidates: 1 }, { type: 'idref', mode: 'search', candidates: 2 },
      { type: 'wikidata', mode: 'search', candidates: 0 },
    ],
  },
  {
    localId: 'LMD',
    identifiers: [],
    candidates: [
      candidate('rnsr', '000000003C', 0.87, 'strong', 'search', {
        label: LMD_NAME, acronym: 'LMD', kind: 'Unité de recherche', unitLabel: 'UR 0003', tutelles: [UDEMO], reasons: ['acronym', 'name', 'unit_label', 'city', 'supervisor'],
      }),
      candidate('hal_struct', '900000301', 0.58, 'medium', 'search', {
        label: `Mathématiques ${CITY}`, kind: 'laboratory', nameScore: 0.5, reasons: ['name', 'city'],
      }),
      candidate('hal_struct', '900000302', 0.47, 'medium', 'search', {
        label: 'Équipe Mathématiques - Démo', kind: 'researchteam', tutelles: [UDEMO], nameScore: 0.45, reasons: ['city', 'supervisor', 'other_kind'],
      }),
      candidate('openalex', 'I99000000009', 0.31, 'weak', 'search', {
        label: UDEMO, acronym: 'UDémo', kind: 'education', worksCount: 15400, nameScore: 0.2, reasons: ['city', 'other_kind'],
      }),
      candidate('idref', fakeStructurePpn(301), 0.6, 'medium', 'search', {
        label: `Laboratoire de mathématiques (${CITY})`, kind: 'Collectivité', nameScore: 0.7, reasons: ['name', 'city'],
      }),
    ],
    searched: [
      { type: 'rnsr', mode: 'search', candidates: 1 }, { type: 'ror', mode: 'search', candidates: 0 }, { type: 'hal_struct', mode: 'search', candidates: 2 },
      { type: 'hal_collection', mode: 'search', candidates: 0 }, { type: 'openalex', mode: 'search', candidates: 1 }, { type: 'idref', mode: 'search', candidates: 1 },
    ],
  },
];
