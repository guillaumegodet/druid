#!/usr/bin/env node
// Broken-link check of the built help centre (plan-documentation-utilisateur.md, lot 7): every
// internal link (`href="/…"` or `href="#…"`) of every page in dist/ must point to an existing page
// and, when it has one, to an existing anchor. Runs after `astro build` (npm run build), so a broken
// link fails the Cloudflare build instead of reaching users. External links are not checked.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;

const htmlFiles = (dir) =>
	readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return name === '_astro' || name === 'pagefind' ? [] : htmlFiles(path);
		return name.endsWith('.html') ? [path] : [];
	});

const idCache = new Map();
const idsOf = (file) => {
	if (!idCache.has(file)) {
		idCache.set(file, new Set([...readFileSync(file, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
	}
	return idCache.get(file);
};

/** dist file served for a site path, or null. */
const targetFile = (sitePath) => {
	const clean = decodeURIComponent(sitePath.split('?')[0]);
	const candidates = clean.endsWith('/') ? [join(DIST, clean, 'index.html')] : [join(DIST, clean), join(DIST, clean, 'index.html')];
	return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
};

const errors = [];
const pages = htmlFiles(DIST);
for (const page of pages) {
	const html = readFileSync(page, 'utf8');
	for (const [, href] of html.matchAll(/<a\s[^>]*?href="([^"]*)"/g)) {
		if (!href.startsWith('/') && !href.startsWith('#')) continue;
		if (href.startsWith('//') || href === '#' || href === '#_top') continue;
		const [path, anchor] = href.split('#');
		const file = path ? targetFile(path) : page;
		if (!file) {
			errors.push(`${relative(DIST, page)} → ${href} : page not found`);
			continue;
		}
		if (anchor && file.endsWith('.html') && !idsOf(file).has(decodeURIComponent(anchor))) {
			errors.push(`${relative(DIST, page)} → ${href} : anchor not found`);
		}
	}
}

if (errors.length) {
	console.error(`check-links: ${errors.length} broken internal link(s)\n  ${[...new Set(errors)].join('\n  ')}`);
	process.exit(1);
}
console.log(`check-links: ${pages.length} pages, no broken internal link`);
