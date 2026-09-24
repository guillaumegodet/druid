/**
 * Normalizes an acronym/slug for tolerant comparison (case, accents,
 * punctuation) — the same rule is used to link a Grist structure acronym
 * to a /biblio-data slug (App.tsx dashboardSlugFor) and to a Keycloak group
 * anchor (lib/auth.ts canSeeStructure), so that the two do not drift
 * apart independently.
 */
const SUPERSCRIPT_TWO = String.fromCodePoint(0x00b2);

export const normalizeAcronym = (s: string): string =>
  s
    .toLowerCase()
    .split(SUPERSCRIPT_TWO).join('2')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]/g, '');
