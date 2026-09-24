#!/usr/bin/env node
/**
 * One-shot codemod (docs/plan-langue-source-en.md, lot A1): switch the Lingui source
 * locale from French to English by rewriting every macro call site with the English
 * translation already present in locales/en/messages.po.
 *
 * For each `t`/`tr`/`msg` tagged template, `<Trans>` element and `<Plural>` element, the
 * script recomputes the Lingui message id exactly like @lingui/babel-plugin-lingui-macro
 * does (JSX text cleaning, `{name}` for identifiers, `{0}` positional placeholders,
 * `<0>…</0>` for nested elements, ICU plural), looks up the English msgstr and rebuilds the
 * macro source from it, reusing the original expressions and JSX elements. Nothing else in
 * the file is touched (textual replacement on the macro span only).
 *
 * Usage: node scripts/i18n/switch_source_locale.mjs [--apply] [--mapping=out.json] [files…]
 *   Without --apply: dry run, prints the report (matched / unmatched sites).
 *   --mapping writes {englishMsgid: frenchMsgid} for filling locales/fr afterwards.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import PO from 'pofile';

const traverse = _traverse.default ?? _traverse;
const ROOT = process.cwd();
const APPLY = process.argv.includes('--apply');
const mappingArg = process.argv.find((a) => a.startsWith('--mapping='));
const onlyFiles = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const TAGS = new Set(['t', 'tr', 'msg']);

// Two French strings translated by the same English string: keep both French renderings by
// giving one of them a Lingui `context` (distinct message id, same English text)…
const CONTEXT = {
  'En cours…': 'in progress',
  'Conformes': 'plural', 'Non conformes': 'plural', 'Autres': 'plural',
  'Internationales': 'feminine plural',
  'Toutes': 'feminine', 'Indéterminée': 'feminine', '— Aucune —': 'feminine', 'Fermée': 'feminine',
  'En accès ouvert': 'adverbial',
  'Laboratoire': 'long form',
  'Topic': 'OpenAlex',
  'Périmètre': 'perimeter',
  'au': 'date range',
  'À revoir': 'needs rework',
  'Fusion': 'noun',
  'Civilité': 'honorific',
  'Appartenance': 'membership',
  'Suiv.': 'short',
};
// …or, for mere inconsistencies, by choosing the French rendering kept for the shared id.
const UNIFY = {
  'Nantes U payer': 'Payeur Nantes U',
  'All publications': 'Toutes les publications',
  'Open access': 'Accès ouvert',
  'Refresh': 'Actualiser',
  'Not found ({0})': 'Non trouvés ({0})',
};
const mapKey = (en, context) => (context ? `${context}\u0004${en}` : en);

// ---------------------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------------------
const po = PO.parse(fs.readFileSync(path.join(ROOT, 'locales/en/messages.po'), 'utf8'));
const enOf = new Map(); // fr msgid -> en msgstr
const byOrigin = new Map(); // "file:line" -> [fr msgid]
for (const it of po.items) {
  if (!it.msgid) continue;
  enOf.set(it.msgid, it.msgstr[0] || '');
  for (const ref of it.references) {
    if (!byOrigin.has(ref)) byOrigin.set(ref, []);
    byOrigin.get(ref).push(it.msgid);
  }
}
const enValues = new Set(enOf.values());
const allFiles = [...new Set([...byOrigin.keys()].map((r) => r.replace(/:\d+$/, '')))].sort();
const files = onlyFiles.length ? onlyFiles : allFiles;

// ---------------------------------------------------------------------------------------
// Tokenizer (mirror of the Lingui macro)
// ---------------------------------------------------------------------------------------
function cleanJSXText(value) {
  const lines = value.split(/\r\n|\n|\r/);
  let lastNonEmptyLine = 0;
  for (let i = 0; i < lines.length; i++) if (lines[i].match(/[^ \t]/)) lastNonEmptyLine = i;
  let str = '';
  for (let i = 0; i < lines.length; i++) {
    const isFirstLine = i === 0;
    const isLastLine = i === lines.length - 1;
    let line = lines[i].replace(/\t/g, ' ');
    if (!isFirstLine) line = line.replace(/^[ ]+/, '');
    if (!isLastLine) line = line.replace(/[ ]+$/, '');
    if (line) {
      if (i !== lastNonEmptyLine) line += ' ';
      str += line;
    }
  }
  return str;
}

function unwrap(exp) {
  while (exp && (exp.type === 'TSAsExpression' || exp.type === 'TSNonNullExpression' || exp.type === 'ParenthesizedExpression')) exp = exp.expression;
  return exp;
}

class Ctx {
  constructor(src) {
    this.src = src;
    this.argIdx = 0;
    this.elemIdx = 0;
    this.absorbed = new Set(); // nested Trans/Plural nodes inlined in this message
  }
  argName(exp) {
    exp = unwrap(exp);
    if (exp.type === 'Identifier') return exp.name;
    return String(this.argIdx++);
  }
}

/** Template literal (tagged or inline in JSX): tokens with arg sources = `${…}`. */
function tplTokens(tpl, ctx) {
  const out = [];
  tpl.quasis.forEach((q, i) => {
    if (q.value.cooked) out.push({ type: 'text', value: q.value.cooked });
    const exp = tpl.expressions[i];
    if (exp) {
      const src = ctx.src.slice(q.end, tpl.quasis[i + 1].start); // `${expr}`
      out.push({ type: 'arg', name: ctx.argName(exp), src });
    }
  });
  return out;
}

