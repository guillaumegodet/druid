// Fictitious Grist directory for the import tests (druid-internal docs/plan-migration-postgresql.md, lot 5): each case
// of the lot 0 mapping and of the migration report. Shared by gristToPg.test.ts and gristToPg.integration.test.ts.
import type { GristDirectoryInput } from '../../migration/gristToPg';

const epoch = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000;
export const row = (id: number, fields: Record<string, unknown>) => ({ id, fields });

export const gristDirectoryFixture = (): GristDirectoryInput => ({
  Etablissements: [
    row(1, { Employeur: 'NANTES UNIVERSITE', UAI: '0442953W', ROR: '03gnh5541', Libelle: 'Nantes Université', idref: '', commentaire: '' }),
    row(2, { Employeur: 'CNRS', UAI: '0753639Y', ROR: '', Libelle: '', idref: '', commentaire: 'national' }),
    row(3, { Employeur: 'CNRS', UAI: '', ROR: '', Libelle: '', idref: '', commentaire: '' }), // duplicated name
    row(4, { Employeur: 'INSERM', UAI: '0753639Y', ROR: '', Libelle: '', idref: '', commentaire: '' }), // duplicated UAI
    row(5, { Employeur: '', UAI: '', ROR: '', Libelle: '', idref: '', commentaire: '' }),
  ],
  Corps_Categorie: [
    row(1, { A: 'PR', B: 'Professeur', C: 'A', D: null }),
    row(2, { A: 'PR', B: 'Doublon', C: null, D: null }),
    row(3, { A: '', B: 'Sans code', C: null, D: null }),
  ],
  Structures: [
    row(10, { local_id: 'U-LAB1', short_labels: 'LAB1[fr]|LAB1[en]', long_labels: 'Laboratoire Un[fr]', type: 'UMR', generic_type: 'research_structure', idref: '   ', nns: '200012345A', ror: '01abcde23', url: 'https://lab1.example.org' }),
    row(11, { local_id: 'U-TEAM1', short_labels: 'TEAMA[fr]', long_labels: 'Équipe A[fr]', type: 'equipe', generic_type: 'research_team', parent_structure: 'LAB1' }),
    row(12, { local_id: 'U-ORPHAN', short_labels: 'ORPH[fr]', type: 'equipe', parent_structure: 'NOWHERE' }),
    row(13, { local_id: 'U-LAB1', short_labels: 'COPY[fr]' }), // duplicated local_id
    row(15, { local_id: 'U-LAB2', short_labels: 'LAB2[fr]', type: 'UMR', generic_type: 'research_structure' }),
    row(16, { local_id: 'U-LAB2-TEAMA', short_labels: 'TEAMA[fr]', type: 'equipe', generic_type: 'research_team', parent_structure: 'LAB2' }),
    row(14, { local_id: '', short_labels: 'NOID[fr]' }),
  ],
  Annuaire: [
    // Same person on two rows (uid in mixed case): row 101 is PRINCIPAL, row 102 carries other values.
    row(101, { uid_dyna: 'dupont-a', Nom: 'Dupont', Prenom: 'Alice', Civilite: 'Mme', LABO: 'LAB1', team: 'TEAMA|Free team',
      rattachement: 'PRINCIPAL', Employeur: 1, IdRef: '000000019', ORCID: '0000-0001-0000-0001', OpenAlex_ids: 'A1|A2',
      ID_SCOPUS: 57193706000, N_ID_UNIV_NANTES_revu_SI_RH_MANGUE_: 12345, validated: true, validated_status: 'INTERNE',
      validation_date: epoch('2026-09-01'), validation_scope: 'statut,rattachement', DATE_DE_NAISSANCE_JJ_MM_AAAA: epoch('1980-05-04'),
      employment_start_date: '2015', employment_end_date: '2030-06', affiliation_start_date: '2015-09', Data_source: 'LDAP|IDREF',
      Commentaires: '[2026-09-01] MAJ LDAP', LinkedIn: 'https://linkedin.com/in/a; https://linkedin.com/in/a2', LDAP_derniere_maj: '2026-10-01',
      LDAP_champs_modifies: 'Corps_grade|TYPE_EMPLOI', ANNEE_HDR: '2012', etp_quotite: 1, etp_recherche: 0.5,
      Personnel_heberge_dans_les_locaux_de_Nantes_Universite: 'Oui', institution_identifier: '0442953W', Mystery_column: 'x' }),
    row(102, { uid_dyna: 'dupont-a', Nom: 'Dupont-Martin', Prenom: 'Alice', LABO: 'zzz', rattachement: 'SECONDAIRE', Employeur: 3,
      IdRef: '000000027', ORCID: '0000-0001-0000-0001', Data_source: 'HAL', Commentaires: 'Note manuelle', ID_SCOPUS: 0,
      affiliation_end_date: '2024-13' }),
    // Record without uid: its own person; sentinels and typed text.
    row(103, { uid_dyna: '', Nom: 'Martin', Prenom: 'Bob', Civilite: 'M.', LABO: 'UNKNOWN', Employeur: 'cnrs', ID_SCOPUS: 'absent',
      N_ID_UNIV_NANTES_revu_SI_RH_MANGUE_: '#N/A', ANNEE_HDR: 'N/A', employment_end_date: '2026-02-30', validated_status: 'PARTI',
      IdRef: '000000019', HDR: 'Oui' }),
    row(104, { uid_dyna: 'ext_durand-c', Nom: 'Durand', Prenom: 'Chloé', Civilite: 'Dr', LABO: '', Employeur: 999, validated_status: 'NOPE',
      N_ID_UNIV_NANTES_revu_SI_RH_MANGUE_: 0, DATE_DE_NAISSANCE_JJ_MM_AAAA: 0, ANNEE_HDR: '', Employeur_extra: null }),
    // TEAMA exists in LAB1 and LAB2: the team under the lab of the membership; FREE: no structure.
    row(105, { uid_dyna: 'Petit-D', Nom: 'Petit', LABO: 'LAB2', team: 'TEAMA', ANNEE_HDR: '' }),
  ],
});
