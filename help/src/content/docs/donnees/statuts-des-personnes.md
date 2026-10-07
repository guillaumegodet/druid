---
title: "Statuts des personnes"
description: "Les trois informations qui remplacent Interne / Externe : présence dans l'unité, employeur et compte LDAP — comment Druid les calcule et comment la validation manuelle s'y superpose."
sidebar:
  order: 2
---

## Ce que c'est

Depuis octobre 2026, Druid ne range plus les personnes en « Interne / Externe ». Ce statut
mélangeait trois questions différentes. Chaque fiche porte désormais **trois informations
indépendantes** :

| Information | Valeurs | Ce qui fait foi |
|---|---|---|
| **Présence** dans l'unité | **Présent**, **Départ** (fin annoncée), **Parti** | Les dates de fin, les listes validées et, pour le personnel de l'établissement, l'annuaire LDAP |
| **Employeur** | L'établissement, un autre organisme (CNRS, Inserm, CHU, autre école…) ou non renseigné | Le champ **Employeur** de la fiche |
| **Compte LDAP** de l'établissement | Actif, en fermeture, aucun | L'annuaire LDAP, tel quel |

Exemple : une chercheuse CNRS hébergée dans un laboratoire de l'université est **Présente**,
son employeur est le **CNRS**, et elle a un **compte LDAP actif**. Ces trois informations ne
se contredisent plus.

Le raccourci **Personnels internes** de la liste combine deux de ces informations :
**présents** et **employés par l'établissement**.

:::note[Selon votre instance]
La présence et la validation dépendent de la fonction « Statuts et validation manuelle ».
Sur une instance où elle est désactivée, elles n'apparaissent pas. Le compte LDAP n'apparaît
que sur une instance reliée à un annuaire LDAP. Voir
[Instances et fonctionnalités](/donnees/instances-fonctionnalites/).
:::

## Présent, Départ, Parti : ce que veut dire chaque statut

La **présence**, qui tient lieu de l'ancien statut, prend trois valeurs :

| Présence | Signification |
|---|---|
| **Présent** | Membre de l'unité. |
| **Départ** | Encore là, mais son départ est annoncé. |
| **Parti** | N'est plus là : fin de contrat passée, compte supprimé, retraite… |

## L'employeur

L'employeur vient du champ **Employeur** de la fiche, saisi dans Druid ou repris d'une liste
(laboratoire, ressources humaines). L'annuaire LDAP ne le donne pas directement : il indique
l'établissement pour tous les comptes, y compris ceux des chercheurs d'organismes hébergés.
Druid en déduit toutefois l'employeur dans les cas sûrs, par exemple à la création d'une fiche
avec **Remplir depuis le LDAP** :

- personnel titulaire ou contractuel de l'établissement avec un corps connu : **l'établissement** ;
- compte ouvert par l'outil d'hébergement du CNRS : **CNRS** ;
- comptes hébergés pour un autre organisme, PU-PH, vacataires : **non déduit**, à saisir.

## Le compte LDAP

Une fiche a un compte LDAP quand son **uid** est un vrai identifiant de l'annuaire (pas un uid
fictif `ext_…`) et que l'annuaire le connaît :

| Compte | Signification |
|---|---|
| **Actif** | Le compte existe et fonctionne. |
| **En fermeture** | L'annuaire annonce sa fermeture (départ programmé, fin d'hébergement). |
| **Aucun** | Pas d'uid, uid fictif `ext_…`, ou compte inconnu de l'annuaire. |

Une fiche `ext_…` dont la personne a en fait un compte (repérée par son n° agent) reçoit une
tâche **Passer à l'uid LDAP**. Voir
[Les tâches à traiter](/guides/personnes/taches-a-traiter/).

## Comment la présence est calculée

Druid applique les règles suivantes, dans cet ordre.

### 1. Le départ certain

Si la **fin d'emploi** et la **fin d'appartenance** au laboratoire sont toutes les deux
renseignées **et passées**, la personne est **Partie**, quoi que disent l'annuaire LDAP et même
la validation. Une date saisie à l'année seule (`2026`) n'est « passée » qu'une fois l'année
entière écoulée, soit à partir du 1er janvier 2027.

### 2. La validation manuelle

