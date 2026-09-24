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
