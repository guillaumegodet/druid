// Strings of the help centre's own components, per content language (docs/plan-aide-anglais.md).
// Starlight's built-in UI (search, table of contents…) is translated by Starlight itself.

export type HelpLang = 'fr' | 'en';

/** Content language of a page from its collection id: English pages live under en/. */
export const langOfId = (id: string): HelpLang => (id === 'en' || id.startsWith('en/') ? 'en' : 'fr');

/** Page id without its locale prefix (en/guides/x → guides/x). */
export const baseId = (id: string): string => (langOfId(id) === 'en' ? id.replace(/^en\/?/, '') : id);

export const asHelpLang = (lang: string | undefined): HelpLang => (lang?.startsWith('en') ? 'en' : 'fr');

export const STRINGS = {
	fr: {
		quiOuTitle: 'Qui peut le faire, et où',
		profiles: 'Profils',
		inDruid: 'Dans Druid',
		availableOn: 'Disponible sur',
		viewMarkdown: 'Voir en Markdown',
		llmsTitle: 'Aide Druid',
		llmsSummary:
			"Druid est une application de gestion de la recherche : annuaire des personnels et des structures de recherche, alignement des identifiants chercheurs (IdRef, ORCID, HAL, OpenAlex, Scopus), tableau de bord bibliométrique. Chaque page existe en Markdown (lien ci-dessous) ; /llms-full.txt contient toute l'aide en un seul fichier.",
		sections: {
			demarrer: 'Démarrer',
			guides: 'Guides pratiques',
			tutoriels: 'Tutoriels',
			donnees: 'Comprendre les données',
			nouveautes: 'Nouveautés',
		},
	},
	en: {
		quiOuTitle: 'Who can do it, and where',
		profiles: 'Profiles',
		inDruid: 'In Druid',
		availableOn: 'Available on',
		viewMarkdown: 'View as Markdown',
		llmsTitle: 'Druid Help',
		llmsSummary:
			'Druid is a research management application: directory of research staff and research structures, alignment of researcher identifiers (IdRef, ORCID, HAL, OpenAlex, Scopus), bibliometric dashboard. Every page is also available in Markdown (links below); /en/llms-full.txt contains the whole help in a single file.',
		sections: {
			demarrer: 'Get started',
			guides: 'How-to guides',
			tutoriels: 'Tutorials',
			donnees: 'Understanding the data',
			nouveautes: "What's new",
		},
	},
} as const;
