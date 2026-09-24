// Cloudflare Pages Function — generation of the newsletter's general-public
// news briefs (POST /api/newsletter/generate).
//
// Flow (see NewsletterPanel.tsx): OpenAlex articles from the last 30 days
// (type « article » only) are popularized in French by the ILAAS LLM
// (hook + 2-3 sentence brief) then stored in the Grist table
// `Newsletter` (status « genere »). The associated researcher = first author of
// the structure found in the Annuaire (normalized name → Email).
//
// The call is BATCHED: at most `limit` briefs generated per invocation (each
// LLM call takes several seconds); the response reports `remaining`
// and the UI calls the endpoint again until nothing is left.
//
// Body: { slug: 'ec-nantes', days?: 30, limit?: 4 }
// Response: { created: NewsletterItem[], skipped: number, remaining: number }
//
// Environment variables:
//   GRIST_API_KEY   (secret)   — already required by the Grist proxy
//   GRIST_API_BASE  (var, opt) — default https://grist.numerique.gouv.fr/api
//   GRIST_DOC_ID    (var, opt) — default: Centrale doc (aligned with VITE_GRIST_DOC_ID)
//   ILAAS_API_KEY   (secret)   — ILAAS API key (https://llm.ilaas.fr)
//   ILAAS_API_BASE  (var, opt) — default https://llm.ilaas.fr/v1
//   ILAAS_MODEL     (var, opt) — default mistral-small-4-119b

// OpenAlex polite-pool contact: OPENALEX_MAILTO (Pages variable) overrides this service address.
const DEFAULT_MAILTO = 'bu-science-ouverte@univ-nantes.fr'
const DEFAULT_DOC = 'vBpWuYg3n1tPn38CGMMAXS'

// slug -> OpenAlex institution + label (source: biblio-metrics configs,
// same values as functions/api/news/[slug].js — keep them in sync).
const STRUCTS = {
  'ec-nantes': { id: 'I100445878', name: 'Centrale Nantes' },
  gem: { id: 'I4210137520', name: 'GeM' },
  ls2n: { id: 'I4210117005', name: 'LS2N' },
  aau: { id: 'I4210162214', name: 'AAU' },
  lmjl: { id: 'I4210153365', name: 'LMJL' },
  lheea: { id: 'I4210153154', name: 'LHEEA' },
}
const LAB_MAP = {
  I4210137520: 'GeM',
  I4210117005: 'LS2N',
  I4210162214: 'AAU',
  I4210153365: 'LMJL',
  I4210153154: 'LHEEA',
}

