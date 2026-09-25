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
| Public demo | `demo/` (fictitious data, see its README) | public | no (`READ_ONLY=true`) |

## Instance registry: `instance.json`

Every instance folder holds an `instance.json` describing the instance (docs/plan-architecture-multi-instances.md,
lot 5): display name, target (`cloudflare` | `docker`), domains, access (`public` | `cloudflare-access` |
`keycloak`), read-only flag, Grist doc, settable capabilities, `news`/`newsletter` features, admins,
OpenAlex contact and the **names** of the secrets it needs — never a secret value. Schema and rules:
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

The build log lists the Pages variables that repeat `instance.json` or override it — do not remove them before lot 5 f. A Pages
variable still wins: Vite gives real environment variables priority over `.env` files, and the Functions do
not read the generated config yet (lot 5 c) — until then keep `instance.json` in step with the variables below.

## Variables of a Pages project

Pages exposes the same variables to the build and to the Functions (`functions/`).

| Variable | Used by | Centrale | Demo |
| --- | --- | --- | --- |
| `DRUID_INSTANCE` | build (assets), Functions | unset (= `centrale`) | `demo` |
| `INSTANCE_LABEL` | `/api/me` (anonymous user name) | unset (= « Centrale Nantes ») | display name of the demo |
| `READ_ONLY` | `/api/me` (capability, no admin), Grist proxy (403 on writes) | unset | `true` |
| `VITE_GRIST_DOC_ID` | build, Grist proxy (only proxied doc) | Centrale doc | demo doc (public read) |
| `VITE_GRIST_PUBLIC_BASE_URL` | build (`lib/gristService.ts`, `lib/readOnly.ts`) | unset (reads through `/api/grist`) | `https://grist.numerique.gouv.fr/api`: the browser reads the public doc directly, no Functions request. **Never on a writable instance** |
| `GRIST_API_KEY` (secret) | Grist proxy, news/newsletter | required | **unset**: the public doc is read anonymously |
| `ADMIN_EMAILS` | `/api/me` | admin e-mails | ignored when `READ_ONLY=true` |
| `SHOW_STATUS_VALIDATION` | `/api/me` | unset | unset |
| `INSTANCES_REPO_TOKEN` (secret) | build: clone of the private instances repository | fine-grained token, read-only Contents on `druid-instances` | unset (data in this repository) |
| `INSTANCES_REPO` | build | unset (= `guillaumegodet/druid-instances`) | unset |
| `ILAAS_API_KEY` (secret) | collab-theme, newsletter | set | **unset**: a public site without Access would expose the LLM quota |
| `OPENALEX_API_KEY` | news, newsletter | set | unset |
| `OPENALEX_MAILTO` | news, newsletter (OpenAlex polite pool) | unset (= `bu-science-ouverte@univ-nantes.fr`) | unset |

`/api/news/*` and `/api/newsletter/*` hold Centrale structures and staff filters in their code:
they answer 404 on any other instance.

A `DRUID_INSTANCE` without a matching `instances/<slug>/` folder fails the build on purpose, so
a typo cannot silently deploy a site without data.
