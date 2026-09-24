# Aide Druid — centre d'aide utilisateur

Site statique [Starlight](https://starlight.astro.build) (Astro), indépendant de l'application :
son propre `package.json`, exclu de l'image Docker (`.dockerignore`), de `tsc` et de Lingui.
Plan : `../docs/plan-documentation-utilisateur.md` ; profils, capacités, règles métier et
glossaire à exploiter : `../docs/documentation-utilisateur-inventaire.md`.

## Arborescence

```
src/content/docs/
  index.mdx                 accueil (cartes des 4 rubriques)
  demarrer/                 Druid en 5 minutes, premiers pas par profil, glossaire
  guides/<rubrique>/        une tâche = une page (personnes, identifiants, structures-groupes,
                            tableau-de-bord, veille, administration, corriger) + support.md
  tutoriels/                parcours longs
  donnees/                  « Comprendre les données » (référence)
  nouveautes.md
src/components/QuiOu.astro  encadré « Qui peut le faire, et où » des guides
src/components/PageTitle.astro  surcharge Starlight : lien « Voir en Markdown »
src/pages/[...slug].md.ts   version Markdown de chaque page (/guides/x.md)
src/pages/llms.txt.ts       index pour assistants IA ; llms-full.txt = toute l'aide
src/styles/druid.css        palette et polices de Druid
gabarits/                   modèles de page guide / référence (hors build)
public/druid-aide-hero*.webp  visuel de l'accueil (design « Druid Aide Hero », Claude Design,
                            rendu en PNG 2× par Playwright puis converti en WebP par sharp)
```

## Écrire une page

1. Copier `gabarits/guide.mdx` ou `gabarits/reference.mdx` à la place de la page `.md` « à venir »
   (même nom, extension `.mdx` si on utilise `<QuiOu>`), puis supprimer l'ancienne.
2. Retirer le badge `à venir` du frontmatter ; garder `sidebar.order`.
3. Libellés de boutons : les reprendre du catalogue `../locales/fr/messages.po`.
4. Aucune donnée personnelle réelle (le site est public) : exemples et captures depuis l'instance
   démo uniquement.
5. Un nouveau dossier de rubrique ⇒ l'ajouter à `sidebar` dans `astro.config.mjs` **et** à
   `SIDEBAR_ORDER` dans `src/lib/markdown.ts`.

## Maintenance

- `npm run build` enchaîne `astro build` et `scripts/check-links.mjs` : un lien interne ou une
  ancre cassés font échouer le build (et donc le déploiement Cloudflare).
- Page Nouveautés : `node scripts/nouveautes-draft.mjs [AAAA-MM]` (mois précédent par défaut)
  produit un brouillon à partir des commits `feat`/`fix` du mois, à réécrire en français pour
  les utilisateurs en tête de `src/content/docs/nouveautes.md`.
- Règles complètes (aide mise à jour à chaque lot, liens d'aide contextuelle, relecture
  annuelle) : section « User help centre » de `../docs/conventions.md`.

## Construire et prévisualiser

Astro 7 demande Node ≥ 22.12 (pas de Node sur l'hôte : conteneur). Depuis la racine du dépôt,
pour que git fournisse les dates de mise à jour :

```bash
cd /opt/crisalid/docker/druid/src
docker run --rm -e HTTPS_PROXY=http://cache.univ-nantes.fr:3128 \
  -v "$PWD":/repo -w /repo/help node:22 sh -c "npm ci && npm run build"
# résultat : help/dist/ (≈ 40 pages + index de recherche Pagefind)
```

Sur un poste avec Node 22 : `cd help && npm install && npm run dev` (http://localhost:4321).

## Déploiement (Cloudflare Workers)

Worker **`druid-aide`** (fichiers statiques seulement, `wrangler.jsonc`), relié à ce dépôt par
Workers Builds, distinct des projets des instances Druid : <https://druid-aide.guillaumegodet.workers.dev>.

| Réglage | Valeur |
|---|---|
| Répertoire racine | `help` |
| Commande de build | `npm run build` |
| Commande de déploiement | `npx wrangler deploy` |
| Build watch paths (Include) | `help/*` |
| Variables de build | `NODE_VERSION=22` ; `HELP_SITE_URL=<url publique>` si un domaine personnalisé est ajouté (sitemap et liens de `/llms.txt`) |

Le projet Cloudflare de l'application Druid doit exclure `help/*` de ses Build watch paths.

Les dates « Dernière mise à jour » viennent de `git log` : si elles manquent en production,
c'est que le clone du build est superficiel.
