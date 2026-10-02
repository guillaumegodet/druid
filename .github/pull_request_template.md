<!-- Process: CONTRIBUTING.md. Title in Conventional Commits form, e.g. « feat(structures): … ». -->

## Objet

<!-- What changes for the users or the operators, and why. Link the plan or the issue. -->

## Vérifications

- [ ] CI verte (types, tests, gardes, build, messages de commit)
- [ ] `CHANGELOG.md` : ligne ajoutée dans « Non publié » (ou sans objet : refactor, CI, docs internes)
- [ ] Nouvelles chaînes d'interface : `npm run i18n:extract` puis traduction française
- [ ] Données : aucune opération Grist à faire au déploiement, ou rubrique **Migration** du CHANGELOG remplie
- [ ] Testé sur l'instance de test (ou raison de ne pas l'avoir fait)
- [ ] Aucune donnée réelle ni hôte interne (dépôt publiable — garde de publication)
