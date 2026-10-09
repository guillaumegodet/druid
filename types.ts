/**
 * @file types.ts
 * @description Type and enum definitions for the Druid application.
 * Gathers the researcher, structure and administrative-management reference types.
 */

/** View states for the main navigation */
export enum ViewState {
  RESEARCHERS_LIST = 'RESEARCHERS_LIST',
  RESEARCHER_DETAIL = 'RESEARCHER_DETAIL',
  STRUCTURES_LIST = 'STRUCTURES_LIST',
  STRUCTURE_DETAIL = 'STRUCTURE_DETAIL',
  GROUPS_LIST = 'GROUPS_LIST',
  UNIFIED_ALIGN = 'UNIFIED_ALIGN',
  /** Two-tab LDAP alignment (search missing / verify existing) — formerly LDAP_CANDIDATES. */
  LDAP_ALIGN = 'LDAP_ALIGN',
  /** « À traiter » section of the Staff tab: uid_dyna duplicates + tasks to carry out outside
   * Druid (?tab=doublons|taches). Replaces DUPLICATES (legacy URL redirected in App.tsx). */
  TASKS = 'TASKS',
  DASHBOARD = 'DASHBOARD',
  /** « Mes rapports » (docs/plan-mes-rapports.md); ?id=<n> opens a report in the editor. */
  REPORTS = 'REPORTS',
  ADMIN = 'ADMIN',
}

// Reliability layer (manually validated status/affiliation).
// Type-only import → erased at compile time, no runtime cycle.
import type { ValidationInfo } from './lib/validation';

/** Administrative statuses of a research staff member */
export enum ResearcherStatus {
  INTERNE = 'INTERNE',   // Verified and active identity
  DEPART = 'DEPART',     // Staff who left the institution
  PARTI = 'PARTI',       // Gone / confirmed inactive (employment end passed, gone from LDAP, retiree without emeritus status…)
  EXTERNE = 'EXTERNE',   // No ID or not found in the directory
}

/** Presence in the unit — with the employer and the LDAP account, replaces ResearcherStatus
 * (lib/presence.ts, docs/plan-statut-employeur-ldap.md). Also the values of `validated_status`. */
export enum Presence {
  PRESENT = 'PRESENT',
  DEPART = 'DEPART',   // end announced: LDAP account closing, or employment end within DEPARTURE_NOTICE_MONTHS
  PARTI = 'PARTI',
}

/** Institution LDAP account of a record: active, closing (dynaEtat D) or none. */
export type LdapAccountState = 'active' | 'closing' | 'none';
/** Employer axis: the home institution, another one, or not filled in. */
export type EmployerKind = 'home' | 'external' | 'unknown';

/** Represents a past or current link with a structure */
export interface Affiliation {
  id?: string;
  structureId?: string;    // Internal Druid reference
  structureName: string;   // Displayed name (e.g. LS2N)
  team: string;            // Team within the structure
  startDate: string;       // YYYY-MM-DD
  endDate?: string;        // YYYY-MM-DD (optional when active)
  isPrimary: boolean;      // Defines the primary membership used for signatures
  /** Lab membership type, cdb/CRISalid vocabulary (Grist column `membership_type`):
   *  statutory, associate, secondary, visitor. Exported as is in people.csv. */
  membershipType?: MembershipType;
  /** Grist qualification (column `rattachement`) when the person has several Annuaire rows:
   *  PRINCIPAL (row carried by the record), SECONDAIRE (concurrent), HISTORIQUE (successive, ended). */
  role?: AffiliationRole;
  /** Original Annuaire row of this membership (multiple rows grouped by uid). */
  gristRowId?: number;
}

export type AffiliationRole = 'PRINCIPAL' | 'SECONDAIRE' | 'HISTORIQUE';

/** Membership types of cdb's people.csv format (convert_spreadsheet_people.VALID_MEMBERSHIP_TYPES). */
export type MembershipType = 'stat_mmb' | 'assoc_mmb' | 'second_mmb' | 'visit_mmb';
export const MEMBERSHIP_TYPES: MembershipType[] = ['stat_mmb', 'assoc_mmb', 'second_mmb', 'visit_mmb'];

