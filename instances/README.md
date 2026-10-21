# Cloudflare Pages instances

One Druid repository, several Cloudflare Pages projects: each project builds this repository
and picks its instance with environment variables (docs/archive/plan-instance-demo-cloudflare.md).
`instances/<slug>/` holds the static assets of instance `<slug>`, copied into `public/` by
`scripts/prepare-cloudflare-assets.cjs` only on a Cloudflare build (`CF_PAGES=1`). The Docker
build (Nantes) never copies anything. Instances with personal data are NOT in this repository:
their folder lives in the private repository `guillaumegodet/druid-instances`, cloned at build
time with the `INSTANCES_REPO_TOKEN` secret when `instances/<slug>/` is absent here.

| Instance | Folder | Access | Grist writes |
| --- | --- | --- | --- |
| Centrale Nantes | `centrale/` of `guillaumegodet/druid-instances` (private: real PII) | Cloudflare Access | yes, with an Access identity |
| Public demo | `demo/` (fictitious data, see its README) — PostgreSQL (Neon) through Hyperdrive since lot 10 c | public | no (`readOnly` in its `instance.json`) |
| Second demo (shared deployment prototype) | `demo-2/` (fictitious data, see its README) | public | no |

## Instance registry: `instance.json`

Every instance folder holds an `instance.json` describing the instance (docs/plan-architecture-multi-instances.md,
lot 5): display name, target (`cloudflare` | `docker`), domains, access (`public` | `cloudflare-access` |
`keycloak`), read-only flag, storage (`grist` with the Grist doc, or `postgres`, see below), settable
capabilities, `news`/`newsletter` features, admins, OpenAlex contact, the **names** of the secrets it needs — never
a secret value — and, optionally, the shared deployment that serves it (`deployment`, see below). Schema and rules:
`scripts/instances/instanceConfig.cjs`. The public repository only accepts read-only instances with
public access, no admins and public data (a public doc, or a PostgreSQL database of fictitious rows) — also
enforced by `scripts/publication/check_public_tree.mjs`.

### Storage: Grist document or PostgreSQL database

`storage` (default `grist`) says where the directory of the instance lives (druid-internal
docs/plan-migration-postgresql.md, lot 10):
- `grist`: the document of the `grist` block (`docId`, `apiBase`, `publicRead`), read with the `GRIST_API_KEY` secret
  unless the doc is public;
- `postgres`: a PostgreSQL database (schema `db/migrations`, roles `db/roles.sql`) reached through a **Hyperdrive**
  binding of the Pages project named `HYPERDRIVE` (`HYPERDRIVE__<SLUG>` on a shared deployment, like the secrets),
  with the connection string of the `druid_app` role. No `grist` block, no `GRIST_API_KEY`; the `newsletter` feature
  is not available yet (its table still lives in a document, lot 10 d). The Functions open one database client per
  request (Hyperdrive keeps the pool) and need the Node.js compatibility of the project at runtime (`nodejs_compat`,
  Settings › Runtime, default for a compatibility date from 2026-08-04); the driver is bundled by the build with its
  Node built-ins as `node:*` (`functions/_generated/pg.js`), since the Pages build system compiles the Functions without
  that flag. On target `docker` the server reads `DRUID_STORAGE` instead; the field only documents it.
The private repository also describes the Docker instance of Nantes (not read by `server.cjs`: inventory
and drift check only).

Validate (tests: `node scripts/tests/instance-config.cjs`):

```bash
docker run --rm -v "$PWD":/app -w /app -v /opt/crisalid/work/druid-instances:/instances:ro \
  -e INSTANCES_DIR=/instances node:20-slim node scripts/instances/validate.cjs
```

On a Cloudflare build, `scripts/prepare-cloudflare-assets.cjs` validates it (an invalid file fails the
build, the previous deployment stays online) and generates:
- `.env.production.local`: `VITE_GRIST_DOC_ID`, plus `VITE_GRIST_PUBLIC_BASE_URL` for a public doc;
- `functions/_generated/instance.js`: the validated config (`null` without `instance.json`), bundled with the
  Functions — Pages compiles `functions/` after the build command. Both files are ignored by git and Docker.

The Functions read that generated config (`functions/_lib/instance.js`, lot 5 c): label, read-only mode,
status/validation capability, Grist doc and API base, admins, OpenAlex contact and the `news`/`newsletter`
features all come from `instance.json`. **Any change of these settings goes through `instance.json`** (a commit
here for the demo, in `druid-instances` for the others), then a new build.

## Variables of a Pages project

