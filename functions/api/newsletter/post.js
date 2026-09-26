// Cloudflare Pages Function — social media post draft (LinkedIn / X)
// tailored to an article's content (POST /api/newsletter/post).
//
// Triggered by the « mégaphone » button of the Veille tab (NewsTab.tsx). The
// Veille feed does not carry the abstract in each item (lighter payload):
// it is fetched on demand from OpenAlex by work_id, then the post is written
// with the same LLM engine (ILAAS) as the newsletter briefs.
//
// Body: { workId: 'W…', title, authors, labs, journal, link, structName, topics }
// Response: { post: string }
//
// Environment variables:
//   ILAAS_API_KEY   (secret)   — ILAAS API key (https://llm.ilaas.fr)
//   ILAAS_API_BASE  (var, opt) — default https://llm.ilaas.fr/v1
//   ILAAS_MODEL     (var, opt) — default mistral-small-4-119b
//   OPENALEX_API_KEY(var, opt) — OpenAlex premium key

import { instanceEnv, instanceOf } from '../../_lib/instance.js'

// OpenAlex polite-pool contact: openalexMailto of instance.json (or OPENALEX_MAILTO) overrides this service address.
const DEFAULT_MAILTO = 'bu-science-ouverte@univ-nantes.fr'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

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

/** From a LinkedIn profile URL, a pseudo-handle « @vanity » (the /in/… segment). */
function linkedinMention(url) {
  const u = String(url || '').trim()
  if (!u) return ''
  const m = u.match(/linkedin\.com\/(?:in|pub)\/([^/?#]+)/i)
  let vanity = m ? m[1] : u.replace(/^https?:\/\//, '').replace(/\/+$/, '').split('/').pop()
  try { vanity = decodeURIComponent(vanity || '') } catch { /* keep as is */ }
  return vanity ? `@${vanity}` : ''
}

/** Resolves author names to their declared LinkedIn accounts (Annuaire). */
async function resolveAuthorMentions(env, grist, authorNames) {
  const names = (Array.isArray(authorNames) ? authorNames : []).filter(Boolean)
  if (names.length === 0 || !env.GRIST_API_KEY) return []
  const { apiBase: base, docId: doc } = grist
  try {
    const resp = await fetch(`${base}/docs/${doc}/tables/Annuaire/records`, {
      headers: { Authorization: `Bearer ${env.GRIST_API_KEY}` },
    })
    if (!resp.ok) return []
    const byName = new Map()
    for (const r of (await resp.json()).records || []) {
      const f = r.fields || {}
      const linkedin = String(f.LinkedIn || '').trim()
      if (!linkedin) continue
      const full = `${f.Prenom || ''} ${f.Nom || ''}`.trim()
      const entry = { name: full, url: linkedin, handle: linkedinMention(linkedin) }
      byName.set(normName(full), entry)
      byName.set(normName(`${f.Nom || ''} ${f.Prenom || ''}`), entry)
    }
    const out = []
    const seen = new Set()
    for (const n of names) {
      const e = byName.get(normName(n))
      if (e && e.handle && !seen.has(e.name)) { seen.add(e.name); out.push(e) }
    }
    return out
  } catch { return [] }
}

/** Rebuilds the abstract from the OpenAlex abstract_inverted_index. */
function abstractOf(w, maxLen = 1600) {
  const inv = w && w.abstract_inverted_index
  if (!inv) return ''
  const words = []
  for (const [word, positions] of Object.entries(inv)) {
    for (const p of positions) words[p] = word
  }
  return words.join(' ').slice(0, maxLen)
}

/** ILAAS call: social media post draft tailored to the article. */
async function generateSocialPost(env, { title, abstract, authors, labs, journal, link, structName, topics, mentions }) {
  const base = (env.ILAAS_API_BASE || 'https://llm.ilaas.fr/v1').replace(/\/$/, '')
  const model = env.ILAAS_MODEL || 'mistral-small-4-119b'
  const system =
    "Tu es chargé·e de communication d'un établissement de recherche. Rédige un " +
    "brouillon de post pour les réseaux sociaux (LinkedIn / X) annonçant une nouvelle " +
    "publication scientifique, en français. Ton chaleureux mais rigoureux, sans " +
    "superlatifs marketing ni jargon. Structure : une accroche avec un emoji pertinent, " +
    "2 à 4 phrases qui expliquent concrètement l'apport de l'article pour le grand " +
    "public, la mention des auteur·rices et du laboratoire, le lien de lecture, puis " +
    "3 à 5 hashtags pertinents. Quand des comptes LinkedIn d'auteur·rices sont fournis, " +
    "mentionne-les avec leur handle « @… » pour inviter à interagir avec elles/eux. " +
    "Réponds UNIQUEMENT avec le texte du post (pas de préambule ni de guillemets englobants)."
  const mentionsLine = (mentions || []).filter((m) => m && m.handle).length
    ? `Comptes LinkedIn des auteur·rices (à mentionner, ex. « @vanity », pour les taguer) : ${
        mentions.filter((m) => m && m.handle).map((m) => `${m.name} ${m.handle}`).join(', ')
      }\n`
    : ''
  const user =
    `Établissement : ${structName}\n` +
    `Titre de l'article : ${title}\n` +
    (authors ? `Auteur·rices : ${authors}\n` : '') +
    mentionsLine +
    (labs ? `Laboratoire(s) : ${labs}\n` : '') +
    (journal ? `Revue : ${journal}\n` : '') +
    (topics && topics.length ? `Thématiques : ${topics.join(', ')}\n` : '') +
    (link ? `Lien de lecture : ${link}\n` : '') +
    (abstract ? `\nRésumé (langue d'origine) :\n${abstract}\n` : '\n(pas de résumé disponible — appuie-toi sur le titre)\n') +
    '\nRédige le post.'
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
      max_tokens: 500,
      temperature: 0.6,
    }),
  })
  if (!r.ok) throw new Error(`ILAAS HTTP ${r.status}`)
  const data = await r.json()
  return (data.choices?.[0]?.message?.content || '').trim()
}