/** Information about the employment contract and grade */
export interface Employment {
  employer: string;        // Paying institution (e.g. Université, CNRS)
  institutionId?: string;  // UAI code of the paying institution
  contractType?: string;   // Tenured, contract staff, etc.
  /** Employment type as stored in the directory (Grist `TYPE_EMPLOI`), before the LDAP category that `contractType`
   * shows: druid-biblio classifies its staff on these codes (EC_aut, Ch_aut, AP_aut…). Read-only, never written. */
  employmentTypeCode?: string;
  grade?: string;          // Corps / grade (e.g. PU, MCF, DR, CR)
  internalTypology?: string; // Internal category (researcher, teacher-researcher, PhD student)
  cnu?: string;            // Section of the Conseil National des Universités
  startDate?: string;
  endDate?: string;
  fte?: number | null;         // Overall FTE (« quotité agent »), 0-1; null = not provided (lib/fte.ts)
  researchFte?: number | null; // Research FTE, 0-1; null = not provided, 0 = no research time
  ldapFields?: string[];   // Fields whose value comes from LDAP (not editable in the app)
}

/** Nantes Université-specific information from Grist */
export interface NURelated {
  pole?: string | null;    // Affiliated pole
  composante?: string;     // Affiliated faculty (composante)
  location?: string;       // Main site
  doctoralSchool?: string; // Affiliated doctoral school (ED)
  hdr?: boolean;           // HDR (habilitation to supervise research)
  hdrYear?: string;        // HDR year
}

/** Main object representing a researcher or support staff member */
export interface Researcher {
  id: string;              // Public/central identifier = uid (uid_dyna) when present, else ext_<name>-<initial>. URL key.
  uid?: string;            // Institution staff number / LDAP uid_dyna (empty outside the directory). people.csv pivot.
  hrId?: string;           // HR staff number (Mangue n° agent, LDAP supannEmpId) — read-only, see lib/hrId.ts.
  gristRowId?: number;     // Grist row number (technical) — required to write (PATCH by rowId). Never in the URL.

  // Civil status
  civility: string;        // M., Mme, Dr, Pr
  lastName: string;        // Usual last name
  firstName: string;       // First name
  birthName?: string;      // Family / birth name
  birthDate?: string;      // YYYY-MM-DD
  nationality?: string;
  
  displayName: string;     // Name formatted for lists (e.g. "DUPONT Jean")
  photoUrl?: string;       // Photo URL (scraped from the lab website → Grist photo_url)
  annuaireUrl?: string;    // Link to the directory page on the website (Grist annuaire_url)

  // Contact details
  email: string;
  eppn?: string;           // LDAP eduPersonPrincipalName (for the SoVisu+ export)
  secondaryEmail?: string;
  phone?: string;
  
  status: ResearcherStatus;
  /** Status derived from the sources (LDAP / dates), BEFORE the validation layer — used to flag a conflict. */
  derivedStatus?: ResearcherStatus;
  /** Three axes replacing `status` (lib/presence.ts, docs/plan-statut-employeur-ldap.md). `status` is
   * kept, computed from them, until every screen has moved. */
  presence?: Presence;
  /** Presence before the validation layer (conflict badge). */
  derivedPresence?: Presence;
  ldapAccount?: LdapAccountState;
  employerKind?: EmployerKind;
  employment: Employment;
  affiliations: Affiliation[]; 
  
  groups: string[];        // Functional groups (e.g. "Conseil Scientifique")

