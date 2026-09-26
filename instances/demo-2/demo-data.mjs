// Fictitious data of the second demo instance (docs/plan-architecture-multi-instances.md, lot 6 c).
//
// A fictitious engineering school, smaller than the demo university, with two labs (MécaDémo,
// SynDémo) — the second tenant of the shared deployment prototype. Same rules as the demo
// (instances/demo/demo-data.mjs, whose generator it reuses): e-mails under example.org, ORCID and
// IdRef identifiers with a WRONG check character, IdHAL prefixed `demo2-`, OpenAlex ids `A00000…`.
// Identifier numbers start at 501, outside the range of the demo, so the two docs never share one.
// Deterministic. Run directly, prints the researchers as JSON:
//   node instances/demo-2/demo-data.mjs > /tmp/demo-2-people.json

import { pathToFileURL } from 'node:url';
import { buildResearchersFor } from '../demo/demo-data.mjs';

/**
 * Etablissements table. The keys are the employer keys of the shared generator (GRADES of
 * demo-data.mjs): UNIV = the school itself, CNR = the research organisation, ENS = the partner
 * university (employer of the research engineers).
 */
export const ETABLISSEMENTS = [
  { key: 'UNIV', Employeur: "ÉCOLE D'INGÉNIEURS DE DÉMONSTRATION", UAI: 'DEMO2-EID', ROR: '', Libelle: "École d'Ingénieurs de Démonstration" },
  { key: 'CNR', Employeur: 'CNRD', UAI: 'DEMO-CNR', ROR: '', Libelle: 'Centre National de Recherche de Démonstration' },
  { key: 'ENS', Employeur: 'UNIVERSITÉ DE DÉMONSTRATION', UAI: 'DEMO-UNIV', ROR: '', Libelle: 'Université de Démonstration' },
];

/** Structures table (CRISalid V2 schema). */
export const STRUCTURES = [
  { generic_type: 'institution', type: 'GE', local_id: 'DEMO2-EID', short_labels: 'EIDémo[fr]', long_labels: "École d'Ingénieurs de Démonstration[fr]", uai: 'DEMO2-EID', web: 'https://example.org/eidemo' },
  { generic_type: 'institution', type: 'EPST', local_id: 'DEMO-CNR', short_labels: 'CNRD[fr]', long_labels: 'Centre National de Recherche de Démonstration[fr]', uai: 'DEMO-CNR', web: 'https://example.org/cnrd' },
  { generic_type: 'institution', type: 'EPE', local_id: 'DEMO-UNIV', short_labels: 'UDémo[fr]', long_labels: 'Université de Démonstration[fr]', uai: 'DEMO-UNIV', web: 'https://example.org/udemo' },
  {
    generic_type: 'unit', type: 'UMR', main_mission: 'research', local_id: 'MECAD', short_labels: 'MécaDémo[fr]',
    long_labels: 'Laboratoire de Mécanique et Matériaux de Démonstration[fr]',
    participations: 'local-DEMO2-EID[main_supervision][20180101-]|local-DEMO-CNR[associated_supervision][20180101-]',
    nns: 'DEMO-UMR-011', web: 'https://example.org/mecademo', signature: "École d'Ingénieurs de Démonstration, CNRD, MécaDémo, UMR 0011, Démoville, France",
  },
  {
    generic_type: 'unit', type: 'UR', main_mission: 'research', local_id: 'SYND', short_labels: 'SynDémo[fr]',
    long_labels: 'Laboratoire des Systèmes Numériques de Démonstration[fr]',
    participations: 'local-DEMO2-EID[main_supervision][20190101-]|local-DEMO-UNIV[associated_supervision][20190101-]',
    nns: 'DEMO-UR-012', web: 'https://example.org/syndemo',
  },
  { generic_type: 'unit', type: 'ER', main_mission: 'research', local_id: 'MECAD-MAT', short_labels: 'Matériaux-Démo[fr]', long_labels: 'Équipe Matériaux Composites[fr]', inclusions: 'local-MECAD[20180101-]' },
  { generic_type: 'unit', type: 'ER', main_mission: 'research', local_id: 'MECAD-FLU', short_labels: 'Fluides-Démo[fr]', long_labels: 'Équipe Mécanique des Fluides[fr]', inclusions: 'local-MECAD[20180101-]' },
];

const DEMO2 = {
  core: [
    { first: 'Margaux', last: 'Lemoine', civ: 'F', birth: '1972-05-21', grade: 'PR', hdr: true, hdrYear: '2006', labo: 'MECAD', team: 'Matériaux-Démo', start: '2008-09-01' },
    { first: 'Thomas', last: 'Giraud', civ: 'M', birth: '1984-11-02', grade: 'MCF', labo: 'MECAD', team: 'Matériaux-Démo', start: '2013-09-01' },
    { first: 'Fatima', last: 'Benali', civ: 'F', birth: '1987-03-14', grade: 'CR', employer: 'CNR', labo: 'MECAD', team: 'Fluides-Démo', start: '2018-01-01' },
    { first: 'Vincent', last: 'Roche', civ: 'M', birth: '1976-08-09', grade: 'PR', hdr: true, hdrYear: '2011', labo: 'SYND', start: '2009-09-01' },
    { first: 'Emma', last: 'Caron', civ: 'F', birth: '1998-01-27', grade: 'Doctorant', labo: 'SYND', start: '2023-10-01', ids: ['orcid'] },
    { first: 'Lucas', last: 'Perret', civ: 'M', birth: '1981-06-30', grade: 'IR', employer: 'ENS', labo: 'SYND', start: '2016-02-01' },
  ],
  special: [
    // Departure (end of employment passed) and a researcher with no identifier: alignment cases.
    { first: 'Bernard', last: 'Lucas', civ: 'M', birth: '1958-10-05', grade: 'PR', hdr: true, hdrYear: '1996', labo: 'MECAD', team: 'Fluides-Démo', start: '1992-09-01', end: '2023-08-31', affEnd: '2023-08-31' },
    { first: 'Inès', last: 'Maillard', civ: 'F', birth: '1993-07-11', grade: 'Post-doc', typeEmploi: 'CDD UNIVERSITE', labo: 'SYND', start: '2025', ids: [] },
  ],
  units: [
    { labo: 'MECAD', team: 'Matériaux-Démo', campus: 'Campus EIDémo', count: 6 },
    { labo: 'MECAD', team: 'Fluides-Démo', campus: 'Campus EIDémo', count: 5 },
    { labo: 'SYND', team: '', campus: 'Campus EIDémo', count: 7 },
  ],
  seed: 20260926,
  firstNumber: 501,
  emailDomain: 'eidemo.example.org',
  idhalPrefix: 'demo2',
  annuaireBase: 'https://example.org/eidemo/annuaire',
  campusFor: () => 'Campus EIDémo',
  doctoralSchool: 'ED Démo-SPI',
};

/** All researchers of the second demo. */
export const buildResearchers = () => buildResearchersFor(DEMO2);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(JSON.stringify(buildResearchers(), null, 1) + '\n');
}
