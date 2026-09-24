---
title: "Compléter les identifiants d'un laboratoire de A à Z"
description: "Parcours complet d'alignement IdRef, ORCID, HAL, OpenAlex et Scopus pour une structure."
sidebar:
  order: 3
---

:::note[En bref]
- **Objectif :** que chaque chercheur d'un laboratoire ait ses identifiants IdRef, ORCID,
  IdHAL, OpenAlex et Scopus, et que les erreurs dans les bases externes soient signalées.
- **Pour qui :** services centraux (bibliothèque, direction de la recherche).
- **Durée :** une à deux journées pour un laboratoire de 100 personnes, étalées sur une
  semaine (temps de recherche, quotas des API, réponses des chercheurs).
- **Il vous faut :** un annuaire du laboratoire fiabilisé (voir
  [Fiabiliser l'annuaire d'un laboratoire](/tutoriels/fiabiliser-annuaire-labo/)).
:::

Les identifiants se renforcent les uns les autres : un ORCID trouvé sur une notice IdRef
rend sûr un profil HAL qui porte le même ORCID. L'ordre des sources compte.

## Étape 1 — Mesurer le point de départ

Dans **Personnel**, filtrez le laboratoire et passez en vue **Dataviz** : le graphique
**Couverture des identifiants** donne la part des fiches qui ont chaque identifiant. Notez-la.

## Étape 2 — Vérifier les identifiants existants

Avant de chercher les manquants, assurez-vous que ceux qui existent sont justes.

1. Ouvrez **Outils d'alignement › Alignement des identifiants chercheurs** et choisissez le
   laboratoire.
2. Sélectionnez **Vérifier les existants**, puis **Rechercher partout**.
3. Traitez les **Écarts de nom / notices remplacées** : **Mettre à jour** les notices IdRef
   fusionnées par l'ABES, confirmer ou détacher les écarts de nom.
4. Traitez les **Conflits** : un identifiant existant faux se corrige sur la fiche.

## Étape 3 — Chercher les identifiants manquants

1. Sélectionnez **Rechercher manquants**, puis **Rechercher partout**. Laissez la recherche
   tourner (de quelques minutes à plus d'une heure).
2. Commencez par l'onglet **Personnel** ; les **Doctorants** et le personnel **Sans
   obligation de recherche** viennent ensuite.

## Étape 4 — Valider les candidats forts

1. Cliquez sur le compteur **Candidats à cocher**.
2. Parcourez rapidement la liste, puis **Cocher tous les candidats forts**. Les fiches
   marquées ⚡ partagent déjà un identifiant avec le profil proposé.
3. Cliquez sur **Appliquer**.

Relancez **Rechercher partout** : les identifiants que vous venez d'écrire rendent souvent
d'autres candidats forts (un ORCID validé confirme un profil HAL ou Scopus).

## Étape 5 — Arbitrer les cas restants

Pour chaque pastille **candidats à vérifier** ou **Ambigu — arbitrer** :

1. Ouvrez le profil proposé : thématiques, coauteurs, établissements.
2. Cochez le bon candidat, **Ignorer** en cas de doute, **Mauvais candidat** pour un
   homonyme.
3. **Appliquer** régulièrement, pour ne pas perdre votre travail.

Pour **OpenAlex**, une personne peut avoir plusieurs profils : validez **tous** ceux qui sont
les siens (le principal et les fragments).

Voir [Accepter, rejeter ou ignorer un candidat](/guides/identifiants/accepter-rejeter-candidat/).

## Étape 6 — Signaler les erreurs à la source

Certains problèmes ne se règlent pas dans Druid :

| Problème | Action |
|---|---|
| Profil qui mélange deux personnes | **Identité mêlée**, puis demande de correction à la source |
| Deux ORCID, deux IdHAL, deux profils Scopus pour une personne | Tâche avec **Email au chercheur** |
| Pas d'ORCID ni d'IdHAL | Tâche d'invitation à en créer un (**Email au chercheur**) |
| Notice IdRef à corriger ou à créer | Tâche pour la **Correspondante autorités (IdRef)** |

Voir [Suivre les tâches « À traiter »](/guides/personnes/taches-a-traiter/). Beaucoup de ces
tâches sont d'ailleurs créées automatiquement.

## Étape 7 — Enrichir les notices IdRef

Druid connaît maintenant des ORCID et des IdHAL absents des notices IdRef. Filtrez le
laboratoire dans **Personnel**, puis **Exporter › Export ABES (IdRef)** : le classeur
produit est à transmettre à l'ABES ou à traiter par la bibliothèque. Voir
[Exporter un fichier pour l'ABES](/guides/identifiants/export-abes/).

## Étape 8 — Mesurer le résultat et envoyer à CRISalid

1. Revenez à la vue **Dataviz** : comparez la couverture des identifiants à celle de
   l'étape 1.
2. Envoyez la liste à CRISalid (**Administration › Synchroniser avec SoVisu+**, si votre
   instance le permet).

## Récapitulatif

- [ ] Couverture initiale notée
- [ ] Identifiants existants vérifiés (notices remplacées, écarts, conflits)
- [ ] Candidats forts validés, puis nouvelle recherche
- [ ] Cas ambigus arbitrés, mauvais candidats écartés
- [ ] Identités mêlées et doublons d'identifiants signalés (tâches)
- [ ] Export ABES transmis
- [ ] Couverture finale mesurée, liste envoyée à CRISalid

## Et ensuite

Les chercheurs créent de nouveaux profils, OpenAlex en fusionne d'autres : relancez
**Vérifier les existants** et **Rechercher manquants** deux ou trois fois par an. Sur
certaines instances, une partie de ces vérifications est automatique.

## Voir aussi

- [Identifiants chercheurs](/donnees/identifiants-chercheurs/)
- [Aligner les identifiants d'un labo](/guides/identifiants/aligner-les-identifiants/)
