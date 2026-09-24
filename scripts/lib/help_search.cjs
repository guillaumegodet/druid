/**
 * help_search.cjs — Retrieval over the user help centre for the « Aide Druid » assistant
 * (docs/plan-documentation-utilisateur.md, lot 8).
 *
 * The help pages (help/src/content/docs/**.md|.mdx, copied into the Docker image) are split into
 * sections (one per `##` heading, `###` kept inside), indexed with BM25 over accent-folded French
 * tokens, and the best sections of a question are handed to the LLM as the only allowed source.
 * Pure apart from the file reads of loadHelpIndex(): no network, testable offline.
 */
const fs = require('fs');
const path = require('path');

const STOPWORDS = new Set((
  'a au aux avec ce ces cet cette comment dans de des du elle en est et etre eux il ils je la le les leur leurs lui ' +
  'ma mais me meme mes moi mon ne nos notre nous on ou par pas pour qu que quel quelle quelles quels qui sa se ses ' +
  'si son sont sur ta te tes toi ton tu un une vos votre vous y faire fait peut puis dois doit quoi quand ' +
  // Question words and generic verbs: frequent in questions, meaningless for retrieval.
  'veut veux dire signifie difference entre ajouter avoir mettre savoir trouver voir utiliser peux puisse ' +
  'possible besoin chose ' +
  'the of to and in for is how what'
).split(' '));

/** Lower case, accents removed, split on non-letters, stop words dropped, light plural stemming. */
const tokenize = (text) =>
  String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
    .map((t) => (t.length > 4 ? t.replace(/[sx]$/, '') : t));

/** Front matter title/description, then the body without MDX imports, components and HTML comments. */
const parsePage = (raw) => {
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  const meta = fm ? fm[1] : '';
  const field = (name) => {
    const m = new RegExp(`^${name}:\\s*(.+)$`, 'm').exec(meta);
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
  };
  const body = (fm ? raw.slice(fm[0].length) : raw)
    .replace(/^import\s.+$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    // <QuiOu profils="…" menu="…" disponibilite="…" /> → plain text (it answers « who » and « where »)
    .replace(/<QuiOu\b([\s\S]*?)\/>/g, (_, attrs) =>
      [...attrs.matchAll(/(\w+)="([^"]*)"/g)].map(([, k, v]) => `${k === 'disponibilite' ? 'Disponible sur' : k === 'menu' ? 'Dans Druid' : 'Profils'} : ${v}`).join('\n'))
    .replace(/<\/?[A-Z][^>]*>/g, '');
  return { title: field('title'), description: field('description'), body };
};

/** Every .md/.mdx page under `docsDir`, as [{ slug, file }] (slug = site path without slashes). */
const listPages = (docsDir, dir = docsDir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return listPages(docsDir, p);
    if (!/\.mdx?$/.test(d.name)) return [];
    return [{ slug: path.relative(docsDir, p).replace(/\.mdx?$/, '').split(path.sep).join('/'), file: p }];
  });

/** Starlight anchor of a heading (github-slugger rules, as in lib/__tests__/helpLinks.test.ts). */
const slugify = (heading) =>
  heading.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*`_]/g, '')
    .toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-');

/**
 * Builds the index: one entry per `##` section of every page (the intro before the first `##`
 * is its own section). Pages still marked « à venir » are skipped.
 */
const loadHelpIndex = (docsDir) => {
  const sections = [];
  for (const { slug, file } of listPages(docsDir)) {
    const raw = fs.readFileSync(file, 'utf8');
    if (/badge:\s*\n\s*text:\s*à venir/.test(raw)) continue;
    const { title, description, body } = parsePage(raw);
    const url = slug === 'index' ? '/' : `/${slug}/`;
    const parts = body.split(/^## /m);
    parts.forEach((part, i) => {
      const heading = i === 0 ? '' : part.split('\n')[0].trim();
      const text = (i === 0 ? part : part.slice(part.indexOf('\n') + 1)).trim();
      // « Voir aussi » lists only repeat page titles: noise for retrieval.
      if (!text || /^voir aussi$/i.test(heading)) return;
      sections.push({
        url: heading ? `${url}#${slugify(heading)}` : url,
        pageTitle: title,
        heading,
        text: i === 0 && description ? `${description}\n\n${text}` : text,
      });
    });
  }
  const docs = sections.map((s) => {
    const tokens = tokenize(`${s.text}`);
    const titleTokens = tokenize(`${s.pageTitle} ${s.heading}`);
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    // Words of the page title and heading weigh like three occurrences in the text.
    for (const t of titleTokens) tf.set(t, (tf.get(t) || 0) + 3);
    return { ...s, tf, length: tokens.length + 3 * titleTokens.length };
  });
  const df = new Map();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  const avgLength = docs.reduce((s, d) => s + d.length, 0) / Math.max(docs.length, 1);
  return { docs, df, avgLength, pageCount: new Set(sections.map((s) => s.pageTitle)).size };
};

/** BM25 (k1 = 1.2, b = 0.75) — the `k` best sections for `query`, best first, score > 0. */
const searchHelp = (index, query, k = 6) => {
  const terms = [...new Set(tokenize(query))];
  const N = index.docs.length;
  const scored = index.docs.map((d) => {
    let score = 0;
    for (const t of terms) {
      const f = d.tf.get(t);
      if (!f) continue;
      const n = index.df.get(t) || 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += idf * ((f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (d.length / index.avgLength))));
    }
    return { d, score };
  });
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, k)
    .map(({ d, score }) => ({ url: d.url, pageTitle: d.pageTitle, heading: d.heading, text: d.text, score }));
};

/** System prompt of the help assistant: the retrieved sections are the only allowed source. */
const buildHelpSystemPrompt = (hits, helpBaseUrl, maxChars = 14000) => {
  let budget = maxChars;
  const excerpts = [];
  for (const h of hits) {
    const label = h.heading ? `${h.pageTitle} — ${h.heading}` : h.pageTitle;
    const text = h.text.length > budget ? h.text.slice(0, Math.max(budget, 0)) : h.text;
    if (!text) break;
    budget -= text.length;
    excerpts.push(`### [${label}](${helpBaseUrl}${h.url})\n${text}`);
  }
  return [
    "Tu es l'assistant d'aide de Druid, l'application de gestion de l'annuaire de la recherche d'un établissement.",
    "Réponds en français, en vouvoyant l'utilisateur, de façon concise et pratique (étapes numérotées quand c'est",
    'une procédure), en reprenant les libellés exacts des boutons et des menus en gras.',
    "Appuie-toi UNIQUEMENT sur les extraits du centre d'aide ci-dessous. Cite la ou les pages utilisées avec leur",
    'lien Markdown exact, par exemple : « Voir [Traiter un doublon](https://…) ».',
    "Si les extraits ne répondent pas à la question, dis-le simplement et propose la page la plus proche ou le",
    'support ; n\'invente jamais de fonction, de bouton ou de règle.',
    "Tu ne connais pas les données de l'établissement (personnes, publications, chiffres) : pour ces questions,",
    "explique où les trouver dans Druid et signale que l'onglet « Données CRISalid » de l'assistant peut y répondre.",
    '',
    "## Extraits du centre d'aide",
    '',
    excerpts.length ? excerpts.join('\n\n') : '(aucun extrait pertinent trouvé)',
  ].join('\n');
};

module.exports = { tokenize, parsePage, slugify, loadHelpIndex, searchHelp, buildHelpSystemPrompt };
