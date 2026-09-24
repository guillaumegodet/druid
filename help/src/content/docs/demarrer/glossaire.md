---
title: "Glossaire"
description: "Les termes employés dans Druid : fiche, statut, fiabilisation, rattachement, alignement, candidat fort…"
sidebar:
  order: 3
---

Les termes sont classés par thème. Chaque définition renvoie à la page qui l'explique en
détail.

## Personnes

- **Annuaire** : la table qui contient une fiche par personne et par laboratoire. C'est la source de vérité
  de Druid : ce que vous corrigez dans Druid y est écrit.
- **Fiche** : une ligne de l'annuaire : une personne dans une structure. Une même personne peut avoir
  plusieurs fiches si elle appartient à plusieurs laboratoires.
- **uid** : l'identifiant de la personne dans l'annuaire LDAP de l'établissement. Les personnes
  extérieures (sans compte) reçoivent un uid fictif commençant par `ext_`.
- **Statut** : *Interne* (en poste), *Départ* (départ annoncé), *Parti* (n'est plus là) ou *Externe*
  (employé par un autre établissement ou sans compte). Calculé automatiquement, sauf
  validation manuelle. → [Statuts des personnes](/donnees/statuts-des-personnes/)
- **Validation, fiabilisation** : confirmation à la main du statut et/ou du rattachement d'une fiche, avec une source et
  une date. Elle l'emporte sur le calcul automatique pendant 18 mois, puis la fiche est
  signalée *périmée*. → [Statuts des personnes](/donnees/statuts-des-personnes/#validation-manuelle)
- **Émérite** : enseignant-chercheur ou chercheur retraité qui conserve une activité de recherche. Druid
  lui donne un grade propre (MCFEM, DREM, PREM). → [Statuts des personnes](/donnees/statuts-des-personnes/#émérites-et-retraités)
- **Emploi** : le contrat de travail : employeur, grade, dates de début et de fin. À ne pas confondre
  avec l'appartenance.
- **Appartenance** : le lien daté entre une personne et une structure (laboratoire, équipe), indépendant du
  contrat de travail. → [Appartenances et rattachement](/donnees/appartenances-rattachement/)
- **Rattachement principal** : l'appartenance qui compte pour la signature des publications et pour l'export vers
  CRISalid. → [Appartenances et rattachement](/donnees/appartenances-rattachement/#rattachement-principal)
- **Date imprécise** : une date saisie à l'année (`2022`), au mois (`2022-09`) ou au jour (`2022-09-01`) selon
  ce que l'on sait. → [Appartenances et rattachement](/donnees/appartenances-rattachement/#dates-imprécises)
- **Doublon** : deux fiches qui portent le même uid : soit la même appartenance saisie deux fois (à
  fusionner), soit une vraie double appartenance (à qualifier). → [Traiter un doublon](/guides/personnes/traiter-un-doublon/)
- **Tâche** : une correction à faire hors de Druid (sur IdRef, ORCID, HAL…), suivie dans la rubrique
  *À traiter*. → [Suivre les tâches](/guides/personnes/taches-a-traiter/)

## Structures

- **Structure** : un établissement, une composante, un laboratoire ou une équipe, décrit selon un modèle
  commun à quatre niveaux. → [Structures](/donnees/structures/)
- **Tutelle** : établissement ou organisme qui porte une structure (université, CNRS, Inserm…). La
  *tutelle principale* est celle de référence.
- **Inclusion** : appartenance forte d'une structure à une autre : une équipe est incluse dans son
  laboratoire, un laboratoire dans son pôle ou sa composante.
- **Participation** : lien plus faible : tutelles, fédérations, participation d'un laboratoire à un réseau.
- **Groupe** : une sélection transverse de chercheurs (un conseil, un projet, une cohorte), avec son
  propre tableau de bord.

## Identifiants

- **Alignement** : le rapprochement d'une fiche avec son identifiant dans une source externe (IdRef, ORCID,
  HAL, OpenAlex, Scopus, annuaire LDAP). → [Identifiants chercheurs](/donnees/identifiants-chercheurs/)
- **Candidat** : un identifiant proposé par Druid pour une fiche. Il n'est écrit qu'après votre
  validation.
- **Candidat fort** : un candidat quasi certain (un identifiant déjà connu est retrouvé sur le profil, ou nom
  exact et affiliation concordante). Il peut être coché en masse.
- **Ambigu** : plusieurs candidats plausibles pour la même fiche : il faut choisir.
- **Conflit** : la fiche porte déjà un identifiant différent de celui trouvé. Druid n'écrase jamais une
  valeur existante : c'est à vous de trancher.
- **Identité mêlée** : un profil distant (IdRef, HAL, OpenAlex…) qui mélange les travaux de plusieurs personnes.
  Il se corrige à la source, pas dans Druid.
- **IdRef, PPN** : le référentiel des personnes de l'ABES (bibliothèques de l'enseignement supérieur) ; le
  PPN est le numéro d'une notice IdRef.
- **ORCID** : identifiant international que le chercheur crée et gère lui-même.
- **IdHAL** : identifiant d'auteur dans l'archive ouverte HAL, créé par l'auteur.
- **A-id (OpenAlex)** : identifiant d'un profil auteur OpenAlex, commençant par `A`. Une personne peut en avoir
  plusieurs.
- **Scopus Author ID** : identifiant d'auteur de la base Scopus (Elsevier).

## Publications et tableau de bord

- **Périmètre** : pour le tableau de bord, *Affiliation* (toutes les publications signées par la structure)
  ou *Effectifs* (celles qui ont au moins un auteur reconnu parmi les membres fiabilisés).
  → [Publications et attribution](/donnees/publications-attribution/#les-deux-périmètres-du-tableau-de-bord)
- **Charte de signature** : la forme d'affiliation recommandée par l'établissement ; le tableau de bord mesure la
  conformité des publications. → [Publications et attribution](/donnees/publications-attribution/)
- **FWCI** : *Field-Weighted Citation Impact* : les citations d'une publication rapportées à la
  moyenne mondiale des publications comparables. 1 = moyenne mondiale.
  → [Indicateurs](/donnees/indicateurs/#fwci)
- **Top 1 % / top 10 %** : publications parmi les 1 % ou 10 % les plus citées de leur domaine et de leur année.
- **Quartile (SJR)** : rang de la revue dans sa discipline selon le classement SCImago, de Q1 (le quart le mieux
  classé) à Q4.
- **APC** : *Article Processing Charges* : frais de publication payés à un éditeur pour publier en
  accès ouvert.
- **ETL** : la chaîne de traitement qui moissonne et calcule les données des tableaux de bord
  (« extraire, transformer, charger »).

## Druid lui-même

- **Instance** : un déploiement de Druid pour un établissement, avec ses données et ses fonctions
  activées. → [Instances et fonctionnalités](/donnees/instances-fonctionnalites/)
- **Profil** : l'ensemble des droits de votre compte (membre de labo, services centraux,
  administrateur…). → [Premiers pas selon votre profil](/demarrer/premiers-pas/)
- **CRISalid** : la chaîne logicielle open source qui moissonne les publications des chercheurs et les
  expose (notamment dans SoVisu+). Druid lui fournit la liste des chercheurs et de leurs
  identifiants.
