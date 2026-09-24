// Cloudflare Pages Function — monitoring of new publications.
// Equivalent of `GET /api/news/:slug` in server.cjs (« Veille » tab of the
// dashboard): queries OpenAlex LIVE and flattens the works to the frontend's
// NewsItem contract (NewsTab.tsx).
//
// Differences from Nantes: no biblio-metrics configs on the edge → the
// structures and the institution id → acronym map are hard-coded below
// (same values as data/<slug>/config.yaml on the biblio-metrics side). No
// Druid groups on this instance. Cache: Cloudflare Cache API, 1 h.

const NEWS_MAX_WORKS = 600
// OpenAlex polite-pool contact: OPENALEX_MAILTO (Pages variable) overrides this service address.
const DEFAULT_MAILTO = 'bu-science-ouverte@univ-nantes.fr'

// slug -> OpenAlex institution (source: EC-Nantes biblio-metrics configs)
const NEWS_STRUCTS = {
  'ec-nantes': 'I100445878',
  gem: 'I4210137520',
  ls2n: 'I4210117005',
  aau: 'I4210162214',
  lmjl: 'I4210153365',
  lheea: 'I4210153154',
}

// institution id -> acronym (Labo column/filter). The institution itself is
// excluded: its id appears in the lineage of almost every work.
const NEWS_LAB_MAP = {
  I4210137520: 'GeM',
  I4210117005: 'LS2N',
  I4210162214: 'AAU',
  I4210153365: 'LMJL',
  I4210153154: 'LHEEA',
}

const oaShortId = (u) => (u ? String(u).split('/').pop() : '')

// ── « effectifs Centrale » (Centrale staff) filter ───────────────────────────
// The labs' OpenAlex entities (LS2N, GeM…) cover ALL their members, whatever
// their supervising institution: without a filter, the monitoring highlights
// researchers who are not at Centrale. We only keep works with at least one
// author present in the Grist Annuaire (matching by normalized name, LABO
// scope for the lab views — aligned with inject_effectifs_centrale.py).

const DEFAULT_DOC = 'vBpWuYg3n1tPn38CGMMAXS'
const SLUG_LABOS = {
  'ec-nantes': null, // whole directory
  gem: ['GEM'],
  ls2n: ['LS2N'],
  aau: ['AAU'],
  lmjl: ['LMJL'],
  lheea: ['LHEEA'],
}

const normName = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[-']/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')

/** Grist Annuaire → Map normalized name → record (name, email, photo, url). */
async function fetchEffectifs(env, slug) {
  const labos = SLUG_LABOS[slug]
  const base = (env.GRIST_API_BASE || 'https://grist.numerique.gouv.fr/api').replace(/\/$/, '')
  const doc = env.GRIST_DOC_ID || DEFAULT_DOC
  const r = await fetch(`${base}/docs/${doc}/tables/Annuaire/records`, {
    headers: { Authorization: `Bearer ${env.GRIST_API_KEY}` },
  })
  if (!r.ok) throw new Error(`Grist Annuaire HTTP ${r.status}`)
  const byName = new Map()
  for (const rec of (await r.json()).records || []) {
    const f = rec.fields || {}
    if (labos && !labos.includes(String(f.LABO || '').toUpperCase())) continue
    const full = `${f.Prenom || ''} ${f.Nom || ''}`.trim()
    if (!full) continue
    const entry = {
      nom: full,
      email: String(f.Email || ''),
      photo: String(f.photo_url || ''),
      url: String(f.annuaire_url || ''),
      labo: String(f.LABO || ''),
    }
    byName.set(normName(full), entry)
    byName.set(normName(`${f.Nom || ''} ${f.Prenom || ''}`), entry)
  }
  return byName
}

/** Authors of the work who are on staff (matched directory records). */
function effectifAuthorsOf(w, byName) {
  const seen = new Set()
  const out = []
  for (const a of w.authorships || []) {
    const entry = byName.get(normName(a.author?.display_name || ''))
    if (entry && !seen.has(entry.nom)) {
      seen.add(entry.nom)
      out.push(entry)
    }
  }
  return out
}

