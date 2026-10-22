# Journal des modifications

Toutes les évolutions notables de Druid sont consignées ici. Format inspiré de
[Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versions numérotées selon
[SemVer](https://semver.org/lang/fr/) (règles dans [`CONTRIBUTING.md`](CONTRIBUTING.md)).

Chaque PR qui change le comportement de l'application ajoute une ligne dans « Non publié ». À la release,
cette section devient `[X.Y.Z] — AAAA-MM-JJ` et sert de note de version.

Rubriques : **Ajouté**, **Modifié**, **Corrigé**, **Sécurité**, **Retiré**, **Migration** (opération de
données à exécuter au déploiement).

## [Non publié]

### Ajouté
- **Démo publique : onglet « Structures » de l'alignement des identifiants garni.** Le seed de la démo écrit désormais
  des identifiants fictifs pour les trois labos (RNSR, ROR, HAL, collection HAL, OpenAlex, IdRef) et les candidats qu'un
  passage du job d'alignement aurait laissés : candidats forts atteints par les passerelles, ambiguïté entre deux
  notices IdRef, notices à arbitrer, RNSR confirmé contredit par le registre, recherches sans résultat, type jamais
  cherché (`lib/migration/demoStructureIds.ts`). Les valeurs ne peuvent désigner aucune notice réelle (RNSR en « 0000… »,
  ROR hors alphabet, HAL à neuf chiffres, PPN à clé fausse) et sont projetées sur les fiches des structures.

## [2.15.0] — 2026-10-22

### Ajouté
- **Vue « Objectifs de développement durable »** (famille Pilotage, après les axes stratégiques ; druid-internal
  `docs/plan-odd-sdg.md`, lot 1) : les 17 ODD de l'ONU qu'OpenAlex attribue à chaque publication (champ
  `sustainable_development_goals`, exporté par druid-biblio depuis le 2026-10-22 sous `sdgs[]`). Chiffres clés
  (publications avec un ODD, ODD couverts, ODD principal, ODD par publication), répartition par ODD aux couleurs
  officielles, évolution annuelle et part étiquetée par année, ODD par labo ou équipe (effectifs ou parts), tableau
  accès ouvert / FWCI / top 10 % / international par ODD, case « hors ODD 3 ». Rebonds vers la liste des publications
  (nouveau filtre « Objectif de développement durable » : un ODD, avec / sans ODD ; colonne `sdgs` du CSV), quatre
  graphiques dans les intégrations et dans « Mes rapports » (`sdg-repartition`, `sdg-evolution`, `sdg-couverture`,
  `sdg-equipes`). La vue reste masquée tant que l'export de la structure ne porte aucun ODD.
- **Portail SaaS : bouton « Réessayer »** sur la page de construction quand le provisionnement d'un tenant a échoué
  (`POST /start/api/tenants/:slug/retry`, propriétaire seulement, refusé si une construction est déjà en file ou en
  cours) ; le seed de l'annuaire tolère une reprise (établissement déjà créé conservé).
- **Démo publique à jour des fonctionnalités récentes** (https://druid-demo.pages.dev) : les instances Cloudflare sur
  PostgreSQL servent désormais les routes des **appels à projets** (`/api/calls/*`, `/api/researchers/:key/calls`),
  des **thèses** (`/api/researchers/:key/theses`, `by-row`) et, quand leurs tableaux de bord embarquent le réseau de
  cosignatures de l'établissement (`features.network` dans `instance.json`, fichier `dashboard-data/network.json`
  version 5 de druid-biblio), celles du **réseau inter-labos et des binômes** (`/api/network/*`,
  `/api/researchers/:key/pairs` : onglet Réseau en mode inter-labos, sous-onglet Binômes avec les rapprochements
  suggérés, bloc « Binômes de recherche » de la fiche). Capacités `HAS_CALLS` (stockage PostgreSQL) et
  `HAS_NETWORK_API` (feature `network`) renvoyées par `/api/me` des Functions. Les données fictives de la démo
  s'enrichissent en conséquence (`lib/migration/demoExtras.ts`, chargées par le seed à chaque déploiement) : douze
  appels (clusters Horizon Europe, ERC Starting / Consolidator avec leur fenêtre de thèse, MSCA, axes ANR, un appel
  régional saisi à la main) appariés aux chercheurs avec leurs propres publications pour preuves, candidats par étape
  de carrière, thèse de chaque chercheur, quelques avis ; `network.json` fictif (binômes entre labos et entre pôles,
  références communes, citations directes) ; dates de la veille et des mentions rafraîchies. Sur une instance sans la
  feature ou sans PostgreSQL, ces routes répondent 404 / 501 et le front masque les vues, comme avant.

### Corrigé
- **Provisionnement d'un tenant SaaS sur une base dont le schéma `public` est vide** (Clever Cloud) : la version de
  l'annuaire était lue par deux requêtes SQL brutes sur `audit_log`, non qualifiées par le schéma du tenant ; le
  premier enregistrement de l'annuaire échouait (« relation "audit_log" does not exist ») et le tenant restait en
  `provisioning`. Lecture par le query builder (qualifiée) ; la CI rejoue les tests multi-tenants sur une base vierge.
- **`sslmode=require` sur une base managée** : node-postgres (serveur, runner, CLI des tenants) le lisait comme
  `verify-full` et refusait le certificat auto-signé de Clever Cloud (« self-signed certificate ») ; `sslmode` suit
  désormais la sémantique libpq (`require`/`prefer` = TLS sans vérification du certificat, `disable` = sans TLS,
  modes vérifiants inchangés), comme dbmate.

### Ajouté
- **Runner de jobs du SaaS** (druid-internal `docs/plan-druid-saas.md`, lot 3) : sur un déploiement multi-tenant,
  les alignements des personnes (`people.align` : scripts `sync_*.cjs` lancés par le runner sur le schéma du tenant,
  `DRUID_DATABASE_SCHEMA`, caches dans la table `align_cache` du tenant servis à `/<source>_align_cache.json`), la
  construction des tableaux de bord (`etl.build` : configuration druid-biblio par labo d'après les identifiants
  confirmés, ETL par labo, exports sur R2 servis à `/dashboard-data/*`) et l'alignement des structures sont des jobs
  de `saas.job` (`POST /api/jobs`, `GET /api/jobs/:id`, `POST /api/jobs/:id/cancel`) ; les routes
  `/api/align/*`, `/api/sync-idref-*` et `/api/structures-align/*` existent en Functions avec le même contrat que
  `server.cjs` (409 quand un run est en cours, « Stop » = fin du processus fils), `HAS_SERVER_JOBS` vaut vrai sur un
  tenant. Un job en cours par tenant, rafraîchissement planifié selon l'offre (fenêtre nocturne), alerte
  e-mail après deux échecs consécutifs, clés du client (Scopus…) chiffrées dans `saas.tenant_secret`.
- **Références communes à l'écran** (druid-internal `docs/plan-binomes-citations.md`, lot 3) : dans les rapprochements
  suggérés et le bloc « Binômes de recherche » de la fiche, chaque ligne dit « N références communes », affiche à la
  demande les trois plus rares avec leur titre lu sur OpenAlex, et « A cite déjà n publications de B » ; classements
  « Références communes seules » et « Citations directes seules », colonnes CSV, aide fr/en.
- **Binômes suggérés par les citations** (druid-internal `docs/plan-binomes-citations.md`, lot 2) : quand le
  `network.json` de druid-biblio porte les références citées (version 5), les rapprochements suggérés ajoutent deux
  signaux explicables — les références communes (couplage bibliographique, pondéré par la rareté de chaque référence,
  classement `signal=coupling`) et la citation directe (`cites`, publications de l'un citées par l'autre). Poids par
  défaut 2 : 1 : 0,5 : 1 d'après le rétro-test ; la réponse de l'API porte `references`, `coupling`, `sharedRefs` et
  `cites` par suggestion (affichage au lot 3).
- **Identifiants des structures et leur alignement** (stockage PostgreSQL) : chaque laboratoire ou équipe porte ses
  identifiants dans une table dédiée (`structure_identifier`, multivaluée : RNSR, ROR, structures HAL, collection HAL,
  OpenAlex, IdRef, Wikidata, ISNI, UAI, SIRET, GRID, affiliation Scopus) avec statut, source et date de vérification ;
  les colonnes et champs V2 (`ror`, `nns`, `idref`, `hal_collection`, `uai`, `isni`, `wikidata`, `scopus`,
  `hal_struct_ids`, `openalex_ids`) en sont la projection, toujours lue par les exports. Nouvel onglet **Structures** de
  la page Alignement : une ligne par structure, une colonne par identifiant, candidats avec preuves (notice, sigle,
  numéro d'unité, ville, tutelles, nombre de travaux, passerelles), validation en masse des candidats forts, refus avec
  motif (plus jamais proposé), saisie manuelle, conflits quand une notice confirmée a disparu, est fermée ou est
  contredite. Le job `scripts/align_structures.ts` lit RNSR, ROR, AuréHAL (structures et collections), OpenAlex, IdRef et
  Wikidata, **passerelles d'abord** (une valeur atteinte par deux chemins est forte) puis recherche par nom ; lancé
  depuis la page (`/api/structures-align/*`) ou en cron. Onglet **Identifiants** de la fiche structure refait sur ce
  modèle. Routes `/api/v1/structures/alignment`, `/api/v1/structures/<id>/identifiers`, et
  `/api/v1/structures/identifiers` (identifiants confirmés de toutes les structures, lisible par jeton de service pour
  le back-end bibliométrique). Sur un déploiement multi-établissements, le provisionnement d'un tenant met en file un
  job `structures.align` : les identifiants de ses laboratoires découlent du RNSR saisi au portail. Druid-internal
  `docs/plan-druid-saas.md`, lot 4.

### Migration
- `20261021140000_structure_identifiers.sql` : tables `structure_identifier`, `structure_alignment_candidate`,
  `structure_alignment_search`, reprise des identifiants déjà saisis (source `migration`). Puis
  `node scripts/.build/align_structures.cjs --mode=search` pour une première passe.
- **Déploiement multi-établissements (plan de contrôle)** : un déploiement Cloudflare qui lie la base de contrôle
  (`SAAS_HYPERDRIVE`) sert, en plus des instances déclarées au build, les **tenants** inscrits dans le schéma `saas`
  (tables `tenant`, `tenant_host`, `member`, `plan`, `magic_link`, `session`, `job`, `tenant_secret`,
  `db/saas/migrations`) : chaque établissement a son propre schéma PostgreSQL (`t_<slug>`, migré depuis
  `db/migrations` par `scripts/saas/tenant_db.ts` — `create`, `migrate-all`, `list`, `drop`), résolu à l'exécution par
  le nom d'hôte, sans build. Connexion par **lien magique** (`/auth/login`, `/api/auth/request`, `/api/auth/verify`,
  `/auth/logout`, e-mail Resend), session par cookie propre au tenant ; droits d'après le rôle du membre
  (`owner`, `admin`, `viewer`, `lab`), capacités d'après le plan (`trial`, `team`, `complete`) et les réglages du tenant ;
  `/api/me` renvoie un bloc `tenant`. Isolation vérifiée par les tests d'intégration (`saasTenants`, `saasFunctions`).
  Druid-internal `docs/plan-druid-saas.md`, lot 1 a-c et e.
- **Portail « Créer mon Druid »** (`/start` sur l'hôte `SAAS_PORTAL_HOST`) : connexion par lien magique, assistant en
  trois étapes — établissement cherché dans ROR (UAI, SIRET, IdRef, Wikidata et identifiant OpenAlex retrouvés pour un
  établissement français), structures de recherche prélistées depuis le RNSR par l'UAI de l'établissement (cases à
  cocher, ajout à la main), adresse `<slug>.<domaine>` et domaine des e-mails — puis page de construction et ouverture
  du nouveau Druid sur son hôte. Un seul essai par établissement (ROR), avec demande d'accès pour les suivants.
  **Runner de jobs** (`scripts/saas/runner.ts`) : traite `tenant.provision` (schéma migré, établissement et structures
  écrits par les commandes de l'annuaire, route Cloudflare de l'hôte, e-mail « votre Druid est prêt »). Lot 2.

### Modifié
- **Fiche chercheur › « Identité numérique »** (ex-« Présence médiatique ») : la carte garde les comptes et profils
  publics déclarés (réseaux sociaux, CV, profils académiques) ; le bloc « Dernières mentions du laboratoire » et la
  note sur les mentions individuelles sont retirés — les mentions dans les médias se consultent dans le tableau de
  bord (Veille › Médias). Toutes les instances.
- `README.md` : description du stockage PostgreSQL (le document Grist n'est plus la source de vérité), des
  fonctionnalités livrées depuis la version 2.0 (appels à projets, binômes, thèses, identifiants des structures,
  déploiement multi-établissements) et des variables d'environnement actuelles.
- Entrée de menu « Alignement des identifiants » (ex-« Alignement des identifiants chercheurs ») : la page porte
  désormais les personnes et les structures.

### Corrigé
- **Création d'une structure ou d'un établissement employeur sur une instance Cloudflare PostgreSQL** : la commande
  lisait le dépôt (pool de connexions) à l'intérieur de sa transaction ; avec une seule connexion par requête
  (Hyperdrive), la requête attendait indéfiniment. Les lectures précèdent maintenant la transaction.

### Migration
- `20261021090000_audit_row_search_path_current.sql` : `audit_row()` fige son `search_path` sur celui de sa création
  (`FROM CURRENT`, `public` sur une base mono-établissement) au lieu de `public` en dur, pour que chaque schéma de
  tenant journalise dans son propre `audit_log`. Sans reprise de données.

## [2.14.0] — 2026-10-20

### Ajouté
- **Fiche chercheur › Binômes de recherche** : en bas de la fiche d'un chercheur du réseau de l'université, ses
  coauteurs les plus fréquents en cartes (photo de la fiche, labo, publications communes, tendance, sujets principaux
  des publications communes ; filtres autres labos / autres pôles) et ses rapprochements suggérés des cinq dernières
  années en pile de cartes à juger une à une (glisser à droite = pertinent, à gauche = non pertinent, ou boutons
  pertinent / déjà en contact / non pertinent / annuler), avec les mêmes avis que le sous-onglet Binômes. Route
  `GET /api/researchers/:key/pairs` (droit sur un labo du chercheur, ou le chercheur lui-même).

### Modifié
- **Partenariats › Binômes › Rapprochements suggérés** : la proximité thématique compare les sujets (*topics*)
  OpenAlex des chercheurs au lieu de leurs sous-disciplines quand le réseau les contient (`network.json` version 4 de
  druid-biblio, seuil de similarité 0,1 ; sous-disciplines sinon). Les sujets communs sont nommés sur chaque ligne et
  dans l'export CSV (`shared_topics`). Rétro-test 2020-2022 → 2023-2026 : 15 % des 100 premières suggestions sont
  devenues des binômes, 10 % entre pôles (6 % avec les sous-disciplines).
- **Partenariats › Binômes** : la vue « Rapprochements suggérés » est gardée dans l'adresse (`view=suggested`) ; un
  lien partagé ou un rechargement de la page y ramène directement.

## [2.13.0] — 2026-10-20

### Ajouté
- **Partenariats › Binômes › Rapprochements suggérés › avis** : boutons « Pertinent », « Déjà en contact », « Non
  pertinent » sur chaque suggestion (un avis par personne et par paire, le dernier compte, second clic = retrait),
  nombre d'avis de tous les utilisateurs, suggestions écartées par soi rangées à part (case pour les réafficher),
  export CSV de tous les avis (droit établissement). La paire est identifiée par la fiche Druid des chercheurs (ou
  leur nom), stable d'une régénération du réseau à l'autre. Routes `POST /api/network/:slug/suggestions/feedback`
  et `GET /api/network/suggestions/feedback.csv` ; PostgreSQL seulement.

### Migration
- `20261020140000_collab_pair_feedback.sql` : table `collab_pair_feedback`, aucune reprise de données. À appliquer avec
  les migrations (`druid-migrate`) ; sur druid-test aussi.

## [2.12.0] — 2026-10-20

### Ajouté
- **Tableau de bord › Partenariats › Binômes** : les paires de chercheurs qui cosignent déjà, sur tout le réseau de
  l'université (un pôle voit ses binômes avec tous les labos). Filtres : labos différents, pôles différents ou
  couple de pôles, profils disciplinaires éloignés (distance entre les profils de disciplines OpenAlex, hors
  publications communes), appartenance d'après l'annuaire (membres, associés, labo déduit des seules publications),
  doctorants, grandes collaborations, minimum de publications communes. Pour chaque binôme : publications communes
  sur la période, part dans la production de chacun, tendance (nouveau, en hausse, stable, en sommeil), distance,
  sous-disciplines dominantes ; clic ⇒ publications communes. Lien depuis les sous-onglets « Au sein de la
  structure » et « Nantes Université ». Route `GET /api/network/:slug/pairs` ; absent sans `HAS_NETWORK_API`
  (Cloudflare). La distance et les appartenances demandent un `network.json` v3 (druid-biblio).
- **Partenariats › Binômes** : chiffres clés (binômes actifs, nouveaux, en sommeil, entre pôles, à profils éloignés,
  part des chercheurs de la structure engagés dans un binôme et dans un binôme entre pôles), cartes de chaleur des
  binômes par couple de pôles et par couple de labos (une case compte des binômes, pas des publications ; clic ⇒ le
  tableau ne liste que ce couple de labos), export CSV du tableau et page d'aide « Repérer les binômes de
  chercheurs ».
- **Partenariats › Binômes › Rapprochements suggérés** : chercheurs de labos différents qui n'ont jamais cosigné,
  classés par leurs coauteurs communs (Adamic-Adar, les plus spécifiques nommés) et la proximité de leurs
  sous-disciplines OpenAlex (atténuée pour les petits profils), 5 suggestions par chercheur au plus, doctorants exclus
  par défaut, mêmes filtres et mêmes droits que les binômes observés, export CSV. Route
  `GET /api/network/:slug/suggestions` (`suggestPairs` de `co_network.cjs`). Rétro-test 2020-2022 → 2023-2026 :
  environ une des 100 premières suggestions sur six a donné une publication commune (0,027 % au hasard).
- **Mes rapports › binômes de chercheurs** : les cartes de chaleur des binômes (par couple de pôles, par couple de
  labos) s'ajoutent à un rapport depuis le sous-onglet (bouton « Ajouter à un rapport », avec ses filtres) ou depuis
  l'éditeur ; nouveaux blocs « Chiffres clés — binômes de chercheurs » et tableau « Binômes de chercheurs ». Ces blocs
  lisent la route authentifiée `/api/network/:slug/pairs` : le rapport charge leurs données comme celles des
  structures (une requête par jeu d'options), puis l'aperçu et le PDF s'en servent. Ils n'ont pas de lien public
  (ni bouton « Partager », ni lien « version interactive » dans le PDF), ignorent les filtres de publications du
  rapport et ne sont pas proposés sans `HAS_NETWORK_API`.

### Corrigé
- **Mes rapports** : les libellés des réglages des blocs (seuil de conformité, nombre d'éléments, publications min.)
  et « Section sans titre » / « Texte vide » restaient en anglais dans l'interface française.

## [2.11.1] — 2026-10-20

### Modifié
- **Mise en production (`deploy.sh prod`)** : la base PostgreSQL de l'instance est sauvegardée avant la bascule
  (`pg_dump -Fc` dans le conteneur `DB_CONTAINER`, fichier `db-<horodatage>-before-<tag>.dump` dans `BACKUP_DIR`) et
  le dump est vérifié par `pg_restore -l` ; le déploiement s'arrête si l'un ou l'autre échoue. Les dumps sont purgés
  avec les autres sauvegardes (`KEEP_BACKUPS`). Jusqu'ici, seul le document Grist était sauvegardé.

### Corrigé
- **Journal d'audit (PostgreSQL)** : une mise à jour qui ne change que des colonnes de suivi (`updated_at`,
  `verified_at` des tâches revérifiées chaque nuit, `checked_at` d'un identifiant) n'écrit plus de ligne, pas plus
  qu'une fiche enregistrée sans changement. Mesuré à Nantes du 9 au 19 octobre : environ 70 % des lignes du journal
  (10 566 revérifications de tâches, soit 22 Mo sur 33, et 1 906 enregistrements sans changement). Les changements
  réels restent journalisés à l'identique, colonnes de suivi comprises dans leurs images.

### Migration
- `20261019150000_audit_skip_bookkeeping.sql` : nouvelle version de la fonction `audit_row()`, sans reprise de
  données (les lignes déjà écrites restent). À appliquer avec les migrations (`druid-migrate` à Nantes, job `migrate`
  du workflow `centrale-db` pour Centrale, hors des heures d'usage).
- Réglage d'instance `DB_CONTAINER` (et au besoin `DB_NAME`, `DB_USER`) à ajouter à la configuration de déploiement
  avant la mise en production ; sans lui, la base n'est pas sauvegardée par `deploy.sh`.

## [2.11.0] — 2026-10-19

### Ajouté
- **Import d'un annuaire de site — équipes et type d'appartenance** : le fichier `druid-site-import` peut déclarer les
  équipes (ou thèmes) du labo (`teams` : acronyme, nom, description, page) ; celles qui manquent sous le labo sont
  proposées à la création (cochées), créées avant les fiches. Chaque personne peut porter son type d'appartenance
  (`membershipType` : membre statutaire, associé, invité…), proposé en complément ou en différence comme les autres
  champs et écrit à la création. Les libellés d'équipe du site sans équipe correspondante sont signalés. Champs
  facultatifs : les fichiers existants restent valides.
- **Nouvelle équipe sur PostgreSQL** : à sa création, une équipe est reliée aux appartenances de son labo qui portent
  déjà son libellé (`membership_team`), sans réenregistrer chaque fiche.

### Modifié
- **Instances Cloudflare sur PostgreSQL — newsletter et veille** : la génération des brèves
  (`/api/newsletter/generate`) écrit dans `newsletter_item` par le store des publications de l'instance au lieu de la
  table Grist `Newsletter` ; la veille (`/api/news/:slug`) et les posts LinkedIn (`/api/newsletter/post`) lisent
  l'Annuaire de la base. Une instance en `storage: "postgres"` peut donc garder `features.newsletter` (Centrale,
  lot 10 d du plan de migration). Chaque route libère sa connexion à la base une fois la réponse construite.

## [2.10.0] — 2026-10-19

### Ajouté
- **Appels à projets — « Mon projet »** : un chercheur décrit un projet (français ou anglais) et l'assistant présente
  les appels ouverts ou annoncés qui lui correspondent, tous programmes confondus (Europe, ANR, France 2030, appels
  saisis à la main), avec l'échéance, le lien vers la page et une phrase sur l'adéquation (rapprochement lointain
  signalé). Le modèle ILaaS écrit 6 requêtes (anglais et français), comparées par similarité bge-m3 aux passages des
  appels (résumé, objectifs, périmètre ; fusion des rangs), puis présente 5 appels au plus parmi les 12 plus proches.
  Vue « Mon projet » de l'onglet et onglet du même nom dans l'assistant (`openChat`) ; route
  `POST /api/calls/project-chat` (SSE, comme l'aide), capacité `HAS_CALLS_CHAT`. Vecteurs dans la table
  `call_passage`, écrits par `scripts/embed_calls.ts` (passage revectorisé seulement si son texte ou le modèle change,
  passages des appels clos supprimés). Lot 7 du plan `plan-funding-calls.md`.
- **Fiche chercheur — carte « Appels à projets »** : les appels où l'appariement a retenu la personne (force,
  justification, publications, boutons d'avis ; appels clos masqués par défaut) et, pour le droit établissement
  seulement, les appels réservés à une étape de carrière où sa date de thèse la rend éligible ou à vérifier (fenêtre
  de l'appel, thèse de la fiche). Mêmes règles de visibilité que l'onglet (un droit labo voit les fiches de ses labos,
  le chercheur la sienne). Route `/api/researchers/:key/calls` ; carte masquée quand il n'y a rien. Lot 7 du plan
  `plan-funding-calls.md`.
- **Fiche chercheur — IdHAL_i secondaires** : sous l'IdHAL_i, un champ « Autres IdHAL_i (non moissonnés) » garde les
  autres personnes HAL du chercheur (un même chercheur en a souvent plusieurs, avec ou sans IdHAL), avec un lien vers
  leurs dépôts et un bouton « définir comme principal » qui échange un secondaire avec le principal. Seul l'IdHAL_i
  principal part dans people.csv (`idhali`) et est moissonné par CRISalid. PostgreSQL : lignes `idhal_i` sans
  `is_primary` ; Grist : colonne `IdHAL_i_secondaires`, écrite seulement si le document l'a. Les fusions de fiches
  font l'union des secondaires, et la tâche « identifiants partagés » voit aussi un IdHAL_i secondaire porté par une
  autre fiche. Premier lot de l'alignement des IdHAL_i (plan `plan-alignement-idhal-i.md`).

### Modifié
- **Alignement des identifiants — HAL multivalué** (vue unifiée) : chaque personne HAL forte d'un chercheur est
  cochable (une ligne par personne, comme OpenAlex) et les autres candidats s'arbitrent par cases à cocher. La
  première personne cochée devient l'IdHAL_i principal (avec son IdHAL et ses ORCID / IdRef), les suivantes des
  IdHAL_i secondaires ; une pastille « principal » / « secondaire » le montre avant d'appliquer. En vérification, les
  IdHAL_i secondaires proposés par le script apparaissent à cocher. L'écriture n'écrase jamais : un IdHAL_i principal
  déjà présent reste principal, la personne cochée devient secondaire. Lot 3 du plan `plan-alignement-idhal-i.md`.
- **Alignement HAL — personnes HAL sans IdHAL** (`scripts/sync_hal.cjs`) : un candidat est désormais une personne HAL
  (IdHAL_i), avec ou sans IdHAL, et plus seulement un IdHAL. Recherche : fiches sans IdHAL ni IdHAL_i ; plusieurs
  personnes fortes du même chercheur sont gardées ensemble, la principale choisie par IdHAL, puis dépôts sur le site,
  puis dépôts. Une personne qui porte l'ORCID ou l'IdRef de la fiche, au nom concordant et sans suspicion, est écrite
  directement (IdHAL_i, IdHAL_i secondaires, IdHAL s'il existe). Vérification : fiches avec IdHAL ou IdHAL_i ; propose
  des IdHAL_i secondaires (même ORCID / IdRef, ou même nom avec des dépôts sur le site, jamais au-dessus de « moyen »).
  Nouveau signal d'identité mêlée : la forme auteur qui rattache la fiche appartient aussi à une autre personne HAL.
  Liste noire `Alignement_HAL` indexée par l'IdHAL_i. Lot 2 du plan `plan-alignement-idhal-i.md`.

### Migration
- `20261017120000_hal_candidate_person.sql` : les décisions HAL (`alignment_candidate`, source `hal`) passent de
  l'IdHAL à l'IdHAL_i comme clé (2 lignes en prod Nantes). À appliquer avec les migrations (`druid-migrate`).
- Instances sur Grist (Centrale) : avant de remplir des IdHAL_i secondaires, créer la colonne avec
  `node scripts/add_align_columns.cjs --apply` (sur PostgreSQL, rien à faire pour ce champ).
- `20261017150000_call_passage.sql` (« Mon projet ») : passages vectorisés des appels ouverts. Variables
  `EMBEDDING_API_URL`, `EMBEDDING_API_KEY`, `EMBEDDING_API_MODEL` (service bge-m3 des agents CRISalid) dans
  l'environnement du service druid ; sans elles l'assistant reste masqué. Première vectorisation
  `node scripts/.build/embed_calls.cjs` (≈ 3 min pour 342 appels, 2 041 passages), puis job ofelia après la collecte.

## [2.9.0] — 2026-10-17

### Ajouté
- **À traiter — doctorants ayant soutenu leur thèse** : nouvelle règle `doctorant_these` de la détection nocturne
  (`scripts/sync_tasks.cjs`, instances PostgreSQL) : une fiche encore « doctorant » (type d'emploi ou grade) dont l'IdRef
  porte une thèse soutenue sur theses.fr donne une tâche « Doctorant ayant soutenu sa thèse : mettre à jour le statut »
  (fermée seule quand la fiche ne dit plus « doctorant » ou que la personne est validée partie) ; une thèse de plus de
  six ans donne plutôt « Doctorant avec une thèse ancienne sur son IdRef : homonyme ? » (lien vers theses.fr). Les
  thèses sont lues par la table `Theses` de la façade PostgreSQL des jobs (`person_thesis`).
- **Appels à projets — appels saisis à la main** (Administration › Appels à projets, droit établissement) : les appels
  qu'aucun collecteur ne lit (Région, fondations, labex, autres opérateurs de France 2030, appels internes…) s'ajoutent
  depuis l'adresse de leur page, leur PDF, une page enregistrée (intranet) ou leur texte collé ; le serveur lit le texte
  et le modèle de langue de l'instance (ILaaS) propose intitulé, financeur, programme, dates, objectifs, périmètre,
  éligibilité et budget, que la personne relit avant d'enregistrer. Un appel reste « à valider » jusqu'à sa validation ;
  seuls les appels validés apparaissent dans l'onglet,
  même avant tout appariement (le filtre « avec chercheurs » ne les masque pas). Financeurs et programmes (source `manual`) sont créés à la volée
  et réutilisés par leur nom ; les doublons d'adresse sont signalés. Import d'un catalogue CSV ou Excel (aperçu puis
  import, une colonne « Référence » pour mettre à jour) et de l'export RTF d'une recherche ResearchConnect (un appel par
  fiche, source `researchconnect`). L'adresse lue doit être un site public (garde contre les adresses internes).

### Migration
- `20261017090000_call_manual.sql` : colonnes `added_by`, `reviewed_by`, `reviewed_at` de `funding_call` (appels saisis
  à la main). Aucune reprise de données.

## [2.8.1] — 2026-10-16

### Corrigé
- **Fiche chercheur — thèse d'une fiche sans uid** : la thèse lue sur theses.fr ne s'affichait que pour les fiches
  ayant un uid d'annuaire ; une fiche sans uid (identifiant `ext_…`) la retrouve maintenant par sa ligne d'annuaire
  (`/api/researchers/by-row/:rowId/theses`), comme la vue Candidats.

## [2.8.0] — 2026-10-16

### Ajouté
- **Collecte des appels de l'ANR** (druid-internal `docs/plan-funding-calls.md`, lot 4) :
  `scripts/.build/collect_calls.cjs --source=anr` lit la liste des appels ouverts ou annoncés d'anr.fr et la page de
  chacun (titre, état pré-annonce / ouvert / clos, dates de la frise, texte), pour deux programmes : **ANR — Appels
  spécifiques** (partenariats européens, réseaux…) et **France 2030** (PEPR, AMI opérés par l'ANR) ; un appel qui
  quitte la liste passe à clos. **AAPG** : les axes de recherche de la dernière édition publiée (57 en 2027) sont lus
  dans le PDF du texte de l'appel (description, mots-clés, panels ERC, ODD) et deviennent chacun un appel du programme
  `anr-aapg`, rangé par domaine disciplinaire (nouveau filtre « Domaine » de l'onglet), gardé après la clôture jusqu'à
  l'édition suivante. Nouvelle dépendance `unpdf` (pdf.js, sans dépendance système). L'import des rapports
  d'appariement ne relit plus le portail Funding & Tenders pour un programme qui n'en vient pas, et traduit le résumé
  (en anglais) d'un appel en français, auparavant laissé en anglais.
- **Thèse de doctorat des chercheurs** (druid-internal `docs/plan-funding-calls.md`, lot 5) :
  `scripts/.build/sync_theses.cjs` lit sur theses.fr, par l'IdRef de chaque fiche, les thèses dont la personne est
  l'auteur (NNT, titre, date de soutenance, établissement, discipline, statut soutenue / en cours) ; une fiche est
  revérifiée après 180 jours ou quand son IdRef change. Tables `person_thesis` et `person_thesis_check` (migration
  `20261016200000_person_thesis.sql`, PostgreSQL seulement) ; la fiche chercheur affiche la thèse sous la ligne HDR
  (lien vers theses.fr). La date de la thèse sert à l'éligibilité aux dispositifs jeunes chercheurs.
- **Candidats aux appels réservés par étape de carrière** (même lot, décision D5) : `scripts/.build/compute_eligibility.cjs`
  lit la règle de chaque appel ouvert ou à venir dans son texte collecté — fenêtre de soutenance de la thèse des ERC
  Starting et Consolidator, propre à chaque édition (2027 : StG = thèse de 2017 à 2026, CoG = de 2012 à 2021) — et
  classe les chercheurs présents ayant une thèse soutenue : éligible, à vérifier (date connue à l'année à une borne,
  ou thèse juste avant la fenêtre, que l'ERC prolonge pour maternité, congé parental, maladie, service national,
  formation clinique), les non-éligibles n'étant pas gardés. Vue **Candidats** de l'onglet Appels à projets, réservée
  au droit établissement : règle et phrase de l'appel, filtres verdict et grade, lien vers la fiche, export CSV.
  Migration `20261016210000_call_eligibility.sql` (`call_eligibility_rule`, `call_eligibility`).

### Migration
- `20261016200000_person_thesis.sql` : tables `person_thesis` et `person_thesis_check` (thèses lues sur theses.fr).
- `20261016210000_call_eligibility.sql` : tables `call_eligibility_rule` et `call_eligibility` (candidats).
- Instances PostgreSQL, dans l'ordre : sauvegarde de la base (`deploy.sh` ne sauvegarde que le document Grist), puis
  `druid-migrate` ; première collecte ANR
  `docker exec -e NODE_USE_ENV_PROXY=1 crisalid-druid-1 node scripts/.build/collect_calls.cjs --source=anr` (sortie par
  le proxy obligatoire : en accès direct, le pare-feu du réseau intercepte le TLS d'anr.fr) ; première synchronisation
  des thèses `docker exec -e NODE_USE_ENV_PROXY=1 crisalid-druid-1 node scripts/.build/sync_theses.cjs` (≈ 1 h pour
  5 000 fiches à IdRef) ; puis le calcul des candidats
  `docker exec crisalid-druid-1 node scripts/.build/compute_eligibility.cjs`.
- Jobs ofelia à déclarer (snippets dans druid-internal `docs/plan-funding-calls.md`) : `druid-calls-collect-anr`
  (hebdomadaire, `--source=anr`), `druid-theses-sync` (hebdomadaire), `druid-calls-eligibility` (nocturne, après la
  collecte des appels).
- Appariement des appels ANR thématiques : `export_calls.cjs --programme=anr-specific` / `france-2030`, run TRM, puis
  `import_calls.cjs --programme=…` (le titre n'est plus relu sur le portail Funding & Tenders pour ces programmes).

## [2.7.0] — 2026-10-16

### Ajouté
- **Appariement de tous les programmes du portail** (druid-internal `docs/plan-funding-calls.md`, lot 3) :
  `scripts/.build/export_calls.cjs --programme=<id> --out=<dossier>` écrit les appels ouverts ou à venir d'un programme
  (EIC, MSCA, missions, ERC…), un fichier par sous-ensemble, au format des topics de crisalid-agents
  (`topic_researcher_match.py --topics-file`) ; les rapports se réimportent par `import_calls.cjs --programme=<id>`.
- **Export des graphiques en SVG, en PDF vectoriel et de leurs données en CSV** : le bouton de téléchargement de
  chaque graphique du tableau de bord ouvre un menu PNG / SVG / PDF / CSV. SVG et PDF rejouent le graphique affiché
  (légende, zoom, disposition d'un réseau) dans une instance ECharts SVG hors écran, le PDF par svg2pdf.js avec les
  polices de la charte ; le CSV (`;`, virgule décimale, BOM) est relu dans l'option ECharts (`lib/chartExport.ts` :
  catégories × séries, nom / valeur, cellules de heatmap, points de carte, nœuds + liens, niveaux d'un sunburst,
  indicateurs d'un radar), proposé aussi sur les graphiques intégrés (`/embed`), journalisé comme les autres exports.
- **Collecte des appels du portail Funding & Tenders** (druid-internal `docs/plan-funding-calls.md`, lot 2) :
  `scripts/.build/collect_calls.cjs --source=ft-portal` lit en flux le fichier de référence public du portail (tous les
  topics, 130 Mo) et le texte de chaque topic nouveau ou modifié (objectifs, périmètre, budget, dates), pour les
  programmes actifs : Horizon Europe (clusters), ERC, MSCA, EIC, missions, infrastructures, Widening ; Euratom, Digital
  Europe, LIFE, FED, EU4Health, CEF, Erasmus+, Europe créative, CERV, écosystèmes d'innovation et entreprises communes
  déclarés mais inactifs. Migration `20261016090000_call_collections.sql` (journal `call_collection`,
  `funding_programme.last_collected_at`). **Administration › Appels à projets** (droit établissement, capacité
  `HAS_CALLS`) : programmes par financeur, activation, nombre d'appels et d'appariements, dernière collecte, journal
  des collectes. Le job nocturne est à déclarer dans ofelia (voir le plan).

### Modifié
- **Import des rapports d'appariement** : un appel collecté sur son portail garde ses textes, son sous-ensemble et
  sa classification ; le rapport n'apporte que son résumé (dont la traduction est refaite s'il change) et les
  appariements.
- **Appels à projets (ex-« Appels européens »)** : l'onglet du tableau de bord devient générique pour accueillir tous les
  guichets de financement (druid-internal `docs/plan-funding-calls.md`, lot 1) — modèle financeur → programme → appel →
  appariement (tables `funder`, `funding_programme`, `funding_call`, `call_match_run`, `call_match`, `call_feedback` à la
  place des `eu_*`), filtres par financeur, programme et sous-ensemble (cluster, axe, panel), routes `/api/calls/*`,
  clé d'onglet `calls` (les liens `?tab=eu-calls` sont redirigés). Le script d'import s'appelle désormais
  `scripts/.build/import_calls.cjs` (`npm run build:calls`) : `--perimeter=` remplace `--scope=` (toujours accepté),
  `--subset=` remplace `--cluster=`, `--programme=` (défaut `horizon-europe`).

### Migration
- `20261015150000_funding_calls.sql` : crée les tables génériques, y reporte les topics, runs, appariements et avis
  Horizon Europe déjà importés, puis supprime les tables `eu_*` (retour arrière possible : la migration `down` les
  reconstitue depuis le programme `horizon-europe`).
- `20261016090000_call_collections.sql` : journal `call_collection` et `funding_programme.last_collected_at`.
- Après le déploiement (instances PostgreSQL) : première collecte du portail
  `NODE_USE_ENV_PROXY=1 node scripts/.build/collect_calls.cjs --source=ft-portal` (≈ 400 textes par passage, relancer
  jusqu'à « 0 new »), puis job nocturne ofelia `collect_calls.cjs --source=ft-portal` (snippet dans druid-internal
  `docs/plan-funding-calls.md`) ; réimport des rapports d'appariement par `import_calls.cjs` (`--perimeter=`,
  `--programme=` hors Horizon Europe) — `import_trm.cjs` n'existe plus.

### Corrigé
- **Appels à projets — filtre de sous-ensemble sans libellé** : le second filtre de l'onglet (clusters, missions,
  dispositifs…) affichait une première option vide ; ses libellés sont maintenant extraits et traduits (« Toutes les
  missions », « Tous les dispositifs », « Toutes les destinations »…), distincts des pôles de l'annuaire.
- **Appels à projets — doublons du portail** : le portail Funding & Tenders liste certains topics une seconde fois sous
  un identifiant sans année (`HORIZON-EIC-PATHFINDERCHALLENGES-01-01` à côté de `HORIZON-EIC-2026-…`), même titre,
  mêmes dates, en « à venir » et sans sous-ensemble : la collecte écarte cette copie et supprime celles qu'une collecte
  précédente avait enregistrées (sauf si un run les a appariées).
- **Appels à projets** : l'avertissement « hors de ce périmètre » ne s'affiche plus pour une structure contenue dans le
  périmètre du calcul — un labo ou une équipe pour un run sur tout l'établissement (« Nantes Université »), une équipe
  pour un run sur son labo.

## [2.6.0] — 2026-10-15

### Ajouté
- **Appels européens : périmètre du calcul** : l'import d'un rapport TRM enregistre le périmètre sur lequel le batch a
  tourné (`import_trm.cjs --scope=<libellé>`, les structures dont les publications portent des vecteurs) ; l'onglet
  l'affiche et avertit quand la structure consultée est hors de ce périmètre (ses chercheurs n'y apparaissent qu'en
  cosignataires). Page du centre d'aide « Appels européens » (lecture d'un indice, avis, limites).
- **Appels européens en français** : les résumés des topics et les justifications des appariements, écrits en anglais par
  le batch, sont traduits une fois à l'import par le modèle de l'instance (`import_trm.cjs --translate-only` pour les
  données déjà importées) et affichés en français quand l'interface est en français (migration
  `20261015110000_eu_calls_fr.sql`).
- **Tableau de bord › Pilotage › Appels européens** : topics du programme de travail Horizon Europe 2026-2027 appariés
  aux chercheurs de la structure par le batch *Topic-to-Researcher Match* de crisalid-agents, en deux vues (par topic
  avec échéances, appel et lien vers le portail Funding & Tenders ; par chercheur), avec les avis des utilisateurs
  (« Pertinent », « Non pertinent », « Déjà en montage ») renvoyés au batch pour son évaluation (`/api/eu-calls/*`,
  export CSV des avis pour les droits établissement). L'onglet n'apparaît qu'une fois un rapport importé ; PostgreSQL
  seulement.
- **Tableau de bord › Pilotage › Axes stratégiques : curation** (instances PostgreSQL) : chaque publication de la période
  avec son axe automatique, sa confiance, ses axes secondaires et la motivation du classement (druid-biblio, axes par
  embeddings + modèle), et les décisions des relecteurs — Confirmer, Corriger (un ou plusieurs axes, note), Hors axes,
  Incertain, annulation — appliquées immédiatement aux graphiques ; filtres (à relire, relues, par décision, axe
  automatique, confiance faible, texte), avancement global et par axe, taux de confirmation, tirage d'un échantillon de
  40 publications à relire. Le texte d'introduction décrit la méthode effectivement utilisée.
- **Revues des axes stratégiques** (`/api/v1/axis-reviews/:slug`, PostgreSQL seulement) : décision d'un utilisateur sur
  la classification automatique d'une publication — confirmée, corrigée (un ou plusieurs axes), hors axes, incertaine —
  une par publication et structure, signée et journalisée ; socle de l'écran de curation de l'onglet Axes stratégiques
  (druid-internal `docs/plan-axes-embeddings.md`, lot 2). Les corrections Grist de Centrale restent lues comme avant.
- **Instances Cloudflare sur PostgreSQL** (lot 10 a du plan de migration) : `storage: "postgres"` dans `instance.json`
  et une liaison Hyperdrive `HYPERDRIVE` (`HYPERDRIVE__<SLUG>` sur un déploiement partagé) remplacent le document Grist
  et sa clé ; les Functions `/api/v1`, rapports, actualités et newsletter lisent la base de l'instance par la même
  fabrique de stockage que le serveur Node (`lib/directory/pg/storage.ts`). Sans liaison, `/api/v1` répond 500.
- **Seed PostgreSQL des instances de démonstration** (lot 10 b du plan de migration) : `npm run seed:demo -- --instance
  demo|demo-2 [--apply]` charge les données fictives de `instances/<slug>/demo-data.mjs` dans une base migrée par la
  même voie que l'import Grist ; `npm run build` le relance à chaque build de production Cloudflare Pages quand le
  secret de build `DEMO_DATABASE_URL` est présent (jamais sur une prévisualisation).

### Modifié
- **Démo publique sur PostgreSQL** (lot 10 c) : `instances/demo/instance.json` passe en `storage: "postgres"` ; l'instance
  lit une base Neon par la liaison Hyperdrive `HYPERDRIVE` du projet Pages (rechargée depuis `demo-data.mjs` à chaque
  déploiement de production, secret de build `DEMO_DATABASE_URL`). Le document Grist public n'est plus lu.

### Corrigé
- **Build Cloudflare Pages des instances PostgreSQL** : la compilation des Functions par le build system échouait
  (« Could not resolve "events" », 24 erreurs) même avec le flag `nodejs_compat` posé sur le projet. Le pilote
  node-postgres est désormais pré-assemblé par `npm run build` (`functions/_generated/pg.js`) avec ses modules Node en
  `node:*`, acceptés sans flag ; `lib/db/core.ts` porte la création Kysely commune au serveur et aux Functions.
- **Appels européens** : les titres des topics viennent désormais du portail Funding & Tenders (titre officiel et échéances),
  à l'import et par `import_trm.cjs --refresh-titles` — l'extraction des PDF coupait des mots (« Ne xt generation ») ;
  l'indice d'un appariement montre la force évaluée par le modèle (forte / plausible / faible) et, à part, le score relatif
  au sein du topic sous forme de barre : le meilleur candidat d'un topic valait toujours « 100 », même jugé faible.
- **Équipes d'une appartenance** : un libellé d'équipe n'est plus relié à une équipe d'un autre labo. Les codes
  génériques des annuaires de labos (E1, E2…) existent dans plusieurs labos, et le seul labo qui les déclarait comme
  structures recevait les membres des autres (à Nantes : 628 liens faux vers les équipes du CRCI2NA, dans 12 labos).
  Une équipe n'est reliée que sous le labo de l'appartenance ; sans labo résolu, seulement si l'acronyme est unique.

### Migration
- `db/migrations/20261015090000_eu_calls.sql` (tables `eu_topic`, `eu_topic_match_run`, `eu_topic_match`,
  `eu_topic_feedback`), puis `node scripts/.build/import_trm.cjs --file=<rapport TRM .json>` par cluster.
- `db/migrations/20261015100000_axis_review.sql` (table `axis_review`).
- `20261014120000_team_links_under_lab` (appliquée par `druid-migrate`) : supprime les liens d'équipe dont l'équipe
  n'est pas sous le labo de l'appartenance ; les libellés `team_labels` sont conservés et seront reliés à la création
  des équipes du labo (fait pour l'IMN le 2026-10-14).

## [2.5.0] — 2026-10-13

### Ajouté
- **Administration › Établissements** (droit établissement) : la liste des établissements employeurs proposée par le
  champ « Établissement employeur » des fiches se gère désormais dans Druid — ajout (nom, forme longue, UAI, ROR,
  PPN IdRef, avec contrôle de forme et refus des doublons de nom ou d'UAI), modification en ligne, nombre de fiches
  par établissement. Routes `POST` / `PUT /api/v1/institutions`, sur PostgreSQL comme sur Grist ; page d'aide
  « Gérer les établissements employeurs ».

## [2.4.0] — 2026-10-13

### Modifié
- **Tableau de bord en sept familles d'analyses** (Vue d'ensemble · Publications · Impact · Collaborations · Effectifs ·
  Pilotage · Veille) : les 17 onglets sont regroupés sur deux rangées (familles avec icône, puis vues de la famille
  ouverte) ; la Vue d'ensemble se termine par une grille « Explorer les analyses » (description, chiffre repère, vues
  cliquables). Les liens partagés `?tab=…`, les liens d'aide, le catalogue des rapports et `druid_tabs_hidden`
  gardent les clés d'onglet existantes.
- **Nouvelle vue Effectifs › Annuaire** : les statistiques d'annuaire de l'ancienne vue « Graphiques » de la page
  Personnel (présence et employeur, parité, couverture des identifiants, employeurs, grades, types d'emploi, labos),
  calculées à ce jour sur les fiches rattachées à la structure du tableau de bord (équipes comprises), en ECharts avec
  export PNG. Bouton « Ouvrir la liste dans Personnel » (filtre Labo).
- **Page Personnel** : la bascule Liste / Graphiques est remplacée par un bandeau « Chiffres clés » (fiches, présents,
  HDR, part de femmes, ORCID) qui suit les filtres, avec le bouton « Toutes les analyses d'effectifs » vers la vue
  Effectifs du labo filtré. `?mode=dashboard` n'est plus lu.

### Corrigé
- **Instances sur PostgreSQL : la liste des personnes n'était plus rafraîchie après une écriture hors de l'écran
  de la fiche** (arbitrage d'un conflit d'import, tâche, synchronisation). La version des listes mises en cache
  (dernière ligne du journal d'audit) était triée en texte (« 999 » devant « 5237 ») et ne bougeait plus ; un
  identifiant pris depuis l'annuaire Centrale restait invisible dans la fiche jusqu'au redémarrage. Tri numérique
  rétabli, test d'intégration ajouté.
- Un lien direct vers la vue Effectifs › Annuaire (`?tab=staff`) retombait sur la Vue d'ensemble, les fiches de
  l'annuaire arrivant après les données bibliométriques ; la vue attend désormais le chargement de l'annuaire.
- Centre d'aide : le build Cloudflare des branches de PR du Worker `druid-aide` échouait (bloc `previews` manquant
  dans `help/wrangler.jsonc`, réglages « Previews Base » à la racine du dépôt) ; chaque PR touchant `help/` a de
  nouveau une URL de prévisualisation.

### Retiré
- `components/ResearcherDashboard.tsx` (graphiques recharts de la page Personnel), remplacé par la vue Annuaire.
- Dépendance `recharts` (plus aucun graphique ne l'utilise : tout est en ECharts).

## [2.3.0] — 2026-10-12

### Modifié
- **Brèves de la newsletter dans PostgreSQL** (instances sur PostgreSQL, plan PostgreSQL lot 14 a) : table
  `newsletter_item` au lieu de la table Grist `Newsletter` ; génération, liste et validation passent par le store des
  publications, chaque écriture est signée dans le journal d'audit. Les instances sur Grist (Cloudflare) ne changent pas ;
  les corrections d'axes restent dans le document Grist de la structure (lot 10).

### Corrigé
- Administration › suivi des retraits envoyés au graphe CRISalid : l'encart ne montrait pas qu'il se déplie (ligne de
  titre sans triangle) ; chevron et lien « Détail » / « Masquer » ajoutés.

### Retiré
- **Contrôle des affiliations OpenAlex** (abandonné pour le moment, plan PostgreSQL lot 14 b) : onglet « À traiter ›
  Affiliations OpenAlex », route `/api/tasks/openalex-affiliations`, bloc « Vérification des affiliations OpenAlex » et
  mots-clés de contrôle de la console ETL. Aucune correction n'avait été traitée ; la table Grist
  `Corrections_affiliations_Openalex` reste en archive (554 lignes), les mots-clés restent dans les `config.yaml` de
  druid-biblio. Centre d'aide : « Une affiliation est fausse » renvoie au signalement chez OpenAlex.

### Migration
- `20261014090000_newsletter` (table `newsletter_item`), appliquée par `druid-migrate`, puis import des brèves depuis
  Grist : `docker exec crisalid-druid-1 node scripts/.build/import_newsletter.cjs --out=/app/logs/newsletter_import`
  (à blanc), puis avec `--apply` ; la table Grist `Newsletter` reste en archive.

## [2.2.0] — 2026-10-12

### Ajouté
- **Administration › suivi des retraits envoyés au graphe CRISalid** (publieur en `dry-run` ou `on`) : encart repliable
  sous l'état de l'export SoVisu+ — retraits envoyés (les 30 derniers, avec l'auteur de la correction), à envoyer, en
  échec (erreur, tentatives), bloqués (type refusé par l'IKG), valeurs de l'annuaire à corriger, personnes du graphe sans
  fiche, état connu du graphe (dernier export `people.csv`, dernier instantané) ; un clic sur un uid ouvre la fiche.
  Route `GET /api/graph-actions-status`. Centre d'aide : étape 8 du tutoriel « Identifiants d'un labo de A à Z ».

## [2.1.0] — 2026-10-12

### Ajouté
- **Retraits d'identifiants envoyés au graphe CRISalid** (instances sur PostgreSQL) : un identifiant retiré ou corrigé
  dans l'annuaire part vers l'IKG comme action utilisateur `REMOVE` (format SoVisu+), pour que le graphe nettoie les
  publications moissonnées avec lui — `people.csv` retire l'identifiant de la personne mais laissait ces publications
  attribuées. Publieur `scripts/.build/graph_publish.cjs` (une fois par nuit), `DRUID_GRAPH_ACTIONS=off|dry-run|on`
  (`off` par défaut), `DRUID_AMQP_URL` (utilisateur RabbitMQ limité à l'écriture sur l'exchange `graph`) ; message
  confirmé par le bus et routé vers une file, sinon en échec et rejoué. Point de départ : instantané du graphe
  (`scripts/graph/export_graph_identifiers.sh` sur l'hôte du graphe, `scripts/.build/import_graph_snapshot.cjs`).
  Gardes : valeur illisible ou personne sans fiche jamais traitées automatiquement, plus de 25 retraits en un passage
  refusés sauf `--force`, Scopus gardé en attente tant que l'IKG le refuse (`DRUID_GRAPH_ACCEPTED_TYPES`).

### Modifié
- **Export `people.csv` vers SoVisu+** avec le publieur actif : envoie d'abord au graphe les retraits en attente (sinon
  l'identifiant disparaîtrait sans nettoyage), et n'est refusé que s'ils n'ont pas pu partir (bus refusé ou injoignable,
  plus de 25 retraits d'un coup) ; un identifiant dont l'IKG refuse encore le retrait (Scopus) y garde la valeur du
  graphe ; l'export devient l'état connu du graphe.

### Migration
- `20261013090000_graph_actions` (tables `graph_identifier_state`, `graph_action`), appliquée par `druid-migrate`.

## [2.0.0] — 2026-10-09

### Ajouté
- **API de l'annuaire `/api/v1`** : toutes les lectures et écritures du navigateur (fiches, structures,
  établissements, doublons et fusions, revue LDAP, alignements des identifiants, newsletter, axes) passent par une
  API métier du serveur, qui applique elle-même les droits (établissement ou labo) et journalise chaque écriture
  (table, lignes, noms des champs). Les Functions Cloudflare servent la même API.
- **Annuaire sur PostgreSQL**, au choix de l'instance : `DRUID_STORAGE=grist|postgres` (`DRUID_DATABASE_URL`, rôle
  `druid_app`) vaut pour le serveur et les jobs ; Grist reste le défaut. Schéma versionné (`db/migrations`, dbmate,
  rôles `druid_owner` / `druid_app`) ; import du document Grist (`scripts/.build/migrate_grist_to_pg.cjs`, à blanc
  par défaut, rapport sans valeurs) ; copie nocturne de la base vers le document Grist, en lecture seule, ligne à
  ligne avec les mêmes ids (`scripts/.build/copy_pg_to_grist.cjs`, à blanc par défaut). Les publications, la
  newsletter et les corrections d'affiliations restent dans Grist.
- **Jetons de service** (`DRUID_SERVICE_TOKENS`, empreintes seulement) : un client machine (druid-biblio) lit
  l'annuaire sans session — `GET /api/v1/people[?lab=]`, `/structures`, `/institutions` uniquement — et chaque
  lecture est journalisée (`service.read`). Nouveau jeton : `node scripts/lib/service_tokens.cjs new <nom>`.
  `GET /api/v1/people?lab=<acronyme>` ne renvoie que les fiches d'un labo.
- Personnel › Synchroniser › **Importer un annuaire de site** : dépôt du fichier produit par le skill
  `sync-annuaire-grist` de druid-biblio (`--export`), revue du rapprochement (créations, compléments des champs
  vides, différences avec le site, présents à valider, homonymes écartés, absents) et application de ce qui est
  coché. Les fiches créées gardent leur source (`Data_source`) ; la page annuaire du site est enregistrée.

### Modifié
- Collaborations › Par pays et modèle de rapport « Collaboration avec un pays » : le pays partenaire se
  choisit dans une liste alphabétique avec recherche (accents ignorés, nom français ou anglais :
  « vietnam » trouve « Viêt Nam ») au lieu d'une liste déroulante triée par nombre de copublications.
- Liste du personnel : « Chargement des fiches… » pendant le chargement, au lieu de « Synchronisation avec Grist
  en cours… ».
- Jobs et scripts (alignements, synchronisations, fusions, export ABES, éméritat, tâches) : ils passent par le
  stockage de l'instance, et non plus directement par le document Grist.

### Sécurité
- Les écritures du navigateur sont des commandes contrôlées par le serveur (champs autorisés, périmètre du labo,
  refus explicites) : le proxy Grist laissait écrire n'importe quelle colonne des tables qu'il ouvrait.

### Retiré
- **Proxy Grist du navigateur** : `/api/grist/*` répond 410. Un client qui lisait ou écrivait le document par ce
  proxy doit passer par `/api/v1` (ou par un jeton de service pour un client machine).

### Migration
- Aucune opération obligatoire : la production reste sur Grist (`DRUID_STORAGE` absent = `grist`), sans base.
- Pour que druid-biblio lise l'annuaire par l'API : créer un jeton dans le conteneur
  (`docker exec crisalid-druid-1 node scripts/lib/service_tokens.cjs new druid-biblio`), ajouter
  `DRUID_SERVICE_TOKENS` à l'environnement de `druid.yaml`, puis `DRUID_API_URL` et `DRUID_SERVICE_TOKEN` à celui de
  druid-biblio ; sans eux, druid-biblio continue de lire le document Grist.

## [1.7.1] — 2026-10-07

### Modifié
- Rapports : la note méthodologique décrit les sources réellement fusionnées par druid-biblio (graphe CRISalid,
  BSO, OpenAlex, HAL), le dédoublonnage, la portée du périmètre « Affiliation » (les publications remontées par
  CRISalid peuvent précéder l'arrivée du chercheur), les indicateurs qui n'existent que pour les notices connues
  d'OpenAlex et l'origine du statut d'accès ouvert ; les lignes « Source » des rapports et des graphiques intégrés
  citent les quatre sources.
- Dépendances : `fast-xml-parser` 5 (synchronisation IdRef, analyse des notices inchangée), `http-proxy-middleware`
  4, `lucide-react` ; centre d'aide : `@astrojs/starlight`.

## [1.7.0] — 2026-10-07

### Ajouté
- Tableau de bord › Collaborations › **Par pays** : le bilan des collaborations avec un pays partenaire. Choix du
  pays (du plus fréquent au moins fréquent, gardé dans le lien `?sub=country&cc=`), options « Exclure les grandes
  collaborations (> 50 auteurs) » et « Regrouper hôpitaux et instituts avec leur université ». Chiffres clés
  (co-publications, part de l'international, rang parmi les pays partenaires, tendance, part bilatérale,
  chercheurs, labos, accès ouvert, grandes collaborations) ; évolution annuelle et rang du pays ; établissements
  **du pays seulement** (carte cadrée sur leurs coordonnées, classement, provinces ou régions quand l'export les
  connaît) ; labos et chercheurs impliqués, tableau « qui travaille avec qui » ; domaines, sous-disciplines et
  indice de spécialisation ; impact comparé aux autres co-publications internationales des mêmes
  sous-disciplines (hors publications de plus de 50 auteurs) ; financeurs par origine (pays, Europe, France,
  autres) ; part bilatérale, autres pays, langues. Les clics ouvrent la liste des publications filtrée.
- Rapports : modèle **« Collaboration avec un pays »** (présentation, synthèse IA, chiffres clés, dynamique et rang,
  établissements et carte, personnes et labos, thématiques et spécialisation, analyse IA par grand thème, impact,
  financements, autres pays et langues, liste des publications ; aucun chiffre écrit dans les textes). 15
  graphiques `pays-*` et deux jeux de chiffres clés (collaboration avec un pays, impact) partageables et
  ajoutables à un rapport depuis le sous-onglet, avec le pays et les options choisis. Ils lisent le pays dans les
  filtres du rapport et le corpus complet pour le rang, la part de l'international et la référence d'impact
  (aperçu, PDF, liens `/embed`).
- Centre d'aide (fr, en) : guide « Analyser les collaborations » (sous-onglet Par pays, spécialisation, impact),
  « Modèles de rapport », « Publications et attribution » (pays d'une publication), Nouveautés.

### Modifié
- Le pays d'une publication comprend aussi les pays de ses institutions partenaires (sous-onglet Par pays, filtre
  « Pays » de la liste des publications). Les exports druid-biblio du 2026-10-07 réunissent les pays de toutes les
  sources et recalculent le caractère international : les chiffres internationaux augmentent.
- Modèle « Collaborations internationales » : plus de paramètre pays, il porte sur tous les pays (les rapports
  enregistrés ne changent pas). Formulaire « Nouveau rapport » : le pays est obligatoire pour le modèle pays et la
  liste propose les pays étrangers, institutions comprises.
- Synthèse IA d'un rapport limité à un pays : traitée comme une collaboration (pistes de coopération, partenaire =
  le pays).
- Collaborations : le sous-onglet ouvert est gardé dans le lien (`?sub=`).

### Corrigé
- Notices d'encyclopédie « signées » par les directeurs de l'ouvrage (OpenAlex les donne comme auteurs de chaque
  entrée) : marquées par druid-biblio (`isEditorialEntry`), elles ne comptent plus comme collaborations ni dans les
  classements de chercheurs (classement, publications par membre et par âge, réseau de co-signatures), mais restent
  dans les volumes de la structure.

### Migration
- Aucune opération au déploiement : les exports druid-biblio (pays complétés, région et université de tutelle des
  établissements, pays des financeurs, notices éditoriales marquées) ont été régénérés le 2026-10-07 et sont déjà
  servis à la production.

## [1.6.1] — 2026-10-07

### Corrigé
- Session perdue (redéploiement, expiration après 8 h) : les onglets ouverts reviennent à la connexion au premier
  appel refusé (401), au lieu d'afficher une erreur par écran (« Erreur Grist (Annuaire) » sur l'onglet Doublons).
  Instances à session serveur seulement (`/api/me` renvoie `auth: 'session'`) ; rien ne change sur Cloudflare.

### Modifié
- À traiter › Doublons : même mise en page que les onglets Tâches et Conflits (barre d'outils avec la date de
  génération, contenu pleine largeur, plus de pied de page).

## [1.6.0] — 2026-10-07

### Ajouté
- Personnel : la **présence** (Présent, Départ, Parti), l'**employeur** et le **compte LDAP** de l'établissement
  (actif, en fermeture, aucun) remplacent le statut Interne / Externe, qui mélangeait les trois. La présence suit
  les dates de fin et les listes validées ; l'annuaire LDAP ne la détermine que pour le personnel de l'établissement
  (employeur établissement ou non renseigné) ; « Départ » = compte en fermeture ou fin d'emploi dans les 3 mois.
  Liste : colonne Présence avec la clé LDAP, filtres **Présence**, **Employeur** (Établissement / Autres employeurs /
  Non renseigné / un employeur) et **Compte LDAP**, raccourci **Personnels internes** (présents et employés par
  l'établissement) ; les anciens liens `?status=` sont traduits. Fiche : présence et compte LDAP dans l'en-tête.
  Tableau de bord du personnel : répartition par présence et employeur.
- Fiche chercheur : **n° agent** (identifiant RH, Mangue) en lecture seule, lu dans l'Annuaire
  (`N_ID_UNIV_NANTES_revu_SI_RH_MANGUE_`) ; la synchro LDAP le lit (`supannEmpId`) et la revue LDAP le propose
  quand il manque, ou le signale « N° agent différent » (décoché par défaut).
- Tâches : **passer une fiche `ext_` sur son uid LDAP** (n° agent = compte LDAP qu'aucune fiche ne porte), avec un
  bouton dans le détail de la tâche et une tâche de suivi SoVisu+ (retirer les identifiants de l'ancienne personne) ;
  **compte LDAP hébergé en fermeture** pour un employeur autre que l'établissement (départ probable à vérifier) ;
  **employeur à renseigner** (créées par la migration 002). Le n° agent rejoint les identifiants partagés (doublons).
- « Remplir depuis le LDAP » : l'employeur est déduit quand c'est sûr (personnel de l'établissement avec un corps,
  comptes ouverts par l'outil CNRS), sinon un message demande de le choisir.
- Centre d'aide (fr, en) : page « Statuts des personnes » réécrite pour les trois axes ; filtres, fiche, validation,
  tâches, glossaire et Nouveautés mis à jour.

### Modifié
- Validation manuelle : elle porte sur la présence (`validated_status` = PRESENT / DEPART / PARTI) ; les valeurs
  INTERNE et EXTERNE sont lues comme PRESENT. La revue LDAP ne propose plus d'aligner la validation d'une personne
  employée ailleurs sur son compte hébergé.
- Pastille « Validé — conflit » : elle compare des présences (Interne contre Externe n'est plus un conflit).

### Corrigé
- « Remplir depuis le LDAP » ouvert depuis l'onglet des arrivées LDAP : l'employeur restait vide (la recherche partait
  avant le chargement de la liste des employeurs).
- Liste du personnel : la pastille « Validé — conflit » et l'`eppn` étaient perdus au chargement (champs absents du
  schéma de validation des données).
- Instance sans cache LDAP : une fiche avec un vrai uid n'est plus classée « Parti » faute de le trouver dans le cache.

### Migration
- Après le déploiement : relancer la **synchro LDAP** (le cache doit porter le n° agent), puis **Lancer la
  détection** des tâches (bascules `ext_` → uid, comptes hébergés en fermeture).
- Puis seulement : `docker exec crisalid-druid-1 node scripts/migrations/002-validated-presence.cjs --apply`
  (`validated_status` INTERNE / EXTERNE → PRESENT, sauvegarde JSON, tâches « employeur à renseigner » ; idempotente).
  Une version antérieure de Druid lirait PRESENT comme une absence de validation. À Nantes : 5 343 valeurs, 355 tâches.
- Déjà faits à Nantes le 2026-10-07 : n° agent rempli depuis le LDAP (1 267 fiches) et employeur déduit du LDAP
  (668 fiches), par scripts hors dépôt.

## [1.5.0] — 2026-10-06

### Ajouté
- Liste du personnel : filtre **Appartenance** (statutaire, associé, affiliation secondaire, invité, non renseigné),
  appliqué à l'affiliation principale comme le filtre Labo ; paramètre d'URL `membership`.

### Modifié
- Liste du personnel : filtres sur une seule ligne de pastilles compactes (Labo, Appartenance, Statut, Employeur,
  Corps-grade) ; Validation, Parcours, Type d'emploi, Pôle, Identifiants présents et Période d'emploi passent dans
  un panneau « Plus de filtres », dont les valeurs actives restent visibles en puces supprimables ; bouton
  « Tout effacer ».

### Sécurité
- `proxy-addr` 2.0.8 : l'adresse IP du client (journaux d'accès et d'audit, derrière `TRUST_PROXY`) ne peut plus
  être usurpée par une adresse IPv6 encapsulant de l'IPv4 (alerte critique).
- Outillage de build et de test, sans effet sur l'application servie : `vitest` 5 et `tinypool` (deux alertes
  critiques), `source-map-js` 1.2.2 (application et centre d'aide), `@babel/core` 7.29.7.

## [1.4.0] — 2026-10-06

### Ajouté
- Tableau de bord, onglet **Chercheurs** : filtre de population (appartenance au labo, catégorie — permanents,
  non-permanents, doctorants, émérites — et présence : membres actuels ou présents sur la période, au prorata),
  raccourci « Statutaires et doctorants », période propre (par défaut les 4 dernières années complètes). Nouveaux
  indicateurs : effectif, ETP recherche, publications par ETP recherche et par an, part de membres publiants ;
  graphiques **taux de publication par tranche d'âge** (âge à la publication), publications par tranche et par année,
  pyramide des âges, publications par membre ; tableau exportable en CSV avec la note de méthode. Doctorants et
  émérites sont hors du taux ; les tranches de moins de 3 personnes sont fusionnées. Le classement des auteurs suit
  le filtre. Clic sur une tranche : liste des publications correspondantes (nouveau filtre « auteur × année »).
  Nécessite un export druid-biblio du 2026-10-06 ou plus récent (sinon l'onglet reste inchangé).
- Centre d'aide (fr, en) : page « Lire les effectifs et le taux de publication par ETP » (population, lecture des
  graphiques, export, méthode, limites), ETP sur la fiche, Nouveautés d'octobre ; le bouton « ? » de l'onglet
  Chercheurs y mène.
- Fiche chercheur, carte « Emploi & contrat » : deux champs **ETP (quotité)** et **ETP recherche** (0 à 1), enregistrés
  dans les colonnes `etp_quotite` / `etp_recherche` de l'Annuaire. Vide = non renseigné, distinct de 0 (aucun temps de
  recherche), y compris lors d'une fusion de doublons. Les champs n'apparaissent que si l'Annuaire de l'instance a les
  deux colonnes. Préalable au taux de publication par ETP recherche de l'onglet Chercheurs du tableau de bord.

### Migration
- Créer les colonnes ETP dans l'Annuaire d'une instance qui veut les saisir : `node scripts/add_fte_columns.cjs --apply`
  (colonnes Numeric vides, et formule « nouvelles lignes = vide » pour que Grist n'y mette pas 0). Fait sur les
  documents Nantes (prod et test) le 2026-10-06.

### Corrigé
- Fiche chercheur : le type d'appartenance au labo (membre statutaire, associé…) s'affiche à nouveau dans la carte
  « Appartenances » ; il était perdu à la lecture, et enregistrer la fiche effaçait la valeur dans Grist
  (`membership_type` remis à vide).
- Alignement des identifiants chercheurs : valider des candidats n'échoue plus (« Invalid column
  "Scopus_champs_modifies" ») sur une instance dont l'Annuaire n'a pas les colonnes de traçabilité d'une source
  (`<Source>_derniere_maj`, `<Source>_champs_modifies`) ; l'identifiant est écrit, la traçabilité absente est
  ignorée. Pour la créer : `node scripts/add_align_columns.cjs --apply`.

## [1.3.0] — 2026-10-05

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
