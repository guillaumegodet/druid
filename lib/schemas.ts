import { z } from 'zod';
import { 
  ResearcherStatus, 
  StructureLevel, 
  StructureNature, 
  StructureStatus, 
  StructureMission, 
  LineageType,
  MEMBERSHIP_TYPES,
  MembershipType
} from '../types';

/**
 * @file schemas.ts
 * @description Zod validation schemas for the Grist data.
 * Guarantees data integrity at the application's entry point.
 */

// --- Researcher Schemas ---

export const AffiliationSchema = z.object({
  id: z.string().optional(),
  structureId: z.string().optional(),
  structureName: z.string().default(''),
  team: z.string().default(''),
  startDate: z.string().default(''),
  endDate: z.string().optional().nullable(),
  isPrimary: z.boolean().default(false),
  // Must be declared: z.object strips unknown keys, so a missing entry blanked the type on read
  // and every later save of the record wrote membership_type = null.
  membershipType: z.enum(MEMBERSHIP_TYPES as [MembershipType, ...MembershipType[]]).optional(),
  role: z.enum(['PRINCIPAL', 'SECONDAIRE', 'HISTORIQUE']).optional(),
  gristRowId: z.number().optional(),
});

export const EmploymentSchema = z.object({
  employer: z.string().default(''),
  contractType: z.string().optional().nullable(),
  grade: z.string().optional().nullable(),
  internalTypology: z.string().optional().nullable(),
  cnu: z.string().optional().nullable(),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  ldapFields: z.array(z.string()).optional().default([]),
});

export const NURelatedSchema = z.object({
  pole: z.string().optional().nullable(),
  composante: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  doctoralSchool: z.string().optional().nullable(),
  hdr: z.boolean().default(false),
  hdrYear: z.string().optional().nullable(),
});

export const ResearcherIdentifiersSchema = z.object({
  orcid: z.string().optional().nullable(),
  idref: z.string().optional().nullable(),
  halId: z.string().optional().nullable(),
  halIdNum: z.string().optional().nullable(),
  scopusId: z.string().optional().nullable(),
  researcherId: z.string().optional().nullable(),
  openalexId: z.string().optional().nullable(),
  openalexIds: z.string().optional().nullable(),
});

export const ValidationInfoSchema = z.object({
  validated: z.boolean().default(false),
  validatedStatus: z.nativeEnum(ResearcherStatus).optional(),
  validationDate: z.string().optional(),
  validationSource: z.string().optional(),
  validationScope: z.array(z.enum(['statut', 'rattachement'])).default([]),
  validatedBy: z.string().optional(),
});

export const ResearcherSchema = z.object({
  id: z.string(),
  uid: z.string().optional().nullable(),
  gristRowId: z.number().optional(),
  civility: z.string().default(''),
  lastName: z.string().default(''),
  firstName: z.string().default(''),
  birthName: z.string().optional().nullable(),
  birthDate: z.string().optional().nullable(),
  nationality: z.string().optional().nullable(),
  displayName: z.string().default(''),
  photoUrl: z.string().optional().nullable(),
  annuaireUrl: z.string().optional().nullable(),
  email: z.string().default(''),   // no .email(): 13 malformed addresses in Grist made the WHOLE list fail (2026-09-09)
  secondaryEmail: z.string().email().or(z.literal('')).optional().nullable(),
  phone: z.string().optional().nullable(),
  status: z.nativeEnum(ResearcherStatus).default(ResearcherStatus.EXTERNE),
  employment: EmploymentSchema,
  affiliations: z.array(AffiliationSchema).default([]),
  groups: z.array(z.string()).default([]),
  identifiers: ResearcherIdentifiersSchema,
  socials: z.object({
    bluesky: z.string().optional().nullable(),
    mastodon: z.string().optional().nullable(),
    youtube: z.string().optional().nullable(),
    podcast: z.string().optional().nullable(),
    blog: z.string().optional().nullable(),
    linkedin: z.string().optional().nullable(),
  }).optional(),
  profiles: z.object({
    cvInstitutionnel: z.string().optional().nullable(),
    cvSiteLabo: z.string().optional().nullable(),
    cvPdf: z.string().optional().nullable(),
    cvHal: z.string().optional().nullable(),
    academia: z.string().optional().nullable(),
    researchgate: z.string().optional().nullable(),
    googleScholar: z.string().optional().nullable(),
    website: z.string().optional().nullable(),
  }).optional(),
  nuFields: NURelatedSchema.optional(),
  ldapFields: z.array(z.string()).optional().default([]),
  lastSync: z.string().optional().nullable(),
  validation: ValidationInfoSchema.optional(),
});

