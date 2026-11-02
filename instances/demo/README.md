# Public demo instance (Cloudflare Pages)

Read-only public instance (`DRUID_INSTANCE=demo`, `READ_ONLY=true`, see `../README.md`), plan
`docs/archive/plan-instance-demo-cloudflare.md`. **Fictitious data only**: fictitious university « UDémo »,
labs LIRA / BIOS / LMD, teams IA-Démo / Net-Démo / Gen-Démo. Since lot 10 c of the PostgreSQL migration the
directory lives in a PostgreSQL database (`storage: "postgres"`, section below); the Grist doc is kept for a while as
a fallback (`storage: "grist"` + the `grist` block in `instance.json`). The demo shows every feature of a
PostgreSQL instance: directory and structures, alignment of the identifiers (people and structures), the dashboards
with their « Réseau » and « Binômes » views (`features.network`), the « Appels à projets » tab with the candidates by
career stage, and on the records the theses, the calls and the research pairs.

| File | Role |
| --- | --- |
| `demo-data.mjs` | Fictitious researchers (54), structures (13), institutions (3). ORCID and IdRef ids have a deliberately wrong check character, IdHAL are prefixed `demo-`, OpenAlex ids are `A00000…`, e-mails under `example.org`: nothing can point to a real person. Deterministic. |
| `schema.json` | Snapshot of the Centrale doc schema (2026-09-24): tables, column types, formulas — no data. |
| `build_demo_grist.mjs` | Creates or refreshes the Grist doc from the two files above (dry run by default); `--instance demo-2` does the same for `../demo-2/`. |
| `gen_demo_dashboards.py` + `country_names.json` | (`--instance demo-2`: same for `../demo-2/`.) Writes `dashboard-data/`: fictitious dashboards (udemo, lira, bios, lmd) whose members are the researchers above, `news.json` per structure (« Veille » tab), `mentions.json` (« Médias » panel), `index.json` (Benchmark hidden), and `network.json`: the university-wide co-authorship network (druid-biblio `network_export.py` version 5 — poles, labs, authors with their Druid uid, publications with OpenAlex topics and cited works, cross-lab pairs drawn among the members) read by `functions/_lib/network.js`. |
| `../../lib/migration/demoExtras.ts` | Fictitious calls for proposals (Horizon Europe clusters, ERC Starting / Consolidator with their PhD window, MSCA, ANR AAPG axes, a regional call added by hand), one matching run per programme with the researchers retained and their own publications as evidence, the candidates by career stage, the doctoral theses of every researcher (theses.fr-like records), a few opinions. Seeded with the directory (`scripts/seed_demo_pg.ts`); the deadlines are set relative to the day of the seed, so the calls stay open. |
| `gen_demo_align_caches.mjs` | (`--instance demo-2`: same for `../demo-2/`.) Writes `demo-*_cache.json`: fictitious candidates for the researchers missing an identifier (unified alignment view, search mode). |

`dashboard-data/` and `demo-*_cache.json` are copied into `public/` on a Cloudflare build
(`scripts/prepare-cloudflare-assets.cjs`, `DRUID_INSTANCE=demo`).

## PostgreSQL database (lot 10 of the PostgreSQL migration plan)

The demo can run on a PostgreSQL database instead of the Grist doc (`storage: "postgres"` in `instance.json`,
Hyperdrive binding `HYPERDRIVE` on the Pages project, see `../README.md`). Its rows come from `demo-data.mjs`
through the same transformation as a Grist document (`lib/migration/demoSeed.ts`, `scripts/seed_demo_pg.ts`):

```bash
# dry run by default (loaded then rolled back); --apply commits. DATABASE_URL = owner of a migrated database.
docker run --rm -v "$PWD":/app -w /app -e DATABASE_URL=postgres://druid_owner:…/druid \
  node:20-slim sh -c 'npm run -s seed:demo -- --instance demo --apply'
```

The seed of the demo also writes the fictitious extras of `lib/migration/demoExtras.ts` (`lib/migration/loadDemoExtras.ts`):
calls for proposals and matches, eligibility rules and candidates, theses and checks, opinions, and the identifiers of the
three labs with the candidates of their alignment (`lib/migration/demoStructureIds.ts`: the « Structures » tab of the
alignment page shows every state — confirmed, strong, ambiguous, to review, conflict, not found, never searched).

**Reloaded at each production deployment**: the last step of `npm run build`, `scripts/seed_demo_on_pages.cjs`,
runs the migrations (dbmate) then the seed when the build is a Cloudflare Pages production build (`CF_PAGES=1`,
`CF_PAGES_BRANCH=main`) and the build secret `DEMO_DATABASE_URL` (role `druid_owner`) is set — a preview build never
touches the database. `DRUID_SEED_DEMO=1` forces it elsewhere (GitHub Actions of a shared deployment, with
`DRUID_SEED_INSTANCES=demo,demo-2` and `DEMO_DATABASE_URL__DEMO`, `DEMO_DATABASE_URL__DEMO_2`). Edits made through
the API between two deployments are lost by design (the instance is read-only anyway).

## Grist doc

`eXbcyqzLmE1tsRo12WjGyY` (« Druid — démo », personal Grist space of the maintainer), created on 2026-09-24.
It must be shared **publicly as viewer**: the demo reads it from the browser without a key
(`VITE_GRIST_PUBLIC_BASE_URL`).

Refresh after editing `demo-data.mjs` — the dashboards, the network and the alignment caches, which depend on it
(and the doc, as long as it is kept: tables and columns are only added, records are replaced):

```bash
docker run --rm -v "$PWD":/app -w /app node:20-slim node instances/demo/demo-data.mjs > /tmp/demo-people.json
python3 instances/demo/gen_demo_dashboards.py /tmp/demo-people.json
docker run --rm -v "$PWD":/app -w /app node:20-slim node instances/demo/gen_demo_align_caches.mjs
docker run --rm --network host -v "$PWD":/app -w /app \
  -e GRIST_API_KEY=<key> -e DEMO_GRIST_DOC_ID=eXbcyqzLmE1tsRo12WjGyY \
  node:20-slim node instances/demo/build_demo_grist.mjs --apply
```

The dates of the « Veille », of the media mentions and of the network (`TODAY`, `NEWS_FETCHED_AT`) are written in
`gen_demo_dashboards.py`: move them forward when regenerating.
