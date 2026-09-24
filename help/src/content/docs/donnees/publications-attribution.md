---
title: "Publications et attribution"
description: "Comment une publication est rattachée à un chercheur et à une structure."
sidebar:
  order: 6
---

## Ce que c'est

Le tableau de bord d'une structure repose sur deux opérations :

1. **constituer le corpus** : retrouver les publications de la structure dans les bases
   bibliographiques ;
2. **reconnaître les auteurs** : pour chaque publication, repérer lesquels de ses auteurs
   sont des membres de la structure, et de quelle équipe.

## Comment le corpus est constitué

Pour chaque structure, la chaîne de traitement (ETL) interroge plusieurs sources :

| Source | Comment la structure y est retrouvée |
|---|---|
| **OpenAlex** | Par l'identifiant OpenAlex de la structure : une publication entre si l'un de ses auteurs est affilié à la structure ou à l'une de ses sous-entités. |
| **Baromètre de la science ouverte (BSO)** | Par les identifiants et mots-clés d'affiliation de la structure (RNSR, sigle). |
| **HAL** | Par la collection HAL de la structure. |
| **Graphe CRISalid** | Par les publications moissonnées pour les chercheurs de la structure, grâce à leurs identifiants. |

Les publications qui ont le même DOI sont **fusionnées** ; en cas de désaccord, les données
du BSO priment pour l'accès ouvert.

Une publication est donc dans le corpus parce qu'**au moins un auteur signe avec
l'affiliation de la structure**, ou parce qu'elle a été moissonnée pour un de ses membres.

## Comment les auteurs sont reconnus

La liste des **membres** d'une structure vient de l'annuaire : ce sont les fiches **validées**
de la structure, hors personnes en départ.

Pour chaque auteur d'une publication, Druid compare son nom à ceux des membres : **nom de
famille** et **initiale du prénom**, en tenant compte des particules (*de*, *Le*, *El*…),
des accents et des noms composés. Si plusieurs membres correspondent, la priorité va aux
titulaires, puis aux membres associés, puis aux doctorants.

Un membre reconnu apporte ses **équipes** : une publication est comptée dans **chaque
équipe** de chacun de ses auteurs membres. Une publication écrite par deux équipes compte
donc une fois pour chacune, mais une seule fois pour la structure.

## Les deux périmètres du tableau de bord

En haut du tableau de bord, le sélecteur de périmètre propose deux vues :

| Périmètre | Publications retenues |
|---|---|
| **Affiliation** | Toutes les publications du corpus, c'est-à-dire signées avec l'affiliation de la structure. |
| **Effectifs** | Seulement celles dont **au moins un auteur est reconnu** parmi les membres. Le nombre de publications écartées est indiqué au survol. |

*Affiliation* répond à la question « qu'a publié la structure ? », *Effectifs* à « qu'ont
publié ses membres actuels, sous cette affiliation ? ». Un écart important entre les deux
signale souvent des fiches non validées, des membres absents de l'annuaire, ou des
affiliations erronées dans les bases.

## Fédérations et établissements

Dans OpenAlex, une institution peut être rattachée à plusieurs « parents ». Certaines
fédérations de recherche ou certains laboratoires multi-tutelles y sont rattachés à
**toutes leurs tutelles**, y compris des établissements où ils n'ont presque aucun membre.
Sans précaution, leurs publications seraient comptées pour chacune de ces tutelles.

Druid tient une **liste d'exclusions** : pour ces institutions, le rattachement aux parents
est ignoré, et une publication qui n'a aucun auteur réellement local est écartée du corpus.

Pour les **structures composites** (un établissement qui regroupe plusieurs laboratoires),
chaque publication est aussi attribuée au ou aux laboratoires internes de ses auteurs,
d'après leurs affiliations.

## Collaborations

Le type de collaboration d'une publication se déduit des **co-auteurs** et de leurs
institutions :

| Type | Condition |
|---|---|
| **Intra-structure** | Auteurs de plusieurs laboratoires internes d'une structure composite. |
| **Avec un autre laboratoire de l'établissement** | Un co-auteur d'un autre laboratoire du même établissement. |
| **Nationale** | Un co-auteur d'une institution française hors établissement. |
| **Internationale** | Un co-auteur d'une institution étrangère. |
| **Pas de collaboration** | Un seul auteur, ou uniquement des auteurs de la structure. |

Une publication peut cumuler plusieurs types. Les co-affiliations d'un même auteur à ses
tutelles ne comptent pas comme une collaboration.

## Charte de signature

L'onglet **Charte de signature** compare l'affiliation écrite par les auteurs à la forme
recommandée par l'établissement : mention exacte de l'établissement, nom ou sigle de la
structure, code d'unité, adresse, tutelles requises. Chaque publication reçoit un score ;
elle est **conforme** si l'établissement est mentionné et si le score atteint le seuil
choisi.

## Limites connues

- **Homonymes** : la reconnaissance par nom et initiale peut confondre deux personnes au
  même nom de famille et à la même initiale dans une même structure.
- **Membres non validés** : une fiche non validée n'est pas un membre ; ses publications
  sortent du périmètre *Effectifs*.
- **Anciens membres** : le périmètre *Effectifs* repose sur la liste **actuelle** des
  membres. Les publications d'une personne partie n'y figurent plus, même si elles datent
  de sa présence. Pour un bilan sur plusieurs années, préférez le périmètre *Affiliation*.
- **Affiliations fausses dans OpenAlex** : OpenAlex attribue parfois une publication à la
  mauvaise institution. Ces erreurs peuvent être repérées et signalées depuis la console
  ETL (voir [Une affiliation est fausse](/guides/corriger/affiliation-fausse/)).
- **Laboratoires multi-sites** : une unité à plusieurs tutelles compte aussi les
  publications de ses membres rattachés à d'autres établissements.
- **Publications sans DOI** : plus difficiles à dédoublonner, elles peuvent apparaître deux
  fois si elles viennent de deux sources différentes.

## Comment signaler une erreur

Voir [Une publication manque ou est mal attribuée](/guides/corriger/publication-manquante/)
et [Une affiliation est fausse](/guides/corriger/affiliation-fausse/).
