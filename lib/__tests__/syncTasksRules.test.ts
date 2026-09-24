import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// The rules live in the CommonJS script (run by the server and by ofelia); requiring it only
// defines them (main() runs under require.main === module).
const { RULES, DEFAULT_RULES, openNantesAffiliations } = createRequire(import.meta.url)('../../scripts/sync_tasks.cjs');

const rec = (id: number, fields: Record<string, unknown>) => ({ id, key: (fields.uid_dyna as string) || `g${id}`, fields });
const cand = (extra: Record<string, unknown>) => ({ nameMatch: 'exact', score: 'moyen', evidence: ['site (Nantes Université)'], ...extra });
const ctx = (over: Partial<Record<'annuaire' | 'orcid' | 'hal' | 'scopus' | 'idref' | 'ldap', unknown>>) =>
  ({ annuaire: [], orcid: {}, hal: {}, scopus: {}, idref: {}, ldap: {}, ...over });

describe('scripts/sync_tasks.cjs rules (docs/plan-chantiers-taches.md, lot 5)', () => {
  it('default rules exclude the ABES ones (handled by the batch export)', () => {
    expect(DEFAULT_RULES).toEqual(['orcid_deux_ids', 'hal_deux_idhal', 'scopus_deux_ids', 'rh_depart']);
    expect(Object.keys(RULES)).toContain('abes_orcid');
  });

  it('orcid_deux_ids: two Nantes-affiliated exact-name profiles, or Annuaire ≠ IdRef record', () => {
    const a = rec(1, { uid_dyna: 'martin-p', Nom: 'Martin', Prenom: 'Pierre', LABO: 'LPPL', ORCID: '0000-0001-0000-0001', IdRef: '123' });
    const b = rec(2, { uid_dyna: 'leroy-a', Nom: 'Leroy', Prenom: 'Anne', ORCID: '0000-0001-9900-9003', IdRef: '456' });
    const c = rec(3, { uid_dyna: 'ok-x', Nom: 'Ok', Prenom: 'X', ORCID: '0000-0001-9900-9070', IdRef: '789' });
    const out = RULES.orcid_deux_ids.detect(ctx({
      annuaire: [a, b, c],
      orcid: {
        'martin-p': { mode: 'search', candidates: [cand({ orcid: '0000-0001-9900-9011' }), cand({ orcid: '0000-0001-9900-9020' }), cand({ orcid: '0000-0000-0000-0009', score: 'faible' })] },
        'ok-x': { mode: 'search', candidates: [cand({ orcid: '0000-0001-9900-9070' }), cand({ orcid: '0000-0003-0000-0004', evidence: ['site (Université de Rennes)'] })] },
      },
      idref: {
        'leroy-a': { mode: 'verify', candidates: [{ ppn: '456', orcid: 'https://orcid.org/0000-0001-9900-9038' }] },
        'ok-x': { mode: 'verify', candidates: [{ ppn: '789', orcid: '0000-0001-9900-9070' }] },
      },
    }));
    expect(out.map((x: { key: string }) => x.key)).toEqual(['martin-p', 'leroy-a']);
    expect(out[0].description).toContain('Deux profils ORCID');
    expect(out[0].lien).toBe('https://orcid.org/0000-0001-9900-9011');
    expect(out[1].description).toContain('0000-0001-9900-9003 ≠ ORCID de la notice IdRef 0000-0001-9900-9038');
  });

  it('rh_depart: LDAP departure + open Nantes 510 in the IdRef record; PhD students and closed ranges ignored', () => {
    const gone = rec(1, { uid_dyna: 'a', Nom: 'A', Prenom: 'A', IdRef: '1', TYPE_EMPLOI: 'PR' });
    const phd = rec(2, { uid_dyna: 'b', Nom: 'B', Prenom: 'B', IdRef: '2', TYPE_EMPLOI: 'DOCTORANT' });
    const closed = rec(3, { uid_dyna: 'c', Nom: 'C', Prenom: 'C', IdRef: '3' });
    const notice = (ppn: string, dates: string) => ({ mode: 'verify', candidates: [{ ppn, affiliations: [{ ppn: 'x', label: 'Nantes Université', qualifier: '2022-....', dates }] }] });
    const out = RULES.rh_depart.detect(ctx({
      annuaire: [gone, phd, closed],
      ldap: { a: { etat: 'D', dateFin: '2026-08-31' }, b: { etat: 'D', dateFin: '2026-08-31' }, c: { etat: 'D', dateFin: '2026-06-30' } },
      idref: { a: notice('1', '2022-....'), b: notice('2', '2022-....'), c: { mode: 'verify', candidates: [{ ppn: '3', affiliations: [{ label: 'Nantes Université', qualifier: '2019-2024', dates: '2019-2024' }] }] } },
    }));
    expect(out.map((x: { key: string }) => x.key)).toEqual(['a']);
    expect(out[0].description).toContain('2026-08-31');
    expect(out[0].lien).toBe('https://www.idref.fr/1');
  });

  it('openNantesAffiliations: open range or no year, Nantes in label or qualifier', () => {
    const aff = openNantesAffiliations({ affiliations: [
      { label: 'Nantes Université', qualifier: '2022-....', dates: '2024-....' },
      { label: 'Centre Hospitalier Universitaire', qualifier: 'Nantes', dates: '2026' },
      { label: 'Université de Nantes', qualifier: '1996-2021', dates: '1996-2021' },
      { label: 'Université de Rennes', qualifier: '2020-....', dates: '' },
    ] });
    expect(aff.map((a: { label: string }) => a.label)).toEqual(['Nantes Université']);
  });
});

describe('rule sources', () => {
  it('every rule declares the caches it reads (empty cache ⇒ rule skipped, no false auto-resolution)', () => {
    for (const [name, rule] of Object.entries(RULES) as [string, { sources: string[] }][]) {
      expect(rule.sources.length, name).toBeGreaterThan(0);
      for (const s of rule.sources) expect(['orcid', 'hal', 'scopus', 'idref', 'ldap']).toContain(s);
    }
  });
});
