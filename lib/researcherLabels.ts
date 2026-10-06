import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import { ResearcherStatus, type MembershipType } from '../types';
import type { ValidationScope } from './validation';

/**
 * @file researcherLabels.ts
 * @description Translatable labels shared by the Staff section
 * (statuses, validation scopes, membership types). Declared with `msg` outside components,
 * to be displayed via `i18n._(label)` or `t(label)`.
 */

export const STATUS_LABELS: Record<ResearcherStatus, MessageDescriptor> = {
  [ResearcherStatus.INTERNE]: msg`Internal`,
  [ResearcherStatus.DEPART]: msg`Leaving`,
  [ResearcherStatus.PARTI]: msg`Left`,
  [ResearcherStatus.EXTERNE]: msg`External`,
};

export const VALIDATION_SCOPE_LABELS: Record<ValidationScope, MessageDescriptor> = {
  statut: msg`status`,
  rattachement: msg`affiliation`,
};

/** Labels of the cdb membership types (CRISalid vocabulary, exported as is in people.csv). */
export const MEMBERSHIP_LABELS: Record<MembershipType, MessageDescriptor> = {
  stat_mmb: msg`Statutory member`,
  assoc_mmb: msg`Associate member`,
  second_mmb: msg`Secondary affiliation`,
  visit_mmb: msg`Visiting member`,
};