  /** Pivot identifiers for interoperability */
  identifiers: {
    orcid?: string;        // International researcher ID
    idref?: string;        // ABES authority ID
    halId?: string;        // HAL author form ID
    halIdNum?: string;     // Numeric HAL idHal_i (Grist column IdHAL_i → `idhali` in people.csv for CRISalid)
    scopusId?: string;     // Elsevier ID
    researcherId?: string; // Web of Science ID
    openalexId?: string;   // OpenAlex author ID (resolved via ORCID or confirmed by hand)
    openalexIds?: string;  // Reviewed list of OpenAlex A-ids, pipe-separated (Grist column OpenAlex_ids → `openalex` in people.csv)
  };
  /** Declared public social media accounts (media monitoring) — editable
   *  here, persisted in the Grist Annuaire (columns Bluesky/Mastodon/YouTube/
   *  Podcast_flux/Blog/LinkedIn). Tracked by media_watch within the GDPR framework. */
  socials?: {
    bluesky?: string;
    mastodon?: string;
    youtube?: string;
    podcast?: string;
    blog?: string;
    linkedin?: string;
  };
  /** Public academic profiles & CVs (Grist Annuaire columns), editable here:
   *  institutional CV / lab website / PDF / HAL, Academia, ResearchGate,
   *  Google Scholar, personal website. */
  profiles?: {
    cvInstitutionnel?: string;
    cvSiteLabo?: string;
    cvPdf?: string;
    cvHal?: string;
    academia?: string;
    researchgate?: string;
    googleScholar?: string;
    website?: string;
  };
  nuFields?: NURelated;    // Nantes Université-specific fields
  ldapFields?: string[];   // Root fields whose value comes from LDAP (not editable)
  lastSync?: string;       // Date of the last update from an external source
  validation?: ValidationInfo; // Manual reliability layer (takes precedence over the derived status)
  /** Set by « Fill from LDAP » on a record being created (lib/ldapPerson.ts): createResearcher then
   *  writes the LDAP traceability (statut_dyna, Data_source, LDAP_derniere_maj). Never read from Grist. */
  ldapPrefill?: { etat: string; date: string };
}

/** Cross-cutting functional group (members = column `groupes` of the Grist Annuaire) */
export interface Group {
  name: string;
  description?: string;
}

/** Structure levels compliant with the national framework (RNSR) */
export enum StructureLevel {
  ETABLISSEMENT = '4', // Legal entity (e.g. university)
  INTERMEDIAIRE = '3', // Grouping (faculty, department, pole)
  ENTITE = '2',               // Research unit (e.g. UMR)
  EQUIPE = '1',               // Internal research team
}

/** Lifecycle status of a structure */
export enum StructureStatus {
  PROJET = 'PROJET',               // Before official administrative creation
  ACTIVE = 'ACTIVE',               // Existing structure (requires a director)
  EN_FERMETURE = 'EN_FERMETURE',   // Transition period
  FERMEE = 'FERMEE',               // Historical structure
}

/** Legal nature of the structure */
export enum StructureNature {
  PUBLIC = 'PUBLIC',
  PRIVE = 'PRIVE',
  MIXTE = 'MIXTE',
}

/** Main mission carried out */
export enum StructureMission {
  RECHERCHE = 'RECHERCHE',
  SERVICES_SCIENTIFIQUES = 'SERVICES_SCIENTIFIQUES',
  SERVICES_ADMINISTRATIFS = 'SERVICES_ADMINISTRATIFS',
}

/** Lineage event types */
export enum LineageType {
  SUCCESSION = 'SUCCESSION', // A is replaced by B
  INTEGRATION = 'INTEGRATION', // B is absorbed by A
  FUSION = 'FUSION',         // A and B become C
  SCISSION = 'SCISSION',       // A becomes B and C
}

/** Lineage link between two structures */
export interface LineageLink {
  relatedStructureId: string;
  relatedStructureName: string;
  type: LineageType;
  date: string;
}

/** Nature of a membership reference */
export type MembershipRefType =
  | 'local'  // structure/institution of the database, ref `local-<local_id>`
  | 'uai'    // external institution by UAI code, ref `uai-<code>`
  | 'ror';   // external institution by ROR identifier, ref `ror-<code>`

/** Participation type code (supervision) — for participations only */
export type SupervisionCode =
  | 'main_supervision'         // main supervising institution
  | 'associated_supervision'   // associated supervising institution
  | 'participating_supervision'; // plain participation

