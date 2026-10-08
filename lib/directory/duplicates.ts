// Duplicate groups of the Annuaire (several rows sharing a uid_dyna), druid-internal docs/archive/plan-fusion-doublons.md.
// Pure module shared by the browser (LDAP diff) and the domain API (GET /api/v1/duplicates, lot 2 c of
// docs/plan-migration-postgresql.md); moved verbatim out of lib/gristService.ts.
import { parseValidation } from '../validation';
import { classifyDuplicate, LdapDuplicateKind } from '../mergeProposal';
import {
  AFFILIATION_END_COL, DUPLICATE_DECISION_COL, RATTACHEMENT_COL, RattachementRole, fromGristDate, fromGristFuzzyDate,
} from './gristMapping';

/** Same uid_dyna on ≥2 Annuaire rows. `kind` classifies the group (see docs/archive/plan-fusion-doublons.md):
 * - same_labo  : every row carries the same LABO → probable duplicate, to merge;
 * - parking    : one row sits in a parking LABO (`zzz`, empty) → to absorb into the lab row;
 * - multi_labo : different LABOs → multi-affiliation (concurrent or successive) to qualify.
 * `ids`/`names` kept for compatibility; `rows` carries the per-row detail. */
export interface DuplicateGroup {
  uid: string; ids: string[]; names: string[];
  kind: LdapDuplicateKind;
  /** Qualified (lot 1): exactly one PRINCIPAL row and every other one SECONDAIRE/HISTORIQUE,
   * or an « À revoir » decision recorded → leaves the list of duplicates to process. */
  qualified: boolean;
  decision: string;
  rows: { id: string; gristRowId: number; name: string; labo: string; validated: boolean; dataSource: string; role: RattachementRole | ''; endDate: string }[];
}

/** « Doublons » page: uid_dyna groups of the Annuaire, without LDAP (docs/archive/plan-reorganisation-sync-ldap.md, lot 3). */
export interface DuplicatesDiff {
  generatedAt: string;
  stats: { gristTotal: number; pending: number; qualified: number; parKind: Record<LdapDuplicateKind, number> };
  doublonsUid: DuplicateGroup[];
}

/** Groups of Annuaire records sharing a uid_dyna (≥ 2 rows), classified (same_labo / parking /
 * multi_labo) and flagged `qualified` when the multi-affiliation is declared (exactly one
 * PRINCIPAL row, every other one SECONDAIRE/HISTORIQUE) or the decision is « A_REVOIR ». Pure
 * logic on raw Grist records — shared by computeLdapDiff (browser) and the duplicates of the domain API (server). */
export function computeDuplicateGroups(records: any[]): { doublonsUid: DuplicateGroup[]; duplicatesByKind: Record<LdapDuplicateKind, number> } {
  const nameOf = (f: any) => `${(f['Nom'] || '').toUpperCase()} ${f['Prenom'] || ''}`.trim();
  const byUid: Record<string, any[]> = {};
  for (const rec of records) {
    const uid = rec.fields['uid_dyna'];
    if (uid) (byUid[uid] = byUid[uid] || []).push(rec);
  }
  const doublonsUid: DuplicateGroup[] = [];
  const duplicatesByKind: Record<LdapDuplicateKind, number> = { same_labo: 0, parking: 0, multi_labo: 0 };
  for (const [uid, recs] of Object.entries(byUid)) {
    if (recs.length < 2) continue;
    const rows = recs.map((r) => {
      const v = parseValidation(r.fields, fromGristDate);
      return {
        id: `G-${r.id}`, gristRowId: r.id, name: nameOf(r.fields),
        labo: String(r.fields['LABO'] || '').trim(), validated: v.validated,
        dataSource: String(r.fields['Data_source'] || ''),
        role: ((String(r.fields[RATTACHEMENT_COL] || '').trim().toUpperCase() as RattachementRole) || '') as RattachementRole | '',
        endDate: fromGristFuzzyDate(r.fields[AFFILIATION_END_COL]) || fromGristFuzzyDate(r.fields['employment_end_date']),
      };
    });
    const kind = classifyDuplicate(rows.map((r) => r.labo));
    const decision = String(recs.map((r) => r.fields[DUPLICATE_DECISION_COL] || '').find(Boolean) || '');
    const qualified =
      (rows.filter((r) => r.role === 'PRINCIPAL').length === 1 && rows.every((r) => !!r.role))
      || decision.toUpperCase().startsWith('A_REVOIR');
    if (!qualified) duplicatesByKind[kind]++;
    doublonsUid.push({ uid, ids: rows.map((r) => r.id), names: rows.map((r) => r.name), kind, qualified, decision, rows });
  }
  // Probable duplicates first, then parking, then multi-affiliations; by name within each class
  const kindOrder: Record<LdapDuplicateKind, number> = { same_labo: 0, parking: 1, multi_labo: 2 };
  doublonsUid.sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || a.names[0].localeCompare(b.names[0]));
  return { doublonsUid, duplicatesByKind };
}
