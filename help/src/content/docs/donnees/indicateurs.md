---
title: "Indicateurs"
description: "Définition et calcul des indicateurs du tableau de bord : FWCI, top 1 % et 10 %, quartiles, accès ouvert, APC."
sidebar:
  order: 7
---

## Ce que c'est

Cette page définit les indicateurs du tableau de bord et dit **sur quelles publications**
ils sont calculés. Tous s'appliquent à la **période** et au **périmètre** choisis en haut
du tableau de bord (voir
[Publications et attribution](/donnees/publications-attribution/#les-deux-périmètres-du-tableau-de-bord)).

## Comptage

Druid pratique le **comptage entier** : une publication compte pour **1** dans la structure,
quel que soit le nombre de ses auteurs ou de ses laboratoires. Il n'y a pas de comptage
fractionnaire.

- Une publication cosignée par deux équipes compte **1 pour chaque équipe**, et **1** pour
  la structure (pas 2).
- Une publication cosignée par deux laboratoires de l'établissement compte **1 pour chacun
  des deux** : la somme des laboratoires dépasse donc le total de l'établissement.

## Volume et profil

| Indicateur | Définition |
|---|---|
| **Publications** | Nombre de publications de la période, tous types confondus. |
| **Types de publication** | Articles, chapitres, ouvrages, communications… selon la typologie des sources. |
| **Citations** | Somme des citations reçues, d'après OpenAlex, à la date de génération du tableau de bord. |
| **Collaborations internationales** | Part des publications avec au moins un co-auteur d'une institution étrangère. |
| **Langue** | Langue de la publication, d'après OpenAlex. |

### Ratios de production

Si l'effectif de recherche en **ETP** (équivalent temps plein recherche) de la structure a
été renseigné, la Vue d'ensemble affiche deux ratios par ETP et par an :

- **RICL** : articles dans des revues indexées par SCImago, utilisées comme approximation
  des « revues internationales à comité de lecture » ;
- **Conférences** : toutes les communications de conférence. Les sources ne distinguent pas
  les conférences nationales et internationales.

## Impact

### FWCI

Le **FWCI** (*Field-Weighted Citation Impact*) rapporte les citations d'une publication à
la moyenne mondiale des publications **du même domaine, du même type et de la même
année**. Il est fourni par OpenAlex.

- **1** = exactement la moyenne mondiale ;
- **2** = deux fois plus cité que la moyenne ;
- **0,5** = deux fois moins.

Le tableau de bord affiche le **FWCI moyen** des publications qui en ont un, et la **part
des publications** pour lesquelles il est connu.

### Top 1 % et top 10 %

Une publication est dans le **top 10 %** (ou **top 1 %**) si elle fait partie des 10 %
(ou 1 %) les plus citées des publications comparables (domaine, année). L'information vient
d'OpenAlex. Les pourcentages sont calculés sur les publications dont l'impact est connu.

Référence : dans une structure « moyenne », 10 % des publications sont dans le top 10 % et
1 % dans le top 1 %.

### Quartiles des revues

Le **quartile SJR** classe une revue dans sa discipline selon le classement **SCImago** :
**Q1** pour le quart le mieux classé, **Q4** pour le moins bien classé. Druid retient le
meilleur quartile de la revue, toutes disciplines confondues, et le rattache à l'article
par son ISSN.

## Accès ouvert

Le statut d'accès ouvert vient du **Baromètre de la science ouverte** (d'après Unpaywall)
quand la publication y figure, sinon d'**OpenAlex**.

| Statut | Signification |
|---|---|
| **Diamant** | Revue en accès ouvert sans frais de publication. |
| **Doré** (gold) | Revue entièrement en accès ouvert, en général avec APC. |
| **Hybride** | Article en accès ouvert dans une revue sur abonnement, en général contre APC. |
| **Bronze** | Lisible gratuitement sur le site de l'éditeur, sans licence ouverte. |
| **Vert** (green) | Accessible uniquement grâce à un dépôt en archive ouverte (HAL, etc.). |
| **Fermé** | Aucune version accessible trouvée. |
| **Inconnu** | Statut non déterminé (souvent sans DOI). |

## APC

Les **APC** (*Article Processing Charges*) sont les frais payés à un éditeur pour publier
en accès ouvert. L'onglet **Suivi des APC** les présente sous trois angles :

| Sous-onglet | Source | Ce qu'il mesure |
|---|---|---|
| **Estimation OpenAlex** | OpenAlex | Prix catalogue de la revue, ou montant payé quand il est connu. Une **estimation** : OpenAlex ne dit pas qui a payé. |
| **Accords éditeurs** | Rapports des éditeurs (accords transformants) | Articles publiés dans le cadre d'un accord négocié, déclenché par l'auteur correspondant. |
| **Dépenses réelles** | OpenAPC | Montants effectivement déclarés par les établissements, s'il y en a. |

Les montants en devises étrangères sont convertis en euros à un taux approximatif.

## Limites connues

- **Dépendance à OpenAlex** : FWCI, top 1 %/10 %, citations et APC estimées viennent
  d'OpenAlex. Leur couverture est bonne pour les articles à DOI, faible pour les ouvrages et
  les publications en sciences humaines et sociales.
- **Publications récentes** : le FWCI et les tops sont instables pour les publications de
  moins de deux ou trois ans, qui ont eu peu de temps pour être citées.
- **Petits effectifs** : sur quelques dizaines de publications, une seule publication très
  citée fait varier fortement le FWCI moyen. À interpréter avec prudence pour une équipe.
- **Quartiles** : un seul classement SCImago est utilisé pour toutes les années ; une revue
  qui a changé de quartile est classée d'après ce classement. Les revues absentes de
  SCImago n'ont pas de quartile.
- **Statut d'accès ouvert** : il évolue dans le temps (dépôts tardifs dans HAL) et n'est
  mis à jour qu'à la régénération du tableau de bord.
- **APC** : l'estimation OpenAlex surestime les dépenses réelles (prix catalogue, remises
  et accords non pris en compte) et ne dit pas qui a payé.
- **Comptage entier** : il avantage les structures qui cosignent beaucoup. Il ne permet pas
  d'additionner les résultats de plusieurs structures.

## Comment signaler une erreur

Un indicateur vous semble faux ? Vérifiez d'abord le périmètre et la période choisis, puis
la liste des publications concernées (onglet **Liste des publications**). Voir ensuite
[Une publication manque ou est mal attribuée](/guides/corriger/publication-manquante/) ou
le [Support](/guides/support/).
