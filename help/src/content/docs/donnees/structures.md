---
title: "Structures"
description: "Le modèle des structures de recherche : niveaux, identifiants, tutelles, hiérarchie."
sidebar:
  order: 4
---

## Ce que c'est

Une **structure** est une entité de l'organisation de la recherche : un établissement, une
composante, un laboratoire, une équipe. Druid les décrit toutes selon un **modèle commun**
(dit « Structures V2 »), partagé avec CRISalid, pour qu'elles puissent être échangées et
reliées entre elles.

## Les quatre niveaux

| Niveau | Libellé Druid | Exemples |
|---|---|---|
| 4 | **Établissement** | Une université, une école, un organisme |
| 3 | **Structure intermédiaire** | Une faculté, un pôle, un département, une fédération |
| 2 | **Unité** | Un laboratoire (UMR, UR, EA…) |
| 1 | **Équipe** | Une équipe interne à un laboratoire |

## La fiche d'une structure

Elle est organisée en cinq onglets :

| Onglet | Contenu |
|---|---|
| **Identification** | Nom officiel, sigle, description, identifiant local, niveau, type (UMR, UR…), RNSR. Le laboratoire ou la composante parente y sont affichés en lecture seule (voir [la hiérarchie dérivée](#la-hiérarchie-dérivée)). |
| **Identifiants & liens** | UAI, ROR, ISNI, Wikidata, identifiant Scopus, collection HAL, site web, signature bibliographique. |
| **Missions & thématiques** | Mission principale et secondaire, campus, panel ERC, domaines HCÉRES. |
| **Appartenances** | Inclusions et participations (dont les tutelles), avec leurs dates. |
| **Cycle de vie et filiation** | Statut, dates de création et de fermeture, liens avec les structures qui l'ont précédée ou suivie. |

## Les identifiants

| Identifiant | Ce que c'est |
|---|---|
| **Identifiant local** | L'identifiant de la structure dans le référentiel de l'établissement. C'est le seul identifiant **pivot** : il relie personnes, structures et CRISalid. Il ne se modifie pas. |
| **RNSR** | Répertoire national des structures de recherche (ministère). |
| **UAI** | Code des établissements (ministère), utilisé pour les tutelles et les employeurs. |
| **ROR** | *Research Organization Registry*, identifiant international des organismes. |
| **ISNI**, **Wikidata**, **Scopus** | Autres référentiels, utiles pour l'interopérabilité et la bibliométrie. |
| **Collection HAL** | Le portail ou la collection HAL de la structure. |

La **signature bibliographique** est la forme d'affiliation que les membres de la structure
doivent utiliser dans leurs publications.

## Tutelles, inclusions et participations

Druid distingue deux sortes de liens entre structures, dans l'onglet **Appartenances**.
Une structure se choisit dans la base, ou s'ajoute par son code UAI ou son identifiant ROR
quand elle est extérieure (un organisme partenaire, par exemple).

- une **inclusion** est une appartenance **forte** : la structure fait partie de sa
  structure parente (une équipe dans son laboratoire, un laboratoire dans son pôle) ;
- une **participation** est un lien plus **faible** : les tutelles d'un laboratoire, sa
  participation à une fédération ou à un réseau.

Parmi les tutelles, la **tutelle principale** est l'établissement de référence ; les autres
sont des **tutelles associées** ou de simples **participations**.

## La hiérarchie dérivée

La liste **Structures** affiche pour chaque équipe son laboratoire, et pour chaque
laboratoire sa structure intermédiaire. Ce **parent** n'est pas saisi séparément : Druid le
**déduit des inclusions**.

- Pour une équipe (niveau 1), le parent est la première unité (niveau 2) dans laquelle elle
  est incluse.
- Pour une unité (niveau 2), c'est la première structure intermédiaire (niveau 3).
- Une inclusion **en cours** passe avant une inclusion terminée.

Si aucune inclusion ne permet de trouver le parent, Druid affiche la valeur enregistrée
auparavant, si elle existe.

:::note[Pour aller plus loin]
Règle implémentée dans `lib/structureHierarchy.ts` du dépôt Druid.
:::

## Cycle de vie

| Statut | Signification |
|---|---|
| **Projet** | Structure en préparation, pas encore créée officiellement. |
| **Active** | Structure existante. |
| **En fermeture** | Période de transition avant fermeture. |
| **Fermée** | Structure historique, conservée pour les données passées. |

Quand des laboratoires fusionnent, se scindent ou se succèdent, l'onglet **Cycle de vie et
filiation** garde la trace de ces liens (succession, intégration, fusion, scission).

## D'où viennent les structures

- Sur une instance reliée à un **annuaire LDAP**, les structures de l'établissement peuvent
  être importées et mises à jour depuis cet annuaire (bouton **Importer LDAP** de la liste
  Structures).
- Sinon, elles sont créées et complétées à la main dans Druid.
- Elles peuvent être transmises à CRISalid (bouton **Synchroniser avec SoVisu+**), si votre
  instance le permet.

## Exemple

Une équipe « Signal » est incluse dans le laboratoire « LABO », lui-même inclus dans le pôle
« Sciences et technologies ». Le laboratoire a deux tutelles : l'université (tutelle
principale) et le CNRS (tutelle associée). Dans la liste Structures, l'équipe affiche
« LABO » comme parent, et le laboratoire affiche le pôle.

## Limites connues

- **Une inclusion manquante casse la hiérarchie** : une équipe sans inclusion dans son
  laboratoire n'apparaît pas sous lui (ni dans les filtres par laboratoire).
- **Les structures intermédiaires sont hétérogènes** : faculté, pôle, département ou
  fédération selon les établissements. Le modèle ne les distingue que par leur type.
- **Les unités multi-tutelles** peuvent regrouper des membres d'autres établissements :
  leurs publications ne sont pas toutes des publications de votre établissement (voir
  [Publications et attribution](/donnees/publications-attribution/)).
- **Les identifiants externes ne sont pas vérifiés automatiquement** : un ROR ou un RNSR
  mal saisi n'est pas signalé.

## Comment signaler une erreur

Voir [Consulter et mettre à jour une structure](/guides/structures-groupes/mettre-a-jour-une-structure/)
ou [Où corriger quoi](/guides/corriger/ou-corriger-quoi/).
