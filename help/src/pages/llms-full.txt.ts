// /llms-full.txt: the whole help in one Markdown file, in sidebar order.
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { groupBySection, toMarkdown } from '../lib/markdown';

export const GET: APIRoute = async () => {
	const docs = await getCollection('docs');
	const parts = groupBySection(docs).flatMap((s) => s.entries.map(toMarkdown));
	return new Response(parts.join('\n---\n\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
