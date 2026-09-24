/**
 * Reduced-precision ISO 8601 dates ("fuzzy dates") shared by the researcher record, the Grist
 * Annuaire, people.csv (cdb) and the ABES export.
 *
 * Canonical Druid format, decided on 2026-09-22: `YYYY` (year only), `YYYY-MM` (year + month)
 * or `YYYY-MM-DD` (full date), empty string when unknown. Used by the four employment /
 * membership date fields (Grist columns employment_start_date, employment_end_date,
 * affiliation_start_date, affiliation_end_date — Text columns once migrated with
 * scripts/migrate_fuzzy_dates.cjs). Consumers needing a full date expand a fuzzy value to a
 * bound: a START date to the first day of the period, an END date to its last day.
 */

export type FuzzyDatePrecision = 'year' | 'month' | 'day';

/** `YYYY`, `YYYY-MM` or `YYYY-MM-DD` (calendar validity checked separately). */
const FUZZY_RE = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

const pad2 = (n: number | string): string => String(n).padStart(2, '0');

/** Assembles a fuzzy date from its parts, or returns null when out of calendar range. */
const build = (y: number, m?: number, d?: number): string | null => {
  if (y < 1000 || y > 9999) return null;
  if (m === undefined) return String(y);
  if (m < 1 || m > 12) return null;
  if (d === undefined) return `${y}-${pad2(m)}`;
  if (d < 1 || d > daysInMonth(y, m)) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
};

/** Precision of a canonical fuzzy date, null when the value is not one. */
export const fuzzyDatePrecision = (value: unknown): FuzzyDatePrecision | null => {
  const m = FUZZY_RE.exec(typeof value === 'string' ? value : '');
  if (!m) return null;
  if (build(+m[1], m[2] === undefined ? undefined : +m[2], m[3] === undefined ? undefined : +m[3]) === null) return null;
  return m[3] !== undefined ? 'day' : m[2] !== undefined ? 'month' : 'year';
};

export const isFuzzyDate = (value: unknown): boolean => fuzzyDatePrecision(value) !== null;

/**
 * Normalizes any date-like input to the canonical fuzzy format.
 * - Grist Date cell (epoch seconds) → `YYYY-MM-DD` (UTC).
 * - Accepted text forms: `YYYY`, `YYYY-MM`, `YYYY-MM-DD`, ISO date-time (time part dropped),
 *   French `DD/MM/YYYY`, `MM/YYYY` (also with `-` or `.`), and unpadded `YYYY-M-D`.
 * - Empty / null / undefined → `''`.
 * - Anything else → `null` (the caller decides: reject in a form, drop in an import).
 */
export const normalizeFuzzyDate = (raw: unknown): string | null => {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw === 0) return '';
    const d = new Date(raw * 1000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return '';
  let m = /^(\d{4})(?:[-/.](\d{1,2})(?:[-/.](\d{1,2}))?)?(?:[T ].*)?$/.exec(s);   // year first
  if (m) return build(+m[1], m[2] === undefined ? undefined : +m[2], m[3] === undefined ? undefined : +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);                          // DD/MM/YYYY
  if (m) return build(+m[3], +m[2], +m[1]);
  m = /^(\d{1,2})[-/.](\d{4})$/.exec(s);                                        // MM/YYYY
  if (m) return build(+m[2], +m[1]);
  return null;
};

/** First day of the period (`2026` → `2026-01-01`, `2026-06` → `2026-06-01`); `''` when not a fuzzy date. */
export const fuzzyDateLowerBound = (value: unknown): string => {
  const m = FUZZY_RE.exec(typeof value === 'string' ? value : '');
  if (!m || !isFuzzyDate(value)) return '';
  return `${m[1]}-${m[2] ?? '01'}-${m[3] ?? '01'}`;
};

/** Last day of the period (`2026` → `2026-12-31`, `2026-06` → `2026-06-30`); `''` when not a fuzzy date. */
export const fuzzyDateUpperBound = (value: unknown): string => {
  const m = FUZZY_RE.exec(typeof value === 'string' ? value : '');
  if (!m || !isFuzzyDate(value)) return '';
  const month = m[2] === undefined ? 12 : +m[2];
  const day = m[3] === undefined ? daysInMonth(+m[1], month) : +m[3];
  return `${m[1]}-${pad2(month)}-${pad2(day)}`;
};

/** Year part (`YYYY`), `''` when not a fuzzy date. */
export const fuzzyDateYear = (value: unknown): string => (isFuzzyDate(value) ? String(value).slice(0, 4) : '');

/** Today as `YYYY-MM-DD` (UTC calendar day, like Grist epochs). */
export const todayIso = (now: Date = new Date()): string => now.toISOString().slice(0, 10);

/**
 * Is the whole period strictly in the past? An END date `2026` is over only from 2027-01-01 on;
 * `2026-06` from 2026-07-01. Empty or invalid → false (an unknown end is not an ended one).
 */
export const isFuzzyDatePast = (value: unknown, today: string = todayIso()): boolean => {
  const upper = fuzzyDateUpperBound(value);
  return !!upper && upper < today;
};

/**
 * Departure that no source may override (rule of 2026-09-22): BOTH the employment end and the
 * primary membership end are filled in and past. Applies even to a validated record and whatever
 * the LDAP state says.
 */
export const isDepartureCertain = (employmentEnd: unknown, membershipEnd: unknown, today: string = todayIso()): boolean =>
  isFuzzyDatePast(employmentEnd, today) && isFuzzyDatePast(membershipEnd, today);

/** Human-readable form for the UI: `2026` → `2026`, `2026-06` → `06/2026`, `2026-06-15` → `15/06/2026`. */
export const formatFuzzyDate = (value: unknown): string => {
  const p = fuzzyDatePrecision(value);
  if (!p) return typeof value === 'string' ? value : '';
  const s = String(value);
  if (p === 'year') return s;
  if (p === 'month') return `${s.slice(5, 7)}/${s.slice(0, 4)}`;
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
};
