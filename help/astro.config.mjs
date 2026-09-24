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
			title: 'Aide Druid',
			description:
				"Centre d'aide de Druid : annuaire des personnels et des structures de recherche, alignement des identifiants, tableau de bord bibliométrique.",
			logo: { src: './src/assets/druid-logo.png', alt: 'Druid' },
			favicon: '/favicon.png',
			// French first (decision D2). To add English: add `en: { label: 'English', lang: 'en' }`
			// and translated pages under src/content/docs/en/ — untranslated pages fall back to French.
			defaultLocale: 'root',
			locales: {
				root: { label: 'Français', lang: 'fr' },
			},
			lastUpdated: true,
			customCss: ['./src/styles/druid.css'],
			components: {
				// Adds the « Voir en Markdown » link under each page title.
				PageTitle: './src/components/PageTitle.astro',
			},
			sidebar: [
				{
					label: 'Démarrer',
					items: [{ autogenerate: { directory: 'demarrer' } }],
				},
				{
					label: 'Guides pratiques',
					items: [
						{ label: 'Personnes', items: [{ autogenerate: { directory: 'guides/personnes' } }] },
						{ label: 'Identifiants', items: [{ autogenerate: { directory: 'guides/identifiants' } }] },
						{ label: 'Structures et groupes', items: [{ autogenerate: { directory: 'guides/structures-groupes' } }] },
						{ label: 'Tableau de bord', items: [{ autogenerate: { directory: 'guides/tableau-de-bord' } }] },
						{ label: 'Veille et communication', items: [{ autogenerate: { directory: 'guides/veille' } }] },
						{ label: 'Administration', items: [{ autogenerate: { directory: 'guides/administration' } }] },
						{ label: 'Corriger une donnée', items: [{ autogenerate: { directory: 'guides/corriger' } }] },
						{ label: 'Support', slug: 'guides/support' },
					],
				},
				{
					label: 'Tutoriels',
					items: [{ autogenerate: { directory: 'tutoriels' } }],
				},
				{
					label: 'Comprendre les données',
					items: [{ autogenerate: { directory: 'donnees' } }],
				},
				{ label: 'Nouveautés', slug: 'nouveautes' },
			],
		}),
	],
});