// Directory scope per structure (LABO column) — aligned with the Veille tab and
// inject_effectifs_centrale.py; null = whole directory (institution).
const SLUG_LABOS = {
  'ec-nantes': null,
  gem: ['GEM'],
  ls2n: ['LS2N'],
  aau: ['AAU'],
  lmjl: ['LMJL'],
  lheea: ['LHEEA'],
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const oaShortId = (u) => (u ? String(u).split('/').pop() : '')

/** Rebuilds the abstract from the OpenAlex abstract_inverted_index. */
function abstractOf(w, maxLen = 1600) {
  const inv = w.abstract_inverted_index
  if (!inv) return ''
  const words = []
  for (const [word, positions] of Object.entries(inv)) {
    for (const p of positions) words[p] = word
  }
  return words.join(' ').slice(0, maxLen)
}

/** Normalized name for Annuaire matching (accent- and case-insensitive). */
function normName(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[-']/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ')
}

/** Authors affiliated with the structure + labs, as in the Veille tab. */
function structAuthorsOf(w, selfIds) {
  const authors = []
  const labs = new Set()
  for (const a of w.authorships || []) {
    const name = a.author?.display_name || ''
    let matched = false
    for (const inst of a.institutions || []) {
      const ids = [oaShortId(inst.id), ...(inst.lineage || []).map(oaShortId)]
      for (const id of ids) {
        if (selfIds.has(id)) matched = true
        if (LAB_MAP[id]) {
          labs.add(LAB_MAP[id])
          matched = true
        }
      }
    }
    if (matched && name) authors.push(name)
  }
  return { authors, labs: [...labs].sort() }
}

/** ILAAS call: hook + general-public brief, JSON output. */
async function generateBreve(env, title, abstract, chars) {
  const base = (env.ILAAS_API_BASE || 'https://llm.ilaas.fr/v1').replace(/\/$/, '')
  const model = env.ILAAS_MODEL || 'mistral-small-4-119b'
  const target = Math.min(1000, Math.max(300, parseInt(chars, 10) || 300))
  const nPhrases = Math.max(2, Math.round(target / 130))
  const system =
    "Tu écris des brèves de vulgarisation scientifique en français pour la newsletter " +
    "grand public d'un établissement de recherche. Réponds UNIQUEMENT en JSON : " +
    '{"accroche": "...", "resume": "..."}. ' +
    "L'accroche : une question ou une phrase courte et concrète, précédée d'un emoji " +
    `pertinent. Le resume : environ ${target} caractères (${nPhrases} phrases), ` +
    "accessibles et rigoureuses, sans jargon, sans superlatifs marketing, qui " +
    "expliquent l'apport concret du travail."
  const user =
    `Titre : ${title}\n` +
    (abstract ? `Résumé (langue d'origine) : ${abstract}\n` : '(pas de résumé disponible — appuie-toi sur le titre)\n') +
    '\nÉcris la brève.'
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.ILAAS_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: Math.max(400, Math.round(target / 2) + 200),
      temperature: 0.4,
    }),
  })
  if (!r.ok) throw new Error(`ILAAS HTTP ${r.status}`)
  const data = await r.json()
  const content = data.choices?.[0]?.message?.content || ''
  // The model sometimes wraps the JSON in text: extract the block.
  const m = content.match(/\{[\s\S]*\}/)
  if (m) {
    try {
      const parsed = JSON.parse(m[0])
      if (parsed.resume) {
        return { accroche: String(parsed.accroche || ''), resume: String(parsed.resume), raw: content }
      }
    } catch { /* fallback: raw text */ }
  }
  return { accroche: '', resume: content.trim(), raw: content }
}

