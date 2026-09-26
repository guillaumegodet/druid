# Second demo instance `demo-2` (shared deployment prototype)

Fictitious engineering school « EIDémo » (labs MécaDémo / SynDémo, teams Matériaux-Démo / Fluides-Démo),
second tenant of the shared Cloudflare deployment (docs/plan-architecture-multi-instances.md, lot 6 c): one
Pages project, `DRUID_INSTANCES=demo,demo-2`, each instance chosen by request host. **Fictitious data only**,
same rules as `../demo/` (whose generator it reuses): wrong check characters on ORCID and IdRef, IdHAL
prefixed `demo2-`, e-mails under `example.org`, identifier numbers from 501 (never shared with the demo).

| File | Role |
| --- | --- |
| `demo-data.mjs` | Fictitious researchers (26), structures (7), institutions (3). Deterministic. |
| `instance.json` | Registry entry: read-only, public access, public Grist doc, host `demo-2.dirladata.fr`. |

No dashboards nor alignment caches yet: a shared deployment copies no instance asset into `public/`
(a file of `public/` would be served on every host); they need the per-instance asset route (lot 6 D5).

## Grist doc

`7LPh1eN5pL8UqSx7osVrwD` (« Druid — démo 2 », personal Grist space of the maintainer), created on 2026-09-26
with the demo schema (`../demo/schema.json`). It must be shared **publicly as viewer** (Grist UI → Share →
Public access, on the doc only — never on the workspace). Refresh after editing `demo-data.mjs`:

```bash
docker run --rm --network host -v "$PWD":/app -w /app \
  -e GRIST_API_KEY=<key> -e DEMO_GRIST_DOC_ID=7LPh1eN5pL8UqSx7osVrwD \
  node:20-slim node instances/demo/build_demo_grist.mjs --instance demo-2 --apply
```
