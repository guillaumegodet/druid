# Second demo instance `demo-2` (shared deployment prototype)

Fictitious engineering school « EIDémo » (labs MécaDémo / SynDémo, teams Matériaux-Démo / Fluides-Démo),
second tenant of the shared Cloudflare deployment (docs/plan-architecture-multi-instances.md, lot 6 c): one
Pages project (`DRUID_DEPLOYMENT=druid-saas`, which both `instance.json` declare), each instance chosen by request host. **Fictitious data only**,
same rules as `../demo/` (whose generator it reuses): wrong check characters on ORCID and IdRef, IdHAL
prefixed `demo2-`, e-mails under `example.org`, identifier numbers from 1001 (the demo uses 1-54, and 501-554
for the homonyms of its alignment caches).

| File | Role |
| --- | --- |
| `demo-data.mjs` | Fictitious researchers (26), structures (7), institutions (3). Deterministic. |
| `instance.json` | Registry entry: read-only, public access, PostgreSQL schema `i_demo_2` of the druid-saas database, host `demo-2.dirladata.fr`. |
| `dashboard-data/` | Fictitious dashboards (eidemo = the school, mecademo, syndemo), written by `../demo/gen_demo_dashboards.py --instance demo-2`. |
| `demo-2-*_cache.json` | Fictitious alignment candidates, written by `../demo/gen_demo_align_caches.mjs --instance demo-2`. |

On the shared deployment these files are copied into `public/instance-assets/demo-2/` and served only on the
hosts of `demo-2` (`functions/_lib/instanceAssets.js`, see `../README.md`).

## Database

Since lot 10 e of druid-internal docs/plan-migration-postgresql.md (2026-11-25), schema `i_demo_2` of the
control-plane database of the druid-saas Worker (`postgres.schema` of `instance.json`, read through
`SAAS_HYPERDRIVE`). The Worker deployment (dirladata-instances) migrates it and reloads `demo-data.mjs` into it at
every deployment (`scripts/seed_demo_pg.ts --instance demo-2 --schema i_demo_2 --apply`). Its former public Grist doc is
no longer read (Grist is not served on Cloudflare since lot 12 a).

Dashboards and alignment caches stay static files, regenerated after editing `demo-data.mjs`:

```bash
docker run --rm -v "$PWD":/app -w /app node:20-slim node instances/demo-2/demo-data.mjs > /tmp/demo-2-people.json
python3 instances/demo/gen_demo_dashboards.py --instance demo-2 /tmp/demo-2-people.json
docker run --rm -v "$PWD":/app -w /app node:20-slim node instances/demo/gen_demo_align_caches.mjs --instance demo-2
```