// Centrale-only route (hard-coded structures and staff filter above): any other Cloudflare
// instance (DRUID_INSTANCE, docs/plan-instance-demo-cloudflare.md) answers 404, like a
// structure this function does not know.
export async function onRequestPost(context) {
  const { request, env } = context
  if ((env.DRUID_INSTANCE || 'centrale') !== 'centrale') return json({ error: 'Newsletter not available on this instance' }, 404)
  if (!env.ILAAS_API_KEY) {
    return json({ error: 'ILAAS_API_KEY not configured on Cloudflare (secret + redeploy)' }, 500)
  }
  if (!env.GRIST_API_KEY) {
    return json({ error: 'GRIST_API_KEY not configured on Cloudflare' }, 500)
  }

  let body = {}
  try { body = await request.json() } catch { /* defaults */ }
  const slug = String(body.slug || '')
  const struct = STRUCTS[slug]
  if (!struct) return json({ error: 'Unknown structure' }, 404)
  const days = Math.min(90, Math.max(7, parseInt(body.days, 10) || 30))
  const limit = Math.min(6, Math.max(1, parseInt(body.limit, 10) || 4))
  const chars = Math.min(1000, Math.max(300, parseInt(body.chars, 10) || 300))

  const gristBase = (env.GRIST_API_BASE || 'https://grist.numerique.gouv.fr/api').replace(/\/$/, '')
  const doc = env.GRIST_DOC_ID || DEFAULT_DOC
  const gristHeaders = {
    Authorization: `Bearer ${env.GRIST_API_KEY}`,
    'Content-Type': 'application/json',
  }

  try {
    // 1. Briefs already in the table (any status) → a work_id is never regenerated.
    const existingResp = await fetch(
      `${gristBase}/docs/${doc}/tables/Newsletter/records?filter=${encodeURIComponent(JSON.stringify({ slug: [slug] }))}`,
      { headers: gristHeaders },
    )
    if (!existingResp.ok) throw new Error(`Grist Newsletter HTTP ${existingResp.status}`)
    const existing = new Set(
      ((await existingResp.json()).records || []).map((r) => String(r.fields.work_id || '')),
    )

    // 2. OpenAlex articles of the period (type article only).
    const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
    const filter = `institutions.id:${struct.id},from_publication_date:${from},type:article`
    const apiKey = env.OPENALEX_API_KEY || ''
    const oaUrl =
      `https://api.openalex.org/works?filter=${encodeURIComponent(filter)}` +
      '&sort=publication_date:desc&per-page=100' +
      '&select=id,title,doi,publication_date,authorships,primary_location,abstract_inverted_index' +
      `&mailto=${encodeURIComponent(context.env?.OPENALEX_MAILTO || DEFAULT_MAILTO)}` +
      (apiKey ? `&api_key=${encodeURIComponent(apiKey)}` : '')
    const oaResp = await fetch(oaUrl)
    if (!oaResp.ok) throw new Error(`OpenAlex HTTP ${oaResp.status}`)
    const worksAll = ((await oaResp.json()).results || []).filter(
      (w) => !existing.has(oaShortId(w.id)),
    )

    // 3. Annuaire: normalized name → { nom, email } to associate the researcher.
    const annuaireResp = await fetch(
      `${gristBase}/docs/${doc}/tables/Annuaire/records`,
      { headers: gristHeaders },
    )
    const labos = SLUG_LABOS[slug]
    const byName = new Map()
    if (annuaireResp.ok) {
      for (const r of (await annuaireResp.json()).records || []) {
        const f = r.fields || {}
        if (labos && !labos.includes(String(f.LABO || '').toUpperCase())) continue
        const full = `${f.Prenom || ''} ${f.Nom || ''}`.trim()
        if (!full) continue
        const entry = {
          nom: full,
          email: String(f.Email || ''),
          photo: String(f.photo_url || ''),
          url: String(f.annuaire_url || ''),
        }
        byName.set(normName(full), entry)
        byName.set(normName(`${f.Nom || ''} ${f.Prenom || ''}`), entry)
      }
    }

    // Restrict to Centrale staff (same rule as the Veille tab): only articles
    // carried by at least one researcher from the directory are popularized.
    const effectifsOf = (w) => {
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
    const works = byName.size
      ? worksAll.filter((w) => effectifsOf(w).length > 0)
      : worksAll

    if (works.length === 0) return json({ created: [], skipped: existing.size, remaining: 0 })

    // 4. LLM generation, at most `limit` per invocation.
    const selfIds = new Set([struct.id])
    const numero = new Date().toISOString().slice(0, 7) // YYYY-MM
    const now = new Date().toISOString()
    const created = []
    for (const w of works.slice(0, limit)) {
      const title = w.title || '(sans titre)'
      const { authors, labs } = structAuthorsOf(w, selfIds)
      let breve
      try {
        breve = await generateBreve(env, title, abstractOf(w), chars)
      } catch (e) {
        // ILAAS error: stop here, the UI will retry (nothing written for this work).
        return json({
          created,
          skipped: existing.size,
          remaining: works.length - created.length,
          error: `Generation interrupted: ${e.message}`,
        }, created.length ? 200 : 502)
      }
      // Highlighted researcher: first Centrale staff member of the work —
      // preferably one with an email (can be contacted), else one with a photo.
      const matches = effectifsOf(w)
      const researcher = matches.find((r) => r.email) || matches.find((r) => r.photo) || matches[0]
      const fields = {
        work_id: oaShortId(w.id),
        slug,
        numero,
        titre: title,
        doi: w.doi ? String(w.doi).replace(/^https?:\/\/doi\.org\//, '') : '',
        date_publication: w.publication_date || '',
        journal: w.primary_location?.source?.display_name || '',
        auteurs: authors.join(', '),
        labs: labs.join(', '),
        accroche: breve.accroche,
        resume: breve.resume,
        resume_genere: breve.raw,
        statut: 'genere',
        chercheur_nom: researcher?.nom || '',
        chercheur_email: researcher?.email || '',
        chercheur_photo: researcher?.photo || '',
        chercheur_url: researcher?.url || '',
        genere_le: now,
        valide_le: '',
        valide_par: '',
        commentaire: '',
      }
      const add = await fetch(`${gristBase}/docs/${doc}/tables/Newsletter/records`, {
        method: 'POST',
        headers: gristHeaders,
        body: JSON.stringify({ records: [{ fields }] }),
      })
      if (!add.ok) throw new Error(`Écriture Grist HTTP ${add.status}`)
      const rec = (await add.json()).records?.[0]
      created.push({ id: rec?.id ?? null, fields })
    }

    return json({
      created,
      skipped: existing.size,
      remaining: works.length - created.length,
    })
  } catch (err) {
    return json({ error: err.message }, 502)
  }
}
