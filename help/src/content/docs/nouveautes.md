---
title: "Nouveautés"
description: "Les évolutions visibles de Druid, mois par mois."
sidebar:
  order: 1
---

Les évolutions de Druid que vous pouvez remarquer, mois par mois. Certaines fonctions
n'existent que sur les instances qui en disposent (voir
[Instances et fonctionnalités](/donnees/instances-fonctionnalites/)).

## Septembre 2026

### Aide

- **Ce centre d'aide** est en ligne : démarrage, guides pratiques, tutoriels et pages
  expliquant les données.
- **Un bouton « ? » sur chaque page de Druid** ouvre l'aide de la page (ou de l'onglet)
  affichée ; un lien vers le centre d'aide est dans la barre du haut.
- **Assistant « Aide Druid »** : dans l'assistant (bouton en bas à droite), un onglet répond
  aux questions « comment faire… » à partir de ce centre d'aide et cite les pages utilisées.

### Personnes

- **Rubrique « À traiter »** (administrateurs) : les doublons à fusionner et les **tâches**
  à faire hors de Druid (IdRef, ORCID, HAL, OpenAlex, RH), avec des e-mails prêts à envoyer
  aux chercheurs et des tâches créées automatiquement. Voir
  [Suivre les tâches](/guides/personnes/taches-a-traiter/).
- **Dates imprécises** : les dates d'emploi et d'appartenance se saisissent à l'année, au
  mois ou au jour ; bouton **→ fin d'emploi**. Une fin d'emploi et une fin d'appartenance
  passées font passer la personne en **Parti**. Voir
  [Saisir des dates imprécises](/guides/personnes/dates-imprecises/).
- **Dates et type d'appartenance** (membre statutaire, associé, secondaire, invité) sur la
  fiche, transmis à CRISalid.
- **Statuts plus justes** : une personne employée par un autre organisme est **Externe**
  même avec un compte de l'établissement ; les émérites ont un grade propre ; un retraité
  sans éméritat est **Parti**. Voir [Statuts des personnes](/donnees/statuts-des-personnes/).
- **Doublons** : assistant de fusion champ par champ, journal des fusions restaurable,
  qualification des personnes rattachées à plusieurs laboratoires.
- **Fiche chercheur** : photo et numéro IdHAL modifiables.

### Identifiants

- **Une seule page « Alignement des identifiants chercheurs »** pour IdRef, ORCID, HAL,
  OpenAlex et Scopus : une ligne par personne, une colonne par identifiant, seules les fiches
  qui demandent une action. Voir [Aligner les identifiants](/guides/identifiants/aligner-les-identifiants/).
- **Nouvelles sources** : ORCID, HAL, profils auteurs OpenAlex (plusieurs par personne) et
  Scopus Author ID.
- **Identité mêlée** : signaler un profil qui mélange plusieurs personnes, pour le faire
  corriger à la source ; Druid signale aussi les cas suspects.
- **Notices IdRef remplacées** par l'ABES : mise à jour du numéro en un clic.
- **Onglet « Sans obligation de recherche »** pour les personnels concernés.
- **Alignement LDAP** en deux onglets : rechercher les manquants, vérifier les existants.

### Structures

- Le **laboratoire de rattachement** d'une équipe se déduit de ses appartenances.
- Création de structures et onglet **Cycle de vie et filiation**.

### Tableau de bord

- **Collaborations avec une alliance d'universités** (EUniWell) : bilan par université,
  chercheurs impliqués, analyse thématique. Voir
  [Analyser les collaborations](/guides/tableau-de-bord/collaborations/).
- **Profil disciplinaire des équipes** par thématique, en carte de chaleur.
- **Console ETL** intégrée à Druid (administrateurs techniques), avec le contrôle des
  affiliations OpenAlex.

### Interface

- **Druid en anglais** : bascule FR / EN dans la barre du haut.
- **Rubrique Administration** : console ETL, gestion des droits, sources médias.
- **Droits** : un compte sans droit particulier voit automatiquement son propre laboratoire.
- **Nouveau logo** et en-tête de page qui se compacte au défilement.
