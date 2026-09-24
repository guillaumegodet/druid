// Markdown twin of every help page (« Voir en Markdown », /llms.txt links).
import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection, type CollectionEntry } from 'astro:content';
import { toMarkdown } from '../lib/markdown';

export const getStaticPaths = (async () => {
	const docs = await getCollection('docs');
	return docs.map((entry) => ({ params: { slug: entry.id || 'index' }, props: { entry } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) => {
	const { entry } = props as { entry: CollectionEntry<'docs'> };
	return new Response(toMarkdown(entry), {
		headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
	});
};
