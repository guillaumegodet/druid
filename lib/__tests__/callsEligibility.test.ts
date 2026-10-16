import { describe, expect, it } from 'vitest';
import { ERC_EXTENSION_YEARS, evaluate, rulesFromCallText } from '../calls/eligibility';

// Sentence of the ERC Consolidator Grant 2027 topic (Funding & Tenders portal, 2026-10-16).
const COG_2027 = 'Profile of the ERC Consolidator Grant Principal Investigator The Principal Investigators will be eligible for a Consolidator '
  + 'Grant if they have defended their PhD in the five to fifteen-year period preceding the 1st of January 2027. Cut-off dates: Successful '
  + 'defence of PhD between 1 January 2012 and 31 December 2021 (inclusive)*2. Principal Investigators who have already held a Starting or a '
  + 'Consolidator Grant in the past will not be able to apply.';

describe('rulesFromCallText', () => {
  it('reads the PhD window stated by an ERC call, with the sentence', () => {
    const [rule] = rulesFromCallText({ callId: 'ERC-2027-COG', scheme: 'ERC-CoG', objectives: '', scope: COG_2027 });
    expect(rule).toMatchObject({ callId: 'ERC-2027-COG', scheme: 'ERC-CoG', phdFrom: '2012-01-01', phdTo: '2021-12-31', extensionYears: ERC_EXTENSION_YEARS });
    expect(rule.sourceText).toBe('Cut-off dates: Successful defence of PhD between 1 January 2012 and 31 December 2021 (inclusive)*2.');
  });
  it('states no rule for a text without window', () => {
    expect(rulesFromCallText({ callId: 'X', scheme: 'MSCA-PF', objectives: 'Postdoctoral fellows', scope: '' })).toEqual([]);
    expect(rulesFromCallText({ callId: 'X', scheme: '', objectives: 'defence of PhD between 1 January 2030 and 31 December 2020', scope: '' })).toEqual([]);
  });
});

describe('evaluate', () => {
  const rule = { phdFrom: '2012-01-01', phdTo: '2021-12-31', extensionYears: 2 };
  it('is eligible inside the window, to the day or to the year', () => {
    expect(evaluate('2015-06-30', rule)).toEqual({ verdict: 'eligible', reasons: ['phd-in-window'] });
    expect(evaluate('2012', rule)?.verdict).toBe('eligible');
    expect(evaluate('2021-12-31', rule)?.verdict).toBe('eligible');
  });
  it('is to check just before the window (documented extension), ineligible further', () => {
    expect(evaluate('2011-05-02', rule)).toEqual({ verdict: 'check', reasons: ['phd-before-window-extension'] });
    expect(evaluate('2010', rule)?.verdict).toBe('check');
    expect(evaluate('2009-12-31', rule)).toEqual({ verdict: 'ineligible', reasons: ['phd-before-window'] });
    expect(evaluate('2011-05-02', { ...rule, extensionYears: 0 })?.verdict).toBe('ineligible');
  });
  it('is ineligible after the window, to check when a date known to the month straddles a bound', () => {
    expect(evaluate('2022-01-01', rule)).toEqual({ verdict: 'ineligible', reasons: ['phd-after-window'] });
    expect(evaluate('2021-12', { phdFrom: '2012-01-01', phdTo: '2021-12-15', extensionYears: 0 })).toEqual({ verdict: 'check', reasons: ['phd-year-at-bound'] });
    expect(evaluate('not a date', rule)).toBeNull();
  });
});
