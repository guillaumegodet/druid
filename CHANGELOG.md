# Journal des modifications

Toutes les évolutions notables de Druid sont consignées ici. Format inspiré de
[Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versions numérotées selon
[SemVer](https://semver.org/lang/fr/) (règles dans [`CONTRIBUTING.md`](CONTRIBUTING.md)).

Chaque PR qui change le comportement de l'application ajoute une ligne dans « Non publié ». À la release,
cette section devient `[X.Y.Z] — AAAA-MM-JJ` et sert de note de version.

Rubriques : **Ajouté**, **Modifié**, **Corrigé**, **Sécurité**, **Retiré**, **Migration** (opération de
données à exécuter au déploiement).

## [Non publié]

Première version numérotée à venir (1.0.0) : état de Druid à la mise en place des releases, plus les
évolutions ci-dessous (depuis la publication du code le 2026-09-24).

### Ajouté
- Version de l'application affichée sous le logo ; route `/api/health` et contrôle de santé de l'image Docker ;
  bandeau signalant une instance de test (`DRUID_ENV`).
- Saisie du code entité (supannCodeEntite) à la création d'une structure.
- Onglet « Arrivées et départs » de l'alignement LDAP : personnels arrivés ou partis depuis une date.
- Bloc « Parcours » de la fiche chercheur (affiliations des publications, ORCID, Scopus), « Suggestions de
  l'établissement », filtre de liste et règles de détection associées.
- « À traiter » : conflits d'un import d'annuaire, fiches partageant un identifiant.
- « Mes rapports » : rapports personnalisables et partageables, modèles, textes générés par IA, historique et PDF archivés.
- Tableau de bord : liste des publications en fenêtre au clic sur un graphique, provenance des autres labos de l'université.
- Alignement des identifiants : « Rechercher partout » encadré (fenêtre de lancement, budget Elsevier, arrêt),
  recherche sur une seule fiche, tableau adapté aux téléphones ; clé Elsevier de secours.
- Remplissage d'une nouvelle fiche depuis le LDAP par uid ; mode inter-labos de l'onglet Réseau.
- Administration : une seule action « Synchroniser avec SoVisu+ » (structures puis personnes).

### Modifié
- Navigation : menu sous 1 320 px de large, bouton « précédent » du navigateur et page demandée conservée à la connexion.
- L'image Docker ne contient plus aucun réglage d'instance : la même image sert le test et la production.

- Tâches « À traiter » : le canal du correspondant autorités s'appelle désormais `correspondant_idref`.

### Corrigé
- Alignement IdRef : les fiches sans uid_dyna sont aussi recherchées.
- « Rechercher partout » masqué sur les instances sans tâches serveur (plantage sur Cloudflare).

### Sécurité
- Plus de mot de passe Neo4j par défaut dans les scripts d'alignement.
- Garde de publication insensible à la casse pour la liste de noms.

### Migration
- `scripts/migrations/001-tasks-channel-rename.cjs --from=<ancienne valeur> --apply` : renomme le canal des
  tâches existantes (table `Taches`) et met à jour les choix de la colonne. À lancer juste après le déploiement.
