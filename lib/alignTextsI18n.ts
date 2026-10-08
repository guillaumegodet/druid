// Browser texts of the alignment diffs (see lib/directory/alignTexts.ts): the `t` messages of the former browser-side
// computation, written with the same expressions so that their message ids — and translations — are unchanged.
import { t } from '@lingui/core/macro';
import type { AlignTexts } from './directory/alignTexts';

export const i18nAlignTexts: AlignTexts = {
  identifierMismatch: () => t`Identifier mismatch`,
  recordDeleted: () => t`Record deleted`,
  recordDeletedDetail: (ppn) => t`PPN ${ppn || '?'}: the record no longer exists on IdRef (404) — fix or remove the IdRef from the Annuaire`,
  recordUnreadable: () => t`Record unreadable`,
  recordUnreadableDetail: (ppn) => t`PPN ${ppn || '?'}: IdRef record unreachable (network error or IdRef down during the run — rerun)`,
  searchError: () => t`Search error`,
  apiUnreachable: () => t`API unreachable during the run — rerun.`,
  verificationError: () => t`Verification error`,
  nameMismatch: () => t`Name mismatch`,
  nameMismatchCandidate: (r, displayName) => t`${r.id} “${r.fullName || '?'}” ≠ Annuaire “${displayName}”`,
  suspectedMixed: () => t`Suspected mixed identity`,
  suspectDetail: (sus) => t`${sus.id} “${sus.fullName || '?'}”: ${(sus.reasons || []).join(' ; ')} — check the profile, flag it “Mixed identity” if needed`,
  mergedInto: (a, b) => t`${a} merged into ${b}`,
  gone: (a) => t`${a} gone`,
  missingOrcidProfile: (a) => t`${a} = missing ORCID profile`,
  listToFix: () => t`List to fix (not written)`,
  listToFixDetail: (detail) => t`${detail} → rerun (direct write) or fix OpenAlex_ids`,
  unknownOrcid: () => t`Unknown ORCID`,
  unknownScopus: () => t`Unknown Scopus Author ID`,
  idhalUnknown: () => t`IdHAL unknown to HAL`,
  noProfile: (entry) => t`${entry.orcid || entry.idhal || entry.scopus || ''}: no profile — fix it in the Annuaire`,
  invalidScopus: () => t`Invalid ID_SCOPUS`,
  invalidScopusDetail: (entry) => t`${entry.scopus!}: not a numeric Scopus identifier (the text « absent » is accepted to mark a verified absence)`,
  invalidOrcid: () => t`Invalid ORCID`,
  invalidOrcidDetail: (entry) => t`${entry.orcid!}: wrong format or check digit`,
  profileMerged: () => t`Profile merged by Scopus`,
  profileMergedDetail: (entry) => t`${entry.scopus!} → ${entry.merged!}: Scopus merged this profile into another one — update ID_SCOPUS`,
  suspectList: (cand) => t`${cand.suspect!.join(' ; ')} — check the profile, flag it “Mixed identity” if needed`,
  nameMismatchProfile: (displayName, cand) => t`Annuaire “${displayName}” ≠ profile “${cand.fullName!}”${(cand.forms || []).length > 1 ? ` (${cand.forms!.join(' | ')})` : ''}`,
};
