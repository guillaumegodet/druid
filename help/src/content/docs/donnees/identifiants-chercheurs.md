---
title: "Identifiants chercheurs"
description: "Ce que représente chaque identifiant (IdRef, ORCID, IdHAL, OpenAlex, Scopus) et comment Druid propose des candidats."
sidebar:
  order: 5
---

## Ce que c'est

Un **identifiant chercheur** relie une personne à son profil dans une base externe. C'est
grâce à eux que CRISalid peut **moissonner les publications** de chaque chercheur : sans
identifiant, une personne ne peut être retrouvée que par son nom, ce qui mélange les
homonymes.

## Chaque source

| Identifiant | Qui le crée et le gère | À quoi il sert |
|---|---|---|
| **IdRef** (PPN) | Les bibliothèques (réseau ABES) | Référentiel national des auteurs : thèses, catalogues des bibliothèques. Fiable, mais tout le monde n'a pas de notice. |
| **ORCID** | Le chercheur lui-même | Identifiant international, demandé par les éditeurs et les financeurs. Seule la personne peut modifier son profil. |
| **IdHAL** | Le chercheur, dans HAL | Relie les dépôts HAL d'un auteur, quelle que soit la forme de son nom. Druid enregistre aussi son numéro interne. |
| **OpenAlex** (A-id) | Calculé automatiquement par OpenAlex | Profil d'auteur construit par algorithme. **Une personne peut avoir plusieurs profils** : un principal et des fragments. |
| **Scopus Author ID** | Calculé automatiquement par Elsevier | Profil d'auteur de la base Scopus, lui aussi construit par algorithme. |

Sur une instance reliée à un annuaire LDAP, l'**uid** de l'annuaire est aussi un
identifiant : il est aligné séparément (voir
[Aligner avec le LDAP](/guides/identifiants/aligner-ldap/)).

## Comment Druid trouve des candidats

Pour chaque fiche à qui il manque un identifiant, Druid **interroge la source** par le nom
de la personne, puis **cherche des preuves** que le profil trouvé est bien le sien.

### Les niveaux de confiance

| Niveau | Preuves typiques | Quoi faire |
|---|---|---|
| **fort** | Un identifiant déjà présent sur la fiche est retrouvé sur le profil (l'ORCID de la fiche sur le profil HAL, l'IdRef sur le profil ORCID…), ou nom exact et affiliation à l'établissement ou au laboratoire de la fiche. | Valider, en masse si besoin (**Cocher tous les candidats forts**). |
| **moyen** | Nom concordant et affiliation à l'établissement ou au laboratoire, mais sans identifiant commun. | Ouvrir le profil et vérifier (thèmes, coauteurs) avant de valider. |
| **faible** | Homonyme, sans preuve d'affiliation. | Seulement après vérification manuelle. |

Les preuves exactes varient selon la source :

- **IdRef** : nom exact, personne scientifique, dates de naissance et de décès
  vraisemblables. Sur certaines instances, le graphe CRISalid affine le choix entre
  homonymes.
- **ORCID et HAL** : identifiants croisés (ORCID, IdRef, Scopus, e-mail) et affiliation
  à l'établissement ou au laboratoire.
- **OpenAlex** : publications en commun avec le corpus HAL ou CRISalid de la personne,
  affiliation au laboratoire. Le profil qui porte l'ORCID de la fiche est enregistré
  directement.
- **Scopus** : ORCID de la fiche sur le profil, ou nom exact avec affiliation à
  l'établissement ou au laboratoire. Un homonyme unique sans preuve n'est jamais proposé
  comme sûr.

### Les situations d'une fiche

| Situation | Signification |
|---|---|
| **candidat fort** | Une proposition quasi certaine, cochable directement dans la ligne. |
| **candidats à vérifier** | Une ou plusieurs propositions de niveau moyen ou faible. |
| **Ambigu — arbitrer** | Plusieurs candidats plausibles : il faut choisir, ou ignorer. |
| **conflit** | La fiche porte déjà un identifiant différent de celui trouvé. |
| **notice remplacée** | L'IdRef de la fiche pointe vers une notice fusionnée ou supprimée par l'ABES : **Mettre à jour** la remplace par la nouvelle. |
| **identité mêlée suspectée** | Des indices laissent penser que le profil mélange plusieurs personnes. |
| **profil vide** | Le profil ORCID existe mais n'affiche aucune donnée publique : impossible de confirmer. |

La page **Alignement des identifiants chercheurs** ne liste **que les fiches qui demandent
une action** : une fiche déjà complète, ou pour laquelle rien n'a été trouvé, n'y apparaît
pas.

### Les trois groupes de la page

| Onglet | Qui |
|---|---|
| **Personnel** | Enseignants-chercheurs, chercheurs et autres personnels de recherche. |
| **Doctorants** | Les doctorants. |
| **Sans obligation de recherche** | Personnels sans obligation statutaire de recherche : ils peuvent avoir des identifiants, mais c'est une priorité basse. |

## Ce que Druid fait de votre décision

- **Valider** écrit l'identifiant dans l'annuaire, avec la date et la source. Druid **ne
  remplit que les cases vides** : il n'écrase jamais un identifiant existant (c'est alors un
  conflit).
- Pour **OpenAlex**, valider **ajoute** le profil à la liste de la personne : rien n'est
  retiré.
- **Mauvais candidat** met le couple (personne, identifiant) sur **liste noire** : il ne
  sera plus jamais proposé.
- **Identité mêlée** ouvre un signalement : le profil n'est ni validé ni rejeté, n'est
  jamais exporté, et la correction se fait **à la source** (voir ci-dessous).

Les identifiants validés partent vers CRISalid au prochain export, puis servent au
moissonnage des publications.

## Mises à jour automatiques

Druid relance régulièrement certaines recherches, selon la configuration de votre instance.
Par exemple, les profils OpenAlex peuvent être revérifiés chaque trimestre : un profil
fusionné par OpenAlex est remplacé par le nouveau, un profil disparu est retiré.

## Limites connues

- **Les homonymes** restent la principale source d'erreur, surtout pour les noms fréquents
  et les profils sans affiliation.
- **Les changements de nom** (mariage, nom d'usage, translittération) font baisser le score
  d'un bon candidat.
- **Les profils algorithmiques** (OpenAlex, Scopus) peuvent mélanger plusieurs personnes ou
  éclater une personne en plusieurs profils. Druid ne les corrige pas : il le signale.
- **Pas de recherche possible sans nom exact** : une fiche au nom mal orthographié ne
  trouve pas son candidat.
- **Quotas des API** : Scopus et OpenAlex limitent le nombre de requêtes. Un grand
  laboratoire peut demander plusieurs jours de recherche.
- **Les relances depuis Druid** dépendent de l'instance : sur certaines, les recherches
  sont lancées par l'équipe technique uniquement.

## Comment signaler une erreur

Un identifiant faux dans Druid se corrige sur la fiche. Une erreur **dans la source**
se corrige là-bas, par la bonne personne :

| Source | Qui corrige |
|---|---|
| IdRef | La bibliothèque (droits de catalogage ABES) |
| HAL | L'auteur (« Mon IdHAL »), sinon le référent HAL du laboratoire |
| OpenAlex | L'auteur via la curation de son profil, sinon le support OpenAlex |
| ORCID | La personne seule |

Voir [Où corriger quoi](/guides/corriger/ou-corriger-quoi/) et
[Suivre les tâches « À traiter »](/guides/personnes/taches-a-traiter/).
