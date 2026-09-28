---
title: "Instances et fonctionnalités"
description: "Pourquoi certaines fonctions n'existent pas sur toutes les instances de Druid, et qui a accès à quoi."
sidebar:
  order: 8
---

## Ce que c'est

Druid est utilisé par plusieurs établissements. Chacun dispose de sa propre **instance** :
ses données, ses comptes, et les **fonctions** que son environnement permet. Une
université reliée à son annuaire LDAP et à CRISalid a plus de fonctions qu'une école qui
utilise Druid seul.

Cette aide est **commune à toutes les instances**. Quand une fonction est optionnelle, la
page le précise par un encadré « Disponible sur : instances reliées à… ». Si vous ne
trouvez pas un bouton décrit dans l'aide, c'est probablement que votre instance ne
dispose pas de la fonction, ou que votre profil ne la permet pas.

## Fonctions optionnelles

| Fonction | Ce qu'elle apporte | Ce qui manque sans elle |
|---|---|---|
| **Annuaire LDAP de l'établissement** | Statuts calculés depuis l'état des comptes, synchronisation des grades et dates d'emploi, page **Alignement LDAP**, import des structures. | Statuts et données d'emploi saisis à la main ; pas d'onglet LDAP. |
| **Statuts et validation manuelle** | Statuts Interne/Départ/Parti/Externe, pastilles de validation, import de listes fiabilisées. | Pas de colonne Statut ni de validation. |
| **Relance des recherches d'identifiants** | Boutons **Rechercher manquants**, **Rechercher partout**, **Vérifier les existants** sur la page d'alignement. | Les candidats sont calculés par l'équipe technique ; la page permet toujours de les valider. |
| **Alignement IdRef enrichi** | Choix entre homonymes IdRef affiné grâce au graphe CRISalid. | Recherche IdRef simple, par nom et dates. |
| **Console ETL** | Régénération des tableaux de bord depuis Druid, configuration des structures, contrôle des affiliations. | Tableaux de bord régénérés hors de Druid. |
| **Gestion des droits** | Vue des groupes de droits et de leurs membres dans **Administration** (l'attribution se fait dans la console Keycloak). | Accès gérés par l'équipe technique. |
| **Enregistrement des rapports** | **Mes rapports** enregistrés sur l'instance : partage, historique, modèles de l'établissement. | Sur une démonstration en lecture seule, rapports conservés dans le navigateur seulement. |
| **Archivage des PDF de rapport** | Les PDF générés sont conservés dans l'historique du rapport et peuvent être partagés figés. | L'historique garde la date, l'auteur et le périmètre, sans le fichier. |
| **Textes par IA (ILAAS)** | Synthèse et analyse par thème des rapports ; analyse thématique des collaborations. | Blocs **Texte IA** impossibles à générer. |
| **Assistant conversationnel** | Bouton flottant pour interroger les données CRISalid en langage naturel. | — |
| **Export vers CRISalid** | Envoi des chercheurs, identifiants et structures à CRISalid (bouton **Synchroniser avec SoVisu+**). | Pas de moissonnage automatique des publications par personne. |

## Profils et droits

Votre **profil** détermine les rubriques que vous voyez et le périmètre des données.

| Profil | Périmètre | Ce qu'il permet en plus |
|---|---|---|
| **Membre d'un laboratoire** | Le ou les laboratoires de **votre propre fiche** dans l'annuaire | Consulter Personnel et le Tableau de bord, corriger les fiches de son labo. |
| **Direction ou gestion de labo** | Les laboratoires attribués | Idem, sans dépendre de sa propre fiche. |
| **Services centraux** | Tout l'établissement | Structures, Outils d'alignement. |
| **Administrateur Druid** | Tout l'établissement | Groupes, À traiter (doublons et tâches), Signaler une correction, consultation des droits. |
| **Administrateur technique** | Selon son autre profil | Console ETL, onglets masqués du tableau de bord ; avec un accès à tout l'établissement : menu Synchroniser, création de fiches. |
| **Chargé·e de communication** | — | Sources médias de la veille. |

Les profils se **cumulent**. Un compte connecté sans droit particulier est traité comme
**membre d'un laboratoire** : son périmètre est déduit de sa fiche. Sans fiche, il ne voit
aucune donnée.

Selon l'instance, les droits sont gérés par l'annuaire de l'établissement (groupes du
service d'authentification) ou par une liste d'adresses autorisées. Sur ce dernier type
d'instance, tout compte autorisé voit l'établissement entier, et les profils labo et
communication n'existent pas.

## Exemple

Sur une instance **reliée** à l'annuaire LDAP et à CRISalid, une directrice de laboratoire
voit le statut de chaque membre calculé depuis l'annuaire, peut valider les fiches de son
labo, et les identifiants qu'elle fait compléter partent vers CRISalid.

Sur une instance **autonome**, la même personne consulte l'annuaire et les tableaux de bord,
mais les statuts ne sont pas affichés et l'export vers CRISalid n'est pas proposé.

## Limites connues

- **Une fonction absente ne se signale pas** : Druid masque simplement le bouton. En cas de
  doute, demandez à l'administrateur de votre instance.
- **Le périmètre labo dépend de votre fiche** : si votre fiche indique un ancien
  laboratoire, vous verrez ce laboratoire.
- **Certaines combinaisons sont restrictives** : le bouton **À traiter** n'apparaît qu'aux
  administrateurs Druid qui sont aussi administrateurs techniques.

## Comment signaler une erreur

Il vous manque un accès ou une fonction ? Voir
[Premiers pas selon votre profil](/demarrer/premiers-pas/#demander-un-accès-supplémentaire)
et le [Support](/guides/support/).
