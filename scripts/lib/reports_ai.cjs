'use strict';
// AI texts of the « Mes rapports » reports (docs/plan-mes-rapports.md § 4.5, lot 8): ILAAS writes,
// the code counts. Three tasks, called one by one by the client (progress shown, each request
// short):
//   clusters          group the OpenAlex topics of the corpus into 3-7 major themes
//   cluster-synthesis short synthesis of one theme from its publications and code-computed figures
//   executive         executive summary, key points and cooperation leads from the key figures and
//                     the theme syntheses
// Guards (same principle as /api/collab-theme/*): every label, name or title the model returns is
// checked against what it was given; anything else is dropped. The model is asked never to state
// a figure it was not given — the figures printed in the report come from the client.
//
// One module for both runtimes: server.cjs (Nantes) and functions/api/report-ai.js (Cloudflare).

const MAX_ITEMS = 60;
const MAX_PUBLICATIONS = 80;
const MAX_RESEARCHERS = 20;
const MAX_FIGURES = 24;
const MAX_TEXT = 12000;

const ERRORS = {
  task: { status: 400, error: 'Invalid AI task' },
  empty: { status: 400, error: 'No publication to analyze' },
};

const str = (v, max = 300) => String(v ?? '').trim().slice(0, max);
const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
const language = (lang) => (lang === 'en' ? 'anglais' : 'français');

/** First JSON object of a model answer ({} when none). */
function parseJson(content) {
  const m = String(content || '').match(/\{[\s\S]*\}/);
  if (!m) return {};
  try { return JSON.parse(m[0]); } catch { return {}; }
}

/**
 * Retry policy of the ILAAS calls: long generations are sometimes cut (« terminated », « fetch
 * failed », 502/503/504 — seen during the 2026-09-28 model benchmark). A cut or overloaded call is
 * retried after a short pause; a refused one (4xx other than 429) is not.
 */
const ATTEMPTS = 3;
const ATTEMPT_TIMEOUT_MS = 90000;
const RETRY_DELAYS_MS = [1500, 4000];
const retryable = (status) => status === 429 || status >= 500;

