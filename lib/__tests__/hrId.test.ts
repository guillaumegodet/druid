import { describe, it, expect } from 'vitest';
import { normalizeHrId, hrIdCell, hrIdProposal } from '../hrId';

describe('normalizeHrId', () => {
  it('reads the Numeric cell, a typed text and an LDAP value alike', () => {
    expect(normalizeHrId(12345)).toBe('12345');
    expect(normalizeHrId(12345.0)).toBe('12345');
    expect(normalizeHrId('012345')).toBe('12345');
    expect(normalizeHrId(' 12345.0 ')).toBe('12345');
    expect(normalizeHrId('{MANGUE}12345')).toBe('12345');
  });

  it('treats empty, zero and non-numeric cells as empty', () => {
    for (const v of [null, undefined, '', 0, '0', '000', false, 'N/C', '12a', NaN]) expect(normalizeHrId(v)).toBe('');
  });
});

describe('hrIdCell', () => {
  it('writes a number, or null when empty', () => {
    expect(hrIdCell('012345')).toBe(12345);
    expect(hrIdCell('')).toBeNull();
  });
});

describe('hrIdProposal', () => {
  it('fills an empty record', () => {
    expect(hrIdProposal(0, '12345')).toEqual({ kind: 'fill', before: '', after: '12345' });
    expect(hrIdProposal(null, '12345')).toEqual({ kind: 'fill', before: '', after: '12345' });
  });

  it('flags a different number as a conflict', () => {
    expect(hrIdProposal(54321, '12345')).toEqual({ kind: 'conflict', before: '54321', after: '12345' });
  });

  it('proposes nothing when equal or when LDAP has no number', () => {
    expect(hrIdProposal(12345, '012345')).toBeNull();
    expect(hrIdProposal(12345, '')).toBeNull();
    expect(hrIdProposal(0, undefined)).toBeNull();
  });
});
