import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ViewState } from '../../types';
import { ADMIN_TAB_HELP, DASHBOARD_TAB_HELP, HELP_BASE_URL, TODO_TAB_HELP, VIEW_HELP, helpUrl } from '../helpLinks';

const DOCS = path.resolve(__dirname, '../../help/src/content/docs');

/** Source file of a help page path (`/guides/x/` → guides/x.md or .mdx), null when missing. */
const pageFile = (pagePath: string): string | null => {
  const slug = pagePath.replace(/^\/+|\/+$/g, '') || 'index';
  for (const ext of ['.md', '.mdx']) {
    const file = path.join(DOCS, slug + ext);
    if (fs.existsSync(file)) return file;
  }
  return null;
};

/** Heading anchors of a page, as Starlight generates them (github-slugger rules). */
const anchorsOf = (file: string): Set<string> => {
  const slugs = new Set<string>();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^#{2,6}\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const text = m[1].replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*`_]/g, '');
    slugs.add(text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s/g, '-'));
  }
  return slugs;
};

const ALL_LINKS: [string, string][] = [
  ...Object.entries(VIEW_HELP).map(([k, v]): [string, string] => [`view ${k}`, v]),
  ...Object.entries(DASHBOARD_TAB_HELP).map(([k, v]): [string, string] => [`dashboard tab ${k}`, v]),
  ...Object.entries(TODO_TAB_HELP).map(([k, v]): [string, string] => [`« À traiter » tab ${k}`, v]),
  ...Object.entries(ADMIN_TAB_HELP).map(([k, v]): [string, string] => [`admin tab ${k}`, v]),
];

describe('helpLinks', () => {
  it('gives every Druid view a help page', () => {
    for (const view of Object.values(ViewState)) expect(VIEW_HELP[view], view).toBeTruthy();
  });

  it.each(ALL_LINKS)('%s → %s exists in the help centre', (_, link) => {
    const [pagePath, anchor] = link.split('#');
    const file = pageFile(pagePath);
    expect(file, `no page for ${pagePath}`).not.toBeNull();
    if (anchor) expect([...anchorsOf(file!)]).toContain(anchor);
  });

  it('builds absolute URLs on the help site', () => {
    expect(HELP_BASE_URL.endsWith('/')).toBe(false);
    expect(helpUrl()).toBe(`${HELP_BASE_URL}/`);
    expect(helpUrl('/donnees/indicateurs/#apc')).toBe(`${HELP_BASE_URL}/donnees/indicateurs/#apc`);
  });
});
