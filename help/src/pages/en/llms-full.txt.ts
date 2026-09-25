// /en/llms-full.txt: the whole English help in one Markdown file (French: pages/llms-full.txt.ts).
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { llmsFull } from '../../lib/markdown';

export const GET: APIRoute = async () =>
	new Response(llmsFull(await getCollection('docs'), 'en'), {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' },
	});
