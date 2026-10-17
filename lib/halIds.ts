/**
 * @file halIds.ts
 * @description Numeric HAL identifiers of a person (idHal_i = `person_i` of AureHAL, `authIdHal_i` of the
 * documents). A HAL « person » exists without an IdHAL (slug) and a researcher often has several of them; the
 * CRISalid harvester takes ONE (consortium decision): the primary one, Annuaire column `IdHAL_i` → `idhali` of
 * people.csv. The others are kept in `IdHAL_i_secondaires` (pipe-separated) and never exported
 * (druid-internal docs/plan-alignement-idhal-i.md, lot 1; decisions D1 / D3).
 *
 * PostgreSQL: `person_identifier` rows of scheme `idhal_i`, the primary one with `is_primary`.
 *
 * Pure module (no network / DOM access): shared by the record form, the PostgreSQL writer and the Grist writer.
 */

/** Grist column of the Annuaire table (absent from the documents that do not have it yet: nothing written there). */
export const HAL_ID_NUM_SECONDARY_COLUMN = 'IdHAL_i_secondaires';

/** One numeric HAL identifier: digits only, no leading zeros (« 0 » of an empty Numeric cell → ''). */
export const normalizeHalIdNum = (raw: unknown): string => {
  if (raw === null || raw === undefined || raw === false) return '';
  const s = typeof raw === 'number' ? (Number.isFinite(raw) ? String(Math.trunc(raw)) : '') : String(raw).trim().replace(/\.0+$/, '');
  return /^\d+$/.test(s) ? s.replace(/^0+/, '') : '';
};

/** Identifiers of a list cell (`|`, commas, semicolons or spaces), deduplicated, order kept; non-numeric parts dropped. */
export const parseHalIdNums = (raw: unknown): string[] => {
  if (raw === null || raw === undefined) return [];
  const out: string[] = [];
  for (const part of String(raw).split(/[|,;\s]+/)) {
    const v = normalizeHalIdNum(part);
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
};

export const joinHalIdNums = (ids: string[]): string => ids.join('|');

/** Identifiers in numeric order: the order of the secondaries means nothing (decision D1 names the primary one), and
 * one order makes the Grist cell and the PostgreSQL rows read the same. */
export const sortHalIdNums = (ids: string[]): string[] => [...ids].sort((a, b) => a.length - b.length || a.localeCompare(b));

/** Secondary identifiers as stored: the list without the primary one, in numeric order. */
export const secondaryHalIdNums = (primary: unknown, secondaries: unknown): string[] => {
  const p = normalizeHalIdNum(primary);
  return sortHalIdNums(parseHalIdNums(secondaries).filter((v) => v !== p));
};

/**
 * Makes `chosen` (one of the secondaries) the primary identifier: the former primary one becomes a secondary.
 * Unknown `chosen` → unchanged.
 */
export const promoteHalIdNum = (primary: unknown, secondaries: unknown, chosen: unknown): { primary: string; secondaries: string } => {
  const p = normalizeHalIdNum(primary);
  const c = normalizeHalIdNum(chosen);
  const list = secondaryHalIdNums(p, secondaries);
  if (!c || !list.includes(c)) return { primary: p, secondaries: joinHalIdNums(list) };
  return { primary: c, secondaries: joinHalIdNums(secondaryHalIdNums(c, [p, ...list].join('|'))) };
};

/** HAL search of the documents of one person. */
export const halIdNumSearchUrl = (id: string): string => `https://hal.science/search/index/q/*/authIdHal_i/${id}`;
