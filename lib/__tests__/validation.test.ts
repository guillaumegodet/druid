import { describe, it, expect } from 'vitest';
import {
  parseValidation,
  validationToGristFields,
  isValidationStale,
  isAffiliationValidated,
  normStatus,
  parseValidationScope,
  parseValidationList,
  computeValidationDiff,
  nameKey,
  ValidationInfo,
} from '../validation';
import { Presence } from '../../types';

const validated = (over: Partial<ValidationInfo> = {}): ValidationInfo => ({
  validated: true,
  validatedStatus: Presence.PRESENT,
  validationDate: '2026-06-01',
  validationSource: 'Liste Centrale 2026-06',
  validationScope: ['statut', 'rattachement'],
  ...over,
});

// ─── normStatus: validated values → presence ──────────────────────────────────

describe('normStatus', () => {
  it('reads the presence values and the legacy statuses (INTERNE / EXTERNE = present)', () => {
    expect(normStatus('PRESENT')).toBe(Presence.PRESENT);
    expect(normStatus('interne')).toBe(Presence.PRESENT);
    expect(normStatus('EXTERNE')).toBe(Presence.PRESENT);
    expect(normStatus('Départ')).toBe(Presence.DEPART);
    expect(normStatus('PARTI')).toBe(Presence.PARTI);
    expect(normStatus('?')).toBeUndefined();
  });
});

// ─── isValidationStale ────────────────────────────────────────────────────────

describe('isValidationStale', () => {
  it('not stale right after the validation', () => {
    expect(isValidationStale(validated({ validationDate: '2026-06-01' }), new Date('2026-09-01'))).toBe(false);
  });

  it('stale beyond 18 months', () => {
    expect(isValidationStale(validated({ validationDate: '2024-01-01' }), new Date('2026-06-01'))).toBe(true);
  });

  it('configurable horizon (12 months)', () => {
    expect(isValidationStale(validated({ validationDate: '2025-01-01' }), new Date('2026-06-01'), 12)).toBe(true);
  });

  it('false if not validated or no date', () => {
    expect(isValidationStale(validated({ validated: false }), new Date('2030-01-01'))).toBe(false);
    expect(isValidationStale(validated({ validationDate: undefined }), new Date('2030-01-01'))).toBe(false);
  });
});

// ─── isAffiliationValidated ───────────────────────────────────────────────────

describe('verrou rattachement', () => {
  it('affiliation locked when the scope covers it', () => {
    expect(isAffiliationValidated(validated())).toBe(true);
    expect(isAffiliationValidated(validated({ validationScope: ['statut'] }))).toBe(false);
  });
});

// ─── parse / serialize Grist ──────────────────────────────────────────────────

describe('parseValidationScope', () => {
  it('decodes the « statut,rattachement » text', () => {
    expect(parseValidationScope('statut,rattachement')).toEqual(['statut', 'rattachement']);
  });
  it('decodes a Grist list and ignores unknown values', () => {
    expect(parseValidationScope(['statut', 'bidon'])).toEqual(['statut']);
  });
  it('vide si rien', () => {
    expect(parseValidationScope(null)).toEqual([]);
  });
});

describe('parseValidation', () => {
  it('reads the Grist columns', () => {
    const v = parseValidation({
      validated: true,
      validated_status: 'INTERNE',
      validation_date: '2026-06-01',
      validation_source: 'Liste LPPL',
      validation_scope: 'statut,rattachement',
      validated_by: 'durand-j',
    });
    expect(v.validated).toBe(true);
    expect(v.validatedStatus).toBe(Presence.PRESENT);
    expect(v.validationDate).toBe('2026-06-01');
    expect(v.validationSource).toBe('Liste LPPL');
    expect(v.validationScope).toEqual(['statut', 'rattachement']);
    expect(v.validatedBy).toBe('durand-j');
  });

  it('default scope = both axes if validated without scope', () => {
    const v = parseValidation({ validated: true, validated_status: 'INTERNE' });
    expect(v.validationScope).toEqual(['statut', 'rattachement']);
  });

  it('not validated if the column is missing', () => {
    expect(parseValidation({}).validated).toBe(false);
  });
});

