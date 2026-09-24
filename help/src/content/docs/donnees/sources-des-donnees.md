---
title: "D'où viennent les données"
description: "Les sources de Druid (annuaire, Grist, OpenAlex, BSO, HAL, IdRef, SJR…) et leur fréquence de mise à jour."
sidebar:
  order: 1
---

## Ce que c'est

Druid rassemble des données venues de plusieurs systèmes. Savoir d'où vient une information
permet de comprendre **pourquoi elle est ce qu'elle est**, **quand elle change** et **où la
corriger**.

## Schéma des flux

```
 Annuaire LDAP ─┐                            ┌─► Export vers CRISalid ─► moissonnage
 (si relié)     │                            │   (chercheurs, structures,   des publications
                ▼                            │    identifiants)
 Saisies ──► ANNUAIRE (Grist) ◄──► DRUID ────┤
 dans Druid     ▲                            │
                │                            └─► Tableau de bord ◄── ETL bibliométrique
 IdRef, ORCID, ─┘                                                     (OpenAlex, BSO, HAL,
 HAL, OpenAlex,                                                        graphe CRISalid,
 Scopus (candidats)                                                    SJR)
```

## Les personnes et les structures

| Source | Ce qu'elle apporte | Mise à jour |
|---|---|---|
| **Annuaire (Grist)** | Les fiches des personnes et des structures. C'est la **source de vérité** : tout ce que vous modifiez dans Druid y est écrit immédiatement. | En continu |
| **Annuaire LDAP** de l'établissement (si votre instance y est reliée) | État du compte, grade, employeur, dates d'emploi, structures de l'établissement. | À chaque synchronisation lancée depuis Druid, après revue des différences |
| **Listes fiabilisées** | Listes transmises par les laboratoires, importées pour valider des fiches en masse. | À la demande |

Druid ne recopie pas aveuglément l'annuaire LDAP : une synchronisation affiche d'abord les
différences, et les fiches validées à la main sont protégées (voir
[Statuts des personnes](/donnees/statuts-des-personnes/)).

## Les identifiants chercheurs

| Source | Mise à jour |
|---|---|
| **IdRef** (ABES), **ORCID**, **HAL** | Recherches lancées à la demande, par laboratoire ou par groupe |
| **OpenAlex** | Recherche des manquants et vérification des profils existants, relancées régulièrement (selon la configuration de l'instance) |
| **Scopus** (Elsevier) | À la demande, dans la limite des quotas hebdomadaires de l'API |

Les candidats trouvés ne sont écrits qu'après validation : voir
[Identifiants chercheurs](/donnees/identifiants-chercheurs/).

## Les publications et les indicateurs

Les tableaux de bord sont calculés par une chaîne de traitement (l'**ETL bibliométrique**)
qui interroge, pour chaque structure :

| Source | Ce qu'elle apporte |
|---|---|
| **OpenAlex** | Base ouverte mondiale : publications, auteurs, institutions, citations, FWCI, thématiques, APC catalogue. |
| **Baromètre de la science ouverte (BSO)** | Publications françaises à DOI et leur statut d'accès ouvert (via Unpaywall). Prioritaire en cas de doublon. |
| **HAL** | Dépôts de la collection HAL de la structure, y compris sans DOI. |
| **Graphe CRISalid** | Publications moissonnées pour les chercheurs de la structure à partir de leurs identifiants. |
| **SCImago (SJR)** | Quartile des revues. |
| **OpenAPC** | Dépenses d'APC réellement déclarées par les établissements. |

Les publications en double (même DOI) sont fusionnées.

**Fréquence** : un tableau de bord est **régénéré à la demande** par l'équipe technique
(console ETL), en général après une mise à jour des effectifs ou à l'approche d'un bilan.
Entre deux régénérations, les chiffres ne bougent pas, même si les sources évoluent : en cas
de doute sur la fraîcheur d'un tableau de bord, demandez la date de la dernière génération
au [support](/guides/support/).

La veille (onglet **Veille**) est alimentée chaque jour par la collecte des mentions dans
les médias.

## L'onglet Sources du tableau de bord

L'onglet **Sources** compare, pour la structure affichée, les publications trouvées par le
moissonneur CRISalid (à partir des identifiants des chercheurs) et celles trouvées par
l'ETL (BSO, OpenAlex, HAL). Il sert à repérer :

- les publications que CRISalid ne trouve pas, souvent parce qu'il **manque un
  identifiant** à un chercheur ;
- les bases par lesquelles CRISalid trouve ses publications (HAL, ScanR, IdRef/Sudoc,
  OpenAlex, Scopus) ;
- les sources qui couvrent mal une discipline (par exemple les ouvrages en sciences
  humaines, souvent absents d'OpenAlex).

## Limites connues

- **Décalage entre les sources** : une personne peut être partie dans l'annuaire LDAP et
  toujours présente dans un tableau de bord qui n'a pas été régénéré.
- **Couverture inégale** : OpenAlex et le BSO couvrent bien les articles à DOI, moins bien
  les ouvrages, chapitres et communications sans DOI ; HAL dépend des dépôts faits par les
  chercheurs.
- **Délais des bases externes** : une publication récente peut mettre plusieurs semaines à
  apparaître dans OpenAlex ou le BSO.
- **Fonctions selon l'instance** : l'annuaire LDAP, la relance des recherches et l'export
  vers CRISalid n'existent pas sur toutes les instances (voir
  [Instances et fonctionnalités](/donnees/instances-fonctionnalites/)).

## Comment signaler une erreur

Voir [Où corriger quoi](/guides/corriger/ou-corriger-quoi/) : selon la source d'une erreur,
la correction se fait dans Druid, dans l'annuaire LDAP, dans HAL ou dans une base externe.
