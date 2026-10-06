import { describe, it, expect } from 'vitest';
import { parseFteCell, parseFteInput, hasFteColumns, fteGristFields, FTE_COLUMNS } from '../fte';
import type { AnnuaireColumnMeta } from '../gristService';

const col = (id: string): AnnuaireColumnMeta => ({ id, label: id, type: 'Numeric', isFormula: false });
const bothCols = [col('Nom'), col(FTE_COLUMNS.fte), col(FTE_COLUMNS.researchFte)];

describe('parseFteCell', () => {
  it('empty cell → null, never 0', () => {
    expect(parseFteCell(null)).toBeNull();
    expect(parseFteCell(undefined)).toBeNull();
    expect(parseFteCell('')).toBeNull();
    expect(parseFteCell('  ')).toBeNull();
  });

  it('a real 0 stays 0 (research discharge)', () => {
    expect(parseFteCell(0)).toBe(0);
    expect(parseFteCell('0')).toBe(0);
  });

  it('numbers and decimal text, comma or dot', () => {
    expect(parseFteCell(0.5)).toBe(0.5);
    expect(parseFteCell(1)).toBe(1);
    expect(parseFteCell('0,6')).toBe(0.6);
    expect(parseFteCell('0.25')).toBe(0.25);
  });

  it('out of [0, 1] or unreadable → null', () => {
    expect(parseFteCell(1.5)).toBeNull();
    expect(parseFteCell(-0.5)).toBeNull();
    expect(parseFteCell('50 %')).toBeNull();
    expect(parseFteCell(NaN)).toBeNull();
  });
});

describe('parseFteInput', () => {
  it('distinguishes empty, valid and invalid input', () => {
    expect(parseFteInput('')).toBeNull();
    expect(parseFteInput('0')).toBe(0);
    expect(parseFteInput('0,5')).toBe(0.5);
    expect(parseFteInput('2')).toBe('invalid');
    expect(parseFteInput('abc')).toBe('invalid');
  });
});

describe('hasFteColumns', () => {
  it('true only when both columns exist', () => {
    expect(hasFteColumns(bothCols)).toBe(true);
    expect(hasFteColumns([col('Nom'), col(FTE_COLUMNS.fte)])).toBe(false);
    expect(hasFteColumns([])).toBe(false);
  });
});

describe('fteGristFields', () => {
  it('writes both columns, null when empty (a new row must not keep the Grist 0)', () => {
    expect(fteGristFields(bothCols, { fte: 1, researchFte: null })).toEqual({ etp_quotite: 1, etp_recherche: null });
    expect(fteGristFields(bothCols, {})).toEqual({ etp_quotite: null, etp_recherche: null });
  });

  it('keeps an explicit 0', () => {
    expect(fteGristFields(bothCols, { fte: 1, researchFte: 0 })).toEqual({ etp_quotite: 1, etp_recherche: 0 });
  });

  it('skips the columns missing from the document (Centrale, demo)', () => {
    expect(fteGristFields([col('Nom')], { fte: 1, researchFte: 0.5 })).toEqual({});
    expect(fteGristFields([col(FTE_COLUMNS.researchFte)], { fte: 1, researchFte: 0.5 })).toEqual({ etp_recherche: 0.5 });
  });

  it('drops an out-of-range value instead of writing it', () => {
    expect(fteGristFields(bothCols, { fte: 3, researchFte: 0.5 })).toEqual({ etp_quotite: null, etp_recherche: 0.5 });
  });
});
