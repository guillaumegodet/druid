import { describe, it, expect } from 'vitest';
import { matchesTeamFilter, primaryTeams, TEAM_NONE } from '../teamFilter';
import type { Affiliation } from '../../types';

const aff = (over: Partial<Affiliation>): Affiliation => ({ structureName: 'LAB', team: '', startDate: '', isPrimary: false, ...over });
const rec = (...affiliations: Affiliation[]) => ({ affiliations });

describe('primaryTeams', () => {
  it('reads the primary affiliation only and splits « A|B »', () => {
    const r = rec(aff({ team: 'OTHER' }), aff({ isPrimary: true, team: 'PCM | ST2E' }));
    expect(primaryTeams(r)).toEqual(['PCM', 'ST2E']);
  });

  it('no primary affiliation or no team → empty', () => {
    expect(primaryTeams(rec(aff({ team: 'PCM' })))).toEqual([]);
    expect(primaryTeams(rec(aff({ isPrimary: true })))).toEqual([]);
  });
});

describe('matchesTeamFilter', () => {
  const pcm = rec(aff({ isPrimary: true, team: 'PCM' }), aff({ team: 'ID2M' }));
  const twoTeams = rec(aff({ isPrimary: true, team: 'PCM|ST2E' }));
  const noTeam = rec(aff({ isPrimary: true }));

  it('empty selection = no filter', () => {
    expect(matchesTeamFilter(noTeam, [])).toBe(true);
  });

  it('matches on the teams of the primary affiliation, not the secondary ones', () => {
    expect(matchesTeamFilter(pcm, ['PCM'])).toBe(true);
    expect(matchesTeamFilter(pcm, ['ID2M'])).toBe(false);
    expect(matchesTeamFilter(twoTeams, ['ST2E'])).toBe(true);
  });

  it('« not specified » option catches the records without a team', () => {
    expect(matchesTeamFilter(noTeam, [TEAM_NONE])).toBe(true);
    expect(matchesTeamFilter(rec(), [TEAM_NONE])).toBe(true);
    expect(matchesTeamFilter(pcm, [TEAM_NONE])).toBe(false);
  });
});
