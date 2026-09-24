#!/usr/bin/env node
// Draft of a monthly « Nouveautés » section from the git history (plan-documentation-utilisateur.md,
// lot 7). Lists the user-visible commits (feat/fix) of a month, grouped by help section, with their
// hash: a starting point to rewrite in plain French in src/content/docs/nouveautes.md — never paste
// it as is (commit subjects are technical and mostly English).
//
// Usage (from the repository root or help/): node help/scripts/nouveautes-draft.mjs [YYYY-MM]
// Default month: the previous calendar month.
import { execFileSync } from 'node:child_process';

const arg = process.argv[2];
const now = new Date();
const month =
	arg && /^\d{4}-\d{2}$/.test(arg)
		? arg
		: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
const [y, m] = month.split('-').map(Number);
const since = `${month}-01`;
const until = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);

/** Commit scope → help section (same headings as nouveautes.md). Unknown scopes go to « Autres ». */
const SECTIONS = [
	['Aide', /^(help|aide)$/],
	['Personnes', /^(tasks|taches|fiche|personnel|doublons|researchers?|validation|dates|ldap-sync)$/],
	['Identifiants', /^(align|alignement|idref|orcid|hal|openalex|scopus|ldap|abes)$/],
	['Structures', /^(structures?|groups?|groupes)$/],
	['Tableau de bord', /^(dashboard|collab|équipes|equipes|etl|veille|media|report|embed)$/],
	['Interface', /^(ui|i18n|auth|droits|rights|admin|instances)$/],
];
/** Scopes that never reach users (build, deployment, security plumbing…). */
const HIDDEN = /^(build|deploy|cloudflare|ci|tests?|sécurité|security|server|scripts?)$/;

const log = execFileSync('git', ['log', `--since=${since}`, `--until=${until}`, '--no-merges', '--pretty=%h%x09%s'], {
	encoding: 'utf8',
});
const groups = new Map();
let skipped = 0;
for (const line of log.split('\n').filter(Boolean)) {
	const [hash, subject] = line.split('\t');
	const match = /^(feat|fix)(?:\(([^)]+)\))?!?:\s*(.+)$/.exec(subject);
	if (!match) continue;
	const [, type, scope = '', text] = match;
	if (HIDDEN.test(scope)) {
		skipped++;
		continue;
	}
	const section = SECTIONS.find(([, re]) => re.test(scope))?.[0] ?? 'Autres';
	if (!groups.has(section)) groups.set(section, []);
	groups.get(section).push(`- ${type === 'fix' ? '(correction) ' : ''}${text} — \`${hash}\``);
}

const monthLabel = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const out = [`## ${monthLabel.charAt(0).toUpperCase()}${monthLabel.slice(1)}`, ''];
for (const section of [...SECTIONS.map(([name]) => name), 'Autres']) {
	const items = groups.get(section);
	if (!items) continue;
	out.push(`### ${section}`, '', ...items, '');
}
if (groups.size === 0) out.push('_Aucun commit feat/fix visible ce mois-ci._', '');
out.push(`<!-- Brouillon généré par help/scripts/nouveautes-draft.mjs : ${skipped} commit(s) technique(s) écarté(s).`);
out.push('     À réécrire en français, du point de vue de l\'utilisateur, avec un lien vers le guide concerné. -->');
console.log(out.join('\n'));
