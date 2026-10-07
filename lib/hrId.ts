/**
 * @file hrId.ts
 * @description HR staff number of a person (« n° agent », Mangue at Nantes Université). Stored in the
 * Grist Annuaire column `N_ID_UNIV_NANTES_revu_SI_RH_MANGUE_` (Numeric) and carried by LDAP in
 * `supannEmpId`. It is the most reliable key between the HR lists (DRPI), LDAP and the Annuaire —
 * names, e-mails and uids drift, the staff number does not.
 *
 * Read-only in the record: it is filled by the LDAP sync (review « LDAP — verify ») or by the
 * imports of HR lists, never typed by hand.
 *
 * Pure module (no network / DOM access): testable and shared by gristService and the record form.
 */

/** Grist column of the Annuaire table; absent from the documents of the instances without HR data. */
export const HR_ID_COLUMN = 'N_ID_UNIV_NANTES_revu_SI_RH_MANGUE_';

/**
 * Normalizes a staff number from a Grist cell (number, or text typed by hand), an LDAP value or an
 * HR export: digits only, no leading zeros, no « .0 » left by a Numeric column. '' when empty or not
 * a number (an LDAP value such as « {MANGUE}98745 » keeps its digits).
 */
export const normalizeHrId = (raw: unknown): string => {
  if (raw === null || raw === undefined || raw === false) return '';
  let s = typeof raw === 'number' ? (Number.isFinite(raw) ? String(Math.trunc(raw)) : '') : String(raw).trim();
  s = s.replace(/^\{[^}]*\}/, '').replace(/\.0+$/, '');
  // All zeros (the 0 Grist puts in an empty Numeric cell) → empty.
  return /^\d+$/.test(s) ? s.replace(/^0+/, '') : '';
};

/** Value to write into the Numeric column (null when empty). */
export const hrIdCell = (id: string): number | null => {
  const n = normalizeHrId(id);
  return n ? Number(n) : null;
};

/**
 * What the LDAP sync proposes for the staff number of a record:
 * - `fill`: the Annuaire has none → proposed like any LDAP field;
 * - `conflict`: the Annuaire holds another number → proposed but left unchecked (an HR number that
 *   differs usually means two people mixed up on one record, or a wrong uid);
 * - null: nothing to propose (same number, or LDAP has none — never cleared).
 */
export const hrIdProposal = (gristRaw: unknown, ldapRaw: unknown): { kind: 'fill' | 'conflict'; before: string; after: string } | null => {
  const before = normalizeHrId(gristRaw);
  const after = normalizeHrId(ldapRaw);
  if (!after || after === before) return null;
  return { kind: before ? 'conflict' : 'fill', before, after };
};