describe('validationToGristFields', () => {
  it('serializes a validation', () => {
    const f = validationToGristFields(validated());
    expect(f.validated).toBe(true);
    expect(f.validated_status).toBe(Presence.PRESENT);
    expect(f.validation_scope).toBe('statut,rattachement');
  });

  it('resets to null/false when not validated (un-validation)', () => {
    const f = validationToGristFields(undefined);
    expect(f.validated).toBe(false);
    expect(f.validated_status).toBeNull();
    expect(f.validation_date).toBeNull();
  });

  it('round-trip parse∘serialize', () => {
    const f = validationToGristFields(validated());
    const v = parseValidation(f);
    expect(v.validatedStatus).toBe(Presence.PRESENT);
    expect(v.validationScope).toEqual(['statut', 'rattachement']);
  });
});

// ─── Bulk import ──────────────────────────────────────────────────────────────

describe('parseValidationList', () => {
  it('detects the columns by header', () => {
    const rows = parseValidationList('nom,email,uid\nDUPONT Jean,jean@x.fr,jdupont\nMARTIN Alice,,amartin');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: 'DUPONT Jean', email: 'jean@x.fr', uid: 'jdupont' });
    expect(rows[1].uid).toBe('amartin');
  });

  it('without header: each line is a name', () => {
    const rows = parseValidationList('DUPONT Jean\nMARTIN Alice');
    expect(rows.map((r) => r.name)).toEqual(['DUPONT Jean', 'MARTIN Alice']);
  });

  it('reads the status when present', () => {
    const rows = parseValidationList('nom;statut\nX Y;DEPART');
    expect(rows[0].status).toBe(Presence.DEPART);
  });
});

describe('computeValidationDiff', () => {
  const researchers = [
    { id: 'G-1', uid: 'jdupont', email: 'jean.dupont@x.fr', displayName: 'DUPONT Jean', presence: Presence.DEPART },
    { id: 'G-2', uid: 'amartin', email: 'alice@x.fr', displayName: 'MARTIN Alice', presence: Presence.PRESENT },
    { id: 'G-3', uid: '', email: '', displayName: 'MARTIN Alice', presence: Presence.PRESENT }, // homonyme
  ];
  const opts = { source: 'Liste Centrale', date: '2026-06-18', scope: ['statut', 'rattachement'] as const };

  it('apparie par uid et marque l’override', () => {
    const diff = computeValidationDiff(researchers, [{ raw: '', uid: 'jdupont' }], { ...opts, scope: [...opts.scope] });
    expect(diff.matched).toHaveLength(1);
    expect(diff.matched[0].researcherId).toBe('G-1');
    expect(diff.matched[0].matchedBy).toBe('uid');
    expect(diff.matched[0].newStatus).toBe(Presence.PRESENT);
    expect(diff.matched[0].overrides).toBe(true); // DEPART → PRESENT
  });

  it('matches by email when there is no uid', () => {
    const diff = computeValidationDiff(researchers, [{ raw: '', email: 'alice@x.fr' }], { ...opts, scope: [...opts.scope] });
    expect(diff.matched[0].researcherId).toBe('G-2');
    expect(diff.matched[0].matchedBy).toBe('email');
  });

  it('reports homonyms as ambiguous', () => {
    const diff = computeValidationDiff(researchers, [{ raw: '', name: 'Martin Alice' }], { ...opts, scope: [...opts.scope] });
    expect(diff.ambiguous).toHaveLength(1);
    expect(diff.ambiguous[0].candidateIds.sort()).toEqual(['G-2', 'G-3']);
  });

  it('not matched if not found', () => {
    const diff = computeValidationDiff(researchers, [{ raw: '', uid: 'inconnu' }], { ...opts, scope: [...opts.scope] });
    expect(diff.unmatched).toHaveLength(1);
  });

  it('respects the row status when provided', () => {
    const diff = computeValidationDiff(researchers, [{ raw: '', uid: 'jdupont', status: Presence.DEPART }], { ...opts, scope: [...opts.scope] });
    expect(diff.matched[0].newStatus).toBe(Presence.DEPART);
    expect(diff.matched[0].overrides).toBe(false);
  });
});

describe('nameKey', () => {
  it('insensitive to case/accents/order', () => {
    expect(nameKey('DUPONT Jean')).toBe(nameKey('jean dupont'));
    expect(nameKey('Géraldine É.')).toBe(nameKey('geraldine'));
  });
});
