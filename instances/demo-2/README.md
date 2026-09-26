# Second demo instance `demo-2` (shared deployment prototype)

Fictitious engineering school « EIDémo » (labs MécaDémo / SynDémo, teams Matériaux-Démo / Fluides-Démo),
second tenant of the shared Cloudflare deployment (docs/plan-architecture-multi-instances.md, lot 6 c): one
Pages project, `DRUID_INSTANCES=demo,demo-2`, each instance chosen by request host. **Fictitious data only**,
same rules as `../demo/` (whose generator it reuses): wrong check characters on ORCID and IdRef, IdHAL
prefixed `demo2-`, e-mails under `example.org`, identifier numbers from 1001 (the demo uses 1-54, and 501-554
for the homonyms of its alignment caches).

| File | Role |
| --- | --- |
| `demo-data.mjs` | Fictitious researchers (26), structures (7), institutions (3). Deterministic. |
| `instance.json` | Registry entry: read-only, public access, public Grist doc, host `demo-2.dirladata.fr`. |
| `dashboard-data/` | Fictitious dashboards (eidemo = the school, mecademo, syndemo), written by `../demo/gen_demo_dashboards.py --instance demo-2`. |
| `demo-2-*_cache.json` | Fictitious alignment candidates, written by `../demo/gen_demo_align_caches.mjs --instance demo-2`. |

On the shared deployment these files are copied into `public/instance-assets/demo-2/` and served only on the
hosts of `demo-2` (`functions/_lib/instanceAssets.js`, see `../README.md`).

## Grist doc

`7LPh1eN5pL8UqSx7osVrwD` (« Druid — démo 2 », personal Grist space of the maintainer), created on 2026-09-26
with the demo schema (`../demo/schema.json`). It must be shared **publicly as viewer** (Grist UI → Share →
Public access, on the doc only — never on the workspace). Refresh after editing `demo-data.mjs`:

```bash
docker run --rm --network host -v "$PWD":/app -w /app \
  -e GRIST_API_KEY=<key> -e DEMO_GRIST_DOC_ID=7LPh1eN5pL8UqSx7osVrwD \
  node:20-slim node instances/demo/build_demo_grist.mjs --instance demo-2 --apply
docker run --rm -v "$PWD":/app -w /app node:20-slim node instances/demo-2/demo-data.mjs > /tmp/demo-2-people.json
python3 instances/demo/gen_demo_dashboards.py --instance demo-2 /tmp/demo-2-people.json
docker run --rm -v "$PWD":/app -w /app node:20-slim node instances/demo/gen_demo_align_caches.mjs --instance demo-2
```
