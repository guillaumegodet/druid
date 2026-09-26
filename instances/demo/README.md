# Public demo instance (Cloudflare Pages)

Read-only public instance (`DRUID_INSTANCE=demo`, `READ_ONLY=true`, see `../README.md`), plan
`docs/plan-instance-demo-cloudflare.md`. **Fictitious data only**: fictitious university « UDémo »,
labs LIRA / BIOS / LMD, teams IA-Démo / Net-Démo / Gen-Démo.

| File | Role |
| --- | --- |
| `demo-data.mjs` | Fictitious researchers (54), structures (13), institutions (3). ORCID and IdRef ids have a deliberately wrong check character, IdHAL are prefixed `demo-`, OpenAlex ids are `A00000…`, e-mails under `example.org`: nothing can point to a real person. Deterministic. |
| `schema.json` | Snapshot of the Centrale doc schema (2026-09-24): tables, column types, formulas — no data. |
| `build_demo_grist.mjs` | Creates or refreshes the Grist doc from the two files above (dry run by default); `--instance demo-2` does the same for `../demo-2/`. |
| `gen_demo_dashboards.py` + `country_names.json` | Writes `dashboard-data/`: fictitious dashboards (udemo, lira, bios, lmd) whose members are the researchers above, `news.json` per structure (« Veille » tab), `mentions.json` (« Médias » panel), `index.json` (Benchmark hidden). |
| `gen_demo_align_caches.mjs` | Writes `demo-*_cache.json`: fictitious candidates for the researchers missing an identifier (unified alignment view, search mode). |

`dashboard-data/` and `demo-*_cache.json` are copied into `public/` on a Cloudflare build
(`scripts/prepare-cloudflare-assets.cjs`, `DRUID_INSTANCE=demo`).

## Grist doc

`eXbcyqzLmE1tsRo12WjGyY` (« Druid — démo », personal Grist space of the maintainer), created on 2026-09-24.
It must be shared **publicly as viewer**: the demo reads it from the browser without a key
(`VITE_GRIST_PUBLIC_BASE_URL`).

Refresh after editing `demo-data.mjs` — the doc, then the dashboards and alignment caches, which
depend on it (tables and columns are only added, records are replaced):

```bash
docker run --rm --network host -v "$PWD":/app -w /app \
  -e GRIST_API_KEY=<key> -e DEMO_GRIST_DOC_ID=eXbcyqzLmE1tsRo12WjGyY \
  node:20-slim node instances/demo/build_demo_grist.mjs --apply
docker run --rm -v "$PWD":/app -w /app node:20-slim node instances/demo/demo-data.mjs > /tmp/demo-people.json
python3 instances/demo/gen_demo_dashboards.py /tmp/demo-people.json
docker run --rm -v "$PWD":/app -w /app node:20-slim node instances/demo/gen_demo_align_caches.mjs
```
