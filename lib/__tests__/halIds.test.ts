import { describe, it, expect } from 'vitest';
import { normalizeHalIdNum, parseHalIdNums, secondaryHalIdNums, promoteHalIdNum, sortHalIdNums } from '../halIds';

describe('normalizeHalIdNum', () => {
  it('reads a number, a typed text and a Numeric cell alike', () => {
    expect(normalizeHalIdNum(123456)).toBe('123456');
    expect(normalizeHalIdNum(' 0123456 ')).toBe('123456');
    expect(normalizeHalIdNum('123456.0')).toBe('123456');
  });

  it('treats empty, zero and non-numeric values as empty', () => {
    for (const v of [null, undefined, '', 0, '0', false, 'jean-dupont', '12a', NaN]) expect(normalizeHalIdNum(v)).toBe('');
  });
});

describe('parseHalIdNums', () => {
  it('splits on pipes, commas and spaces, deduplicates and keeps the order', () => {
    expect(parseHalIdNums('300002| 100001,300002 ; 200003')).toEqual(['300002', '100001', '200003']);
  });

  it('drops what is not a numeric identifier', () => {
    expect(parseHalIdNums('100001|jean-dupont|0')).toEqual(['100001']);
    expect(parseHalIdNums(null)).toEqual([]);
  });
});

describe('secondaryHalIdNums', () => {
  it('never keeps the primary identifier among the secondaries', () => {
    expect(secondaryHalIdNums('100001', '100001|200003')).toEqual(['200003']);
    expect(secondaryHalIdNums('', '100001|200003')).toEqual(['100001', '200003']);
  });

  it('keeps them in numeric order', () => {
    expect(secondaryHalIdNums('1', '300002|99999|200003')).toEqual(['99999', '200003', '300002']);
    expect(sortHalIdNums(['20', '3', '100'])).toEqual(['3', '20', '100']);
  });
});

describe('promoteHalIdNum', () => {
  it('swaps the chosen secondary with the primary one', () => {
    expect(promoteHalIdNum('400004', '200003|300002', '300002')).toEqual({ primary: '300002', secondaries: '200003|400004' });
  });

  it('promotes without a former primary', () => {
    expect(promoteHalIdNum('', '200003|300002', '200003')).toEqual({ primary: '200003', secondaries: '300002' });
  });

  it('leaves everything unchanged for an identifier that is not a secondary', () => {
    expect(promoteHalIdNum('100001', '200003', '999999')).toEqual({ primary: '100001', secondaries: '200003' });
  });
});
