# Cloudflare Pages instances

One Druid repository, several Cloudflare Pages projects: each project builds this repository
and picks its instance with environment variables (docs/plan-instance-demo-cloudflare.md).
`instances/<slug>/` holds the static assets of instance `<slug>`, copied into `public/` by
`scripts/prepare-cloudflare-assets.cjs` only on a Cloudflare build (`CF_PAGES=1`). The Docker
build (Nantes) never copies anything. Instances with personal data are NOT in this repository:
their folder lives in the private repository `guillaumegodet/druid-instances`, cloned at build
time with the `INSTANCES_REPO_TOKEN` secret when `instances/<slug>/` is absent here.

| Instance | Folder | Access | Grist writes |
| --- | --- | --- | --- |
| Centrale Nantes | `centrale/` of `guillaumegodet/druid-instances` (private: real PII) | Cloudflare Access | yes, with an Access identity |
| Public demo | `demo/` (fictitious data, see its README) | public | no (`readOnly` in its `instance.json`) |
| Second demo (shared deployment prototype) | `demo-2/` (fictitious data, see its README) | public | no |

## Instance registry: `instance.json`

Every instance folder holds an `instance.json` describing the instance (docs/plan-architecture-multi-instances.md,
lot 5): display name, target (`cloudflare` | `docker`), domains, access (`public` | `cloudflare-access` |
`keycloak`), read-only flag, Grist doc, settable capabilities, `news`/`newsletter` features, admins,
OpenAlex contact, the **names** of the secrets it needs — never a secret value — and, optionally, the shared
deployment that serves it (`deployment`, see below). Schema and rules:
`scripts/instances/instanceConfig.cjs`. The public repository only accepts read-only instances with
public access, a public doc and no admins (also enforced by `scripts/publication/check_public_tree.mjs`).
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
