---
title: "Appartenances et rattachement"
description: "Appartenance à un labo ou une équipe, rattachement principal, types d'appartenance et dates imprécises."
sidebar:
  order: 3
---

## Ce que c'est

Druid distingue deux choses que l'on confond souvent :

- l'**emploi** : le contrat de travail, avec un employeur, un grade et des dates (carte
  **Emploi** de la fiche) ;
- l'**appartenance** : le fait d'être membre d'un laboratoire ou d'une équipe, avec ses
  propres dates (carte **Appartenances & historique** de la fiche).

Les deux ne coïncident pas toujours. Un maître de conférences peut changer de laboratoire
sans changer d'employeur. Une doctorante peut être rattachée à un laboratoire avant le début
de son contrat. Un chercheur CNRS est employé par le CNRS mais appartient à un laboratoire
de l'université.

## Rattachement principal

Une personne peut appartenir à plusieurs structures. L'une d'elles est le **rattachement
principal** (pastille violette dans la carte Appartenances) :

- c'est la structure à indiquer en priorité dans la **signature** des publications ;
- c'est celle qui est transmise à **CRISalid** comme structure de recherche de la personne ;
- c'est elle qui détermine dans quel laboratoire la personne apparaît par défaut dans les
  listes et le tableau de bord.

Les autres appartenances apparaissent avec une mention :

| Mention | Signification |
|---|---|
| **secondaire** | Appartenance concomitante à une autre structure, en cours. |
| **historique** | Ancienne appartenance, terminée (la personne a changé de laboratoire). |

Ces mentions viennent de la qualification des fiches multiples : voir
[Traiter un doublon](/guides/personnes/traiter-un-doublon/).

## Types d'appartenance

Le **type** précise la nature du lien avec la structure. Druid reprend le vocabulaire de
CRISalid :

| Type (libellé Druid) | Quand l'utiliser |
|---|---|
| **Membre statutaire** | Membre à part entière, rattaché statutairement à l'unité. C'est le cas par défaut. |
| **Membre associé** | Contribue aux travaux de l'unité sans y être rattaché statutairement. |
| **Rattachement secondaire** | Membre principal d'une autre unité, rattaché aussi à celle-ci. |
| **Visiteur / invité** | Présence temporaire (chercheur invité, séjour). |

Un type laissé vide est considéré comme **Membre statutaire** lors de l'export vers
CRISalid.

## Dates imprécises

On ne connaît pas toujours la date exacte d'une arrivée ou d'un départ. Les quatre dates de
la fiche (début et fin d'emploi, début et fin d'appartenance) acceptent donc trois
précisions :

| Ce que vous savez | À saisir | Affiché |
|---|---|---|
| L'année | `2022` | 2022 |
| Le mois | `2022-09` | 09/2022 |
| Le jour | `2022-09-01` | 01/09/2022 |

Les formes françaises `01/09/2022` et `09/2022` sont aussi acceptées et converties
automatiquement. Une saisie illisible reste en rouge et n'est pas enregistrée.

Quand une date précise est nécessaire (export vers CRISalid, calcul d'un départ), Druid
prend la **borne de la période** : le premier jour pour une date de début (`2022` →
1er janvier 2022), le dernier jour pour une date de fin (`2026-06` → 30 juin 2026).

Le bouton **→ fin d'emploi**, à côté de la date de fin d'appartenance, recopie cette date
comme fin d'emploi en un clic : c'est le cas le plus courant quand une personne quitte
l'établissement.

Voir [Saisir des dates d'emploi imprécises](/guides/personnes/dates-imprecises/).

## Ce que les dates changent

- **Le statut** : une fin d'emploi **et** une fin d'appartenance passées font passer la
  personne en **Parti**, même si sa fiche est validée (voir
  [Statuts des personnes](/donnees/statuts-des-personnes/#1-le-départ-certain)). Pour une
  personne sans compte dans l'établissement, la fin d'emploi seule suffit.
- **L'export vers CRISalid** : les dates de l'appartenance principale sont transmises, ce
  qui permet de dater les publications moissonnées.
- Une période n'est « passée » qu'une fois **entièrement** écoulée : une fin `2026` compte à
  partir du 1er janvier 2027.

## Exemple

Une enseignante-chercheuse change de laboratoire en septembre 2025, sans changer d'employeur.
On garde sa carte Emploi telle quelle et, dans la carte Appartenances :

- l'ancien laboratoire reçoit une fin d'appartenance `2025-08` et passe en **historique** ;
- le nouveau laboratoire, avec un début `2025-09`, devient le **rattachement principal**.

Elle reste **Présente**, puisque son emploi continue.

## Limites connues

- **Les dates d'appartenance sont souvent vides** : elles n'existent que depuis 2026 et
  n'ont pas été reprises pour les fiches anciennes. Une appartenance sans date de fin est
  considérée comme en cours.
- **Une fin d'appartenance seule ne fait pas partir la personne** : pour une personne
  employée par l'établissement, il faut aussi une fin d'emploi passée (ou un compte fermé
  dans l'annuaire LDAP).
- **Le rattachement principal est unique** : une personne réellement partagée à parts
  égales entre deux unités doit tout de même en choisir une comme principale.
- **L'export vers CRISalid ne transmet que l'appartenance principale** et ses dates.

## Comment signaler une erreur

Un laboratoire, une équipe ou des dates erronés se corrigent directement sur la fiche si
vous avez les droits sur ce laboratoire ; sinon voir
[Où corriger quoi](/guides/corriger/ou-corriger-quoi/).
