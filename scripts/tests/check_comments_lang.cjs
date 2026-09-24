#!/usr/bin/env node
// Inventory of source-code comments still written in French.
//
// Usage:
//   node scripts/tests/check_comments_lang.cjs [--list] [--strict] [--json] [paths...]
//
//   --list    print every French comment line as `file:line: text`
//   --strict  exit with code 1 when at least one French comment remains
//   --json    print the summary as JSON (used by lib/__tests__/commentsLang.test.ts)
//   paths     restrict the scan to these files or directories (default: whole repo)
//
// Run it with the same Node image as the tests:
//   docker run --rm -v "$PWD":/app -w /app node:20-slim node scripts/tests/check_comments_lang.cjs
//
// Detection is a heuristic (accented letters, French quotes, or at least two
// French function words on the same line). Quoted fragments (« … », “ … ”, "…")
// are ignored so that data values such as the « Parti » status can stay in
// French inside an English comment (see docs/conventions.md).
// Context: docs/archive/plan-traduction-commentaires.md.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const EXTENSIONS = /\.(tsx?|[cm]?js|py|sh|css|ya?ml)$/;
const EXCLUDED_PREFIXES = ['dist/', 'node_modules/', 'locales/', 'scripts/.build/', 'public/'];
const HASH_COMMENT_EXT = /\.(py|sh|ya?ml)$/;

const ACCENTS = /[éèêëàâäçùûüîïôöœÉÈÊÀÂÇÙÛÎÔŒ«»]/;
// One occurrence of a strong word is enough; weak words need two hits per line
// (they also exist in English or in identifiers).
const STRONG_WORDS = new Set([
  'les', 'des', 'une', 'pour', 'avec', 'dans', 'sont', 'sinon', 'lorsque', 'chaque', 'aucun',
  'aucune', 'toutes', 'renvoie', 'retourne', 'affiche', 'fiche', 'fiches', 'colonne', 'colonnes',
  'chercheur', 'chercheurs', 'publi', 'publis', 'sert', 'produit', 'fichier',
  'fichiers', 'requête', 'ligne', 'lignes', 'appel', 'appels', 'valeur', 'valeurs', 'nouveau',
  'nouvelle', 'ancien', 'ancienne', 'seulement', 'toujours', 'jamais', 'encore', 'ainsi', 'puis',
  'sans', 'voir', 'vide', 'vides', 'absente', 'retenu', 'retenus', 'seul', 'seule', 'cible', 'groupes',
  'produits', 'charger', 'reprend', 'invalide', 'humain', 'secondaires', 'prioritaire', 'autre', 'autres',
  'aussi', 'ici', 'donc', 'mais', 'ou', 'du', 'au', 'aux', 'pas',
]);
const WEAK_WORDS = new Set([
  'le', 'la', 'un', 'sur', 'est', 'que', 'qui', 'et', 'par', 'de',
  'en', 'même', 'déjà', 'après', 'avant', 'depuis', 'selon', 'entre', 'tous',
  'alors', 'quand', 'ce', 'cette', 'ces', 'son', 'sa', 'ses', 'leur', 'leurs', 'nous',
  'vous', 'ne', 'très', 'être', 'avoir', 'fait', 'faire', 'peut', 'doit', 'sera', 'soit', 'car',
  'chez', 'vers', 'sous', 'lors', 'dont', 'cf', 'nb', 'ex', 'charge', 'filtre', 'défaut', 'labo', 'labos', 'nom',
]);
// Directive comments that must stay untouched and are never counted.
const DIRECTIVE = /^(eslint|@ts-|prettier|biome|noqa|type:|pylint|fmt:|istanbul|c8 |v8 |#!|-\*-|@vitest|@jsx|<reference)/;
// Quoted fragments are data values, not prose to translate. A « … » quote may
// span two comment lines: the opening or closing half is stripped on its own.
const QUOTED = /«[^»]*»|“[^”]*”|"[^"]*"|`[^`]*`|«[^»]*$|^[^«]*»/g;
// Proper nouns and institutional names that legitimately keep their accents in
// English prose (no \b: JavaScript word boundaries are ASCII-only).
const PROPER_NOUNS = /Conseil National des Universités|Nantes\s+Universit[ée]s?|Universit[ée]s?|Établissements?|HCÉRES|PÔLE|Prénom|École|Centrale|Référence|É[A-Z]{2,}/g;

