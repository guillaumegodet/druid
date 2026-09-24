import type { CollectionEntry } from 'astro:content';

/** Markdown twin of a page: /guides/x/ → /guides/x.md, home page → /index.md. */
export const markdownHref = (id: string): string => `/${id || 'index'}.md`;

/** `<QuiOu profils="…" menu="…" disponibilite="…" />` (components/QuiOu.astro) as a Markdown quote. */
const quiOuToMarkdown = (body: string): string =>
	body.replace(/<QuiOu\b([\s\S]*?)\/>/g, (_, attrs: string) => {
		const attr = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(attrs)?.[1];
		const lines = [
			['Profils', attr('profils')],
			['Dans Druid', attr('menu')],
			['Disponible sur', attr('disponibilite')],
		]
			.filter(([, value]) => value)
			.map(([label, value]) => `> - **${label} :** ${value}`);
		return ['> **Qui peut le faire, et où**', '>', ...lines].join('\n');
	});

/** Raw Markdown of a page for /…md and /llms-full.txt: title, summary, body without MDX imports. */
export const toMarkdown = (entry: CollectionEntry<'docs'>): string => {
	const body = quiOuToMarkdown(
		(entry.body ?? '')
			.split('\n')
			.filter((line) => !/^import\s.+\sfrom\s['"].+['"];?\s*$/.test(line))
			.join('\n'),
	).trim();
	const summary = entry.data.description ? `\n\n> ${entry.data.description}` : '';
	return `# ${entry.data.title}${summary}\n\n${body}\n`;
};

/** Help sections in reading order (same order as the sidebar in astro.config.mjs). */
export const SECTIONS: { prefix: string; label: string }[] = [
	{ prefix: 'demarrer/', label: 'Démarrer' },
	{ prefix: 'guides/', label: 'Guides pratiques' },
	{ prefix: 'tutoriels/', label: 'Tutoriels' },
	{ prefix: 'donnees/', label: 'Comprendre les données' },
	{ prefix: 'nouveautes', label: 'Nouveautés' },
];

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

/** Pages of the help grouped by section, sorted like the sidebar (group, sidebar.order, title). */
export const groupBySection = (entries: CollectionEntry<'docs'>[]) =>
	SECTIONS.map(({ prefix, label }) => ({
		label,
		entries: entries
			.filter((e) => e.id.startsWith(prefix))
			.sort(
				(a, b) =>
					rank(a.id) - rank(b.id) ||
					(a.data.sidebar.order ?? 999) - (b.data.sidebar.order ?? 999) ||
					a.data.title.localeCompare(b.data.title, 'fr'),
			),
	})).filter((s) => s.entries.length > 0);