// Centrale-only route (ILAAS relay part of the Veille newsletter): an instance without
// `features.newsletter` in its instance.json (docs/plan-architecture-multi-instances.md, lot 5 c)
// answers 404.
export async function onRequestPost(context) {
  const { request } = context
  const instance = instanceOf(context)
  const env = instanceEnv(context.env, instance)
  if (!instance.features.newsletter) return json({ error: 'Newsletter not available on this instance' }, 404)
  if (!env.ILAAS_API_KEY) {
    return json({ error: 'ILAAS_API_KEY not configured on Cloudflare (secret + redeploy)' }, 500)
  }

  let body = {}
  try { body = await request.json() } catch { /* defaults */ }
  const workId = String(body.workId || '')
  try {
    let abstract = ''
    if (/^W\d+$/.test(workId)) {
      const apiKey = env.OPENALEX_API_KEY || ''
      const url =
        `https://api.openalex.org/works/${workId}?select=abstract_inverted_index` +
        `&mailto=${encodeURIComponent(instance.openalexMailto || DEFAULT_MAILTO)}` +
        (apiKey ? `&api_key=${encodeURIComponent(apiKey)}` : '')
      const r = await fetch(url)
      if (r.ok) abstract = abstractOf(await r.json())
    }
    // Authors' LinkedIn accounts (Annuaire profile record) → @vanity mentions.
    const mentions = await resolveAuthorMentions(env, instance.grist, body.authorNames)
    const post = await generateSocialPost(env, {
      title: String(body.title || ''),
      abstract,
      authors: String(body.authors || ''),
      labs: Array.isArray(body.labs) ? body.labs.join(', ') : String(body.labs || ''),
      journal: String(body.journal || ''),
      link: String(body.link || ''),
      structName: String(body.structName || ''),
      topics: Array.isArray(body.topics) ? body.topics : [],
      mentions,
    })
    return json({ post, mentions })
  } catch (e) {
    return json({ error: `Generation failed: ${e.message}` }, 502)
  }
}