// Flattens an OpenAlex work to the NewsItem contract (copy of server.cjs,
// without the groups branch).
const processNewsWork = (w, selfIds) => {
  const structAuthors = new Set()
  const labs = new Set()
  const allAuthors = []
  for (const a of w.authorships || []) {
    const name = a.author?.display_name || ''
    if (name) allAuthors.push(name)
    let matched = false
    for (const inst of a.institutions || []) {
      const ids = [oaShortId(inst.id), ...(inst.lineage || []).map(oaShortId)]
      for (const id of ids) {
        if (selfIds.has(id)) matched = true
        if (NEWS_LAB_MAP[id]) {
          labs.add(NEWS_LAB_MAP[id])
          matched = true
        }
      }
    }
    if (matched && name) structAuthors.add(name)
  }
  const src = w.primary_location?.source || null
  return {
    id: oaShortId(w.id),
    title: w.title || null,
    date: w.publication_date || null,
    link: w.doi || w.primary_location?.landing_page_url || w.id || null,
    doi: w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//, '') : null,
    workType: w.type || null,
    sourceName: src?.display_name || null,
    sourceType: src?.type || null,
    issn: src?.issn_l || null,
    isOa: !!w.open_access?.is_oa,
    oaStatus: w.open_access?.oa_status || null,
    citedByCount: w.cited_by_count || 0,
    authors: [...structAuthors],
    allAuthors: allAuthors.slice(0, 8),
    authorsTotal: allAuthors.length,
    labs: [...labs].sort(),
    topics: (w.topics || []).map((t) => t.display_name).filter(Boolean).slice(0, 5),
    subfields: [...new Set((w.topics || []).map((t) => t.subfield?.display_name).filter(Boolean))],
    keywords: (w.keywords || []).map((k) => k.display_name).filter(Boolean),
  }
}

const json = (body, status = 200, extraHeaders = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  })

// Centrale-only route (hard-coded structures and staff filter above): any other Cloudflare
// instance (DRUID_INSTANCE, docs/plan-instance-demo-cloudflare.md) answers 404, like a
// structure this function does not know.
export async function onRequestGet(context) {
  const { request, params } = context
  if ((context.env?.DRUID_INSTANCE || 'centrale') !== 'centrale') return json({ error: 'Unknown structure' }, 404)
  const slug = String(params.slug || '')
  const institutionId = NEWS_STRUCTS[slug]
  if (!institutionId) return json({ error: 'Unknown structure' }, 404)

  const url = new URL(request.url)
  const days = Math.min(365, Math.max(7, parseInt(url.searchParams.get('days'), 10) || 30))

  // Edge cache, 1 h per structure/period (the normalized URL is the key).
  // Defensive: the Cache API is unavailable/no-op on *.pages.dev domains
  // — no exception here must take the response down (Error 1101).
  let cache = null
  let cacheKey = null
  try {
    cache = caches.default
    cacheKey = new Request(`${url.origin}/api/news/${slug}?days=${days}`)
    const cached = await cache.match(cacheKey)
    if (cached) return cached
  } catch (e) {
    cache = null
  }

  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
  const selfIds = new Set([institutionId])
  const filter = `institutions.id:${institutionId},from_publication_date:${from}`

  // Premium OpenAlex key (Cloudflare variable OPENALEX_API_KEY): priority rate
  // limit + fresher index. Without it, the shared pool (mailto).
  const apiKey = context.env?.OPENALEX_API_KEY || ''

  try {
    const works = []
    let total = 0
    for (let page = 1; works.length < NEWS_MAX_WORKS; page += 1) {
      const apiUrl =
        `https://api.openalex.org/works?filter=${encodeURIComponent(filter)}` +
        `&sort=publication_date:desc&per-page=200&page=${page}` +
        `&mailto=${encodeURIComponent(context.env?.OPENALEX_MAILTO || DEFAULT_MAILTO)}` +
        (apiKey ? `&api_key=${encodeURIComponent(apiKey)}` : '')
      const r = await fetch(apiUrl)
      if (!r.ok) throw new Error(`OpenAlex HTTP ${r.status}`)
      const data = await r.json()
      total = data.meta?.count ?? 0
      const results = data.results || []
      works.push(...results)
      if (results.length < 200 || works.length >= total) break
    }
    // Restrict to Centrale staff. If the directory is unavailable, degrade to
    // unfiltered monitoring (effectifsFilter=false, shown by the UI).
    let byName = null
    if (context.env?.GRIST_API_KEY) {
      try {
        byName = await fetchEffectifs(context.env, slug)
      } catch (e) {
        byName = null
      }
    }
    const kept = works.slice(0, NEWS_MAX_WORKS)
    const items = []
    for (const w of kept) {
      const item = processNewsWork(w, selfIds)
      if (byName) {
        const eff = effectifAuthorsOf(w, byName)
        if (eff.length === 0) continue
        // Highlighted authors = staff members (directory labels); the rest of
        // the NewsItem contract is unchanged.
        item.authors = eff.map((e) => e.nom)
        item.effectifs = eff
      }
      items.push(item)
    }
    const payload = {
      slug,
      days,
      fetchedAt: new Date().toISOString(),
      total: byName ? items.length : total,
      truncated: kept.length < total,
      effectifsFilter: !!byName,
      items,
    }
    const response = json(payload, 200, { 'Cache-Control': 'public, s-maxage=3600' })
    if (cache && cacheKey) {
      context.waitUntil(cache.put(cacheKey, response.clone()).catch(() => {}))
    }
    return response
  } catch (err) {
    return json({ error: `OpenAlex unreachable: ${err.message}` }, 502)
  }
}
