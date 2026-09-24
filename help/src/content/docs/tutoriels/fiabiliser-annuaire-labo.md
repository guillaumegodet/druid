---
title: "Fiabiliser l'annuaire d'un laboratoire avant l'envoi à CRISalid"
description: "Parcours complet : statuts, rattachements, doublons, identifiants, puis export vers SoVisu+."
sidebar:
  order: 1
---

:::note[En bref]
- **Objectif :** que la liste des membres d'un laboratoire soit juste (qui est là, dans
  quelle équipe, avec quels identifiants) avant de l'envoyer à CRISalid, qui moissonnera
  leurs publications.
- **Pour qui :** services centraux, avec un administrateur Druid pour les doublons.
- **Durée :** une demi-journée pour un laboratoire de 100 personnes, plus le temps de
  réponse du laboratoire.
- **Il vous faut :** une liste des membres à jour, fournie par le laboratoire (direction ou
  gestion), idéalement avec e-mail ou identifiant de compte.
:::

CRISalid moissonne les publications **des personnes que Druid lui transmet**, avec **leurs
identifiants**. Une personne partie restée « Interne », une personne présente absente de
l'annuaire, un ORCID manquant : autant de publications perdues ou mal attribuées. Ce parcours
enchaîne les guides dans le bon ordre.

## Étape 1 — Faire l'état des lieux

1. Dans **Personnel**, filtrez sur le laboratoire (**Labo (affil. principale)**).
2. Notez le nombre de fiches, puis passez en vue **Dataviz** : répartition par statut,
   couverture des identifiants. Gardez ces chiffres : ils serviront à mesurer le progrès.
3. Filtrez **Validation › Non validé** : ce sont les fiches à traiter en priorité.

Voir [Rechercher et filtrer les personnels](/guides/personnes/rechercher-filtrer/).

## Étape 2 — Régler les doublons

Une personne présente deux fois fausse tous les comptes. Dans **Personnel › À traiter ›
Doublons**, traitez les groupes du laboratoire :

- **Même labo** et **Parking** : fusionnez ;
- **Plusieurs labos** : qualifiez (concomitant ou successif).

Voir [Traiter un doublon](/guides/personnes/traiter-un-doublon/). Réservé aux administrateurs
Druid : sinon, transmettez la liste au [support](/guides/support/).

## Étape 3 — Relier les fiches à l'annuaire de l'établissement

*Si votre instance est reliée à un annuaire LDAP.*

1. **Outils d'alignement › Alignement LDAP › Rechercher manquants** : rattachez les fiches
   sans uid à leur compte.
2. **Vérifier les existants** : reportez les changements de l'annuaire (grades, dates) et
   regardez les **Orphelins** du laboratoire : ce sont souvent des départs.

Voir [Aligner avec l'annuaire LDAP](/guides/identifiants/aligner-ldap/).

## Étape 4 — Confronter à la liste du laboratoire

Comparez la liste du laboratoire à celle de Druid, personne par personne :

| Situation | Que faire |
|---|---|
| Présente dans les deux, fiche correcte | Rien : elle sera validée à l'étape 5. |
| Présente dans Druid, **partie** d'après le labo | Renseignez **fin d'appartenance** et **fin d'emploi** (bouton **→ fin d'emploi**). |
| Présente dans Druid, **employée par un organisme** (CNRS, Inserm…) | Renseignez l'**Établissement employeur** : elle deviendra Externe. |
| Mauvaise **équipe** ou mauvais **rattachement principal** | Corrigez la carte **Appartenances & historique**. |
| Absente de Druid | Demandez la création de sa fiche (bouton **Nouveau**, administrateurs techniques). |

Une date approximative suffit : `2025` ou `2025-09` (voir
[Saisir des dates imprécises](/guides/personnes/dates-imprecises/)).

## Étape 5 — Valider les fiches

Une fois les fiches corrigées, validez-les **avec la liste du laboratoire comme source** :

- en masse avec **Personnel › Synchroniser › Importer une liste fiabilisée** (source :
  « Liste du labo, septembre 2026 », portée : statut et rattachement) ;
- ou fiche par fiche avec **Valider la fiche**.

Traitez à la main les **homonymes** et les **non trouvés** signalés par l'import. Voir
[Corriger le statut ou le rattachement](/guides/personnes/fiabiliser-statut-rattachement/).

:::tip[Point de contrôle]
Filtrez de nouveau le laboratoire avec **Validation › Non validé** : il ne doit rester que
des fiches volontairement écartées (anciens membres, par exemple).
:::

## Étape 6 — Compléter les identifiants

Suivez le tutoriel [Compléter les identifiants d'un laboratoire de A à Z](/tutoriels/identifiants-labo-a-z/).
C'est l'étape la plus longue, mais la plus utile pour CRISalid : sans identifiant, une
personne n'est retrouvée que par son nom.

## Étape 7 — Envoyer à CRISalid

*Si votre instance permet l'export vers CRISalid.*

1. Ouvrez **Administration** et cliquez sur **Synchroniser avec SoVisu+** : Druid régénère
   la liste des chercheurs (identifiants, structure principale, dates) envoyée à CRISalid.
2. Si des structures ont changé, faites de même depuis **Structures › Synchroniser ›
   Synchroniser avec SoVisu+**.

CRISalid prend en compte la nouvelle liste à son prochain passage (en général le lendemain),
puis moissonne les publications au fil des jours.

## Étape 8 — Vérifier le résultat

Quelques jours plus tard :

- dans SoVisu+, les membres du laboratoire apparaissent avec leurs publications ;
- dans le tableau de bord du laboratoire, l'onglet **Sources** montre la part des
  publications trouvées par CRISalid ;
- le périmètre **Effectifs** reconnaît désormais les membres validés (après régénération du
  tableau de bord).

## Récapitulatif

- [ ] Doublons du laboratoire traités
- [ ] Fiches reliées à l'annuaire LDAP (si disponible)
- [ ] Départs, employeurs, équipes et rattachements corrigés
- [ ] Fiches validées avec la liste du laboratoire comme source
- [ ] Identifiants complétés
- [ ] Liste envoyée à CRISalid
- [ ] Résultat vérifié dans SoVisu+ et dans l'onglet Sources

## Et ensuite

La validation vaut **18 mois** : planifiez la même revue chaque année, par exemple à la
rentrée. Les fiches dont la validation est **Périmée** ressortent avec le filtre
**Validation**.

## Voir aussi

- [Statuts des personnes](/donnees/statuts-des-personnes/)
- [Appartenances et rattachement](/donnees/appartenances-rattachement/)
