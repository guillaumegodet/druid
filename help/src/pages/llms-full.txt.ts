// /llms-full.txt: the whole help in one Markdown file, in sidebar order. English twin: pages/en/.
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { llmsFull } from '../lib/markdown';

export const GET: APIRoute = async () =>
	new Response(llmsFull(await getCollection('docs'), 'fr'), {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' },
	});
