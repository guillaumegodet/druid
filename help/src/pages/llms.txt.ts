// /llms.txt (https://llmstxt.org): index of the help for AI assistants, as on help.openalex.org.
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { groupBySection, markdownHref } from '../lib/markdown';

export const GET: APIRoute = async ({ site }) => {
	const docs = await getCollection('docs');
	const base = site ? site.toString().replace(/\/$/, '') : '';
	const lines = [
		'# Aide Druid',
		'',
		"> Druid est une application de gestion de la recherche : annuaire des personnels et des structures de recherche, alignement des identifiants chercheurs (IdRef, ORCID, HAL, OpenAlex, Scopus), tableau de bord bibliométrique. Chaque page existe en Markdown (lien ci-dessous) ; /llms-full.txt contient toute l'aide en un seul fichier.",
		'',
	];
	for (const section of groupBySection(docs)) {
		lines.push(`## ${section.label}`, '');
		for (const e of section.entries) {
			const desc = e.data.description ? `: ${e.data.description}` : '';
			lines.push(`- [${e.data.title}](${base}${markdownHref(e.id)})${desc}`);
		}
		lines.push('');
	}
	return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