Si la fiche a été **validée** pour le statut, la présence validée l'emporte sur les règles
suivantes. Voir [Validation manuelle](#validation-manuelle).

### 3. La retraite

Une personne classée **retraitée** par les ressources humaines, **sans trace d'éméritat**, est
**Partie**. Voir [Émérites et retraités](#émérites-et-retraités).

### 4. L'annuaire LDAP, pour le personnel de l'établissement

Quand l'employeur est l'établissement ou n'est pas renseigné, et que la fiche a un vrai uid :

| Ce que dit l'annuaire LDAP | Présence |
|---|---|
| Compte actif | **Présent** (sauf règle 5) |
| Départ programmé (compte en fermeture) | **Départ** |
| Le compte n'existe plus | **Parti** |

Pour **un autre employeur**, l'annuaire LDAP ne compte pas : un compte hébergé qui ferme
signale souvent la fin d'une convention d'hébergement, pas un départ du laboratoire. Druid
crée alors une tâche **Compte LDAP hébergé en fermeture : départ probable ?** pour qu'une
personne vérifie.

### 5. Les dates de fin d'emploi

- Fin d'emploi **passée** : **Parti**.
- Fin d'emploi dans les **3 prochains mois** : **Départ** (fin annoncée). Pour une date
  imprécise, c'est la fin de la période qui compte : `2027` n'est une fin annoncée qu'à partir
  d'octobre 2027.

### 6. Sinon

La personne est **Présente**.

:::note[Pour aller plus loin]
Règles implémentées dans `lib/presence.ts` (présence, compte LDAP, employeur),
`lib/validation.ts` (validation), `lib/emeritus.ts` (éméritat), `lib/dates.ts` (dates) et
`lib/ldapEmployer.ts` (employeur déduit du LDAP) du dépôt Druid.
:::

## Émérites et retraités

L'éméritat peut apparaître à plusieurs endroits : le grade, le type d'emploi, la catégorie de
l'annuaire LDAP. Dès qu'une de ces sources indique un éméritat, Druid attribue un **grade
d'émérite** d'après le corps d'origine :

| Corps d'origine | Grade d'émérite |
|---|---|
| Maître de conférences (MCF, MCF hors classe, MCU-PH) | **MCFEM** |
| Directeur de recherche (DR, DR1, DR2, DRCE) | **DREM** |
| Tous les autres (professeurs, PU-PH, chargés de recherche, corps inconnu) | **PREM** |

Un émérite garde la présence que lui donne l'annuaire LDAP (le plus souvent **Présent**). À
l'inverse, un **retraité sans éméritat** passe en **Parti**.

## Validation manuelle

Les sources automatiques sont imparfaites : l'annuaire LDAP est mis à jour avec retard, les
dates d'emploi des personnes extérieures sont incomplètes. Quand on dispose d'une information
sûre (une liste envoyée par un laboratoire, une vérification directe), on **valide la fiche**.

Une validation enregistre :

- ce qu'elle couvre : le **statut** (la présence), le **rattachement**, ou les deux ;
- la **présence validée** : Présent, Départ ou Parti ;
- la **source** (par exemple « Liste du labo, juin 2026 ») et la **date** ;
- l'auteur de la validation.

La validation ne porte **pas** sur l'employeur : pour dire qu'une personne relève du CNRS, on
renseigne son employeur. Les validations « Interne » et « Externe » enregistrées avant octobre
2026 valent toutes deux **Présent**.

Elle se fait fiche par fiche (**Valider la fiche** sur la fiche chercheur) ou en masse
(**Importer une liste fiabilisée**, menu **Synchroniser** de Personnel). Voir
[Corriger le statut ou le rattachement](/guides/personnes/fiabiliser-statut-rattachement/).

### Les pastilles de validation

| Pastille | Signification |
|---|---|
| **Validé** | La fiche est validée ; la source et la date s'affichent au survol. |
| **Périmé** | La validation a plus de **18 mois** : elle s'applique toujours, mais il faut la revoir. |
| **Validé — conflit** | Le calcul automatique donne une autre présence que la présence validée (par exemple, l'annuaire LDAP annonce un départ). La présence affichée reste la présence validée : à vous d'arbitrer. |

### Pourquoi c'est important

Les fiches validées sont celles qui comptent comme **membres** d'un laboratoire dans le tableau
de bord (périmètre *Effectifs*, voir
[Publications et attribution](/donnees/publications-attribution/#les-deux-périmètres-du-tableau-de-bord)).
Une fiche non validée n'est pas prise en compte dans ce périmètre.

## Exemple

Une chercheuse CNRS travaille dans un laboratoire de l'université et y a un compte actif. Sa
fiche indique l'employeur « CNRS » : elle est **Présente**, employeur **CNRS**, compte LDAP
**actif**. Son compte hébergé passe ensuite en fermeture : sa présence ne change pas, mais une
tâche demande de vérifier auprès du laboratoire. Le laboratoire confirme son départ : on
renseigne sa fin d'emploi et sa fin d'appartenance, et elle passe en **Partie** (règle 1).

## Limites connues

- **L'employeur doit être renseigné** : une fiche sans employeur suit l'annuaire LDAP comme le
  personnel de l'établissement, et n'entre pas dans le raccourci **Personnels internes**.
- **Le retard de l'annuaire LDAP** : un départ n'y apparaît parfois qu'après plusieurs mois.
  Pendant ce temps, la personne reste Présente, sauf validation ou dates de fin renseignées.
- **Les personnes extérieures sans date de fin** restent Présentes indéfiniment : seule une
  date de fin d'emploi (ou une validation) les fait passer en Parti.
- **Une validation ne se met pas à jour seule** : si la situation change, la fiche validée
  garde sa présence jusqu'à ce qu'on la revoie. La pastille **Validé — conflit** signale les
  cas où l'annuaire LDAP dit autre chose.
- **Les dates de fin passées l'emportent sur tout** : une fin d'emploi et une fin
  d'appartenance saisies par erreur dans le passé font passer la fiche en Parti, même validée.

## Comment signaler une erreur

Une présence ou un employeur vous semble faux ? Vérifiez d'abord l'employeur et les dates de la
fiche, puis voir [Où corriger quoi](/guides/corriger/ou-corriger-quoi/). Pour une erreur de
l'annuaire LDAP, c'est le service des ressources humaines qui corrige.