Pages exposes the same variables to the build and to the Functions (`functions/`). Since lot 5 f, a project only
holds the instance slug and the secrets its `instance.json` lists (`secrets`), in both its Production and
Preview environments:

| Variable | Used by | Centrale | Demo |
| --- | --- | --- | --- |
| `DRUID_INSTANCE` | build (instance folder), Functions | `centrale` (default when unset) | `demo` |
| `GRIST_API_KEY` (secret) | Grist proxy, news/newsletter | required | **unset**: the public doc is read anonymously |
| `INSTANCES_REPO_TOKEN` (secret) | build: clone of the private instances repository | fine-grained token, read-only Contents on `druid-instances` | unset (data in this repository) |
| `ILAAS_API_KEY` (secret) | collab-theme, newsletter | set | **unset**: a public site without Access would expose the LLM quota |
| `OPENALEX_API_KEY` (secret) | news, newsletter | set | unset |

Optional technical variables, not described by the registry: `INSTANCES_REPO` (default
`guillaumegodet/druid-instances`), `ILAAS_API_BASE`, `ILAAS_MODEL`, and `ALLOW_ANONYMOUS_WRITES=true` for local
`wrangler pages dev` only.

**Overrides (transition only).** These variables are still honoured, field by field, when present and non-empty,
and win over `instance.json`: `INSTANCE_LABEL`, `READ_ONLY`, `SHOW_STATUS_VALIDATION`, `VITE_GRIST_DOC_ID`,
`GRIST_DOC_ID`, `VITE_GRIST_PUBLIC_BASE_URL`, `GRIST_API_BASE`, `ADMIN_EMAILS`, `OPENALEX_MAILTO`. The build log
names each one found (« repeats instance.json » or « overrides instance.json »): remove it from the dashboard, after
moving its value into `instance.json` when it differs. Without `instance.json` (instance not migrated yet), they
remain the only source, with the historical defaults (Centrale).

## Shared deployment (prototype, lot 6 of docs/plan-architecture-multi-instances.md)

One Pages project can serve several instances: set `DRUID_DEPLOYMENT=<project name>` instead of
`DRUID_INSTANCE`. The build takes every instance whose `instance.json` declares `"deployment": "<project name>"`,
in `instances/` and, when `INSTANCES_REPO_TOKEN` is set, in the private repository `INSTANCES_REPO` (a folder
present in both and claimed by either fails the build). **Adding an instance is then a new folder with its
`instance.json`, its secrets and its domain — no change to the Pages variables.** The demos declare
`druid-saas`. `DRUID_INSTANCES=<slug>,<slug>` (explicit list, prototype of lot 6) still works; setting it
together with `DRUID_DEPLOYMENT` fails the build. The build validates every `instance.json` (required), refuses a domain claimed by two
instances and generates `functions/_generated/registry.js` in mode `multi`; the Functions then pick the
instance whose `domains` list the request host (`functions/api/_middleware.js`) and answer **404 for any
other host** — the front shows « No Druid instance is declared for this address ». On such a deployment:

- no variable overrides an instance (settings come only from `instance.json`);
- secrets are per instance, `<NAME>__<SLUG>` with the slug upper-cased and `-` → `_`
  (`GRIST_API_KEY__DEMO_2`); the plain `GRIST_API_KEY` is never used, so an instance without its own key
  cannot borrow another's;
- nothing instance-specific is built into the bundle; the files of each instance (dashboard exports,
  alignment caches) are copied into `public/instance-assets/<slug>/` and the build writes route files
  (`functions/dashboard-data/`, `functions/<name>_align_cache.json.js`, `functions/instance-assets/`, ignored
  by git) that serve, at the usual URLs, the copy of the request host's instance only
  (`functions/_lib/instanceAssets.js`); `/instance-assets/*` itself answers 404. Only **public** instances may
  have such files: a file of `public/` is still a static file of the deployment, so the build fails for a
  non-public instance with files — private files wait for the R2 store (lot 7);
- `ALLOW_ANONYMOUS_WRITES` is ignored.

Every domain of every instance must also be attached to the Pages project (Custom domains).

`/api/news/*` and `/api/newsletter/*` hold Centrale structures and staff filters in their code:
they answer 404 unless `features.news` / `features.newsletter` is true in `instance.json` (without
`instance.json`: Centrale only).

A `DRUID_INSTANCE` without a matching `instances/<slug>/` folder fails the build on purpose, so
a typo cannot silently deploy a site without data.

## Control plane: tenants resolved at run time (multi-tenant deployment)