function jsxName(el) {
  const n = el.openingElement.name;
  return n.type === 'JSXIdentifier' ? n.name : null;
}

function jsxChildrenTokens(children, ctx) {
  const out = [];
  for (const child of children) {
    if (child.type === 'JSXText') {
      const v = cleanJSXText(child.value);
      if (v) out.push({ type: 'text', value: v });
    } else if (child.type === 'JSXExpressionContainer') {
      const exp = child.expression;
      const src = ctx.src.slice(child.start, child.end);
      if (exp.type === 'JSXEmptyExpression') continue;
      if (exp.type === 'StringLiteral') out.push({ type: 'text', value: exp.value });
      else if (exp.type === 'TemplateLiteral') {
        // Inline template: text + args; args re-emitted as their own containers.
        for (const t of tplTokens(exp, ctx)) {
          if (t.type === 'arg') out.push({ type: 'arg', name: t.name, src: '{' + t.src.slice(2, -1) + '}' });
          else out.push(t);
        }
      } else if (exp.type === 'JSXElement') out.push(...jsxNodeTokens(exp, ctx));
      else out.push({ type: 'arg', name: ctx.argName(exp), src });
    } else if (child.type === 'JSXElement') {
      out.push(...jsxNodeTokens(child, ctx));
    }
  }
  return out;
}

function jsxNodeTokens(el, ctx) {
  const name = jsxName(el);
  if (name === 'Trans') {
    ctx.absorbed.add(el);
    return jsxChildrenTokens(el.children, ctx);
  }
  if (name === 'Plural') {
    ctx.absorbed.add(el);
    return [pluralToken(el, ctx)];
  }
  const idx = ctx.elemIdx++;
  return [{ type: 'element', name: String(idx), node: el, children: jsxChildrenTokens(el.children, ctx) }];
}

