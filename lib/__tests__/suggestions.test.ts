import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

// « Suggestions de l'établissement » (scripts/lib/suggestions.cjs, docs/plan-parcours-affiliations.md lot 5).
const { computeSuggestions, scopusLooksMerged, SUGGESTION_TASK_TYPES } = createRequire(import.meta.url)('../../scripts/lib/suggestions.cjs');
const schema = createRequire(import.meta.url)('../../scripts/lib/tasks_schema.cjs');

const record = (over: Record<string, unknown> = {}) => ({ key: 'martin-p', orcid: '0000-0001-0000-0001', idhal: 'pierre-martin', scopus: [], openalex: [], employmentStart: '2015-09', ended: false, horsRecherche: false, member: true, employedHere: true, ...over });
const entry = (over: Record<string, unknown> = {}) => ({
  sources: { graph: 40, openalex: 30, scopus: 20, orcid: 1, scopusProfile: true },
  signals: [], orcid: [{ kind: 'employment', cls: 'local', name: 'Université Alpha', start: '2015', end: '' }],
  extras: { halDocs: 3, scopusDocCount: 25, scopusAffiliated: 18, orcidExternal: ['Scopus Author ID'] },
  ...over,
});
const ids = (r: { suggestions: { id: string }[] }) => r.suggestions.map((s) => s.id);
const INST = { name: 'Université Alpha', ror: '0alpha' };

describe('computeSuggestions', () => {
  it('nothing for a complete record, nothing at all for an ended one', () => {
    expect(ids(computeSuggestions({ record: record(), entry: entry(), institution: INST }))).toEqual([]);
    expect(ids(computeSuggestions({ record: record({ orcid: '', idhal: '', ended: true }), entry: entry() }))).toEqual([]);
  });
  it('missing identifiers first; no identifier creation for staff without research duty', () => {
    const r = computeSuggestions({ record: record({ orcid: '', idhal: '' }), entry: entry(), institution: INST });
    expect(ids(r)).toEqual(['orcid_creer', 'idhal_creer']);
    expect(r.suggestions[1].data).toEqual({ halDocs: 3 });
    expect(ids(computeSuggestions({ record: record({ orcid: '', idhal: '', horsRecherche: true }), entry: entry() }))).toEqual([]);
  });
  it('outside collaborators get nothing; the ORCID position is only suggested to the institution staff', () => {
    expect(ids(computeSuggestions({ record: record({ orcid: '', member: false }), entry: entry() }))).toEqual([]);
    expect(ids(computeSuggestions({ record: record({ employedHere: false }), entry: entry({ orcid: [] }) }))).toEqual([]);
  });
  it('empty ORCID: make it public, and no completeness suggestion on it', () => {
    expect(ids(computeSuggestions({ record: record(), entry: entry({ orcid: [] }), orcidEmpty: true }))).toEqual(['orcid_rendre_public']);
  });
  it('ORCID without any position, or without the local one; nothing after a departure', () => {
    const all = computeSuggestions({ record: record(), entry: entry({ orcid: [] }), institution: INST });
    expect(all.suggestions[0]).toMatchObject({ id: 'orcid_ajouter_poste', data: { missing: 'all', institution: 'Université Alpha', ror: '0alpha', start: '2015-09' } });
    const other = computeSuggestions({ record: record(), entry: entry({ orcid: [{ kind: 'employment', cls: 'other', name: 'Université Beta', start: '2010', end: '2014' }] }), institution: INST });
    expect(other.suggestions[0].data.missing).toBe('local');
    const gone = computeSuggestions({ record: record(), entry: entry({ orcid: [{ kind: 'employment', cls: 'local', name: 'Université Alpha', start: '2015', end: '' }], signals: [{ type: 'depart_observe' }] }) });
    expect(ids(gone)).toEqual(['orcid_cloturer_poste']);
  });
  it('errors: two IdHAL / Scopus from the rules, Scopus profile never local, several OpenAlex profiles', () => {
    const r = computeSuggestions({
      record: record({ scopus: ['123'], openalex: ['A1', 'A2'] }),
      entry: entry({ signals: [{ type: 'identifiant_suspect', sources: ['scopus'] }] }),
      ruleHits: { hal_deux_idhal: 'Deux IdHAL', scopus_deux_ids: null },
    });
    expect(ids(r)).toEqual(['idhal_fusionner', 'scopus_corriger', 'openalex_fusionner']);
    expect(r.suggestions[1].data).toMatchObject({ reason: 'never_local', scopus: '123' });
  });
  it('link ORCID and Scopus only when the external identifiers were read', () => {
    expect(ids(computeSuggestions({ record: record({ scopus: ['123'] }), entry: entry({ extras: { orcidExternal: ['ResearcherID'] } }) }))).toEqual(['orcid_relier_scopus']);
    expect(ids(computeSuggestions({ record: record({ scopus: ['123'] }), entry: entry({ extras: { orcidExternal: null } }) }))).toEqual([]);
  });
  it('merged Scopus profile heuristic', () => {
    expect(scopusLooksMerged(entry({ sources: { graph: 100, openalex: 90, scopus: 250 }, extras: { scopusDocCount: 2256, scopusAffiliated: 1 } }))).toBe(true);
    expect(scopusLooksMerged(entry({ sources: { graph: 100, openalex: 90, scopus: 250 }, extras: { scopusDocCount: 431, scopusAffiliated: 240 } }))).toBe(false);
  });
  it('follow-up: hidden or done suggestion stays away, open task shown, at most 5', () => {
    const tasks = [
      { id: 1, cle: 'suggestion:orcid_creer:martin-p', type: 'orcid_absent', statut: 'abandonnee' },
      { id: 2, cle: '', type: 'hal_idhal_absent', statut: 'en_attente' },
    ];
    const r = computeSuggestions({ record: record({ orcid: '', idhal: '' }), entry: entry(), tasks });
    expect(ids(r)).toEqual(['idhal_creer']);
    expect(r.suggestions[0].task).toEqual({ id: 2, statut: 'en_attente' });
    const many = computeSuggestions({ record: record({ orcid: '', idhal: '', scopus: ['1'], openalex: ['A1', 'A2'] }), entry: entry({ signals: [{ type: 'identifiant_suspect', sources: ['scopus'] }] }), ruleHits: { hal_deux_idhal: 'x', scopus_deux_ids: 'y' } });
    expect(many.suggestions).toHaveLength(5);
    expect(many.hidden).toBe(1);
  });
  it('every task type of the catalogue exists in the tasks schema', () => {
    for (const t of Object.values(SUGGESTION_TASK_TYPES)) if (t) expect(schema.TASK_TYPES[t as string], String(t)).toBeTruthy();
  });
});
