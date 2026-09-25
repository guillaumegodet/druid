import type { CollectionEntry } from 'astro:content';
import { STRINGS, baseId, langOfId, type HelpLang } from './i18n';

/** Markdown twin of a page: /guides/x/ → /guides/x.md, home page → /index.md. */
export const markdownHref = (id: string): string => `/${id || 'index'}.md`;

/** `<QuiOu profils="…" menu="…" disponibilite="…" />` (components/QuiOu.astro) as a Markdown quote. */
const quiOuToMarkdown = (body: string, lang: HelpLang): string =>
	body.replace(/<QuiOu\b([\s\S]*?)\/>/g, (_, attrs: string) => {
		const s = STRINGS[lang];
		const colon = lang === 'fr' ? ' :' : ':';
		const attr = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(attrs)?.[1];
		const lines = [
			[s.profiles, attr('profils')],
			[s.inDruid, attr('menu')],
			[s.availableOn, attr('disponibilite')],
		]
			.filter(([, value]) => value)
			.map(([label, value]) => `> - **${label}${colon}** ${value}`);
		return [`> **${s.quiOuTitle}**`, '>', ...lines].join('\n');
	});

/** Raw Markdown of a page for /…md and /llms-full.txt: title, summary, body without MDX imports. */
export const toMarkdown = (entry: CollectionEntry<'docs'>): string => {
	const body = quiOuToMarkdown(
		(entry.body ?? '')
			.split('\n')
			.filter((line) => !/^import\s.+\sfrom\s['"].+['"];?\s*$/.test(line))
			.join('\n'),
		langOfId(entry.id),
	).trim();
	const summary = entry.data.description ? `\n\n> ${entry.data.description}` : '';
	return `# ${entry.data.title}${summary}\n\n${body}\n`;
};

/** Help sections in reading order (same order as the sidebar in astro.config.mjs). */
export const SECTIONS = [
	{ prefix: 'demarrer/', key: 'demarrer' },
	{ prefix: 'guides/', key: 'guides' },
	{ prefix: 'tutoriels/', key: 'tutoriels' },
	{ prefix: 'donnees/', key: 'donnees' },
	{ prefix: 'nouveautes', key: 'nouveautes' },
] as const;

/** Page prefixes in sidebar order — keep in sync with `sidebar` in astro.config.mjs. */
const SIDEBAR_ORDER = [
	'demarrer/',
	'guides/personnes/',
	'guides/identifiants/',
	'guides/structures-groupes/',
	'guides/tableau-de-bord/',
	'guides/veille/',
	'guides/administration/',
	'guides/corriger/',
	'guides/support',
	'tutoriels/',
	'donnees/',
	'nouveautes',
];
const rank = (id: string): number => {
	const i = SIDEBAR_ORDER.findIndex((prefix) => id.startsWith(prefix));
	return i === -1 ? SIDEBAR_ORDER.length : i;
};

/** Pages of the help in one language grouped by section, sorted like the sidebar (group, sidebar.order, title). */
export const groupBySection = (entries: CollectionEntry<'docs'>[], lang: HelpLang = 'fr') =>
	SECTIONS.map(({ prefix, key }) => ({
		label: STRINGS[lang].sections[key],
		entries: entries
			.filter((e) => langOfId(e.id) === lang && baseId(e.id).startsWith(prefix))
			.sort(
				(a, b) =>
					rank(baseId(a.id)) - rank(baseId(b.id)) ||
					(a.data.sidebar.order ?? 999) - (b.data.sidebar.order ?? 999) ||
					a.data.title.localeCompare(b.data.title, lang),
			),
	})).filter((s) => s.entries.length > 0);

/** /llms.txt body (https://llmstxt.org): index of the help in one language, for AI assistants. */
export const llmsIndex = (docs: CollectionEntry<'docs'>[], lang: HelpLang, site: URL | undefined): string => {
	const base = site ? site.toString().replace(/\/$/, '') : '';
	const lines = [`# ${STRINGS[lang].llmsTitle}`, '', `> ${STRINGS[lang].llmsSummary}`, ''];
	for (const section of groupBySection(docs, lang)) {
		lines.push(`## ${section.label}`, '');
		for (const e of section.entries) {
			const desc = e.data.description ? `: ${e.data.description}` : '';
			lines.push(`- [${e.data.title}](${base}${markdownHref(e.id)})${desc}`);
		}
		lines.push('');
	}
	return lines.join('\n');
};

/** /llms-full.txt body: the whole help in one language, in sidebar order. */
export const llmsFull = (docs: CollectionEntry<'docs'>[], lang: HelpLang): string =>
	groupBySection(docs, lang)
		.flatMap((s) => s.entries.map(toMarkdown))
		.join('\n---\n\n');
