---
title: "Créer le Druid de son établissement"
description: "Le portail « Créer mon Druid » : établissement, laboratoires, adresse, puis construction automatique."
sidebar:
  order: 4
---

Sur l'offre hébergée de Druid, n'importe quel établissement peut créer son instance en
quelques minutes, sans installation. Vous saisissez votre établissement et vos laboratoires ;
Druid retrouve leurs identifiants et construit votre espace.

## Avant de commencer

- Une **adresse e-mail professionnelle** : elle devient le compte administrateur du Druid.
- Le **nom de votre établissement** tel qu'il figure dans le registre ROR (c'est le cas de la
  quasi-totalité des universités et écoles).
- Pour un établissement français, rien d'autre : l'UAI, le SIRET, l'IdRef et la liste des
  laboratoires (RNSR) sont retrouvés automatiquement.

## Les trois étapes

1. **Établissement** — tapez le nom, choisissez la bonne fiche dans la liste ROR. Druid affiche
   les identifiants retrouvés (UAI, SIRET, IdRef, Wikidata, OpenAlex) et le site web.
2. **Laboratoires** — les structures de recherche qui ont votre établissement pour tutelle dans
   le RNSR sont prélistées et cochées : décochez celles qui ne sont pas les vôtres (unités dont
   vous n'êtes que tutelle secondaire, par exemple), ajoutez celles qui manquent (une par
   ligne : `sigle ; nom ; numéro RNSR facultatif`).
3. **Confirmation** — le nom affiché, l'adresse de votre Druid (`votre-etablissement.…`) et
   le domaine des adresses e-mail de l'établissement. Validez.

La construction prend moins d'une minute : base de données, structures, adresse. Vous recevez
un e-mail quand elle est terminée et le bouton **Ouvrir mon Druid** vous connecte directement.

## Et ensuite

- **Charger vos chercheurs** : [fiabiliser l'annuaire d'un laboratoire](/tutoriels/fiabiliser-annuaire-labo/),
  puis lancer l'alignement des identifiants (IdRef, ORCID, IdHAL, OpenAlex).
- **Compléter les identifiants des structures** (ROR, HAL, OpenAlex) : l'onglet Structures de
  la page Alignement les propose.
- **Inviter des collègues** : l'essai gratuit comprend un compte ; les offres Équipe et Complet
  en ajoutent (page « Mon établissement »).

## Si votre établissement a déjà un Druid

Un seul essai est possible par établissement. Si quelqu'un l'a déjà créé, le portail vous le
dit et vous propose de **demander l'accès** : l'administrateur de ce Druid est prévenu.
