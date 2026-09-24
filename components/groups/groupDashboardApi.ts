// Client of the « dashboards de groupe » endpoints of server.cjs (relay to
// the druid-biblio API, see scripts/group_api.py on the druid-biblio side). Keycloak
// session required — same origin, the cookie is sent automatically.

import { Researcher } from '../../types';
// Same contract as the structures ETL console (same /status endpoint on the server.cjs side): imported
// rather than redefined, so as not to diverge silently (code review lot 7c, finding 2).
import type { EtlStatus } from '../etl/etlConsoleApi';
export type { EtlStatus } from '../etl/etlConsoleApi';

/** Member in the format expected by the group ETL (config.yaml members[]). */
export interface GroupMemberPayload {
  nom: string;
  prenom: string;
  orcid?: string;
  openalex_author_id?: string;
  labo?: string;
  type?: string;
}

export interface GroupDashboardInfo {
  slug: string;
  name: string | null;
  members: number;
  resolved: number;
  state: string | null; // running | done | error | null
  endedAt: string | null;
  hasDashboard: boolean;
}

export interface AuthorCandidate {
  id: string;
  display_name: string;
  alternatives: string[];
  works_count: number;
  last_known_institutions: string[];
}

/** druid-biblio slug of a group (deterministic from its name). */
export function groupSlug(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `groupe-${base || 'sans-nom'}`;
}

/** A researcher is harvestable if they have an ORCID or a confirmed author ID. */
export function isHarvestable(r: Researcher): boolean {
  return Boolean(r.identifiers.orcid || r.identifiers.openalexId);
}

/** Grist TYPE_EMPLOI (« TITULAIRE ») → staff label (« Titulaire »). */
function memberType(r: Researcher): string {
  const ct = (r.employment.contractType || '').trim();
  return ct ? ct.charAt(0).toUpperCase() + ct.slice(1).toLowerCase() : '';
}

export function toMemberPayload(r: Researcher): GroupMemberPayload {
  return {
    nom: r.lastName,
    prenom: r.firstName,
    orcid: r.identifiers.orcid || undefined,
    openalex_author_id: r.identifiers.openalexId || undefined,
    labo: r.affiliations[0]?.structureName || undefined,
    type: memberType(r) || undefined,
  };
}

async function asJson<T>(resp: Response): Promise<T> {
  if (resp.status === 401) {
    // Keycloak session expired or lost (e.g. Druid container recreated: in-memory sessions) — same
    // fallback as etlConsoleApi.ts. Without it, GroupDashboardSection (poll every 4 s) swallowed the
    // 401 as a « erreur transitoire » and retried indefinitely without ever redirecting to the login
    // (code review lot 7c).
    window.location.assign('/auth/login');
    return new Promise<T>(() => {}); // the navigation interrupts the flow
  }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error((data as { error?: string }).error || `Erreur HTTP ${resp.status}`);
  }
  return data as T;
}

export const GroupDashboardApi = {
  list: async (): Promise<GroupDashboardInfo[]> => {
    const data = await asJson<{ groups: GroupDashboardInfo[] }>(
      await fetch('/api/groups/dashboards'),
    );
    return data.groups;
  },

  /** Creates/replaces the group config and runs the ETL in the background. */
  generate: async (
    slug: string,
    name: string,
    members: GroupMemberPayload[],
    yearFrom: number,
    yearTo: number,
  ): Promise<{ state: string; warning?: string }> =>
    asJson(
      await fetch('/api/groups/dashboards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          name,
          acronym: name,
          year_from: yearFrom,
          year_to: yearTo,
          members,
        }),
      }),
    ),

  status: async (slug: string): Promise<EtlStatus> =>
    asJson(await fetch(`/api/groups/dashboards/${encodeURIComponent(slug)}/status`)),

  remove: async (slug: string): Promise<void> => {
    await asJson(
      await fetch(`/api/groups/dashboards/${encodeURIComponent(slug)}`, { method: 'DELETE' }),
    );
  },

  /** OpenAlex author candidates (name resolution, home lab scope). */
  searchAuthors: async (name: string, labo?: string): Promise<AuthorCandidate[]> => {
    const data = await asJson<{ candidates: AuthorCandidate[] }>(
      await fetch('/api/groups/authors-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, labo }),
      }),
    );
    return data.candidates;
  },
};
