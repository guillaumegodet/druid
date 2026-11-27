// Marks of the identifiers a researcher or a librarian changed in SoVisu+ (lot 6 of druid-internal
// docs/plan-retour-identifiants-sovisuplus.md), read from the sources of the record's identifiers (the « Sources »
// panel, lib/directory/pg/identifierProvenance.ts readIdentifierSources). Pure: the record shows a pill next to the
// identifier, so that a manager knows the value was chosen in SoVisu+ before changing it.
import type { IdentifierSourceDetail } from '../types';

export const SOVISUPLUS_SOURCES = new Set(['sovisuplus', 'sovisuplus:auth']);

export interface SovisuplusMark {
  /** authenticated: proved by the researcher (ORCID, HAL); added: typed by library staff; removed: removed in SoVisu+. */
  kind: 'authenticated' | 'added' | 'removed';
  value: string;
  /** ISO date of the change. */
  at: string;
}

/** Whether an author of a decision is SoVisu+ (`sovisuplus:<person>`, lib/graph/inboundPg.ts). */
export const isSovisuplusAuthor = (by: string | null | undefined): boolean => !!by && by.startsWith('sovisuplus:');

/**
 * Mark of each scheme: the primary value when SoVisu+ brought it (authenticated first), else the latest value removed
 * in SoVisu+ that the record no longer shows. Schemes without anything from SoVisu+ are absent.
 */
export const sovisuplusMarks = (details: Record<string, IdentifierSourceDetail[]> | null | undefined): Record<string, SovisuplusMark> => {
  const out: Record<string, SovisuplusMark> = {};
  for (const [scheme, values] of Object.entries(details || {})) {
    const primary = values.find((v) => v.shown && v.primary);
    const fromSvp = primary?.sources.filter((s) => SOVISUPLUS_SOURCES.has(s.source)) ?? [];
    if (primary && fromSvp.length) {
      const auth = fromSvp.find((s) => s.source === 'sovisuplus:auth');
      const s = auth ?? fromSvp.reduce((a, b) => (a.at > b.at ? a : b));
      out[scheme] = { kind: auth ? 'authenticated' : 'added', value: primary.value, at: s.at };
      continue;
    }
    const removed = values.filter((v) => !v.shown && v.setAside?.decision === 'Rejeté' && isSovisuplusAuthor(v.setAside.by) && v.setAside.at)
      .sort((a, b) => String(b.setAside!.at).localeCompare(String(a.setAside!.at)))[0];
    if (removed) out[scheme] = { kind: 'removed', value: removed.value, at: removed.setAside!.at! };
  }
  return out;
};
