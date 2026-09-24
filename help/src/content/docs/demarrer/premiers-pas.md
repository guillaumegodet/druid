---
title: "Premiers pas selon votre profil"
description: "Ce que vous voyez et pouvez faire dans Druid selon votre profil : membre ou direction de labo, services centraux, administration."
sidebar:
  order: 2
---

Druid n'affiche pas la même chose à tout le monde. Ce que vous voyez dépend de deux
choses : **votre profil** (les droits attribués à votre compte) et **votre instance** (les
fonctions activées dans le Druid de votre établissement, voir
[Instances et fonctionnalités](/donnees/instances-fonctionnalites/)).

## Comment votre profil est déterminé

Vous vous connectez avec le compte de votre établissement. Druid lit alors les droits
associés à ce compte :

- **sans droit particulier**, vous êtes *membre d'un laboratoire* : Druid retrouve votre
  laboratoire grâce à **votre propre fiche** dans l'annuaire. Si vous n'avez pas de fiche,
  ou si elle n'indique pas de laboratoire, vous ne verrez aucune donnée ;
- **avec un droit attribué** par un administrateur (direction de labo, services centraux,
  administration…), votre périmètre est celui de ce droit.

Les droits se cumulent : on peut par exemple être à la fois administrateur et chargé·e de
communication.

## Membre d'un laboratoire

Vous voyez les données **de votre ou vos laboratoires** :

- **Personnel** : la liste des membres de votre labo, leurs fiches, les graphiques ;
- **Tableau de bord** : les publications et indicateurs de votre labo.

Par où commencer :

1. Ouvrez **Personnel** et vérifiez [votre propre fiche](/guides/personnes/lire-une-fiche/) :
   statut, laboratoire, équipe, identifiants.
2. Ouvrez le **Tableau de bord** et parcourez la **Vue d'ensemble** de votre labo
   ([choisir une structure, une période, un périmètre](/guides/tableau-de-bord/structure-periode-perimetre/)).
3. Une erreur ? Voir [Où corriger quoi](/guides/corriger/ou-corriger-quoi/).

## Direction ou gestion de laboratoire

Même périmètre que les membres (vos laboratoires), mais **attribué explicitement** : il ne
dépend pas de votre propre fiche. C'est le profil des directions d'unité et des
gestionnaires qui suivent un ou plusieurs labos.

Par où commencer :

1. Dans **Personnel**, parcourez la liste de votre labo et repérez les fiches à corriger
   (personnes parties, équipe manquante) : voir
   [Corriger le statut ou le rattachement](/guides/personnes/fiabiliser-statut-rattachement/).
2. Dans le **Tableau de bord**, comparez les périmètres **Affiliation** et **Effectifs**
   pour vérifier que les publications de vos membres sont bien reconnues.
3. Pour un bilan : [Préparer le volet bibliométrique d'un bilan](/tutoriels/bilan-bibliometrique/).

## Services centraux

Direction de la recherche, bibliothèques, pilotage, vice-présidences : vous voyez **tout
l'établissement**. En plus de Personnel et du Tableau de bord, vous avez accès à :

- **Structures** : la description des laboratoires, équipes et composantes ;
- **Outils d'alignement** : la complétion des identifiants chercheurs (IdRef, ORCID, HAL,
  OpenAlex, Scopus) et, selon l'instance, l'alignement avec l'annuaire LDAP.

Par où commencer :

1. [Aligner les identifiants d'un labo](/guides/identifiants/aligner-les-identifiants/).
2. [Fiabiliser l'annuaire d'un laboratoire](/tutoriels/fiabiliser-annuaire-labo/), le
   parcours complet.

## Administrateurs Druid

Tout ce que voient les services centraux, plus :

- **Groupes** : créer des sélections de chercheurs et leur tableau de bord ;
- **À traiter** (dans Personnel) : les doublons à fusionner et les tâches de correction à
  faire hors de Druid (le bouton n'apparaît que si vous êtes aussi administrateur
  technique) ;
- **Signaler une correction** sur une fiche ;
- **Administration › Gestion des droits** (consultation), si votre instance le permet.

Voir [Traiter un doublon](/guides/personnes/traiter-un-doublon/) et
[Donner des droits](/guides/administration/donner-des-droits/).

## Administrateurs techniques

Profil réservé à l'équipe qui exploite Druid : **console ETL** (régénération des tableaux
de bord), onglets masqués du tableau de bord. Cumulé avec un droit sur tout
l'établissement, il donne aussi le menu **Synchroniser** de Personnel (dont **Importer une
liste fiabilisée**, pour valider d'un coup les fiches d'un labo à partir d'une liste sûre)
et le bouton **Nouveau** (créer une fiche). Voir [Piloter la console ETL](/guides/administration/console-etl/).

## Chargé·es de communication

Accès à **Administration › Sources médias**, pour choisir les médias suivis par la veille,
et à l'onglet **Veille** du tableau de bord. Voir
[Gérer les sources médias](/guides/veille/sources-medias/).

## Demander un accès supplémentaire

Si une rubrique vous manque ou si vous ne voyez pas le bon laboratoire :

1. Vérifiez d'abord **votre fiche** dans Personnel : un profil labo dépend du laboratoire
   qui y figure.
2. Sinon, demandez le droit adapté à l'administrateur Druid de votre établissement, en
   précisant le ou les laboratoires concernés : voir [Support](/guides/support/).

## Voir aussi

- [Druid en 5 minutes](/demarrer/druid-en-5-minutes/)
- [Instances et fonctionnalités](/donnees/instances-fonctionnalites/) : le détail des droits
