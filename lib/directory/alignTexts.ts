// Texts of the alignment diffs (reasons and details of the conflicts), druid-internal docs/plan-migration-postgresql.md,
// lot 2 e. The diffs are computed by the server (lib/directory/alignments.ts), where the Lingui macros cannot run: the
// computation receives an AlignTexts. The server passes `tokenAlignTexts`, which writes each text as an invisible
// token (key + arguments); the browser replaces the tokens of the diff it receives with `localizeAlignTokens` and its
// own AlignTexts (lib/alignTextsI18n.ts), whose `t` messages are the ones the browser used before — same message ids,
// same translations.

export interface AlignTexts {
  identifierMismatch(): string;
  recordDeleted(): string;
  recordDeletedDetail(ppn: string): string;
  recordUnreadable(): string;
  recordUnreadableDetail(ppn: string): string;
  searchError(): string;
  apiUnreachable(): string;
  verificationError(): string;
  nameMismatch(): string;
  nameMismatchCandidate(r: { id: string; fullName?: string }, displayName: string): string;
  suspectedMixed(): string;
  suspectDetail(sus: { id: string; fullName?: string; reasons?: string[] }): string;
  mergedInto(a: string, b: string): string;
  gone(a: string): string;
  missingOrcidProfile(a: string): string;
  listToFix(): string;
  listToFixDetail(detail: string): string;
  unknownOrcid(): string;
  unknownScopus(): string;
  idhalUnknown(): string;
  noProfile(entry: { orcid?: string; idhal?: string; scopus?: string }): string;
  invalidScopus(): string;
  invalidScopusDetail(entry: { scopus?: string }): string;
  invalidOrcid(): string;
  invalidOrcidDetail(entry: { orcid?: string }): string;
  profileMerged(): string;
  profileMergedDetail(entry: { scopus?: string; merged?: string }): string;
  suspectList(cand: { suspect?: string[] }): string;
  nameMismatchProfile(displayName: string, cand: { fullName?: string; forms?: string[] }): string;
}

export type AlignTextKey = keyof AlignTexts;

// Invisible delimiters (Unicode « function application » / « invisible times »), never found in directory data.
const OPEN = '⁡';
const CLOSE = '⁢';

/** Keeps the fields a text needs (the cache entries carry whole candidate lists). */
const pick = (o: any, keys: string[]) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));
const token = (key: AlignTextKey, ...args: unknown[]) => `${OPEN}${JSON.stringify([key, ...args])}${CLOSE}`;

/** Server side: every text is a token (key + arguments), localized by the browser. */
export const tokenAlignTexts: AlignTexts = {
  identifierMismatch: () => token('identifierMismatch'),
  recordDeleted: () => token('recordDeleted'),
  recordDeletedDetail: (ppn) => token('recordDeletedDetail', ppn),
  recordUnreadable: () => token('recordUnreadable'),
  recordUnreadableDetail: (ppn) => token('recordUnreadableDetail', ppn),
  searchError: () => token('searchError'),
  apiUnreachable: () => token('apiUnreachable'),
  verificationError: () => token('verificationError'),
  nameMismatch: () => token('nameMismatch'),
  nameMismatchCandidate: (r, displayName) => token('nameMismatchCandidate', pick(r, ['id', 'fullName']), displayName),
  suspectedMixed: () => token('suspectedMixed'),
  suspectDetail: (sus) => token('suspectDetail', pick(sus, ['id', 'fullName', 'reasons'])),
  mergedInto: (a, b) => token('mergedInto', a, b),
  gone: (a) => token('gone', a),
  missingOrcidProfile: (a) => token('missingOrcidProfile', a),
  listToFix: () => token('listToFix'),
  listToFixDetail: (detail) => token('listToFixDetail', detail),
  unknownOrcid: () => token('unknownOrcid'),
  unknownScopus: () => token('unknownScopus'),
  idhalUnknown: () => token('idhalUnknown'),
  noProfile: (entry) => token('noProfile', pick(entry, ['orcid', 'idhal', 'scopus'])),
  invalidScopus: () => token('invalidScopus'),
  invalidScopusDetail: (entry) => token('invalidScopusDetail', pick(entry, ['scopus'])),
  invalidOrcid: () => token('invalidOrcid'),
  invalidOrcidDetail: (entry) => token('invalidOrcidDetail', pick(entry, ['orcid'])),
  profileMerged: () => token('profileMerged'),
  profileMergedDetail: (entry) => token('profileMergedDetail', pick(entry, ['scopus', 'merged'])),
  suspectList: (cand) => token('suspectList', pick(cand, ['suspect'])),
  nameMismatchProfile: (displayName, cand) => token('nameMismatchProfile', displayName, pick(cand, ['fullName', 'forms'])),
};

/** Replaces the tokens of a string (nested ones first: a detail can embed other texts). */
const localizeString = (s: string, texts: AlignTexts): string => {
  if (!s.includes(OPEN)) return s;
  let out = '';
  let i = 0;
  while (i < s.length) {
    const start = s.indexOf(OPEN, i);
    if (start < 0) { out += s.slice(i); break; }
    out += s.slice(i, start);
    let depth = 0;
    let end = start;
    for (; end < s.length; end++) {
      if (s[end] === OPEN) depth++;
      else if (s[end] === CLOSE && --depth === 0) break;
    }
    if (end >= s.length) { out += s.slice(start); break; }   // unbalanced: left as is
    try {
      const [key, ...args] = JSON.parse(s.slice(start + 1, end)) as [AlignTextKey, ...unknown[]];
      const localized = args.map((a) => localizeAlignTokens(a, texts));
      out += (texts[key] as (...a: unknown[]) => string)(...localized);
    } catch {
      out += s.slice(start, end + 1);
    }
    i = end + 1;
  }
  return out;
};

/** Browser side: the same value with every token replaced by its text (strings at any depth). */
export function localizeAlignTokens<T>(value: T, texts: AlignTexts): T {
  if (typeof value === 'string') return localizeString(value, texts) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => localizeAlignTokens(v, texts)) as unknown as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, localizeAlignTokens(v, texts)])) as T;
  }
  return value;
}
