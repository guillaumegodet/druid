// Cloudflare Pages Function — ILAAS relay matching a free-text theme
// → OpenAlex domains/subfields/topics (POST /api/collab-theme/select-topics).
//
// Used by the teams' disciplinary profile (TeamsTab.tsx, « Par thématique »
// mode) and by the thematic analysis of collaborations (PartnerBilanSection.tsx).
// Ported from server.cjs (Nantes): same prompt, same anti-hallucination guard
// (only labels actually present in the supplied lists are returned).
//
// Body: { theme: string, domains?: string[], subfields?: string[], topics?: string[] }
// Response: { domains: string[], subfields: string[], topics: string[] }
//
// Environment variables:
//   ILAAS_API_KEY   (secret)   — ILAAS API key (https://llm.ilaas.fr)
//   ILAAS_API_BASE  (var, opt) — default https://llm.ilaas.fr/v1
//   ILAAS_MODEL     (var, opt) — default mistral-small-4-119b

const MAX_THEME_TOPICS = 60

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

/** Step 1: match a free-text theme to OpenAlex domains/subfields/topics
 * taken from a CLOSED list supplied by the client. */
async function selectThemeTopics(env, theme, { domains, subfields, topics }) {
  const base = (env.ILAAS_API_BASE || 'https://llm.ilaas.fr/v1').replace(/\/$/, '')
  const model = env.ILAAS_MODEL || 'mistral-small-4-119b'
  const system =
    "Tu aides à explorer un corpus de publications scientifiques. On te donne une " +
    "thématique décrite librement par l'utilisateur et une liste FERMÉE de domaines, " +
    "sous-disciplines et sujets (topics) OpenAlex réellement présents dans le corpus. " +
    "Choisis UNIQUEMENT parmi les libellés fournis ceux qui correspondent à la " +
    "thématique — n'invente aucun libellé, ne reformule rien, recopie-les à l'identique. " +
    "Si rien ne correspond, réponds avec des listes vides plutôt que de forcer un lien. " +
    'Réponds UNIQUEMENT en JSON : {"domains": [...], "subfields": [...], "topics": [...]}.'
  const user =
    `Thématique recherchée : ${theme}\n\n` +
    `Domaines disponibles : ${domains.join(' | ') || '(aucun)'}\n` +
    `Sous-disciplines disponibles : ${subfields.join(' | ') || '(aucune)'}\n` +
    `Topics disponibles : ${topics.join(' | ') || '(aucun)'}\n`
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
      max_tokens: 600,
      temperature: 0.1,
    }),
  })
  if (!r.ok) throw new Error(`ILAAS HTTP ${r.status}`)
  const data = await r.json()
  const content = data.choices?.[0]?.message?.content || ''
  const m = content.match(/\{[\s\S]*\}/)
  let parsed = {}
  if (m) {
    try { parsed = JSON.parse(m[0]) } catch { /* fallback: empty lists */ }
  }
  // Anti-hallucination guard: only return labels that are actually present
  // in the input lists.
  const keep = (arr, allowed) => {
    const allowedSet = new Set(allowed)
    return (Array.isArray(arr) ? arr : []).filter((v) => allowedSet.has(v))
  }
  return {
    domains: keep(parsed.domains, domains),
    subfields: keep(parsed.subfields, subfields),
    topics: keep(parsed.topics, topics),
  }
}

export async function onRequestPost(context) {
  const { request, env } = context
  if (!env.ILAAS_API_KEY) {
    return json({ error: 'ILAAS_API_KEY not configured on Cloudflare (secret + redeploy)' }, 500)
  }

  let body = {}
  try { body = await request.json() } catch { /* defaults */ }
  const theme = String(body.theme || '').trim().slice(0, 300)
  if (!theme) return json({ error: 'Missing theme' }, 400)
  const clip = (arr) => (Array.isArray(arr) ? arr : []).map(String).slice(0, MAX_THEME_TOPICS)
  const domains = clip(body.domains)
  const subfields = clip(body.subfields)
  const topics = clip(body.topics)

  try {
    const selection = await selectThemeTopics(env, theme, { domains, subfields, topics })
    return json(selection)
  } catch (e) {
    return json({ error: `Analysis failed: ${e.message}` }, 502)
  }
}