// --- Structure Schemas ---

export const LineageLinkSchema = z.object({
  relatedStructureId: z.string(),
  relatedStructureName: z.string(),
  type: z.nativeEnum(LineageType),
  date: z.string(),
});

export const StructureIdentifiersSchema = z.object({
  halStructIds: z.array(z.string()).default([]),
  idrefId: z.string().optional().nullable(),
  scopusId: z.string().optional().nullable(),
  uai: z.string().optional().nullable(),
  isni: z.string().optional().nullable(),
  wikidata: z.string().optional().nullable(),
});

const MembershipSchema = z.object({
  refType: z.enum(['local', 'uai', 'ror']).default('local'),
  ref: z.string(),
  supervision: z.string().optional().nullable(),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
});

export const StructureSchema = z.object({
  id: z.string(),
  localId: z.string().optional().nullable(),
  level: z.nativeEnum(StructureLevel).default(StructureLevel.ENTITE),
  nature: z.nativeEnum(StructureNature).default(StructureNature.PUBLIC),
  type: z.string().default(''),
  acronym: z.string().default(''),
  officialName: z.string().default(''),
  description: z.string().optional().nullable(),
  cluster: z.string().optional().nullable(),
  parentStructure: z.string().optional().nullable(),
  code: z.string().default(''),
  rnsrId: z.string().default(''),
  rnestId: z.string().optional().nullable(),
  siren: z.string().optional().nullable(),
  status: z.nativeEnum(StructureStatus).default(StructureStatus.ACTIVE),
  historyLinks: z.array(LineageLinkSchema).default([]),
  creationDate: z.string().optional().nullable(),
  closeDate: z.string().optional().nullable(),
  primaryMission: z.nativeEnum(StructureMission).default(StructureMission.RECHERCHE),
  secondaryMission: z.nativeEnum(StructureMission).optional().nullable(),
  scientificDomains: z.array(z.string()).default([]),
  ercFields: z.array(z.string()).default([]),
  hceresDomain: z.string().optional().nullable(),
  evaluationWave: z.string().optional().nullable(),
  director: z.string().default(''),
  supervisors: z.array(z.string()).default([]),
  institutionCodes: z.string().optional().nullable(),
  structureParticipations: z.string().optional().nullable(),
  inclusions: z.array(MembershipSchema).default([]),
  participations: z.array(MembershipSchema).default([]),
  doctoralSchools: z.array(z.string()).default([]),
  address: z.string().default(''),
  zipCode: z.string().default(''),
  city: z.string().default(''),
  country: z.string().default('FR'),
  website: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  rorId: z.string().optional().nullable(),
  halCollectionUrl: z.string().optional().nullable(),
  identifiers: StructureIdentifiersSchema,
  signature: z.string().optional().nullable(),
  ercField: z.string().optional().nullable(),
  hceresAreas: z.string().optional().nullable(),
  campus: z.string().optional().nullable(),
  rawParticipations: z.string().optional().nullable(),
});

// List schemas (used when fetching from Grist)
export const ResearcherListSchema = z.array(ResearcherSchema);
export const StructureListSchema = z.array(StructureSchema);
