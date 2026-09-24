import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import { ResearcherStatus } from '../types';
import type { ValidationScope } from './validation';

/**
 * @file researcherLabels.ts
 * @description Translatable labels shared by the Staff section
 * (statuses, validation scopes). Declared with `msg` outside components,
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
