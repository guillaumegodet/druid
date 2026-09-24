import { describe, it, expect } from 'vitest';
import {
  normalizeFuzzyDate, isFuzzyDate, fuzzyDatePrecision, fuzzyDateLowerBound, fuzzyDateUpperBound,
  fuzzyDateYear, isFuzzyDatePast, isDepartureCertain, formatFuzzyDate,
} from '../dates';

describe('normalizeFuzzyDate', () => {
  it('keeps canonical forms', () => {
    expect(normalizeFuzzyDate('2026')).toBe('2026');
    expect(normalizeFuzzyDate('2026-06')).toBe('2026-06');
    expect(normalizeFuzzyDate('2026-06-15')).toBe('2026-06-15');
  });
  it('converts Grist epochs (seconds) to a full UTC date', () => {
    expect(normalizeFuzzyDate(1768435200)).toBe('2026-01-15');
    expect(normalizeFuzzyDate(0)).toBe('');
  });
  it('accepts French and unpadded forms', () => {
    expect(normalizeFuzzyDate('15/06/2026')).toBe('2026-06-15');
    expect(normalizeFuzzyDate('15-06-2026')).toBe('2026-06-15');
    expect(normalizeFuzzyDate('06/2026')).toBe('2026-06');
    expect(normalizeFuzzyDate('2026-6-5')).toBe('2026-06-05');
    expect(normalizeFuzzyDate('2026/06')).toBe('2026-06');
    expect(normalizeFuzzyDate('2026-06-15T00:00:00Z')).toBe('2026-06-15');
    expect(normalizeFuzzyDate('  2026 ')).toBe('2026');
  });
  it('returns empty for empty input and null for garbage', () => {
    expect(normalizeFuzzyDate('')).toBe('');
    expect(normalizeFuzzyDate(null)).toBe('');
    expect(normalizeFuzzyDate(undefined)).toBe('');
    expect(normalizeFuzzyDate('juin 2026')).toBeNull();
    expect(normalizeFuzzyDate('2026-13')).toBeNull();
    expect(normalizeFuzzyDate('2026-02-30')).toBeNull();
    expect(normalizeFuzzyDate('26')).toBeNull();
  });
});

describe('precision and bounds', () => {
  it('detects the precision', () => {
    expect(fuzzyDatePrecision('2026')).toBe('year');
    expect(fuzzyDatePrecision('2026-06')).toBe('month');
    expect(fuzzyDatePrecision('2026-06-15')).toBe('day');
    expect(fuzzyDatePrecision('2026-06-31')).toBeNull();
    expect(isFuzzyDate('')).toBe(false);
  });
  it('expands to the first / last day of the period', () => {
    expect(fuzzyDateLowerBound('2026')).toBe('2026-01-01');
    expect(fuzzyDateUpperBound('2026')).toBe('2026-12-31');
    expect(fuzzyDateLowerBound('2024-02')).toBe('2024-02-01');
    expect(fuzzyDateUpperBound('2024-02')).toBe('2024-02-29');
    expect(fuzzyDateUpperBound('2026-06-15')).toBe('2026-06-15');
    expect(fuzzyDateUpperBound('')).toBe('');
  });
  it('extracts the year', () => {
    expect(fuzzyDateYear('2026-06')).toBe('2026');
    expect(fuzzyDateYear('x')).toBe('');
  });
});

describe('isFuzzyDatePast / isDepartureCertain', () => {
  const today = '2026-09-22';
  it('a period is past only once fully elapsed', () => {
    expect(isFuzzyDatePast('2025', today)).toBe(true);
    expect(isFuzzyDatePast('2026', today)).toBe(false);
    expect(isFuzzyDatePast('2026-08', today)).toBe(true);
    expect(isFuzzyDatePast('2026-09', today)).toBe(false);
    expect(isFuzzyDatePast('2026-09-21', today)).toBe(true);
    expect(isFuzzyDatePast('2026-09-22', today)).toBe(false);
    expect(isFuzzyDatePast('', today)).toBe(false);
    expect(isFuzzyDatePast(null, today)).toBe(false);
  });
  it('departure is certain only when both end dates are past', () => {
    expect(isDepartureCertain('2025', '2025-06', today)).toBe(true);
    expect(isDepartureCertain('2025', '', today)).toBe(false);
    expect(isDepartureCertain('', '2025', today)).toBe(false);
    expect(isDepartureCertain('2025', '2026', today)).toBe(false);
  });
});

describe('formatFuzzyDate', () => {
  it('renders French display forms', () => {
    expect(formatFuzzyDate('2026')).toBe('2026');
    expect(formatFuzzyDate('2026-06')).toBe('06/2026');
    expect(formatFuzzyDate('2026-06-15')).toBe('15/06/2026');
    expect(formatFuzzyDate('')).toBe('');
  });
});
