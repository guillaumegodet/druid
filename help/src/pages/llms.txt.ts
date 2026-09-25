// /llms.txt (https://llmstxt.org): index of the help for AI assistants, as on help.openalex.org.
// English twin: pages/en/llms.txt.ts.
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { llmsIndex } from '../lib/markdown';

export const GET: APIRoute = async ({ site }) =>
	new Response(llmsIndex(await getCollection('docs'), 'fr', site), {
		headers: { 'Content-Type': 'text/plain; charset=utf-8' },
	});
