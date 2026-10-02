#!/usr/bin/env node
// Guard before publishing this repository (docs/plan-instance-demo-cloudflare.md, lot B2): scans
// the files git tracks or would add (untracked, not ignored), minus scripts/publication/public-exclude.txt, for what must never reach
// the public repository — personal data of researchers and internal infrastructure details.
//
//  - e-mail addresses outside the allowed domains (example.*, npm/GitHub bot addresses) and the
//    service addresses listed in SERVICE_EMAILS;
//  - ORCID iDs with a VALID check character (fictitious ones are built with a wrong one), except
//    the official ORCID test record 0000-0002-1825-0097;
//  - internal hosts (*.univ-nantes.prive, *.intra.univ-nantes.fr, 172.16-31.x.x addresses);
//  - secret-looking strings (40-hex API keys, GitHub tokens);
//  - names that must not appear (regression list): read from the file given by PUBLIC_DENYLIST
//    (one name per line) — kept in the private druid-instances repository (publication/denylist.txt),
//    since listing them here would publish them;
//  - instances/<slug>/instance.json that do not follow the public rules of the instance registry
//    (read-only, public access and doc, no admins — scripts/instances/instanceConfig.cjs).
// Exit 1 with the list of findings (values masked), 0 when clean.
//
// Usage (git needed, hence node:20 and not node:20-slim):
//   docker run --rm -v "$PWD":/app -w /app node:20 sh -c \
//     'git config --global --add safe.directory /app && node scripts/publication/check_public_tree.mjs'
//   with the name list: add -v /opt/crisalid/work/druid-instances/publication:/deny:ro
//   -e PUBLIC_DENYLIST=/deny/denylist.txt
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const excludes = fs.readFileSync(path.join(ROOT, 'scripts/publication/public-exclude.txt'), 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
// Deleted-but-not-committed files are still listed by --cached: skip what is gone from disk.
const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0').filter(Boolean)
  .filter((f) => !excludes.some((e) => f === e || f.startsWith(e)))
  .filter((f) => fs.existsSync(path.join(ROOT, f)));

const ALLOWED_EMAIL = /@(example\.(org|com|fr|net)|users\.noreply\.github\.com|noreply\.anthropic\.com|izs\.me|x\.fr)$/i;
// Service (non-personal) addresses allowed as is.
const SERVICE_EMAILS = new Set(['bu-science-ouverte@univ-nantes.fr', 'noreply@anthropic.com']);
const ORCID_TEST = new Set(['0000-0002-1825-0097']);
const orcidValid = (digits) => {
  let total = 0;
  for (const c of digits.slice(0, 15)) total = (total + Number(c)) * 2;
  const r = (12 - (total % 11)) % 11;
  return (r === 10 ? 'X' : String(r)) === digits[15].toUpperCase();
};
const CHECKS = [
  { kind: 'e-mail', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, keep: (m) => !ALLOWED_EMAIL.test(m) && !SERVICE_EMAILS.has(m.toLowerCase()) },
  { kind: 'ORCID (valid check digit)', re: /\b\d{4}-\d{4}-\d{4}-\d{3}[\dX]\b/g, keep: (m) => !ORCID_TEST.has(m) && orcidValid(m.replace(/-/g, '')) },
  { kind: 'internal host', re: /[\w.-]+\.univ-nantes\.prive|[\w.-]+\.intra\.univ-nantes\.fr|\b172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/g, keep: () => true },
  // A 40-hex string right after /blob/, /tree/ or /commit/ is a git commit in a URL, not a key.
  { kind: 'secret-like', re: /\b[0-9a-f]{40}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}/g, keep: (m, before) => !/\/(blob|tree|commit)\/$/.test(before) },
];
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const denylist = process.env.PUBLIC_DENYLIST
  ? fs.readFileSync(process.env.PUBLIC_DENYLIST, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  : [];
// Names are matched whatever their case: an identifier written in lower case (a task channel named
// after a colleague, found on 2026-10-02) escaped the case-sensitive check.
if (denylist.length) {
  CHECKS.push({ kind: 'denylisted name', re: new RegExp(`(?<![\\w-])(${denylist.map(escapeRe).join('|')})(?![\\w-])`, 'gi'), keep: () => true });
}
const mask = (s) => (s.length <= 6 ? '***' : `${s.slice(0, 3)}…${s.slice(-3)}`);

const findings = [];
for (const f of files) {
  const buf = fs.readFileSync(path.join(ROOT, f));
  if (buf.includes(0)) continue;   // binary
  const lines = buf.toString('utf8').split('\n');
  lines.forEach((line, i) => {
    for (const { kind, re, keep } of CHECKS) {
      for (const m of line.matchAll(re)) if (keep(m[0], line.slice(Math.max(0, m.index - 10), m.index))) findings.push(`${f}:${i + 1}  ${kind}  ${mask(m[0])}`);
    }
  });
}
// Instance registry: an instance of the public repository must not expose a private doc or admins.
const { publicRepoErrors } = createRequire(import.meta.url)(path.join(ROOT, 'scripts/instances/instanceConfig.cjs'));
for (const f of files.filter((x) => /^instances\/[^/]+\/instance\.json$/.test(x))) {
  let errors;
  try {
    errors = publicRepoErrors(JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  } catch (err) {
    errors = [`invalid JSON (${err.message})`];
  }
  for (const e of errors) findings.push(`${f}  instance registry  ${e}`);
}

console.log(`${files.length} files checked (${excludes.length} excluded path(s), ${denylist.length} denylisted name(s)).`);
if (!denylist.length) console.log('Warning: no PUBLIC_DENYLIST — names are not checked.');
if (findings.length) {
  console.log(`${findings.length} finding(s):\n${findings.join('\n')}`);
  process.exit(1);
}
console.log('Clean: nothing personal or internal found.');
