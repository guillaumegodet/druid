---
title: "Préparer le volet bibliométrique d'un bilan"
description: "Parcours complet pour un rapport HCERES ou un rapport d'activité : périmètre, indicateurs, exports."
sidebar:
  order: 2
---

:::note[En bref]
- **Objectif :** produire les chiffres, les graphiques et la liste des publications d'une
  unité pour un rapport d'évaluation (HCÉRES) ou un rapport d'activité, en sachant
  expliquer d'où ils viennent.
- **Pour qui :** direction ou gestion de laboratoire, services centraux.
- **Durée :** une demi-journée, plus le délai d'une éventuelle régénération du tableau de
  bord.
- **Il vous faut :** la période du bilan (par exemple les cinq dernières années) et, pour
  les ratios, l'effectif de recherche en ETP.
:::

## Étape 1 — Préparer les données (deux à trois semaines avant)

Les chiffres ne valent que ce que valent l'annuaire et les affiliations :

1. **Annuaire** : les membres de l'unité sont-ils à jour et validés ? Sinon, voir
   [Fiabiliser l'annuaire d'un laboratoire](/tutoriels/fiabiliser-annuaire-labo/).
2. **HAL** : les publications de la période sont-elles déposées dans la collection de
   l'unité, avec la bonne affiliation ? C'est souvent la seule source des ouvrages et des
   chapitres.
3. **Régénération** : demandez à l'équipe technique de régénérer le tableau de bord de
   l'unité une fois ces corrections faites, et, si vous voulez les ratios de production,
   de renseigner l'**ETP recherche** (voir [Piloter la console ETL](/guides/administration/console-etl/)).

## Étape 2 — Régler le tableau de bord

1. Ouvrez le **Tableau de bord** de l'unité.
2. Réglez la **période** du bilan.
3. Choisissez le **périmètre** :

| Question du bilan | Périmètre |
|---|---|
| « Qu'a publié l'unité pendant la période ? » (cas habituel d'un bilan HCÉRES) | **Affiliation** : toutes les publications signées par l'unité, y compris celles des membres partis depuis. |
| « Que publient les membres actuels sous l'affiliation de l'unité ? » | **Effectifs** : seulement les publications d'au moins un membre actuel. |

4. **Copier le lien** : gardez l'adresse de cette vue dans vos notes, pour retrouver
   exactement les mêmes réglages.

## Étape 3 — Relever les chiffres clés

| Onglet | À relever | À savoir |
|---|---|---|
| **Vue d'ensemble** | Nombre de publications par an et par type, part en accès ouvert, collaborations internationales, ratios par ETP | Comptage entier : une copublication de deux unités compte pour chacune. |
| **Impact et citations** | FWCI moyen, part dans le top 10 % et le top 1 % | Instable sur les publications récentes et les petits effectifs. |
| **Revues** | Principales revues, répartition par quartile SJR | Un seul classement SCImago pour toutes les années. |
| **Ouvrages** | Livres et chapitres | Couverture incomplète hors HAL. |
| **Collaborations** | Partenaires nationaux et internationaux | Voir [Analyser les collaborations](/guides/tableau-de-bord/collaborations/). |
| **Charte de signature** | Taux de conformité des affiliations | Utile pour un plan d'action sur la signature. |

La définition de chaque indicateur et ses limites sont dans [Indicateurs](/donnees/indicateurs/) :
reprenez-les dans la partie « méthodologie » de votre rapport. Le bouton **Méthodologie** de
chaque graphique donne aussi sa description et ses limites.

## Étape 4 — Vérifier la liste des publications

1. Ouvrez **Liste des publications** et **Exporter en CSV (résultats filtrés)**.
2. Faites relire la liste par l'unité : publications manquantes, publications qui ne sont
   pas de l'unité.
3. Pour chaque écart, voir [Une publication manque ou est mal attribuée](/guides/corriger/publication-manquante/).

:::caution
Si des corrections importantes sont faites (dépôts HAL, affiliations OpenAlex), il faut
**régénérer** le tableau de bord avant de relever les chiffres définitifs.
:::

## Étape 5 — Produire les livrables

- **Rapport PDF** : composez un rapport avec les graphiques utiles, sur la période et le
  périmètre choisis (voir [Exporter](/guides/tableau-de-bord/exporter/)).
- **Graphiques isolés** : **Télécharger en PNG** depuis la barre d'outils de chaque
  graphique, pour les insérer dans le rapport.
- **Liste des publications** : le CSV de l'étape 4, relu.

## Étape 6 — Documenter

Dans le rapport, précisez :

- la **date** d'extraction et la **période** ;
- le **périmètre** (Affiliation ou Effectifs) ;
- les **sources** (OpenAlex, Baromètre de la science ouverte, HAL, CRISalid) et le
  **comptage entier** ;
- les limites connues des indicateurs utilisés.

## Récapitulatif

- [ ] Annuaire de l'unité fiabilisé, dépôts HAL vérifiés
- [ ] Tableau de bord régénéré (et ETP renseigné pour les ratios)
- [ ] Période et périmètre choisis, lien de la vue conservé
- [ ] Chiffres clés relevés avec leurs limites
- [ ] Liste des publications relue par l'unité
- [ ] Rapport PDF et graphiques exportés
- [ ] Méthodologie documentée

## Voir aussi

- [Publications et attribution](/donnees/publications-attribution/)
- [Choisir une structure, une période, un périmètre](/guides/tableau-de-bord/structure-periode-perimetre/)
