import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import { StructureLevel, StructureStatus, StructureMission, type SupervisionCode } from '../types';

/**
 * @file structureLabels.ts
 * @description Translatable labels shared by the Structures section
 * (levels, statuses, missions, supervision codes). Declared with `msg`
 * outside components, to be displayed via `t(label)`.
 */

/** Short level label (badges, subtitles). Key = enum value ('4'…'1'). */
export const LEVEL_LABELS: Record<string, MessageDescriptor> = {
  [StructureLevel.ETABLISSEMENT]: msg`Institution`,
  [StructureLevel.INTERMEDIAIRE]: msg`Intermediate str.`,
  [StructureLevel.ENTITE]: msg`Unit`,
  [StructureLevel.EQUIPE]: msg`Team`,
};

/** Long level label, with its number (filters, record). */
export const LEVEL_LONG_LABELS: Record<string, MessageDescriptor> = {
  [StructureLevel.ETABLISSEMENT]: msg`Institution (level 4)`,
  [StructureLevel.INTERMEDIAIRE]: msg`Intermediate structure (level 3)`,
  [StructureLevel.ENTITE]: msg`Unit (level 2)`,
  [StructureLevel.EQUIPE]: msg`Team (level 1)`,
};

export const STRUCTURE_STATUS_LABELS: Record<StructureStatus, MessageDescriptor> = {
  [StructureStatus.ACTIVE]: msg`Active`,
  [StructureStatus.PROJET]: msg`Planned`,
  [StructureStatus.EN_FERMETURE]: msg`Closing`,
  [StructureStatus.FERMEE]: msg({ message: `Closed`, context: "feminine" }),
};

export const MISSION_LABELS: Record<StructureMission, MessageDescriptor> = {
  [StructureMission.RECHERCHE]: msg`Research`,
  [StructureMission.SERVICES_SCIENTIFIQUES]: msg`Scientific services`,
  [StructureMission.SERVICES_ADMINISTRATIFS]: msg`Administrative services`,
};

export const SUPERVISION_LABELS: Record<SupervisionCode, MessageDescriptor> = {
  main_supervision: msg`Main supervision`,
  associated_supervision: msg`Associated supervision`,
  participating_supervision: msg`Participation`,
};
