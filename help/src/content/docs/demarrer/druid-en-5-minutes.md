---
title: "Druid en 5 minutes"
description: "Ce que fait Druid, les rubriques du menu et d'où viennent les données."
sidebar:
  order: 1
---

Druid est l'outil de **gestion de l'annuaire de la recherche** d'un établissement : qui
travaille dans quel laboratoire, avec quels identifiants chercheurs, et ce que ces personnes
publient. Il sert à la fois à **fiabiliser les données** (statuts, rattachements,
identifiants) et à **les exploiter** (tableaux de bord bibliométriques, exports).

Il alimente la chaîne [CRISalid](https://www.crisalid.org/) : les fiches fiabilisées dans
Druid sont celles qui permettent de moissonner les publications de chaque chercheur.

## Ce que vous pouvez faire avec Druid

- **Tenir l'annuaire à jour** : retrouver une personne, vérifier sa présence (présente,
  en départ, partie) et son employeur, son laboratoire et son équipe, corriger une fiche.
- **Compléter les identifiants chercheurs** : IdRef, ORCID, IdHAL, OpenAlex, Scopus. Druid
  propose des candidats ; vous acceptez ou rejetez.
- **Décrire les structures de recherche** : laboratoires, équipes, composantes, avec leurs
  identifiants (RNSR, ROR, UAI…) et leurs tutelles.
- **Analyser la production scientifique** d'un laboratoire ou d'un groupe de chercheurs :
  volume, accès ouvert, impact, collaborations, revues, APC.
- **Composer des rapports** bibliométriques à partir des graphiques du tableau de bord ou de
  modèles (bilan, collaborations, financements, revues), les partager et les exporter en PDF.
- **Exporter** : listes en CSV, Excel ou PDF, fichier pour l'ABES, graphiques intégrables sur
  un site web.

## Les rubriques du menu

| Rubrique | Ce qu'on y trouve | Qui la voit |
|---|---|---|
| **Personnel** | La liste des fiches, avec filtres et graphiques (parité, âges, grades, couverture des identifiants). Un clic ouvre la fiche d'une personne. | Tout le monde (limité à son labo pour un profil labo) |
| **Structures** | Les laboratoires, équipes et composantes, leur hiérarchie et leur fiche descriptive. | Services centraux et administrateurs |
| **Groupes** | Des sélections transverses de chercheurs (un conseil, un projet, une cohorte) avec leur propre tableau de bord. | Administrateurs |
| **Tableau de bord** | Les indicateurs bibliométriques d'une structure ou d'un groupe, en une quinzaine d'onglets. | Tout le monde (limité à son labo pour un profil labo) |
| **Mes rapports** | Vos rapports bibliométriques, ceux partagés avec vous et ceux visibles par tous ; création à partir d'un modèle, export PDF. | Tout le monde (sur les structures qu'il voit) |
| **Outils d'alignement** | L'alignement des identifiants chercheurs et, si votre instance est reliée à un annuaire LDAP, l'alignement LDAP. | Services centraux et administrateurs |
| **Administration** | Console ETL, gestion des droits, sources médias de la veille, selon votre profil. | Administrateurs et chargé·es de communication |

Les rubriques que votre profil ne permet pas d'utiliser n'apparaissent pas : voir
[Premiers pas selon votre profil](/demarrer/premiers-pas/).

## D'où viennent les données

Druid ne crée presque rien lui-même : il **rassemble et confronte** plusieurs sources.

- **L'annuaire** : une table partagée (dans Grist) qui contient une fiche par personne et
  par laboratoire. C'est la source de vérité de Druid ; ce que vous corrigez dans Druid y est
  écrit.
- **L'annuaire LDAP de l'établissement**, si votre instance y est reliée : il indique si un
  compte est actif et fournit le grade, l'employeur, les dates d'emploi.
- **Les référentiels d'identifiants** (IdRef, ORCID, HAL, OpenAlex, Scopus), interrogés pour
  proposer des candidats.
- **Les sources bibliographiques** (OpenAlex, Baromètre de la science ouverte, HAL, graphe
  CRISalid) pour les tableaux de bord.

Le détail, avec les fréquences de mise à jour, est dans
[D'où viennent les données](/donnees/sources-des-donnees/).

## Trois notions à connaître

- **Présence, employeur, compte LDAP** : la présence (Présent, Départ, Parti) est calculée
  automatiquement, et une personne habilitée peut la confirmer à la main (« valider la
  fiche ») ; l'employeur et le compte LDAP sont affichés à part. Voir
  [Statuts des personnes](/donnees/statuts-des-personnes/).
- **Rattachement principal** : le laboratoire (et l'équipe) qui compte pour la signature des
  publications et pour l'export vers CRISalid. Voir
  [Appartenances et rattachement](/donnees/appartenances-rattachement/).
- **Candidat** : une proposition d'identifiant (IdRef, ORCID…) calculée par Druid, avec un
  niveau de confiance. Rien n'est écrit sans votre accord. Voir
  [Identifiants chercheurs](/donnees/identifiants-chercheurs/).

Les autres termes sont dans le [glossaire](/demarrer/glossaire/).

## Dans la barre du haut

- **?** : ouvre ce centre d'aide. Dans chaque page de Druid, un bouton **?** à côté du titre
  ouvre directement l'aide de cette page (ou de l'onglet affiché).
- **FR / EN** : bascule la langue de l'interface.
- **Mode sombre / Mode clair** : change le thème d'affichage.
- **Votre nom** et **Se déconnecter**.

Sur certaines instances, un **assistant conversationnel** (bouton flottant en bas à droite)
a deux onglets :

- **Aide Druid** répond aux questions « comment faire… » à partir de ce centre d'aide, avec
  les liens vers les pages utilisées ;
- **Données CRISalid** répond aux questions sur la recherche de l'établissement
  (publications, laboratoires, expertises).

## Et ensuite ?

- [Premiers pas selon votre profil](/demarrer/premiers-pas/) : ce que vous pouvez faire, vous.
- [Où corriger quoi](/guides/corriger/ou-corriger-quoi/) : une donnée vous semble fausse.
- [Support](/guides/support/) : poser une question ou demander un accès.
