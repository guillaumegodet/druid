# Journal des modifications

Toutes les évolutions notables de Druid sont consignées ici. Format inspiré de
[Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versions numérotées selon
[SemVer](https://semver.org/lang/fr/) (règles dans [`CONTRIBUTING.md`](CONTRIBUTING.md)).

Chaque PR qui change le comportement de l'application ajoute une ligne dans « Non publié ». À la release,
cette section devient `[X.Y.Z] — AAAA-MM-JJ` et sert de note de version.

Rubriques : **Ajouté**, **Modifié**, **Corrigé**, **Sécurité**, **Retiré**, **Migration** (opération de
données à exécuter au déploiement).

## [Non publié]

### Modifié
- En-tête : le centre d'aide, la langue, le thème clair/sombre, l'Administration et la déconnexion sont regroupés
  dans un menu « Mon compte » (menu déroulant sur grand écran, section en bas du menu ☰ sur mobile). La langue et
  le thème s'y choisissent par un sélecteur qui montre le choix actif. La barre de navigation complète s'affiche
  dès 1 180 px de large au lieu de 1 320.

## [1.2.1] — 2026-10-02

### Sécurité
- La recherche d'une personne dans l'annuaire LDAP par uid (« Remplir depuis le LDAP » à la création d'une fiche)
  est réservée au droit établissement ; elle était ouverte à tout droit labo, donc à tout compte connecté.
- Les tableaux de bord de groupe (liste, création, calcul, suppression, recherche d'auteurs) sont réservés aux
  super-administrateurs côté serveur, comme la page Groupes ; tout compte connecté pouvait en créer et lancer un calcul.
- L'annuaire et les structures ne sont plus copiés dans le stockage local du navigateur (ils restaient sur le disque
  après la déconnexion, accessibles aux autres utilisateurs du poste) : cache en mémoire le temps de l'onglet, et les
  copies existantes sont effacées au chargement de Druid et à la déconnexion.

## [1.2.0] — 2026-10-02

### Sécurité
- En-têtes de sécurité HTTP sur toutes les réponses (`nosniff`, `Referrer-Policy`, `Permissions-Policy`,
  `X-Frame-Options` sauf pages `embed`), plus d'en-tête `X-Powered-By`.
- Export Excel : bibliothèque SheetJS 0.20.3 (distribution officielle) à la place de `xlsx` 0.18 du registre npm,
  qui portait deux vulnérabilités sans correctif (pollution de prototype, ReDoS).
- Image et CI sur Node.js 24 (LTS) ; Node 20 n'a plus de correctifs de sécurité depuis avril 2026.
- Lectures filtrées côté serveur pour les droits « labo » : l'`Annuaire` ne renvoie plus que les lignes de leurs
  laboratoires, les tables d'administration (tâches, revues d'alignement, arbitrages…) leur sont refusées, le cache
  LDAP (date de naissance, corps, statut de tout le personnel) est réduit aux agents de leurs laboratoires et les
  caches d'alignement sont réservés au droit établissement. Auparavant, le filtrage n'avait lieu que dans le
  navigateur : tout compte connecté pouvait obtenir l'annuaire complet.
- Vérification des certificats TLS rétablie partout : serveur (elle était coupée pour tous les appels sortants),
  scripts d'alignement (tunnel du proxy), client LDAPS, scripts ponctuels. Les services appelés présentent tous un
  certificat public valide, y compris à travers le proxy de l'université (vérifié le 2026-10-02).

## [1.1.0] — 2026-10-02

### Ajouté
- Journaux d'accès et d'audit (une ligne JSON par événement, dans `DRUID_LOG_DIR`) : chaque requête (utilisateur,
  adresse réelle derrière la passerelle, chemin sans paramètres, statut, durée) ; connexions et échecs, déconnexions,
  écritures Grist (table, lignes, noms des champs — jamais les valeurs), exports faits dans le navigateur, tâches
  lancées, consultations d'administration, appels aux modèles de langue, refus d'accès.

### Sécurité
- Les URL complètes des appels Grist (avec leurs filtres) ne sont plus écrites dans la sortie du conteneur.

## [1.0.0] — 2026-10-02

Première version numérotée : état de Druid à la mise en place des releases, avec les évolutions ci-dessous
(depuis la publication du code le 2026-09-24).


### Ajouté
- Version de l'application affichée sous le logo ; route `/api/health` et contrôle de santé de l'image Docker ;
  bandeau signalant une instance de test (`DRUID_ENV`).
- Procédure de release : `scripts/release/prepare.sh`, `tag.sh` (tag signé), `deploy.sh test|prod` (vérifications,
  sauvegarde, retour automatique à la version précédente, journal des déploiements).
- Instance hors production (`DRUID_ENV` ≠ `production`) réservée aux super-administrateurs, sans partage public
  (pages `embed` et `/api/public` fermées).
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
  tâches existantes (table `Taches`) et met à jour les choix de la colonne. À lancer juste après le déploiement
  (déjà appliquée à Nantes le 2026-10-02 ; idempotente).
