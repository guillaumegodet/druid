# 🧙‍♂️ Druid (Directory for Researchers, Units & Identifiers)

**Druid** est le portail de gestion et de pilotage de la recherche de Nantes Université. Il centralise les identités, affiliations et structures de recherche (pont entre le **LDAP** institutionnel et la curation collaborative **Grist**), et intègre un **tableau de bord bibliométrique** complet alimenté par OpenAlex/BSO, une **veille des nouvelles publications** et un **assistant conversationnel** adossé au graphe CRISalid.

![React](https://img.shields.io/badge/Stack-React_19-61dafb.svg)
![Vite](https://img.shields.io/badge/Stack-Vite_6-646cff.svg)
![Tailwind](https://img.shields.io/badge/Styling-Tailwind_3-38bdf8.svg)
![ECharts](https://img.shields.io/badge/Dataviz-ECharts_6-aa344d.svg)
![Keycloak](https://img.shields.io/badge/Auth-Keycloak-4d4d4d.svg)

---

## 🚀 Fonctionnalités Clés

### 📂 Annuaire & Curation
- **Synchro LDAP → Grist** avec revue de diff (mise à jour par lots, jamais de création en masse) et traçabilité des champs modifiés.
- **Fiabilisation** des statuts/rattachements : les validations manuelles (listes fiabilisées importées) priment sur le LDAP et périment après 18 mois ; garde-fou en cas de conflit lors des syncs.
- **Structures V2** : fiches alignées sur le `structures.csv` du directory bridge CRISalid (identifiants UAI/ROR/ISNI/Wikidata, appartenances inclusions/participations avec tutelle principale).
- **Alignement d'identifiants** : recherche/vérification IdRef (ABES, prototype Qualinka), **ORCID** (API publique), **HAL** (AureHal, IdHAL + IdHAL_i), **OpenAlex** (profils auteurs A-ids multivalués, signaux IKG/DOI, vérification des fusions) et **Scopus** (Author ID via les API Elsevier, candidats forts par affiliation Nantes Université / labo, `docs/plan-alignement-scopus.md`) avec revue collaborative dans Grist (`docs/revue-idref-grist.md`, `docs/revue-orcid-hal-grist.md`, `docs/revue-openalex-grist.md`) ; identifiants chercheurs ORCID/HAL/IdRef/Scopus avec dataviz de couverture.
- **Dataviz RH** : parité, pyramide des âges, grades, employeurs/labos ; filtres par pôle, statut, période ; exports CSV/Excel/PDF.

### 📊 Tableau de bord bibliométrique (React/ECharts)
Rubrique native alimentée par les exports `dashboard.json` de **druid-biblio** (OpenAlex/BSO), agrégations côté client :
- **13 onglets** : Vue d'ensemble, Collaborations (typologie, intra-structure, Nantes Université, nationales avec carte de France, internationales avec choroplèthe/Sankey), Impact et citations (FWCI, top 1/10 %), Ouvrages, Revues (accès Nantilus, quartiles SJR), Suivi des APC, Axes stratégiques (avec curation Grist), Charte de signature, Équipes, Doctorants, Chercheurs, Réseau, Liste des publications (filtres ~28 dimensions, pilotables depuis les autres onglets).
- **Veille** : publications des derniers jours interrogées **en direct sur OpenAlex** (filtres labo/thématique/mots-clés/auteur/type/quartile, export CSV, brouillon de post LinkedIn pour la communication).
- **Partage public** : chaque dataviz est intégrable via la page `/embed` (hors authentification), avec ids stables et deep-links de l'état complet (structure, onglet, période, périmètre).
- **Groupes de chercheurs** : dashboards à la demande par liste d'auteurs (ETL ORCID→OpenAlex via l'API druid-biblio).
- **Console ETL** (rôle `admin`) : page native de configuration des structures de druid-biblio (créer, enregistrer, régénérer avec journal, effectifs Grist, corrections d'affiliations), via `/api/etl/structures` → `druid-etl-api`.

### 🤖 Assistant & ponts CRISalid
- **Widget de chat** « Assistant de Recherche CRISalid » : relais SSE vers l'agent LangGraph (Open WebUI Pipelines → MCP toolbox → Neo4j).
- **Génération `people.csv` / `structures.csv`** pour le directory bridge CRISalid, dataviz de la hiérarchie des structures.

---

## 🛠️ Stack Technique

- **Frontend** : [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/), build [Vite](https://vitejs.dev/), thème « refonte 2026 » (soft glass) en [Tailwind CSS](https://tailwindcss.com/), icônes [Lucide](https://lucide.dev/).
- **Dataviz** : [ECharts](https://echarts.apache.org/) (tableau de bord, imports modulaires) + [Recharts](https://recharts.org/) (dataviz RH).
- **Backend** : `server.cjs` ([Express](https://expressjs.com/)) — authentification **Keycloak** (OIDC, session serveur, garde global), proxy Grist, APIs du tableau de bord (dont `/api/news` OpenAlex en direct et `/api/chat`), proxy Streamlit authentifié (HTTP + WebSocket), scripts de synchronisation Node (`scripts/`).
- **Données** : Grist (source de vérité), exports druid-biblio montés en lecture seule, cache LDAP JSON, validation [Zod](https://zod.dev/).

---

## ⚙️ Configuration & Installation

### En production (stack CRISalid)
Druid est déployé en conteneur Docker (image construite depuis ce dépôt, `node server.cjs` sur le port 3000). Le service, ses variables d'environnement (Keycloak, Grist, LDAP, druid-biblio, pipelines) et ses volumes sont définis dans le projet compose CRISalid (`docker/druid/druid.yaml`), hors de ce dépôt.

### En développement
```bash
npm install
npm run dev        # front seul (Vite)
# ou, pour le backend complet (auth, proxys, APIs) :
node server.cjs    # sert dist/ → lancer npm run build d'abord
```

### Variables d'environnement principales (`.env`)
- `VITE_GRIST_DOC_ID` : identifiant du document Grist (public, embarqué dans le bundle pour les liens).
- `GRIST_API_KEY` : clé API Grist, **serveur uniquement** (injectée par le proxy `/api/grist`, jamais exposée au navigateur). L'ancien nom `VITE_GRIST_API_KEY` reste accepté avec un avertissement.
- `KEYCLOAK_URL` / `KEYCLOAK_REALM` / `KEYCLOAK_CLIENT_ID` / `APP_URL` : authentification.
- `LDAP_URL` / `LDAP_BIND_DN` / `LDAP_BIND_PASSWORD` : synchronisation LDAP (compte applicatif de l'annuaire supann). **Obligatoires** : les scripts `scripts/sync_*ldap*.cjs` n'ont aucune valeur par défaut pour le mot de passe et s'arrêtent s'il manque.
- `ETL_API_URL` (API `druid-etl-api`) / `DASHBOARD_SHARED_SECRET` : tableau de bord, console ETL, groupes et veille médias (back-end druid-biblio).
- `PIPELINES_URL` / `PIPELINES_API_KEY` : assistant conversationnel.

---

## 🌐 Internationalisation

Interface bilingue **fr/en** via LinguiJS (même outil que SoVisu+) : chaînes sources en anglais dans le code (depuis le 2026-09-23), traductions françaises dans `locales/fr/messages.po`, sélecteur de langue dans la barre de navigation. Toute nouvelle chaîne impose `npm run i18n:extract` (`lingui extract --clean`) puis la traduction française dans `locales/fr/messages.po`.

Le **code** (commentaires, logs, noms de tests) est écrit en **anglais**, comme dans SoVisu+ et les autres applis CRISalid ; les chaînes d'interface sont en anglais dans le code et traduites en français dans le catalogue Lingui ; les messages d'erreur (client et API) sont eux aussi en anglais dans le code et traduits à l'affichage (`lib/apiErrors.ts`). `npm test` refuse tout commentaire en français.

## 📁 Structure du Projet

- `server.cjs` : backend Express (auth, proxys, APIs) — point d'entrée du conteneur.
- `/components` : UI — `structures/`, `researchers/`, `groups/`, `dashboard/` (rubrique Tableau de bord), `layout/`, `ChatWidget.tsx`.
- `/hooks` : `useDruidData` (chargement/synchro), `useUrlState`.
- `/lib` : services (Grist, auth, exports), `validation.ts` (fiabilisation), `schemas.ts` (Zod), mappings.
- `/scripts` : synchronisations Node (LDAP, IdRef/Qualinka, ORCID, HAL, OpenAlex, Scopus — socle commun `scripts/lib/align_common.cjs`) et dataviz Python de la hiérarchie des structures.
- `/functions` : Cloudflare Pages Functions (proxy Grist, identité, veille) des instances hébergées sur Cloudflare.
- `/instances` : données statiques des instances Cloudflare sans donnée personnelle (démo) — voir `instances/README.md`.
- `/help` : centre d'aide utilisateur (site Starlight).
- `/scripts/publication` : garde-fou exécuté avant chaque publication (`check_public_tree.mjs`).

---

## 🏛️ Instances et déploiement

Un seul code, plusieurs instances configurées par variables d'environnement (capacités exposées par `/api/me`) :

- **Nantes Université** : image Docker (`server.cjs`) avec Keycloak, LDAP, ETL druid-biblio, assistant CRISalid.
- **Centrale Nantes** : Cloudflare Pages + Functions, derrière Cloudflare Access ; ses données (personnelles) sont dans un dépôt privé, récupéré au build.
- **Démo publique** : Cloudflare Pages en lecture seule sur un doc Grist de données fictives — <https://druid-demo.pages.dev>.

Variables par instance : `instances/README.md`.

## 📚 Documentation de travail

Les plans et comptes rendus de conception cités dans les commentaires (`docs/…`) sont une documentation de travail interne, non publiée dans ce dépôt.

## 🔒 Données personnelles

Ce dépôt ne contient aucune donnée personnelle : les données de test et de démonstration sont fictives (identifiants ORCID/IdRef à clé de contrôle volontairement fausse, adresses `example.org`). `scripts/publication/check_public_tree.mjs` le vérifie avant chaque publication.

## ⚖️ Licence

Druid est distribué sous licence [CeCILL v2.1](LICENCE), comme les autres applications CRISalid (SoVisu+, svp-harvester, crisalid-ikg).

---

## 🤝 Contribution
Pour toute demande de nouveau graphique, de nouvel onglet ou de nouvelle source de données, contacter l'administrateur du projet.

---
*Réalisé avec ❤️ par le service Bibliométrie du SCD de Nantes Université pour l'excellence de la recherche.*
