import { describe, it, expect } from 'vitest';
import { buildMergeProposal, MergeColumnMeta, MergeRow } from '../mergeProposal';

const numCol = (id: string): MergeColumnMeta => ({ id, label: id, type: 'Numeric', isFormula: false });
const row = (rowId: number, fields: Record<string, any>): MergeRow => ({ rowId, fields: { LABO: 'LPPL', ...fields } });
const fieldOf = (keep: MergeRow, drop: MergeRow, col: string) =>
  buildMergeProposal(keep, drop, [numCol(col)]).fields.find((f) => f.col === col)!;

describe('buildMergeProposal — FTE columns (0 is a value, lib/fte.ts)', () => {
  it('a research FTE of 0 on the kept row is not overwritten by the other row', () => {
    const f = fieldOf(row(1, { etp_recherche: 0 }), row(2, { etp_recherche: 0.5 }), 'etp_recherche');
    expect(f.kind).toBe('conflict');
  });

  it('a 0 on the dropped row fills an empty kept row', () => {
    const f = fieldOf(row(1, { etp_recherche: null }), row(2, { etp_recherche: 0 }), 'etp_recherche');
    expect(f).toMatchObject({ kind: 'fill', choice: 'drop' });
  });

  it('0 and empty are different values, 0 and 0 are equal', () => {
    expect(fieldOf(row(1, { etp_quotite: 0 }), row(2, { etp_quotite: null }), 'etp_quotite')).toMatchObject({ choice: 'keep', reason: 'fill' });
    expect(fieldOf(row(1, { etp_quotite: 0 }), row(2, { etp_quotite: 0 }), 'etp_quotite')).toMatchObject({ reason: 'equal' });
  });

  it('other numeric columns keep the « 0 = empty » rule', () => {
    const f = fieldOf(row(1, { ID_SCOPUS: 0 }), row(2, { ID_SCOPUS: 57190000000 }), 'ID_SCOPUS');
    expect(f).toMatchObject({ kind: 'fill', choice: 'drop' });
  });
});