/**
 * A membership of a structure (inclusion OR participation).
 * The kind (inclusion/participation) is carried by the containing array
 * (`Structure.inclusions` / `Structure.participations`), not by the object.
 * Serialized in the V2 columns `inclusions`/`participations`:
 *   `<refType>-<ref>[<supervision>]?[<YYYYMMDD>-<YYYYMMDD>?]`
 */
export interface Membership {
  refType: MembershipRefType;
  ref: string;                       // local_id, UAI or ROR code (without prefix)
  supervision?: SupervisionCode | ''; // relevant for institution participations
  startDate?: string;                // YYYY-MM-DD
  endDate?: string;                  // YYYY-MM-DD (empty = open-ended)
}

/** Main object representing a research structure */
export interface Structure {
  id: string;
  localId?: string;         // Source reference identifier (V2 local_id = supannCodeEntite) → Neo4j uid local-<localId>. The only pivot identifier of structures.
  
  // Identification
  level: StructureLevel;
  nature: StructureNature;
  type: string;             // Label (e.g. UMR, EA, ERL)
  acronym: string; 
  officialName: string; 
  description?: string;
  cluster?: string;         // Affiliated pole or faculty
  parentStructure?: string; // Parent lab (acronym) — for teams (level 1)
  structureParticipations?: string; // Participations (weak membership) in other research structures: local_id separated by « | » (e.g. lab → pole)
  inclusions?: Membership[];        // Inclusions (strong membership): V2 column `inclusions`
  participations?: Membership[];    // Participations (supervising institutions + weak membership): V2 column `participations`

  code: string;             // Unit number (e.g. 7020)
  rnsrId: string;           // National identifier (RNSR)
  rnestId?: string;         // Specific identifier (RNest)
  siren?: string;           // Institution only

  // Lifecycle
  status: StructureStatus;
  historyLinks: LineageLink[];
  creationDate?: string;
  closeDate?: string;

  // Missions & Classification
  primaryMission: StructureMission;
  secondaryMission?: StructureMission;
  scientificDomains: string[]; // e.g. "Informatique"
  ercFields: string[];        // ERC panels (e.g. PE6_1)
  hceresDomain?: string;      // HCERES domain
  evaluationWave?: string;    // Wave A, B, C...

  // Governance
  director: string;           // Name of the head
  supervisors: string[];      // Supervising institutions (Université, CNRS...)
  institutionCodes?: string;  // UAI codes of the supervising institutions
  doctoralSchools: string[];  // Affiliated doctoral schools

  // Location
  address: string;
  zipCode: string;
  city: string;
  country: string;
  website?: string;
  socials?: {
    twitter?: string;
    linkedin?: string;
    facebook?: string;
  };
  email?: string;
  phone?: string;
  
  // Third-party identifiers
  rorId?: string;             // Research Organization Registry
  halCollectionUrl?: string;  // Link to the HAL portal (V2: hal_collection)
  identifiers: {
    halStructIds?: string[];  // HAL structure IDs
    idrefId?: string;
    scopusId?: string;
    uai?: string;             // UAI code (V2: uai)
    isni?: string;            // International Standard Name Identifier (V2: isni)
    wikidata?: string;        // Wikidata identifier (V2: wikidata)
  };
  signature?: string;         // Bibliographic signature template

  // Topics & affiliation (V2)
  ercField?: string;          // Main ERC panel (V2: erc_research_field)
  hceresAreas?: string;       // HCÉRES research areas (V2: hceres_research_areas)
  campus?: string;            // Affiliated campus (V2: campus)

  /** Raw value of the V2 field `participations` (kept for writing when supervising institutions are unchanged) */
  rawParticipations?: string;
}

/** Option for the synchronization menus */
export interface SyncOption {
  id: string;
  label: string;
  icon?: string;
}

/** Comparison structure for bidirectional updates */
export interface ComparisonField {
  key: string;
  label: string;
  localValue: string | null;
  remoteValue: string | null;
}
