import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// The rules live in the CommonJS script (run by the server and by ofelia); requiring it only
// defines them (main() runs under require.main === module).
const { RULES, DEFAULT_RULES, openNantesAffiliations, nameMatch, sharedIdentifierGroups } = createRequire(import.meta.url)('../../scripts/sync_tasks.cjs');

const rec = (id: number, fields: Record<string, unknown>) => ({ id, key: (fields.uid_dyna as string) || `g${id}`, fields });
const cand = (extra: Record<string, unknown>) => ({ nameMatch: 'exact', score: 'moyen', evidence: ['site (Nantes Université)'], ...extra });
const ctx = (over: Partial<Record<'annuaire' | 'orcid' | 'hal' | 'scopus' | 'idref' | 'ldap', unknown>>) =>
  ({ annuaire: [], orcid: {}, hal: {}, scopus: {}, idref: {}, ldap: {}, ...over });

describe('scripts/sync_tasks.cjs rules (docs/plan-chantiers-taches.md, lot 5)', () => {
  it('default rules exclude the ABES ones (handled by the batch export)', () => {
    expect(DEFAULT_RULES).toEqual(['orcid_deux_ids', 'hal_deux_idhal', 'scopus_deux_ids', 'rh_depart', 'annuaire_ids_partages']);
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
      for (const s of rule.sources) expect(['orcid', 'hal', 'scopus', 'idref', 'ldap', 'annuaire']).toContain(s);
    }
  });
});

describe('annuaire_ids_partages — records with different uid sharing an exported identifier', () => {
  const p = (id: number, uid: string, Nom: string, Prenom: string, extra: Record<string, unknown> = {}) => rec(id, { uid_dyna: uid, Nom, Prenom, LABO: 'LS2N', ...extra });
  const detect = (annuaire: unknown[]) => RULES.annuaire_ids_partages.detect(ctx({ annuaire }));

  it('nameMatch: same person, swapped names, usage name / relatives, two people', () => {
    expect(nameMatch({ Nom: 'MARTIN', Prenom: 'Pierre' }, { Nom: 'Martin', Prenom: 'Pierre' })).toBe('same');
    expect(nameMatch({ Nom: 'Leroy', Prenom: 'Anaïs' }, { Nom: 'Anais', Prenom: 'Leroy' })).toBe('same');
    expect(nameMatch({ Nom: 'DUPONT', Prenom: 'Claire' }, { Nom: 'Durand', Prenom: 'Claire' })).toBe('partial');
    expect(nameMatch({ Nom: 'BERNARD', Prenom: 'Luc' }, { Nom: 'BERNARD', Prenom: 'Louis' })).toBe('partial');
    expect(nameMatch({ Nom: 'PETIT', Prenom: 'Jean' }, { Nom: 'Moreau', Prenom: 'Paul' })).toBe('distinct');
  });

  it('one task per group, typed by the names; same-uid rows, rows without uid and invalid values ignored', () => {
    const out = detect([
      p(1, 'martin-p-1', 'MARTIN', 'Pierre', { ORCID: 'https://orcid.org/0000-0001-0000-0001', IdRef: '123456789' }),
      p(2, 'E000001A', 'Martin', 'Pierre', { ORCID: '0000-0001-0000-0001', LABO: 'zzz' }),
      p(3, 'petit-j', 'PETIT', 'Jean', { IdHAL: 'jean-petit', IdHAL_i: 100001 }),
      p(4, 'ext_moreau-p', 'Moreau', 'Paul', { IdHAL: 'Jean-Petit ' }),
      p(5, 'dup-a', 'Dup', 'Anne', { ORCID: '0000-0001-1111-1111' }),
      p(6, 'dup-a', 'Dup', 'Anne', { ORCID: '0000-0001-1111-1111', LABO: 'CEISAM' }),   // same uid: one person
      p(7, '', 'Sans', 'Uid', { ORCID: '0000-0001-1111-1111' }),                        // not exported
      p(8, 'x-1', 'X', 'Un', { ID_SCOPUS: 0, IdRef: 'n/a' }),
      p(9, 'x-2', 'X', 'Deux', { ID_SCOPUS: 0, IdRef: 'n/a' }),
    ]);
    expect(out.map((d: { type: string; key: string }) => `${d.type}:${d.key}`)).toEqual([
      'annuaire_doublon:E000001A+martin-p-1',
      'annuaire_identifiant_partage:ext_moreau-p+petit-j',
    ]);
    expect(out[0].rec.key).toBe('martin-p-1');   // lab before the parking lab
    expect(out[0].description).toContain('ORCID 0000-0001-0000-0001');
    expect(out[0].description).toContain('fusionner');
    expect(out[0].lien).toBe('https://orcid.org/0000-0001-0000-0001');
    // The IdHAL names the petit-j record: the task goes to the other record, the one to correct.
    expect(out[1].rec.key).toBe('ext_moreau-p');
    expect(out[1].description).toContain('Indice : l’IdHAL jean-petit correspond au nom de PETIT Jean (petit-j)');
  });

  it('connected groups: A–B by ORCID and B–C by IdRef make one group, typed by its least similar pair', () => {
    const groups = sharedIdentifierGroups([
      p(1, 'roux-m', 'ROUX', 'Marc', { ORCID: '0000-0001-0000-0002', IdRef: '987654321' }),
      p(2, 'roux-m-2', 'Roux', 'Marc', { IdRef: '987654321' }),
      p(3, 'faure-a', 'FAURE', 'Alain', { ORCID: '0000-0001-0000-0002' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].uids).toEqual(['faure-a', 'roux-m', 'roux-m-2']);
    expect(groups[0].match).toBe('distinct');
    const out = detect([
      p(1, 'roux-m', 'ROUX', 'Marc', { ORCID: '0000-0001-0000-0002', IdRef: '987654321' }),
      p(2, 'roux-m-2', 'Roux', 'Marc', { IdRef: '987654321' }),
      p(3, 'faure-a', 'FAURE', 'Alain', { ORCID: '0000-0001-0000-0002' }),
    ]);
    expect(out[0].description).toContain('ORCID 0000-0001-0000-0002 (faure-a, roux-m)');
  });
});