function isFrench(text) {
  const stripped = text.replace(QUOTED, ' ').replace(PROPER_NOUNS, ' ').trim();
  if (!stripped) return false;
  if (ACCENTS.test(stripped)) return true;
  const words = (stripped.toLowerCase().match(/[a-zà-ÿ_']+/g) || []).filter((w) => !w.includes('_'));
  let hits = 0;
  for (const raw of words) {
    const w = raw.replace(/^(l|d|qu|n|s|c|j|m)'/, '');
    if (STRONG_WORDS.has(w)) return true;
    if (WEAK_WORDS.has(w)) hits++;
  }
  return hits >= 2;
}

// Extracts comment lines from a JS/TS/CSS source. Strings are skipped so that
// `//` inside URLs or `/*` inside string literals are not taken for comments.
// Single- and double-quoted strings never span lines; template literals do.
function extractSlashComments(src) {
  const out = []; // { line, text }
  const n = src.length;
  let i = 0, line = 1;
  let quote = null; // current string delimiter, or null
  while (i < n) {
    const ch = src[i], next = src[i + 1];
    if (ch === '\n') { line++; if (quote && quote !== '`') quote = null; i++; continue; }
    if (quote) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === quote) quote = null;
      i++; continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; i++; continue; }
    if (ch === '/' && next === '/' && src[i - 1] !== '\\' && src[i - 1] !== ':') {
      const end = src.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      out.push({ line, text: src.slice(i + 2, stop).trim() });
      i = stop; continue;
    }
    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end;
      const body = src.slice(i + 2, stop);
      let l = line;
      for (const raw of body.split('\n')) {
        const text = raw.replace(/^\s*\*+\s?/, '').trim();
        if (text) out.push({ line: l, text });
        l++;
      }
      line += body.split('\n').length - 1;
      i = stop + 2; continue;
    }
    i++;
  }
  return out;
}

// `#` comments (Python, shell, YAML) plus Python docstrings.
function extractHashComments(src, isPython) {
  const out = [];
  const lines = src.split('\n');
  let inDoc = null; // docstring delimiter while inside one
  lines.forEach((raw, idx) => {
    const line = idx + 1;
    const s = raw.trim();
    if (inDoc) {
      const close = s.indexOf(inDoc);
      const text = (close === -1 ? s : s.slice(0, close)).trim();
      if (text) out.push({ line, text });
      if (close !== -1) inDoc = null;
      return;
    }
    if (isPython) {
      const m = s.match(/^[rRuUbB]{0,2}("""|''')(.*)$/);
      if (m) {
        const rest = m[2];
        const close = rest.indexOf(m[1]);
        const text = (close === -1 ? rest : rest.slice(0, close)).trim();
        if (text) out.push({ line, text });
        if (close === -1) inDoc = m[1];
        return;
      }
    }
    // A `#` outside quotes; string tracking kept simple (no multi-line strings).
    let quote = null;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (quote) { if (ch === '\\') i++; else if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'") { quote = ch; continue; }
      if (ch === '#') {
        const text = raw.slice(i + 1).trim();
        if (text) out.push({ line, text });
        break;
      }
    }
  });
  return out;
}

function listFiles(paths) {
  let files;
  try {
    files = execSync('git ls-files -z', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().split('\0').filter(Boolean);
  } catch {
    files = walk(ROOT).map((f) => path.relative(ROOT, f));
  }
  files = files.filter((f) => EXTENSIONS.test(f) && !EXCLUDED_PREFIXES.some((p) => f.startsWith(p)));
  if (paths.length) {
    const wanted = paths.map((p) => path.relative(ROOT, path.resolve(ROOT, p)));
    files = files.filter((f) => wanted.some((w) => f === w || f.startsWith(w.replace(/\/?$/, '/'))));
  }
  return files;
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!['node_modules', 'dist', '.git'].includes(entry.name)) out.push(...walk(full));
    } else out.push(full);
  }
  return out;
}

function groupOf(file) {
  const parts = file.split('/');
  if (parts.length === 1) return '(root)';
  if (parts[0] === 'components' && parts.length > 2) return `components/${parts[1]}`;
  return parts[0];
}

function scan(paths = []) {
  const files = listFiles(paths);
  const byGroup = {}; // group -> { total, french }
  const french = []; // { file, line, text }
  let total = 0;
  for (const file of files) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const comments = HASH_COMMENT_EXT.test(file)
      ? extractHashComments(src, file.endsWith('.py'))
      : extractSlashComments(src);
    const g = (byGroup[groupOf(file)] ||= { total: 0, french: 0 });
    for (const c of comments) {
      if (DIRECTIVE.test(c.text)) continue;
      total++; g.total++;
      if (isFrench(c.text)) { g.french++; french.push({ file, ...c }); }
    }
  }
  return { files: files.length, total, french, byGroup };
}

function formatTable(result) {
  const rows = Object.entries(result.byGroup).sort((a, b) => b[1].french - a[1].french);
  const width = Math.max(12, ...rows.map(([g]) => g.length));
  const lines = [`${'group'.padEnd(width)}  comments  french`];
  for (const [g, v] of rows) lines.push(`${g.padEnd(width)}  ${String(v.total).padStart(8)}  ${String(v.french).padStart(6)}`);
  const filesWithFrench = new Set(result.french.map((c) => c.file)).size;
  lines.push(`${'TOTAL'.padEnd(width)}  ${String(result.total).padStart(8)}  ${String(result.french.length).padStart(6)}`);
  lines.push(`files scanned: ${result.files}, files with French comments: ${filesWithFrench}`);
  return lines.join('\n');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const paths = args.filter((a) => !a.startsWith('--'));
  const result = scan(paths);
  if (flags.has('--json')) {
    console.log(JSON.stringify({ files: result.files, total: result.total, french: result.french.length, byGroup: result.byGroup }, null, 2));
  } else {
    if (flags.has('--list')) for (const c of result.french) console.log(`${c.file}:${c.line}: ${c.text}`);
    console.log(formatTable(result));
  }
  if (flags.has('--strict') && result.french.length > 0) process.exit(1);
}

module.exports = { scan, isFrench, extractSlashComments, extractHashComments, formatTable };
