// Fictitious work tables for the import tests (druid-internal docs/plan-migration-postgresql.md, lot 5 b), pointing to
// the people of fixtures/gristDirectory.ts (Annuaire rows 101-105). Each case of the work transformation.
import type { GristWorkInput } from '../../migration/gristToPgWork';
import { row } from './gristDirectory';

export const gristWorkFixture = (): GristWorkInput => ({
  Taches: [
    row(1, { cle: 'annuaire_ids_partages:dupont-a', type: 'annuaire_ids_partages', base: 'Annuaire', canal: 'interne', titre: 'Identifiant partagé',
      chercheur: 101, uid_dyna: 'dupont-a', statut: 'a_faire', priorite: 'normale', origine: 'regle:annuaire_ids_partages',
      cree_par: 'job', cree_le: '2026-10-01T05:00:00.000Z', verifie_le: '2026-10-08T05:00:00.000Z' }),
    row(2, { cle: '', type: 'autre', titre: 'Tâche manuelle', chercheur: 0, statut: '', priorite: '', cree_le: '2026-10-02T09:00:00.000Z',
      fait_le: 'hier', Champ_inconnu: 'x' }),
    row(3, { cle: 'annuaire_ids_partages:dupont-a', type: 'annuaire_ids_partages', titre: 'Doublon de clé', chercheur: 999, statut: 'bizarre',
      priorite: 'urgente', cree_le: '2026-10-03T09:00:00.000Z' }),
    row(4, { cle: 'x:petit-d', type: 'autre', titre: 'Par uid', uid_dyna: 'petit-d', statut: 'fait', cree_le: '2026-10-04T09:00:00.000Z' }),
  ],
  Taches_evenements: [
    row(10, { tache: 1, date: '2026-10-01T05:00:00.000Z', auteur: 'job', action: 'creation', detail: 'Détectée' }),
    row(11, { tache: 2, date: '2026-10-02T09:00:00.000Z', auteur: 'alice', action: 'creation', detail: '' }),
    row(12, { tache: 77, date: '2026-10-02T09:00:00.000Z', auteur: 'alice', action: 'commentaire' }), // no such task
  ],
  Fusions_log: [
    row(20, { uid_dyna: 'dupont-a', Nom: 'Dupont', kept_rowid: 101, dropped_rowid: 150, auteur: 'alice', date: '2026-09-09T10:00:00.000Z',
      note: 'script', dropped_json: '{"Nom":"Dupont","LABO":"LAB1"}', kept_before_json: '{"Email":""}', kept_patch_json: '{"Email":"a@x"}', restaure: false }),
    row(21, { uid_dyna: 'gone-z', kept_rowid: 160, dropped_rowid: 161, date: 'not a date', dropped_json: '{oops', restaure: true, restored_rowid: 104 }),
  ],
  Alignement_IdRef: [
    row(30, { uid_dyna: 'dupont-a', PPN_candidat: '000000035', Nom_notice: 'Dupont, A.', Decision: 'Rejeté', Pousse_le: '2026-09-11', Lien_IdRef: 'https://…' }),
    row(31, { uid_dyna: 'g103', PPN_candidat: '000000043', Decision: 'Validé', Applique: true, Date_application: '2026-09-12' }), // record without uid
    row(32, { uid_dyna: 'nobody', PPN_candidat: '000000051', Decision: 'Rejeté' }),
  ],
  Alignement_HAL: [row(40, { uid_dyna: 'dupont-a', Annuaire_id: 102, IdHAL_candidat: 'alice-dupont', Score: 'fort', Decision: 'Identité mêlée', Pousse_le: '2026-09-20' })],
  Alignement_ORCID: [
    row(50, { uid_dyna: 'dupont-a', Annuaire_id: 101, ORCID_candidat: '0000-0002-0000-0002', Decision: 'Rejeté', Pousse_le: 'n/a' }),
    row(51, { uid_dyna: 'dupont-a', Annuaire_id: 101, ORCID_candidat: '0000-0002-0000-0002', Decision: 'Rejeté' }), // same key
  ],
  Alignement_OpenAlex: [],
  Alignement_Scopus: null,
  Rapports: [
    row(60, { owner: 'alice', name: 'Mon rapport', definition: '{"schemaVersion":1,"blocks":[]}', visibility: 'private',
      created_at: '2026-09-28T10:00:00.000Z', updated_at: '2026-09-28T11:00:00.000Z', published_template: false }),
    row(61, { owner: 'bob', name: 'Abîmé', definition: 'not json', visibility: 'instance', created_at: '2026-09-29T10:00:00.000Z',
      updated_at: '2026-09-29T10:00:00.000Z', deleted_at: '2026-09-30T10:00:00.000Z' }),
  ],
  Rapports_partages: [
    row(70, { report: 60, grantee: 'bob', role: 'editor', granted_by: 'alice', granted_at: '2026-09-28T12:00:00.000Z' }),
    row(71, { report: 99, grantee: 'carol', role: 'viewer' }), // no such report
  ],
  Rapports_generations: [
    row(80, { report: 60, generated_at: '2026-09-28T12:00:00.000Z', generated_by: 'alice', definition_snapshot: '{"schemaVersion":1}',
      publication_count: 42, data_date: '2026-09-27', ai_texts: 'null', pdf_ref: 'centrale/60/80.pdf', shared_frozen: true }),
  ],
  BenchmarkPeerGroups: [
    row(90, { owner: 'alice', name: 'Pairs', rors: '["https://ror.org/a","https://ror.org/b"]', updated_at: '2026-09-01T00:00:00.000Z' }),
    row(91, { owner: 'alice', name: 'Pairs', rors: '[]' }),
  ],
  arbitrations: {
    Arbitrage_Centrale_2026_09: [
      row(1, { Fiche: 101, Personne: 'DUPONT Alice', Labo: 'LAB1', Famille: 'RH', Champ: 'Email', Valeur_actuelle: 'a@x', Valeur_importee: 'b@x',
        Valeur_importee_json: '"b@x"', Choix: 'Import', Resolu_le: '2026-09-30T10:00:00.000Z', Resolu_par: 'alice' }),
      row(2, { Fiche: 555, Personne: 'Inconnu', Champ: 'ORCID', Valeur_importee_json: '{bad' }),
    ],
  },
});
