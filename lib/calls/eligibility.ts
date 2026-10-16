// Eligibility engine of the calls for proposals (druid-internal docs/plan-funding-calls.md, lot 5, family C): which
// researchers may apply to a scheme reserved by career stage (ERC Starting / Consolidator, ANR JCJC…). The rules are
// never written in the code: each edition states its own cut-off dates in the text of the call (ERC 2027: « Successful
// defence of PhD between 1 January 2012 and 31 December 2021 (inclusive) », where 2026 said 2 to 7 years for a
// Starting Grant and 2027 says 10), read from the collected text (`rulesFromCallText`). The verdict of a person is
// pure (`evaluate`): eligible, to check (date known to the year only at a bound, or just outside the window when the
// scheme extends it for documented career breaks: maternity, parental leave, illness, national service, clinical
// training), or ineligible. A person without known PhD is not evaluated.
import { fuzzyDateLowerBound, fuzzyDateUpperBound, isFuzzyDate } from '../dates';

export type EligibilityVerdict = 'eligible' | 'check' | 'ineligible';

/** Why a person got its verdict (translated by the view). */
export type EligibilityReason =
  | 'phd-in-window'
  | 'phd-year-at-bound'
  | 'phd-before-window-extension'
  | 'phd-before-window'
  | 'phd-after-window';

export interface EligibilityRule {
  /** Call the rule comes from. */
  callId: string;
  /** Scheme of the call (ERC-CoG, ANR-JCJC…). */
  scheme: string;
  /** Window of the defence of the PhD, inclusive ('YYYY-MM-DD'). */
  phdFrom: string;
  phdTo: string;
  /** Years before `phdFrom` within which a documented extension may still make a person eligible. */
  extensionYears: number;
  /** Sentence of the call that states the rule, shown with the candidates. */
  sourceText: string;
}

const MONTHS: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12',
};
const dayOf = (d: string, month: string, y: string): string | null => {
  const m = MONTHS[month.toLowerCase()];
  return m ? `${y}-${m}-${d.padStart(2, '0')}` : null;
};

/**
 * Extension window of the ERC, in years: the eligibility period is extended for maternity (18 months per child),
 * paternity and parental leave, long illness, national service, clinical training (up to 4 years); two years catch
 * the common cases without listing everybody whose PhD is old.
 */
export const ERC_EXTENSION_YEARS = 2;

/** Rules stated by the text of a call; none when the text states no PhD window. */
export const rulesFromCallText = (call: { callId: string; scheme: string; objectives: string; scope: string }): EligibilityRule[] => {
  const text = `${call.objectives}\n${call.scope}`.replace(/\s+/g, ' ');
  const m = text.match(/defen[cs]e of (?:their |the )?(?:first )?PhD between (\d{1,2}) ([A-Za-z]+) (\d{4}) and (\d{1,2}) ([A-Za-z]+) (\d{4})/i);
  if (!m) return [];
  const from = dayOf(m[1], m[2], m[3]);
  const to = dayOf(m[4], m[5], m[6]);
  if (!from || !to || from > to) return [];
  const start = Math.max(0, text.lastIndexOf('.', m.index ?? 0) + 1);
  const end = text.indexOf('.', (m.index ?? 0) + m[0].length);
  return [{
    callId: call.callId, scheme: call.scheme, phdFrom: from, phdTo: to, extensionYears: /^ERC-/i.test(call.scheme) ? ERC_EXTENSION_YEARS : 0,
    sourceText: text.slice(start, end < 0 ? undefined : end + 1).trim(),
  }];
};

const minusYears = (iso: string, years: number): string => `${Number(iso.slice(0, 4)) - years}${iso.slice(4)}`;

export interface EligibilityResult {
  verdict: EligibilityVerdict;
  reasons: EligibilityReason[];
}

/** Verdict of a person whose PhD was defended on `phdOn` (fuzzy date), null when the date is unreadable. */
export const evaluate = (phdOn: string, rule: Pick<EligibilityRule, 'phdFrom' | 'phdTo' | 'extensionYears'>): EligibilityResult | null => {
  if (!isFuzzyDate(phdOn)) return null;
  const low = fuzzyDateLowerBound(phdOn);
  const high = fuzzyDateUpperBound(phdOn);
  if (low >= rule.phdFrom && high <= rule.phdTo) return { verdict: 'eligible', reasons: ['phd-in-window'] };
  if (high < rule.phdFrom) {
    const extended = minusYears(rule.phdFrom, rule.extensionYears);
    return rule.extensionYears > 0 && high >= extended
      ? { verdict: 'check', reasons: ['phd-before-window-extension'] }
      : { verdict: 'ineligible', reasons: ['phd-before-window'] };
  }
  if (low > rule.phdTo) return { verdict: 'ineligible', reasons: ['phd-after-window'] };
  // The period of the date straddles a bound: known to the year (or month) only.
  return { verdict: 'check', reasons: ['phd-year-at-bound'] };
};
