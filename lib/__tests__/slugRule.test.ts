// One access rule per structure (slug) for the whole server: canAccessSlug of server.cjs (routes not moved to the
// domain API yet: dashboard, reports…) and scopeAllowsSlug of lib/directory/api.ts must agree — review of lot 2 b,
// druid-internal docs/plan-migration-postgresql.md (2 g).
import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import { scopeAllowsSlug } from '../directory/api';

process.env.VITE_GRIST_DOC_ID ||= 'docA';
process.env.GRIST_API_KEY ||= 'k';
const { canAccessSlug } = createRequire(import.meta.url)('../../server.cjs');

const SLUGS = ['LS2N', 'ls2n', 'LAB²B', 'lab2b', 'Lab-A', 'LAB A', 'École', 'ecole', 'ec-nantes', 'ECNANTES', '', 'zzz', 'IETR '];
const RIGHTS = [
  { allSlugs: true, labAnchors: [] },
  { allSlugs: false, labAnchors: ['ls2n'] },
  { allSlugs: false, labAnchors: ['lab2b', 'laba'] },
  { allSlugs: false, labAnchors: ['ecole', 'ecnantes'] },
  { allSlugs: false, labAnchors: [] },
];

describe('access rule per structure', () => {
  it('gives the same answer in server.cjs and in the domain API', () => {
    for (const access of RIGHTS) for (const slug of SLUGS) {
      expect(scopeAllowsSlug({ all: access.allSlugs, labAnchors: access.labAnchors }, slug), `${JSON.stringify(access)} ${slug}`)
        .toBe(canAccessSlug(access, slug));
    }
  });
});
