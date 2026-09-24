// University consortia — fixed member list (an institutional fact, not a
// user preference), hence hard-coded here rather than in a generic persistence
// mechanism. Shared between the Benchmark tab (Leiden peer groups, see
// computeConsortiumPeerGroups in benchmarkAggregates.ts) and the partner
// institution picker of the Collaborations tab (lot 1 of the plan
// docs/archive/plan-collab-consortium.md, 2026-09-15). To add a consortium,
// extend CONSORTIA below.

import type { PartnerCatalogEntry } from './collabAggregates';

export interface ConsortiumMember {
  /** Short ROR (without https://ror.org/). */
  ror: string;
  /** Display name (useful when the member is missing from the partner catalog). */
  name: string;
}

export interface ConsortiumDefinition {
  key: string;
  label: string;
  /** Members, potential reference institution included. */
  members: ConsortiumMember[];
  /** Short RORs of the members (convenience view for the Benchmark). */
  memberRors: string[];
}

const consortium = (
  key: string,
  label: string,
  members: ConsortiumMember[],
): ConsortiumDefinition => ({ key, label, members, memberRors: members.map((m) => m.ror) });

/** RORs looked up in leiden_universities.csv (druid-biblio reference dataset) on 2026-09-03;
 * Inalco (too small for the Leiden Ranking Open Edition) taken from the
 * OpenAlex partners of `Nantes Université` on 2026-09-15. Request from the product owner:
 * compare `Nantes Université` with the EUniWell members and detail collaborations with each. */
export const CONSORTIA: ConsortiumDefinition[] = [
  consortium('euniwell', 'EUniWell', [
    { ror: '03angcq70', name: 'University of Birmingham' },
    { ror: '00rcxh774', name: 'University of Cologne' },
    { ror: '04jr1s763', name: 'University of Florence' },
    { ror: '0546hnb39', name: 'University of Konstanz' },
    { ror: '00j9qag85', name: 'Linnaeus University' },
    { ror: '03p3aeb86', name: 'University of Murcia' },
    { ror: '03gnr7b55', name: 'Nantes Université' },
    { ror: '030eybx10', name: 'University of Santiago de Compostela' },
    { ror: '01g9ty582', name: 'Semmelweis University' },
    { ror: '02aaqv166', name: 'Taras Shevchenko National University of Kyiv' },
    { ror: '04p2y4s44', name: 'Medical University of Warsaw' },
    { ror: '023zg8w32', name: 'Inalco' },
  ]),
];

/** Predefined group of partner institutions (picker of the Collaborations tab). */
export interface PartnerGroup {
  key: string;
  label: string;
  /** PartnerCatalogEntry.key keys (ROR) of the members present in the catalog. */
  keys: string[];
  /** Consortium members with no co-publication at all in the displayed corpus. */
  missing: ConsortiumMember[];
}

/** `https://ror.org/03gnr7b55` or `03gnr7b55` → `03gnr7b55`. */
export function shortRor(ror: string | null | undefined): string | null {
  if (!ror) return null;
  return ror.replace(/^https?:\/\/ror\.org\//, '') || null;
}

/**
 * Partner groups per consortium — only the members actually encountered as
 * partners in the corpus (`buildPartnerCatalog` catalog), with the reference
 * institution excluded. Unlike the Benchmark, we do not filter on whether
 * `ownRor` belongs to the consortium: a lab (whose export carries no
 * institution ROR) is a member through its university, and
 * `Nantes Université` never shows up in its own
 * partner catalog.
 */
export function consortiumPartnerGroups(
  catalog: PartnerCatalogEntry[],
  ownRor: string | null,
): PartnerGroup[] {
  const own = shortRor(ownRor);
  const available = new Set(catalog.map((c) => c.key));
  return CONSORTIA.map((c) => {
    const members = c.members.filter((m) => m.ror !== own);
    return {
      key: `consortium:${c.key}`,
      label: c.label,
      keys: members.filter((m) => available.has(m.ror)).map((m) => m.ror),
      missing: members.filter((m) => !available.has(m.ror)),
    };
  }).filter((g) => g.keys.length > 0);
}

/** The predefined group whose members are exactly the current selection, else null. */
export function matchingPartnerGroup(groups: PartnerGroup[], selected: string[]): PartnerGroup | null {
  const sel = new Set(selected);
  return (
    groups.find((g) => g.keys.length === sel.size && g.keys.every((k) => sel.has(k))) ?? null
  );
}
