// Titles of the references shared by a suggested pair (druid-internal docs/plan-binomes-citations.md, lot 3):
// network.json only carries OpenAlex W-ids, the title, year and DOI are fetched from OpenAlex when a user asks for
// them (a handful per opened row, within the anonymous budget of the viewer's IP), and cached for the session.

export interface WorkTitle {
  id: string;
  title: string;
  year: number | null;
  doi: string | null;
}

const cache = new Map<string, Promise<WorkTitle | null>>();

/** Resolves a W-id to its title; null when OpenAlex does not answer (the link to openalex.org still works). */
export function fetchWorkTitle(id: string, fetchImpl: typeof fetch = fetch): Promise<WorkTitle | null> {
  let p = cache.get(id);
  if (!p) {
    p = fetchImpl(`https://api.openalex.org/works/${encodeURIComponent(id)}?select=id,title,publication_year,doi`)
      .then((r) => (r.ok ? r.json() : null))
      .then((w) => (w ? { id, title: w.title || '', year: w.publication_year ?? null, doi: w.doi ?? null } : null))
      .catch(() => null);
    cache.set(id, p);
  }
  return p;
}

export const openAlexWorkUrl = (id: string) => `https://openalex.org/${id}`;
