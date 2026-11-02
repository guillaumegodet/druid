import type { Researcher } from '../types';

/**
 * @file teamFilter.ts
 * @description « Team » filter of the researcher list: teams of the PRIMARY affiliation, like the
 * « Lab » and « Membership » filters. A membership may name several teams (« A|B », one badge per
 * team in ResearcherTable): each one is an option, and a record matches when any of its teams is
 * selected.
 */

/** Filter value of the records whose primary affiliation names no team. */
export const TEAM_NONE = 'none';

/** Teams of the primary affiliation (empty when absent or not filled in). */
export const primaryTeams = (r: Pick<Researcher, 'affiliations'>): string[] =>
  String(r.affiliations.find((a) => a.isPrimary)?.team || '').split('|').map((t) => t.trim()).filter(Boolean);

/** True when the record matches the selected values (empty selection = no filter). */
export const matchesTeamFilter = (r: Pick<Researcher, 'affiliations'>, selected: string[]): boolean => {
  if (selected.length === 0) return true;
  const teams = primaryTeams(r);
  if (teams.length === 0) return selected.includes(TEAM_NONE);
  return teams.some((t) => selected.includes(t));
};
