import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

// The rules live in the CommonJS script (run by the server and by ofelia); requiring it only
// defines them (main() runs under require.main === module).
const { RULES, DEFAULT_RULES, openNantesAffiliations, nameMatch, sharedIdentifierGroups, endsByKey } = createRequire(import.meta.url)('../../scripts/sync_tasks.cjs');

const rec = (id: number, fields: Record<string, unknown>) => ({ id, key: (fields.uid_dyna as string) || `g${id}`, fields });
const cand = (extra: Record<string, unknown>) => ({ nameMatch: 'exact', score: 'moyen', evidence: ['site (Nantes Université)'], ...extra });
const ctx = (over: Partial<Record<'annuaire' | 'orcid' | 'hal' | 'scopus' | 'idref' | 'ldap' | 'parcours', unknown>>) =>
  ({ annuaire: [], orcid: {}, hal: {}, scopus: {}, idref: {}, ldap: {}, parcours: {}, ...over });

describe('scripts/sync_tasks.cjs rules (docs/plan-chantiers-taches.md, lot 5)', () => {
  it('default rules exclude the ABES ones (handled by the batch export)', () => {
    expect(DEFAULT_RULES).toEqual(['orcid_deux_ids', 'hal_deux_idhal', 'scopus_deux_ids', 'rh_depart', 'annuaire_ids_partages', 'uid_ldap_disponible', 'parcours_depart', 'parcours_statut_incoherent', 'parcours_identifiant_suspect']);
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
      for (const s of rule.sources) expect(['orcid', 'hal', 'scopus', 'idref', 'ldap', 'annuaire', 'parcours']).toContain(s);
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

  it('same names but two different IdRef: namesakes as often as duplicates ⇒ to check, with a warning', () => {
    const out = detect([
      p(1, 'bernard-l', 'BERNARD', 'Lucie', { IdRef: '111111111', ORCID: '0000-0001-0000-0003' }),
      p(2, 'ext_bernard-l', 'Bernard', 'Lucie', { IdRef: '222222222', ORCID: '0000-0001-0000-0003' }),
      p(3, 'blanc-a', 'BLANC', 'Alice', { ORCID: '0000-0001-0000-0004' }),
      p(4, 'ext_blanc-a', 'Blanc', 'Alice', { ORCID: '0000-0001-0000-0004' }),   // no IdRef on one side: no contradiction
    ]);
    expect(out.map((d: { type: string; key: string }) => `${d.type}:${d.key}`)).toEqual([
      'annuaire_doublon_a_verifier:bernard-l+ext_bernard-l',
      'annuaire_doublon:blanc-a+ext_blanc-a',
    ]);
    expect(out[0].description).toContain('Attention : bernard-l et ext_bernard-l ont des IdRef différents');
    expect(out[1].description).not.toContain('Attention');
  });

  it('the HR staff number links an ext_ record to the LDAP uid record; two numbers on namesakes are a warning', () => {
    const out = detect([
      p(1, 'leroux-c', 'LEROUX', 'Camille', { N_ID_UNIV_NANTES_revu_SI_RH_MANGUE_: 12345 }),
      p(2, 'ext_leroux-c', 'Leroux', 'Camille', { N_ID_UNIV_NANTES_revu_SI_RH_MANGUE_: '012345.0' }),
      p(3, 'noel-b', 'NOEL', 'Bruno', { N_ID_UNIV_NANTES_revu_SI_RH_MANGUE_: 222, ORCID: '0000-0001-0000-0005' }),
      p(4, 'ext_noel-b', 'Noel', 'Bruno', { N_ID_UNIV_NANTES_revu_SI_RH_MANGUE_: 333, ORCID: '0000-0001-0000-0005' }),
      p(5, 'vide-a', 'VIDE', 'Anne', { N_ID_UNIV_NANTES_revu_SI_RH_MANGUE_: 0 }),
      p(6, 'vide-b', 'VIDE', 'Anne', { N_ID_UNIV_NANTES_revu_SI_RH_MANGUE_: 0 }),   // empty Numeric cells: no link
    ]);
    expect(out.map((d: { type: string; key: string }) => `${d.type}:${d.key}`)).toEqual([
      'annuaire_doublon:ext_leroux-c+leroux-c',
      'annuaire_doublon_a_verifier:ext_noel-b+noel-b',
    ]);
    expect(out[0].description).toContain('N° agent 12345');
    expect(out[1].description).toContain('ont des N° agent différents');
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

  describe('uid_ldap_disponible — ext_ record whose staff number is an LDAP account (docs/plan-statut-employeur-ldap.md, lot 2)', () => {
    const HR = 'N_ID_UNIV_NANTES_revu_SI_RH_MANGUE_';
    const ldap = {
      'leroux-c': { etat: 'N', categorie: 'CNRS-INSERM', empId: '12345', birthDate: '1980-01-15' },
      'noel-b': { etat: 'N', categorie: 'TITULAIRE', empId: '222' },
      'blanc-a': { etat: 'D', categorie: 'CDD UNIVERSITE', empId: '333', birthDate: '1990-05-01' },
      'vidal-p': { etat: 'N', categorie: 'TITULAIRE', empId: '444' },
    };
    const detect = (annuaire: unknown[]) => RULES.uid_ldap_disponible.detect(ctx({ annuaire, ldap }));

    it('proposes the LDAP uid for an ext_ record or a record without uid, once per person', () => {
      const out = detect([
        rec(1, { uid_dyna: 'ext_leroux-c', Nom: 'Leroux', Prenom: 'Camille', [HR]: '012345.0', DATE_DE_NAISSANCE_JJ_MM_AAAA: 316742400 }),
        rec(2, { uid_dyna: 'ext_leroux-c', Nom: 'Leroux', Prenom: 'Camille', [HR]: 12345, LABO: 'CEISAM' }),
        rec(3, { uid_dyna: '', Nom: 'Noel', Prenom: 'Bruno', [HR]: 222 }),
        rec(4, { uid_dyna: 'ext_vidal-p', Nom: 'Vidal', Prenom: 'Paul', [HR]: 444 }),
        rec(5, { uid_dyna: 'vidal-p', Nom: 'Vidal', Prenom: 'Paul' }),   // uid already carried: merge rule instead
        rec(6, { uid_dyna: 'ext_x', Nom: 'X', Prenom: 'Y', [HR]: 999 }),   // no LDAP account
        rec(7, { uid_dyna: 'ext_z', Nom: 'Z', Prenom: 'Y', [HR]: 0 }),
      ]);
      expect(out.map((d: { key: string }) => d.key)).toEqual(['ext_leroux-c>leroux-c', 'g3>noel-b']);
      expect(out[0].description).toContain('Le n° agent 12345 de cette fiche (ext_leroux-c) est celui du compte LDAP leroux-c (état N, CNRS-INSERM)');
      expect(out[0].description).toContain('SoVisu+ connaît cette personne sous ext_leroux-c');
      expect(out[0].description).not.toContain('Attention');
      expect(out[1].description).not.toContain('SoVisu+');
    });

    it('accepts compound and usage-prefixed names', () => {
      const ldap2 = { 'gaugler-mh': { etat: 'N', empId: '1' }, 'bruneau-patitucci-m': { etat: 'N', empId: '2' }, 'elmahjoub-s-1': { etat: 'N', empId: '3' }, 'Perrigaud-k': { etat: 'N', empId: '4' } };
      const out = RULES.uid_ldap_disponible.detect(ctx({ ldap: ldap2, annuaire: [
        rec(1, { uid_dyna: 'ext_a', Nom: 'Vuillet-Gaugler', Prenom: 'M', [HR]: 1 }),
        rec(2, { uid_dyna: 'ext_b', Nom: 'Patitucci', Prenom: 'M', [HR]: 2 }),
        rec(3, { uid_dyna: 'ext_c', Nom: 'Mahjoub', Prenom: 'S', [HR]: 3 }),
        rec(4, { uid_dyna: 'ext_d', Nom: 'Perrigaud', Prenom: 'K', [HR]: 4 }),
      ] }));
      expect(out).toHaveLength(4);
      expect(out.filter((d: { description: string }) => d.description.includes('Attention'))).toEqual([]);
    });

    it('warns when the uid does not look like the name, with the birth dates as a hint', () => {
      const out = detect([rec(1, { uid_dyna: 'ext_martin-a', Nom: 'Martin', Prenom: 'Alice', [HR]: 333, DATE_DE_NAISSANCE_JJ_MM_AAAA: '1991-05-01' })]);
      expect(out[0].description).toContain('Attention : l’uid blanc-a ne ressemble pas au nom MARTIN Alice');
      expect(out[0].description).toContain('dates de naissance différentes (fiche 1991-05-01, LDAP 1990-05-01)');
    });
  });

  describe('career path rules (docs/plan-parcours-affiliations.md, lot 4)', () => {
    const line = (signals: unknown[]) => ({ computedAt: '2026-09-30', signals });
    const confirmed = { type: 'depart_confirme', date: '2021-08', sources: ['orcid', 'publications'], destination: 'Université Beta' };
    const observed = { type: 'depart_observe', date: '2020', count: 4, destination: 'Université Beta' };
    it('parcours_depart: one task per record, typed by the strongest signal; ended records skipped', () => {
      const out = RULES.parcours_depart.detect(ctx({
        annuaire: [rec(1, { uid_dyna: 'martin-p' }), rec(2, { uid_dyna: 'martin-p' }), rec(3, { uid_dyna: 'leroy-a' }), rec(4, { uid_dyna: 'petit-j', employment_end_date: '2021' })],
        parcours: { 'martin-p': line([observed, confirmed]), 'leroy-a': line([observed]), 'petit-j': line([confirmed]) },
      }));
      expect(out.map((x: { key: string; type: string }) => [x.key, x.type])).toEqual([['martin-p', 'parcours_depart_confirme'], ['leroy-a', 'parcours_depart_observe']]);
      expect(out[0].description).toContain('Départ confirmé par ORCID + les publications : parti vers 2021-08, pour Université Beta');
      expect(out[0].description).toContain('aucune affiliée à l’établissement après 2020');
      expect(out[0].lien).toBe('/?page=RESEARCHER_DETAIL&id=martin-p');
    });
    it('a membership ends the record only when every row is ended', () => {
      const ends = endsByKey([rec(1, { uid_dyna: 'a', affiliation_end_date: '2020' }), rec(2, { uid_dyna: 'a' }), rec(3, { uid_dyna: 'b', affiliation_end_date: '2020' })]);
      expect([ends.get('a').ended, ends.get('b').ended]).toEqual([false, true]);
    });
    it('parcours_statut_incoherent only on records still ended; parcours_identifiant_suspect only on open ones', () => {
      const parcours = {
        'a-a': line([{ type: 'statut_incoherent', endYear: 2020, lastLocal: 2024 }]),
        'b-b': line([{ type: 'statut_incoherent', endYear: 2020, orcidOpenLocal: true }]),
        'c-c': line([{ type: 'identifiant_suspect', sources: ['publications', 'scopus'] }]),
      };
      const annuaire = [rec(1, { uid_dyna: 'a-a', employment_end_date: '2020-12-31' }), rec(2, { uid_dyna: 'b-b' }), rec(3, { uid_dyna: 'c-c' })];
      const inc = RULES.parcours_statut_incoherent.detect(ctx({ annuaire, parcours }));
      expect(inc.map((x: { key: string }) => x.key)).toEqual(['a-a']);
      expect(inc[0].description).toContain('encore affiliées à l’établissement en 2024');
      const sus = RULES.parcours_identifiant_suspect.detect(ctx({ annuaire, parcours }));
      expect(sus.map((x: { key: string }) => x.key)).toEqual(['c-c']);
      expect(sus[0].description).toContain('les publications et le profil Scopus');
    });
  });
});
