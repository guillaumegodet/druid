// Copy of the PostgreSQL directory into the Grist document (druid-internal docs/plan-migration-postgresql.md, lot 8 e):
// plan by row id, formula columns never written, Grist actions, mass removal guard. Fictitious data only.
import { describe, it, expect } from 'vitest';
import { planTableCopy, copyActions, massRemoval, normalizeCell, writableColumns } from '../directory/pg/gristCopy';

const COLUMNS = [
  { id: 'Nom', fields: { type: 'Text', isFormula: false } },
  { id: 'Employeur', fields: { type: 'Ref:Etablissements', isFormula: false } },
  { id: 'groupes', fields: { type: 'ChoiceList', isFormula: false } },
  { id: 'institution_identifier', fields: { type: 'Any', isFormula: true } },
  { id: 'manualSort', fields: { type: 'ManualSortPos', isFormula: false } },
];

describe('planTableCopy', () => {
  it('adds, updates and removes by row id, and writes only the changed data cells', () => {
    const source = [
      { id: 1, fields: { Nom: 'Durand', Employeur: 10, groupes: ['L', 'g1'], institution_identifier: 'X', LDAP_only: 'z' } },
      { id: 2, fields: { Nom: 'Martin', Employeur: null, groupes: null } },
      { id: 5, fields: { Nom: 'Nouveau', Employeur: 11 } },
    ];
    const target = [
      { id: 1, fields: { Nom: 'Durant', Employeur: 10, groupes: ['L', 'g1'], institution_identifier: 'Y', manualSort: 1 } },
      { id: 2, fields: { Nom: 'Martin', Employeur: 0, groupes: '' } },
      { id: 3, fields: { Nom: 'Ancien', Employeur: 0 } },
    ];
    const plan = planTableCopy('Annuaire', source, target, COLUMNS);
    expect(plan.adds).toEqual([{ id: 5, fields: { Nom: 'Nouveau', Employeur: 11 } }]);
    // The formula column (different value) and the empty reference / empty text are not changes.
    expect(plan.updates).toEqual([{ id: 1, fields: { Nom: 'Durand' } }]);
    expect(plan.removes).toEqual([3]);
    expect(plan.changedColumns).toEqual({ Nom: 1 });
    expect(plan.missingColumns).toEqual(['LDAP_only']);
  });

  it('never lists a formula or helper column as writable', () => {
    expect([...writableColumns([...COLUMNS, { id: 'gristHelper_Display', fields: { isFormula: false } }]).keys()]).toEqual(['Nom', 'Employeur', 'groupes']);
    expect(normalizeCell(0, 'Ref:Etablissements')).toBeNull();
    expect(normalizeCell(0, 'Numeric')).toBe(0);
    expect(normalizeCell(['L', 'a'], 'ChoiceList')).toBe('["L","a"]');
  });
});

describe('planTableCopy — column rules of the Annuaire', () => {
  it('compares the civility by meaning and treats 0 as no identifier, not as no FTE', () => {
    const cols = [
      { id: 'Civilite', fields: { type: 'Choice' } }, { id: 'ID_SCOPUS', fields: { type: 'Numeric' } },
      { id: 'etp_recherche', fields: { type: 'Numeric' } },
    ];
    const plan = planTableCopy('Annuaire', [
      { id: 1, fields: { Civilite: 'F', ID_SCOPUS: 0, etp_recherche: 0 } },
      { id: 2, fields: { Civilite: 'M', ID_SCOPUS: 123 } },
      { id: 3, fields: { Civilite: 'F' } },
    ], [
      { id: 1, fields: { Civilite: 'Mme', ID_SCOPUS: null, etp_recherche: null } },
      { id: 2, fields: { Civilite: 'Mme', ID_SCOPUS: 123 } },
    ], cols);
    expect(plan.updates).toEqual([{ id: 1, fields: { etp_recherche: 0 } }, { id: 2, fields: { Civilite: 'M' } }]);
    expect(plan.adds).toEqual([{ id: 3, fields: { Civilite: 'F' } }]);
  });
});

describe('copyActions', () => {
  it('adds with the source ids, groups the updates by changed columns, removes in batches', () => {
    const plan = planTableCopy('Annuaire', [
      { id: 1, fields: { Nom: 'A' } }, { id: 2, fields: { Nom: 'B', Employeur: 3 } }, { id: 4, fields: { Nom: 'C' } }, { id: 7, fields: { Nom: 'N', Employeur: 3 } },
    ], [
      { id: 1, fields: { Nom: 'a' } }, { id: 2, fields: { Nom: 'b', Employeur: 0 } }, { id: 4, fields: { Nom: 'c' } }, { id: 8, fields: {} }, { id: 9, fields: {} },
    ], COLUMNS);
    expect(copyActions(plan, 1)).toEqual([
      ['BulkAddRecord', 'Annuaire', [7], { Nom: ['N'], Employeur: [3] }],
      ['BulkUpdateRecord', 'Annuaire', [1], { Nom: ['A'] }],
      ['BulkUpdateRecord', 'Annuaire', [4], { Nom: ['C'] }],
      ['BulkUpdateRecord', 'Annuaire', [2], { Nom: ['B'], Employeur: [3] }],
      ['BulkRemoveRecord', 'Annuaire', [8]],
      ['BulkRemoveRecord', 'Annuaire', [9]],
    ]);
  });
});

describe('massRemoval', () => {
  it('refuses to empty a table from an empty or half-loaded source', () => {
    const target = Array.from({ length: 2000 }, (_, i) => ({ id: i + 1, fields: { Nom: 'x' } }));
    expect(massRemoval(planTableCopy('Annuaire', [], target, COLUMNS))).toBe(true);
    expect(massRemoval(planTableCopy('Annuaire', target.slice(0, 1940), target, COLUMNS))).toBe(false);
    expect(massRemoval(planTableCopy('Annuaire', target.slice(0, 1890), target, COLUMNS))).toBe(true);
  });
});