const pluralRuleRe = /^(_[\d\w]+|zero|one|two|few|many|other)$/;
function pluralToken(el, ctx) {
  const tok = { type: 'choice', format: 'plural', name: null, node: el, options: [] };
  for (const attr of el.openingElement.attributes) {
    if (attr.type !== 'JSXAttribute') continue;
    const key = attr.name.name;
    const value = attr.value;
    if (key === 'value') {
      tok.name = ctx.argName(value.type === 'JSXExpressionContainer' ? value.expression : value);
    } else if (key === 'offset') {
      tok.options.push({ key: 'offset', text: String(value.type === 'JSXExpressionContainer' ? value.expression.value : value.value), attr });
    } else {
      let tokens;
      if (value.type === 'StringLiteral') tokens = [{ type: 'text', value: value.extra.raw.replace(/(["'])(.*)\1/, '$2') }];
      else tokens = jsxChildrenTokens([value], ctx);
      const icuKey = pluralRuleRe.test(key) ? key.replace(/_(\d+)/, '=$1').replace(/_(\w+)/, '$1') : key;
      tok.options.push({ key: icuKey, tokens, attr });
    }
  }
  return tok;
}

function printTokens(tokens) {
  let s = '';
  for (const t of tokens) {
    if (t.type === 'text') s += t.value;
    else if (t.type === 'arg') s += `{${t.name}}`;
    else if (t.type === 'element') s += t.children.length ? `<${t.name}>${printTokens(t.children)}</${t.name}>` : `<${t.name}/>`;
    else if (t.type === 'choice') {
      const opts = t.options.map((o) => (o.key === 'offset' ? `offset:${o.text}` : `${o.key} {${printTokens(o.tokens)}}`)).join(' ');
      s += `{${t.name}, ${t.format}, ${opts}}`;
    }
  }
  return s;
}

// ---------------------------------------------------------------------------------------
// Message string parser (English msgstr -> token tree)
// ---------------------------------------------------------------------------------------
function parseMessage(str) {
  const tokens = [];
  let i = 0;
  let text = '';
  const flush = () => { if (text) { tokens.push({ type: 'text', value: text }); text = ''; } };
  while (i < str.length) {
    const c = str[i];
    let m;
    if (c === '<' && (m = /^<(\d+)\/>/.exec(str.slice(i)))) {
      flush(); tokens.push({ type: 'element', name: m[1], children: [], selfClosing: true }); i += m[0].length; continue;
    }
    if (c === '<' && (m = /^<(\d+)>/.exec(str.slice(i)))) {
      const close = `</${m[1]}>`;
      // find matching close (elements do not repeat their index inside themselves)
      const end = str.indexOf(close, i + m[0].length);
      if (end < 0) throw new Error(`unbalanced element <${m[1]}> in: ${str}`);
      flush();
      tokens.push({ type: 'element', name: m[1], children: parseMessage(str.slice(i + m[0].length, end)) });
      i = end + close.length; continue;
    }
    if (c === '{') {
      let depth = 0, j = i;
      for (; j < str.length; j++) { if (str[j] === '{') depth++; else if (str[j] === '}') { depth--; if (depth === 0) break; } }
      if (depth !== 0) throw new Error(`unbalanced braces in: ${str}`);
      const inner = str.slice(i + 1, j);
      flush();
      const cm = /^([^,]+),\s*plural,\s*([\s\S]*)$/.exec(inner);
      if (cm) tokens.push({ type: 'choice', format: 'plural', name: cm[1].trim(), options: parseIcuOptions(cm[2]) });
      else tokens.push({ type: 'arg', name: inner.trim() });
      i = j + 1; continue;
    }
    text += c; i++;
  }
  flush();
  return tokens;
}

function parseIcuOptions(s) {
  const opts = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    const km = /^(offset:\d+|=\d+|\w+)/.exec(s.slice(i));
    if (!km) throw new Error(`bad ICU options: ${s}`);
    const key = km[1]; i += key.length;
    if (key.startsWith('offset:')) { opts.push({ key: 'offset', text: key.slice(7) }); continue; }
    while (i < s.length && /\s/.test(s[i])) i++;
    if (s[i] !== '{') throw new Error(`bad ICU option body: ${s}`);
    let depth = 0, j = i;
    for (; j < s.length; j++) { if (s[j] === '{') depth++; else if (s[j] === '}') { depth--; if (depth === 0) break; } }
    opts.push({ key, tokens: parseMessage(s.slice(i + 1, j)) });
    i = j + 1;
  }
  return opts;
}

// ---------------------------------------------------------------------------------------
// Rebuild source from the English token tree + original nodes
// ---------------------------------------------------------------------------------------
function collect(tokens, acc = { args: new Map(), elements: new Map(), choices: new Map() }) {
  for (const t of tokens) {
    if (t.type === 'arg') { if (!acc.args.has(t.name)) acc.args.set(t.name, t.src); }
    else if (t.type === 'element') { acc.elements.set(t.name, t); collect(t.children, acc); }
    else if (t.type === 'choice') { acc.choices.set(t.name, t); for (const o of t.options) if (o.tokens) collect(o.tokens, acc); }
  }
  return acc;
}

const tplEscape = (s) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${').replace(/\n/g, '\\n');

function buildTemplate(enTokens, orig) {
  let s = '`';
  for (const t of enTokens) {
    if (t.type === 'text') s += tplEscape(t.value);
    else if (t.type === 'arg') {
      const src = orig.args.get(t.name);
      if (src === undefined) throw new Error(`unknown placeholder {${t.name}}`);
      s += src;
    } else throw new Error(`unsupported token ${t.type} in template`);
  }
  return s + '`';
}

function jsxText(text) {
  if (/[{}<>]|&[#\w]+;|\n/.test(text)) return `{${JSON.stringify(text)}}`;
  return text;
}

function buildJsxChildren(enTokens, orig, src) {
  let s = '';
  for (const t of enTokens) {
    if (t.type === 'text') s += jsxText(t.value);
    else if (t.type === 'arg') {
      const a = orig.args.get(t.name);
      if (a === undefined) throw new Error(`unknown placeholder {${t.name}}`);
      s += a;
    } else if (t.type === 'element') {
      const o = orig.elements.get(t.name);
      if (!o) throw new Error(`unknown element <${t.name}>`);
      const el = o.node;
      if (t.selfClosing || !el.closingElement) s += src.slice(el.start, el.end);
      else s += src.slice(el.openingElement.start, el.openingElement.end) + buildJsxChildren(t.children, orig, src) + src.slice(el.closingElement.start, el.closingElement.end);
    } else if (t.type === 'choice') {
      const o = orig.choices.get(t.name);
      if (!o) throw new Error(`unknown plural {${t.name}}`);
      s += buildPlural(o, t, orig, src);
    }
  }
  return s;
}

function attrString(text) {
  return text.includes('"') ? `{${JSON.stringify(text)}}` : `"${text}"`;
}

/** Rebuild a <Plural …/> element: same attributes, option values replaced. */
function buildPlural(origTok, enTok, orig, src) {
  const el = origTok.node;
  const enOpts = new Map(enTok.options.map((o) => [o.key, o]));
  const edits = [];
  for (const o of origTok.options) {
    if (o.key === 'offset') continue;
    const e = enOpts.get(o.key);
    if (!e) throw new Error(`plural option ${o.key} missing in English`);
    const val = o.attr.value;
    let text;
    if (e.tokens.every((t) => t.type === 'text')) text = attrString(e.tokens.map((t) => t.value).join(''));
    else text = `{${buildTemplate(e.tokens, orig)}}`;
    edits.push({ start: val.start, end: val.end, text });
  }
  return applyEdits(src.slice(el.start, el.end), edits.map((e) => ({ ...e, start: e.start - el.start, end: e.end - el.start })));
}

function applyEdits(text, edits) {
  edits.sort((a, b) => b.start - a.start);
  for (const e of edits) text = text.slice(0, e.start) + e.text + text.slice(e.end);
  return text;
}

// ---------------------------------------------------------------------------------------
// Per-file processing
// ---------------------------------------------------------------------------------------
const report = { files: 0, sites: 0, matched: 0, unmatched: [], collisions: [] };
const mapping = new Map(); // en msgid -> fr msgid

function lookup(msgid) {
  if (enOf.has(msgid)) return msgid;
  const norm = msgid.replace(/\s+/g, ' ').trim();
  if (enOf.has(norm)) return norm;
  return null;
}

function processFile(rel) {
  const abs = path.join(ROOT, rel);
  let src = fs.readFileSync(abs, 'utf8');
  let pass = 0;
  let total = 0;
  while (pass++ < 6) {
    const ast = parse(src, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
    const sites = [];
    traverse(ast, {
      TaggedTemplateExpression(p) {
        const tag = p.node.tag;
        if (tag.type === 'Identifier' && TAGS.has(tag.name)) sites.push({ kind: 'tpl', node: p.node, start: p.node.quasi.start, end: p.node.quasi.end });
      },
      JSXElement(p) {
        const name = jsxName(p.node);
        if (name === 'Trans') sites.push({ kind: 'trans', node: p.node, start: p.node.openingElement.end, end: p.node.closingElement ? p.node.closingElement.start : p.node.end });
        else if (name === 'Plural') sites.push({ kind: 'plural', node: p.node, start: p.node.start, end: p.node.end });
      },
    });
    if (!sites.length) break;
    // Compute message ids; note nodes absorbed by an enclosing <Trans>.
    const absorbed = new Set();
    for (const s of sites) {
      const ctx = new Ctx(src);
      if (s.kind === 'tpl') s.tokens = tplTokens(s.node.quasi, ctx);
      else if (s.kind === 'trans') s.tokens = jsxChildrenTokens(s.node.children, ctx);
      else s.tokens = [pluralToken(s.node, ctx)];
      for (const a of ctx.absorbed) absorbed.add(a);
      s.msgid = printTokens(s.tokens);
    }
    const live = sites.filter((s) => !absorbed.has(s.node));
    // Defer sites that contain another live site (nested macros): innermost first.
    const ready = live.filter((s) => !live.some((o) => o !== s && o.start >= s.start && o.end <= s.end));
    const edits = [];
    for (const s of ready) {
      total++;
      const key = lookup(s.msgid);
      const line = s.node.loc.start.line;
      if (key === null && pass > 1 && enValues.has(s.msgid)) { total--; continue; } // rewritten in a previous pass
      if (key === null) {
        report.unmatched.push({ file: rel, line, kind: s.kind, computed: s.msgid, atLine: byOrigin.get(`${rel}:${line}`) || [] });
        continue;
      }
      const en = enOf.get(key);
      if (!en) { report.unmatched.push({ file: rel, line, kind: s.kind, computed: s.msgid, reason: 'empty msgstr' }); continue; }
      const context = CONTEXT[key];
      const mk = mapKey(en, context);
      if (mapping.has(mk) && mapping.get(mk) !== key && UNIFY[en] === undefined) report.collisions.push({ en, fr: [mapping.get(mk), key] });
      mapping.set(mk, UNIFY[en] ?? key);
      report.matched++;
      if (en === key && !context) continue; // identical in both languages: nothing to rewrite
      try {
        const enTokens = parseMessage(en);
        const orig = collect(s.tokens);
        let text;
        if (s.kind === 'tpl') {
          text = buildTemplate(enTokens, orig);
          if (context) {
            // t`…` → t({ message: `…`, context: '…' }) — whole tagged template replaced
            edits.push({ start: s.node.start, end: s.node.end, text: `${s.node.tag.name}({ message: ${text}, context: ${JSON.stringify(context)} })` });
            continue;
          }
        } else if (s.kind === 'plural') text = buildPlural(s.tokens[0], enTokens[0], orig, src);
        else {
          const inner = buildJsxChildren(enTokens, orig, src);
          const origInner = src.slice(s.start, s.end);
          if (/^\r?\n/.test(origInner)) {
            const indentInner = (/\n([ \t]*)\S/.exec(origInner) || [, ''])[1];
            const indentClose = (/\n([ \t]*)$/.exec(origInner) || [, ''])[1];
            const protectedInner = inner.replace(/^ /, "{' '}").replace(/ $/, "{' '}");
            text = `\n${indentInner}${protectedInner}\n${indentClose}`;
          } else text = inner;
        }
        if (context && s.kind === 'trans') {
          const o = s.node.openingElement;
          edits.push({ start: o.start + 6, end: o.start + 6, text: ` context=${JSON.stringify(context)}` });
        }
        if (context && s.kind === 'plural') throw new Error('context on <Plural> not supported');
        edits.push({ start: s.start, end: s.end, text });
      } catch (err) {
        report.unmatched.push({ file: rel, line, kind: s.kind, computed: s.msgid, reason: err.message });
      }
    }
    if (!edits.length) break;
    src = applyEdits(src, edits);
    if (ready.length === live.length) break; // everything handled in this pass
  }
  report.files++;
  report.sites += total;
  if (APPLY) fs.writeFileSync(abs, src);
  return src;
}

for (const f of files) processFile(f);

console.log(`files: ${report.files}, sites: ${report.sites}, matched: ${report.matched}, unmatched: ${report.unmatched.length}, collisions: ${report.collisions.length}`);
for (const u of report.unmatched) {
  console.log(`\n✗ ${u.file}:${u.line} [${u.kind}]${u.reason ? ' ' + u.reason : ''}\n  computed: ${u.computed.slice(0, 160)}`);
  for (const c of u.atLine || []) console.log(`  catalog : ${c.slice(0, 160)}`);
}
for (const c of report.collisions) console.log(`\n≈ collision "${c.en.slice(0, 80)}" ← ${c.fr.map((x) => JSON.stringify(x.slice(0, 60))).join(' | ')}`);
if (mappingArg) fs.writeFileSync(mappingArg.slice(10), JSON.stringify(Object.fromEntries(mapping), null, 1));
if (!APPLY) console.log('\n(dry run — pass --apply to rewrite the files)');
