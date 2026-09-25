// /en/llms.txt: index of the English help for AI assistants (French: pages/llms.txt.ts).
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { llmsIndex } from '../../lib/markdown';

export const GET: APIRoute = async ({ site }) =>
	new Response(llmsIndex(await getCollection('docs'), 'en', site), {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' },
	});
