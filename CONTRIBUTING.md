# Contribuer à Druid — branches, commits, versions

Ce document décrit comment le code de Druid évolue, de la modification à la mise en production. Il sert
aussi de référence pour la sécurité des systèmes d'information : aucune modification n'atteint la
production sans être passée par une branche, une revue automatique (CI) et une version numérotée.

## Environnements

| Environnement | Ce qui y est déployé | Quand |
|---|---|---|
| **Test** | la branche `main`, ou une branche en cours | en continu |
| **Production** | uniquement une version numérotée (tag `vX.Y.Z`) | à chaque release |

L'instance de test a ses propres comptes de service, ses propres secrets et ses propres données ; elle
n'écrit dans aucun système de production. Elle affiche un bandeau (`DRUID_ENV=test`). La même image
Docker sert les deux environnements : aucun réglage d'instance n'est compilé dans le code (voir
`README.md`, « Version et santé »).

## Branches

| Branche | Rôle |
|---|---|
| `main` | intégration : toujours construisible, déployée sur le test |
| `feature/<sujet>` | une évolution ou un correctif, courte durée de vie, fusionnée dans `main` par PR |
| `release` | pointe sur la dernière version en production (avancée par la procédure de release) |
| `hotfix/<X.Y>` | correctif urgent créé depuis le tag en production, puis reporté dans `main` |

Règles :

- tout passe par une **pull request** vers `main`, fusionnée seulement quand la **CI est verte** ;
- pas de réécriture d'historique (`push --force`) sur `main` ni `release` ;
- les tags `v*` ne sont jamais déplacés ni supprimés.

## Messages de commit

Format [Conventional Commits](https://www.conventionalcommits.org/fr/), vérifié par la CI sur chaque PR
(`scripts/release/check-commit-messages.cjs`) :

```
<type>(<portée>): <résumé>
```

| Type | Usage | Effet sur la version |
|---|---|---|
| `feat` | nouvelle fonctionnalité | mineure |
| `fix` | correction de bug | correctif |
| `security` | correction de sécurité | correctif (release hors cycle si nécessaire) |
| `perf`, `refactor`, `style` | sans changement fonctionnel | — |
| `docs`, `test`, `build`, `ci`, `chore` | documentation, tests, outillage | — |
| `revert` | annulation d'un commit | selon le commit annulé |

Un `!` après le type (`feat(api)!: …`) signale une **rupture** (version majeure) : schéma Grist incompatible,
suppression d'une fonction, changement de configuration obligatoire.

Le code, les commentaires et les messages de commit sont en anglais ; l'interface est traduite en français
(`npm run i18n:extract`, voir `README.md`).

## Versions

Numérotation [SemVer](https://semver.org/lang/fr/) `MAJEUR.MINEUR.CORRECTIF`, portée par `package.json`
et affichée dans l'application (sous le logo).

- **Rythme** : une release toutes les deux semaines ; la veille, seuls les correctifs entrent dans `main`.
- **Correctif de sécurité** : release `X.Y.(Z+1)` sans attendre, depuis une branche `hotfix/<X.Y>` si
  `main` contient déjà des évolutions non recettées.
- **Contenu** : chaque PR qui change le comportement ajoute une ligne à la section « Non publié » de
  [`CHANGELOG.md`](CHANGELOG.md), qui devient la note de version.
- **Tag** : annoté et signé (`git tag -s vX.Y.Z`), créé par la procédure de release après recette de
  l'image sur l'environnement de test.

## Données

Une évolution qui modifie la structure des données (colonnes ou tables Grist) ou qui doit corriger des
données existantes fournit un script de migration idempotent, cité dans la rubrique **Migration** du
CHANGELOG. Elle ajoute avant de retirer : la colonne remplacée reste en place pendant une version, pour
qu'un retour à la version précédente reste possible.

## Dépendances

Dependabot ouvre une PR à chaque alerte de sécurité, et des PR mensuelles groupées pour les mises à jour
(npm, centre d'aide, GitHub Actions, image de base Docker). Elles suivent le même chemin que toute
évolution : CI, test, release. L'audit des dépendances de production (`npm audit`) est affiché par la CI.

## Données personnelles et publication

Le dépôt ne contient aucune donnée réelle (noms, identifiants de personnes, adresses internes, clés) :
jeux de test fictifs, identifiants inventés, adresses `example.org`. Les données et réglages propres à
chaque établissement vivent dans des dépôts privés.
