---
title: "Statuts des personnes"
description: "Comment Druid détermine si une personne est Interne, en Départ, Partie ou Externe, et comment la validation manuelle s'y superpose."
sidebar:
  order: 2
---

## Ce que c'est

Chaque fiche porte un **statut** qui dit où en est la personne par rapport à
l'établissement :

| Statut | Signification |
|---|---|
| **Interne** | En poste dans l'établissement. |
| **Départ** | Encore présente, mais son départ est annoncé. |
| **Parti** | N'est plus là : fin de contrat passée, compte supprimé, retraite… |
| **Externe** | Membre du laboratoire mais employée par un autre organisme (CNRS, Inserm, autre école…), ou sans compte dans l'établissement. |

Le statut est **calculé automatiquement** à partir de l'annuaire LDAP et des dates d'emploi.
Une personne habilitée peut ensuite le **confirmer à la main** : c'est la validation (ou
fiabilisation), qui l'emporte sur le calcul.

:::note[Selon votre instance]
Les statuts et la validation dépendent de la fonction « Statuts Interne/Externe et
validation manuelle ». Sur une instance où elle est désactivée, ils n'apparaissent pas.
Voir [Instances et fonctionnalités](/donnees/instances-fonctionnalites/).
:::

## Comment c'est calculé

Druid applique les règles suivantes, dans cet ordre.

### 1. L'employeur

Si l'**employeur** de la fiche est connu et **différent de l'établissement** (CNRS, Inserm,
CHU, une autre école…), la personne est **Externe**, même si elle a un compte actif dans
l'annuaire de l'établissement. Elle passe en **Parti** quand sa date de fin d'emploi est
passée.

Pourquoi : beaucoup de chercheurs d'organismes ont un compte hébergé par l'université, et
l'état de ce compte ne dit rien de leur vrai contrat.

### 2. L'annuaire LDAP

Sinon, pour une personne qui a un compte (un uid) :

| Ce que dit l'annuaire LDAP | Statut |
|---|---|
| Compte actif, situation normale | **Interne** |
| Départ programmé | **Départ** |
| Autre situation (compte anticipé…) | **Externe** |
| Le compte n'existe plus | **Parti** |

### 3. Les personnes sans compte

Une personne sans compte dans l'établissement (uid vide ou fictif `ext_…`) est **Externe**,
et passe en **Parti** quand sa date de fin d'emploi est passée.

### 4. La retraite

Une personne classée **retraitée** par les ressources humaines, **sans trace d'éméritat**,
est **Parti**, même si son compte est encore actif. Voir
[Émérites et retraités](#émérites-et-retraités).

### 5. La validation manuelle

Si la fiche a été **validée** pour le statut, le statut validé **remplace** le résultat des
règles 1 à 4. Voir [Validation manuelle](#validation-manuelle).

### 6. Le départ certain

Enfin, si la **fin d'emploi** et la **fin d'appartenance** au laboratoire sont toutes les
deux renseignées **et passées**, la personne est **Parti**, quoi que disent l'annuaire LDAP
et même la validation. Une date saisie à l'année seule (`2026`) n'est « passée » qu'une fois
l'année entière écoulée, soit à partir du 1er janvier 2027.

:::note[Pour aller plus loin]
Règles implémentées dans `lib/gristService.ts` (calcul), `lib/validation.ts` (validation),
`lib/emeritus.ts` (éméritat) et `lib/dates.ts` (départ certain) du dépôt Druid.
:::

## Émérites et retraités

L'éméritat peut apparaître à plusieurs endroits : le grade, le type d'emploi, la catégorie
de l'annuaire LDAP. Dès qu'une de ces sources indique un éméritat, Druid attribue un **grade
d'émérite** d'après le corps d'origine :

| Corps d'origine | Grade d'émérite |
|---|---|
| Maître de conférences (MCF, MCF hors classe, MCU-PH) | **MCFEM** |
| Directeur de recherche (DR, DR1, DR2, DRCE) | **DREM** |
| Tous les autres (professeurs, PU-PH, chargés de recherche, corps inconnu) | **PREM** |

Un émérite garde le statut que lui donne l'annuaire LDAP (le plus souvent **Interne**). À
l'inverse, un **retraité sans éméritat** passe en **Parti**.

## Validation manuelle

Les sources automatiques sont imparfaites : l'annuaire LDAP est mis à jour avec retard, les
dates d'emploi des personnes extérieures sont incomplètes. Quand on dispose d'une
information sûre (une liste envoyée par un laboratoire, une vérification directe), on
**valide la fiche**.

Une validation enregistre :

- ce qu'elle couvre : le **statut**, le **rattachement**, ou les deux ;
- le **statut validé** (Interne, Départ, Parti ou Externe) ;
- la **source** (par exemple « Liste du labo, juin 2026 ») et la **date** ;
- l'auteur de la validation.

Elle se fait fiche par fiche (**Valider la fiche** sur la fiche chercheur) ou en masse
(**Importer une liste fiabilisée**, menu **Synchroniser** de Personnel). Voir
[Corriger le statut ou le rattachement](/guides/personnes/fiabiliser-statut-rattachement/).

### Les pastilles de validation

| Pastille | Signification |
|---|---|
| **Validé** | La fiche est validée ; la source et la date s'affichent au survol. |
| **Périmé** | La validation a plus de **18 mois** : elle s'applique toujours, mais il faut la revoir. |
| **Validé — conflit** | Le calcul automatique donne un autre statut que le statut validé (par exemple, l'annuaire LDAP annonce un départ). Le statut affiché reste le statut validé : à vous d'arbitrer. |

### Pourquoi c'est important

Les fiches validées sont celles qui comptent comme **membres** d'un laboratoire dans le
tableau de bord (périmètre *Effectifs*, voir
[Publications et attribution](/donnees/publications-attribution/#les-deux-périmètres-du-tableau-de-bord)).
Une fiche non validée n'est pas prise en compte dans ce périmètre.

## Exemple

Une chercheuse CNRS travaille dans un laboratoire de l'université et y a un compte actif.
Sa fiche indique l'employeur « CNRS » : elle est **Externe** (règle 1), et non Interne comme
le laisserait croire son compte. Quand le laboratoire indique qu'elle a rejoint un autre
site, on renseigne sa fin d'emploi et sa fin d'appartenance : elle passe en **Parti**
(règle 6).

## Limites connues

- **L'employeur doit être renseigné** : une fiche sans employeur suit l'annuaire LDAP. Un
  chercheur d'organisme sans employeur sur sa fiche peut ainsi apparaître **Interne**.
- **Le retard de l'annuaire LDAP** : un départ n'y apparaît parfois qu'après plusieurs mois.
  Pendant ce temps, la personne reste Interne, sauf validation ou dates de fin renseignées.
- **Les personnes extérieures sans date de fin** restent Externes indéfiniment : seule une
  date de fin d'emploi les fait passer en Parti.
- **Une validation ne se met pas à jour seule** : si la situation change, la fiche validée
  garde son statut jusqu'à ce qu'on la revoie. La pastille **Validé — conflit** signale les
  cas où l'annuaire LDAP dit autre chose.
- **Les dates de fin passées l'emportent sur tout** : une fin d'emploi et une fin
  d'appartenance saisies par erreur dans le passé font passer la fiche en Parti, même
  validée.

## Comment signaler une erreur

Un statut vous semble faux ? Vérifiez d'abord l'employeur et les dates de la fiche, puis
voir [Où corriger quoi](/guides/corriger/ou-corriger-quoi/). Pour une erreur de l'annuaire
LDAP, c'est le service des ressources humaines qui corrige.
