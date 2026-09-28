// Institutions affiliated with a partner (docs/plan-mes-rapports.md § 5.2, decision D1): the
// « child » and « related » relationships of the ROR registry (API v2, open CORS, called from the
// browser and cached for the session), kept when they appear among the structure's partners.
// For the University of Ottawa: its hospitals and research institute, which sign the clinical
// co-publications under their own ROR.

import type { PartnerCatalogEntry } from '../collabAggregates';

const ROR_API = 'https://api.ror.org/v2/organizations';
const AFFILIATED_TYPES = new Set(['child', 'related']);
const cache = new Map<string, Promise<string[]>>();

/** Short ROR id (`03c4mmv16`) of a partner key, or null for a name key (`international:…`). */
export const rorOf = (key: string): string | null =>
  /^0[a-z0-9]{8}$/.test(key) ? key : null;

/** ROR ids linked to `ror` as child or related organization (empty when unreachable). */
export function relatedRors(ror: string, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  let p = cache.get(ror);
  if (!p) {
    p = fetchImpl(`${ROR_API}/${encodeURIComponent(ror)}`)
      .then((r) => (r.ok ? r.json() : { relationships: [] }))
      .then((j: { relationships?: { type?: string; id?: string }[] }) =>
        (j.relationships ?? [])
          .filter((rel) => AFFILIATED_TYPES.has(String(rel.type ?? '').toLowerCase()))
          .map((rel) => String(rel.id ?? '').replace(/^https?:\/\/ror\.org\//, ''))
          .filter((id) => rorOf(id) != null))
      .catch(() => []);
    cache.set(ror, p);
    // A failure is not cached: the next selection retries.
    p.then((ids) => { if (!ids.length) cache.delete(ror); });
  }
  return p;
}

/**
 * Affiliated institutions of the selected partners that co-signed with the structure and are not
 * selected yet — the « + N affiliated institutions » suggestion of the partner parameter.
 */
export async function affiliatedPartners(
  selected: string[],
  catalog: PartnerCatalogEntry[],
  fetchImpl: typeof fetch = fetch,
): Promise<PartnerCatalogEntry[]> {
  const byKey = new Map(catalog.map((c) => [c.key, c]));
  const chosen = new Set(selected);
  const lists = await Promise.all(
    selected.map(rorOf).filter((r): r is string => r != null).map((r) => relatedRors(r, fetchImpl)),
  );
  const out = new Map<string, PartnerCatalogEntry>();
  for (const id of lists.flat()) {
    const entry = byKey.get(id);
    if (entry && !chosen.has(id)) out.set(id, entry);
  }
  return [...out.values()].sort((a, b) => b.count - a.count);
}