A shared deployment that binds the control-plane database as **`SAAS_HYPERDRIVE`** (Hyperdrive, druid-internal
docs/plan-druid-saas.md, lot 1) serves, besides the instances of the registry above, the **tenants** of the `saas` schema
of that database (`db/saas/migrations`, `npm run db:saas:migrate`): `tenant` (slug, label, plan, status, settings),
`tenant_host` (host → tenant), `member` (accounts and roles), `plan`, `magic_link`, `session`, `job`, `tenant_secret`.
Every tenant has its own PostgreSQL schema (`t_<slug>`) on the same database, migrated from `db/migrations` by
`scripts/saas/tenant_db.ts` (`npm run build:saas` → `scripts/.build/tenant_db.cjs`: `create`, `migrate-all`, `list`,
`drop`), and every query of the Functions is qualified by that schema (`lib/db/core.ts`, option `schema`) — no
`search_path`, which a pooled connection would not keep.

- Host resolution (`functions/api/_middleware.js`, `functions/_lib/saas.js`): the hosts the registry **declares** first
  (demos), then `tenant_host`; cached per isolate (60 s) and in the optional KV namespace **`SAAS_REGISTRY`** (5 min). On
  such a deployment a missing or single-instance registry serves no host by itself.
- Identity: a session cookie (`druid_session`) opened by a **magic link** — `/auth/login` (page), `POST /api/auth/request`
  (members only, 5 links per address and quarter of an hour, e-mail through Resend: secrets `RESEND_API_KEY`,
  `EMAIL_FROM`; `SAAS_DEV_LINKS=true` returns the link instead, local runs only), `GET`/`POST /api/auth/verify`,
  `/auth/logout`. The cookie of one tenant opens nothing on another; the Cloudflare Access header is ignored on a tenant.
- Rights: the member row (`owner` = super administrator, `admin`, `viewer` = read only, `lab` = labs of `lab_scope`);
  capabilities: the structural ones of this runtime, then `plan.capabilities`, then `tenant.settings.capabilities`;
  a tenant that is not `active` is read-only. `/api/me` adds a `tenant` block (plan, seats, members, mail domains) and
  `auth: 'session'`.
- Secrets of a tenant (LLM, Elsevier…) will live encrypted in `tenant_secret` (lot 6); the per-instance secrets
  `<NAME>__<SLUG>` of the registry do not apply to tenants.

### Portal « create my Druid » and the runner (lot 2)

On the host **`SAAS_PORTAL_HOST`** of a control-plane deployment, `/start` (functions/start/[[path]].js,
functions/_lib/portalPages.js) lets anybody with an e-mail address create the Druid of their establishment: magic link of
the portal (session with no tenant), then an assistant in three steps — the establishment (search in **ROR**, and for a
French one the UAI, SIRET, IdRef and Wikidata from the ministry dataset `fr-esr-principaux-etablissements-enseignement-superieur`
plus the OpenAlex id), its research structures (prelisted from the **RNSR**, `fr-esr-structures-recherche-publiques-actives`,
by the UAI of the establishment; others typed in), the address `<slug>.<SAAS_BASE_DOMAIN>` and the mail domain. The
creation writes the tenant (status `provisioning`, payload in `tenant.onboarding`), its host, the creator as `owner` and
queues the job **`tenant.provision`**; one trial per establishment (unique ROR: a second person gets « ask for access »,
`access_request`). The construction page polls `/start/api/tenants/<slug>` and, once active, opens the tenant on its
own host with a magic link of that host.

The **runner** (`scripts/saas/runner.ts` → `scripts/.build/saas_runner.cjs`, lib/saas/runner.ts) is a Node process next
to the database (never a Worker: it spawns dbmate): it claims the queued jobs (`FOR UPDATE SKIP LOCKED`) and, for
`tenant.provision`, migrates the schema, seeds the establishment and the structures through the directory commands,
creates the route `<host>/*` of the Worker through the Cloudflare API (`SAAS_CF_API_TOKEN`, `SAAS_CF_ZONE_ID`,
`SAAS_WORKER_NAME`; skipped when unset), sets the tenant active and sends the « ready » e-mail (`RESEND_API_KEY`).
`--once` processes the queue and exits (CI, cron); without it, polls every 10 s. Provisioning then queues a
`structures.align` job (lot 4): the identifiers of the seeded labs (HAL, ROR, OpenAlex, IdRef, Wikidata, HAL collection)
are derived from their RNSR through the open registries (`OPENALEX_API_KEY` or `OPENALEX_MAILTO` for OpenAlex), and
reviewed on the Structures tab of the alignment page of the tenant. The other job types (people alignments, ETL) come
with lot 3.
