// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// Public URL of the help centre (decision D1, docs/documentation-utilisateur-inventaire.md).
// Used for the sitemap and the absolute links of /llms.txt. Served by the Cloudflare Worker
// « druid-aide » (wrangler.jsonc); override with HELP_SITE_URL once a custom domain is set.
const site = process.env.HELP_SITE_URL || 'https://druid-aide.guillaumegodet.workers.dev';

export default defineConfig({
	site,
	integrations: [
		starlight({
			title: { fr: 'Aide Druid', en: 'Druid Help' },
			description:
				"Centre d'aide de Druid : annuaire des personnels et des structures de recherche, alignement des identifiants, tableau de bord bibliométrique.",
			logo: { src: './src/assets/druid-logo.png', alt: 'Druid' },
			favicon: '/favicon.png',
			// French at the root, English under /en/ (docs/plan-aide-anglais.md): translated pages live
			// under src/content/docs/en/ with the same file paths; untranslated ones fall back to French.
			defaultLocale: 'root',
			locales: {
				root: { label: 'Français', lang: 'fr' },
				en: { label: 'English', lang: 'en' },
			},
			lastUpdated: true,
			customCss: ['./src/styles/druid.css'],
			components: {
				// Adds the « Voir en Markdown » link under each page title.
				PageTitle: './src/components/PageTitle.astro',
			},
			sidebar: [
				{
					label: 'Démarrer', translations: { en: 'Get started' },
					items: [{ autogenerate: { directory: 'demarrer' } }],
				},
				{
					label: 'Guides pratiques', translations: { en: 'How-to guides' },
					items: [
						{ label: 'Personnes', translations: { en: 'People' }, items: [{ autogenerate: { directory: 'guides/personnes' } }] },
						{ label: 'Identifiants', translations: { en: 'Identifiers' }, items: [{ autogenerate: { directory: 'guides/identifiants' } }] },
						{ label: 'Structures et groupes', translations: { en: 'Structures and groups' }, items: [{ autogenerate: { directory: 'guides/structures-groupes' } }] },
						{ label: 'Tableau de bord', translations: { en: 'Dashboard' }, items: [{ autogenerate: { directory: 'guides/tableau-de-bord' } }] },
						{ label: 'Veille et communication', translations: { en: 'Monitoring and communication' }, items: [{ autogenerate: { directory: 'guides/veille' } }] },
						{ label: 'Administration', translations: { en: 'Administration' }, items: [{ autogenerate: { directory: 'guides/administration' } }] },
						{ label: 'Corriger une donnée', translations: { en: 'Fix a data error' }, items: [{ autogenerate: { directory: 'guides/corriger' } }] },
						{ label: 'Support', translations: { en: 'Support' }, slug: 'guides/support' },
					],
				},
				{
					label: 'Tutoriels', translations: { en: 'Tutorials' },
					items: [{ autogenerate: { directory: 'tutoriels' } }],
				},
				{
					label: 'Comprendre les données', translations: { en: 'Understanding the data' },
					items: [{ autogenerate: { directory: 'donnees' } }],
				},
				{ label: 'Nouveautés', translations: { en: "What's new" }, slug: 'nouveautes' },
			],
		}),
	],
});