function createReportAi({ apiBase, apiKey, model, fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const base = String(apiBase || 'https://llm.ilaas.fr/v1').replace(/\/$/, '');
  const chat = async (system, user, maxTokens, temperature) => {
    const body = JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      max_tokens: maxTokens,
      temperature,
    });
    let lastError = null;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]);
      let r;
      try {
        r = await fetchImpl(`${base}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body,
          // A generation stuck longer than this is abandoned and retried.
          signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ATTEMPT_TIMEOUT_MS) : undefined,
        });
      } catch (e) {
        lastError = e; // network cut or timeout: retried
        continue;
      }
      if (!r.ok) {
        lastError = new Error(`ILAAS HTTP ${r.status}`);
        if (retryable(r.status)) continue;
        throw lastError;
      }
      try {
        const data = await r.json();
        return data.choices?.[0]?.message?.content || '';
      } catch (e) {
        lastError = e; // body cut while reading: retried
      }
    }
    throw lastError || new Error('ILAAS unreachable');
  };

  /** Topics → 3-7 themes. Each topic in at most one theme; unknown topics dropped. */
  async function clusters(body) {
    const items = list(body.items, MAX_ITEMS)
      .map((it) => ({ label: str(it?.label), count: Number(it?.count) || 0 }))
      .filter((it) => it.label);
    if (!items.length) throw ERRORS.empty;
    const system =
      "Tu es analyste bibliométrique. On te donne la liste FERMÉE des sujets (topics OpenAlex) " +
      "des publications communes entre une structure de recherche et un ou plusieurs partenaires, " +
      "avec leur nombre de publications. Regroupe ces sujets en 3 à 7 grands domaines thématiques " +
      "cohérents, nommés de façon courte et parlante pour une direction des relations " +
      "internationales. Chaque sujet va dans un seul domaine ; recopie les libellés des sujets À " +
      "L'IDENTIQUE, n'en invente aucun. Les sujets trop isolés peuvent rester hors domaine. " +
      `Écris les noms et résumés de domaines en ${language(body.lang)}. ` +
      'Réponds UNIQUEMENT en JSON : {"domains": [{"label": "...", "summary": "une phrase", "topics": ["..."]}]}.';
    const user =
      `Structure : ${str(body.structureLabel)}\nPartenaire(s) : ${str(body.partnerLabel) || '(non précisé)'}\n\n` +
      `Sujets (nombre de publications) :\n${items.map((it) => `- ${it.label} (${it.count})`).join('\n')}\n`;
    const parsed = parseJson(await chat(system, user, 1500, 0.2));
    const allowed = new Set(items.map((it) => it.label));
    const used = new Set();
    const domains = list(parsed.domains, 7)
      .map((d) => {
        const topics = list(d?.topics, MAX_ITEMS).map((t) => str(t)).filter((t) => allowed.has(t) && !used.has(t));
        topics.forEach((t) => used.add(t));
        return { label: str(d?.label, 120), summary: str(d?.summary, 400), topics };
      })
      .filter((d) => d.label && d.topics.length);
    return { domains, unclassified: items.map((it) => it.label).filter((l) => !used.has(l)) };
  }

  /** One theme: short synthesis, highlights checked against the supplied names and titles. */
  async function clusterSynthesis(body) {
    const publications = list(body.publications, MAX_PUBLICATIONS).map((p) => ({
      title: str(p?.title),
      year: Number.isFinite(p?.year) ? p.year : null,
      journal: str(p?.journal, 200),
      authors: list(p?.authors, 10).map((a) => str(a, 120)),
    })).filter((p) => p.title);
    if (!publications.length) throw ERRORS.empty;
    const researchers = list(body.researchers, MAX_RESEARCHERS)
      .map((r) => ({ label: str(r?.label, 160), count: Number(r?.count) || 0 }))
      .filter((r) => r.label);
    const system =
      "Tu es analyste bibliométrique pour un établissement de recherche. On te fournit un grand " +
      "domaine thématique d'une collaboration, ses chiffres (calculés, à ne pas contredire ni " +
      "compléter), les publications communes et les chercheur·euses internes les plus impliqué·es. " +
      `Rédige en ${language(body.lang)} un paragraphe de 4 à 7 phrases, sobre, sans superlatif, qui ` +
      "décrit la nature de la collaboration dans ce domaine (sujets, types de travaux, continuité " +
      "dans le temps) et cite 1 à 3 publications ou chercheur·euses EXACTEMENT comme fournis. " +
      "N'écris AUCUN chiffre qui ne figure pas dans les chiffres fournis. Si la collaboration repose " +
      "sur peu de personnes ou sur de grands consortiums, dis-le. " +
      'Réponds UNIQUEMENT en JSON : {"synthesis": "...", "highlightedResearchers": ["..."], "highlightedTitles": ["..."]}.';
    const user =
      `Structure : ${str(body.structureLabel)}\nPartenaire(s) : ${str(body.partnerLabel) || '(non précisé)'}\n` +
      `Domaine : ${str(body.domain?.label, 120)} — ${str(body.domain?.summary, 400)}\n` +
      `Chiffres : ${str(body.domain?.figures, 600)}\n` +
      `Chercheur·euses internes : ${researchers.map((r) => `${r.label} (${r.count})`).join(', ') || '(aucun)'}\n\n` +
      `Publications (${publications.length}) :\n` +
      publications.map((p) => `- [${p.year ?? '?'}] ${p.title} — ${p.journal} — ${p.authors.join(', ')}`).join('\n');
    const content = await chat(system, user, 900, 0.3);
    const parsed = parseJson(content);
    const names = new Set(researchers.map((r) => r.label));
    const titles = new Set(publications.map((p) => p.title));
    const keep = (arr, allowed) => list(arr, 5).map((v) => str(v)).filter((v) => allowed.has(v));
    return {
      synthesis: str(parsed.synthesis || content, 4000),
      highlightedResearchers: keep(parsed.highlightedResearchers, names),
      highlightedTitles: keep(parsed.highlightedTitles, titles),
    };
  }

  /** Executive summary from the key figures and the theme syntheses (not the raw publications). */
  async function executive(body) {
    const figures = list(body.keyFigures, MAX_FIGURES)
      .map((f) => `${str(f?.label, 120)} : ${str(f?.value, 60)}${f?.hint ? ` (${str(f.hint, 160)})` : ''}`);
    if (!figures.length) throw ERRORS.empty;
    // focus: « collaboration » (report on partner institutions) or « general » (funding, journals…).
    const collaboration = body.focus !== 'general';
    const system =
      (collaboration
        ? "Tu es analyste bibliométrique pour la direction des relations internationales d'un " +
          "établissement de recherche. À partir des chiffres clés (calculés, à reprendre tels quels sans " +
          "en ajouter) et des synthèses par domaine d'une collaboration, rédige en " +
          `${language(body.lang)} : un paragraphe de synthèse (4 à 6 phrases), 3 à 5 points clés, et 2 à 4 ` +
          "pistes de coopération concrètes. Reste factuel et prudent ; signale les domaines portés par peu " +
          "de chercheur·euses ou par de grands consortiums. "
        : "Tu es analyste bibliométrique pour la direction de la recherche d'un établissement. À partir " +
          "des chiffres clés d'un rapport (calculés, à reprendre tels quels sans en ajouter) et, s'il y en " +
          `a, des synthèses par domaine, rédige en ${language(body.lang)} : un paragraphe de synthèse (4 à 6 ` +
          "phrases), 3 à 5 points clés, et 2 à 4 pistes d'action concrètes. Reste factuel et prudent ; " +
          "signale les limites des données quand elles sont indiquées (couverture partielle, effectifs " +
          "faibles). ") +
      "Ne cite aucun nom qui n'apparaît pas dans les éléments fournis. " +
      'Réponds UNIQUEMENT en JSON : {"summary": "...", "keyPoints": ["..."], "leads": ["..."]}.';
    const user =
      `Structure : ${str(body.structureLabel)}\nPartenaire(s) : ${str(body.partnerLabel) || '(non précisé)'}\n\n` +
      `Chiffres clés :\n${figures.map((f) => `- ${f}`).join('\n')}\n\n` +
      `Synthèses par domaine :\n${str(body.domainTexts, MAX_TEXT) || '(aucune)'}\n`;
    const content = await chat(system, user, 1200, 0.3);
    const parsed = parseJson(content);
    const lines = (arr) => list(arr, 5).map((v) => str(v, 600)).filter(Boolean);
    return {
      summary: str(parsed.summary || content, 4000),
      keyPoints: lines(parsed.keyPoints),
      leads: lines(parsed.leads),
    };
  }

  const TASKS = { clusters, 'cluster-synthesis': clusterSynthesis, executive };

  return {
    /** { task, ... } → { status, body } — the model name goes with every answer (cited in the PDF). */
    async run(body) {
      const fn = TASKS[body && body.task];
      try {
        if (!fn) throw ERRORS.task;
        return { status: 200, body: { ...(await fn(body)), model } };
      } catch (e) {
        if (e && e.status && e.error) return { status: e.status, body: { error: e.error } };
        return { status: 502, body: { error: `Analysis failed: ${String((e && e.message) || e)}` } };
      }
    },
  };
}

module.exports = { createReportAi, parseJson, MAX_ITEMS, MAX_PUBLICATIONS };
