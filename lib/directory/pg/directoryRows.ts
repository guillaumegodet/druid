// PostgreSQL people and memberships → directory rows (lib/directory/people.ts), druid-internal
// docs/plan-migration-postgresql.md, lot 6 a. One row per membership, the person fields repeated on each (as the
// Grist Annuaire did), so that the business rules — grouping of qualified multi-row people included — give the
// same researchers on both stores. Values the import could not normalize are read back from `extra`, where it kept
// them under their Grist column id (lib/migration/gristToPg.ts). Pure.
import { MEMBERSHIP_TYPES, MembershipType } from '../../../types';
import { fromGristDate, fromGristFuzzyDate } from '../gristMapping';
import { normalizeHrId } from '../../hrId';
import { parseFteCell } from '../../fte';
import { validationInfo } from '../../validation';
import type { DirectoryRow, EmployerIndex, RattachementRole } from '../people';

/** Columns of the PostgreSQL rows the adapter reads (selected by the repository). */
export interface PgPerson {
  id: string; uid: string | null; last_name: string; first_name: string | null; civility: string | null;
  email: string | null; nationality: string | null; birth_date: string | null; corps_grade: string | null;
  employment_type: string | null; employment_type_label: string | null; hdr: string | null; hdr_year: number | null;
  employer_id: string | number | null; employment_start: string | null; employment_end: string | null;
  hr_id: string | null; fte_ratio: string | number | null; fte_research: string | number | null;
  photo_url: string | null; directory_url: string | null; presence_validated: boolean; presence_status: string | null;
  presence_validated_on: string | null; presence_validation_source: string | null; presence_validation_scope: string[];
  presence_validated_by: string | null; extra: Record<string, any>; legacy_grist_id: number | null;
}
export interface PgMembership {
  id: string | number; person_id: string; lab_label: string | null; type: string | null; role: string | null;
  start_date: string | null; end_date: string | null; team_labels: string[];
}
export interface PgIdentifier { person_id: string; scheme: string; value: string; is_primary: boolean; source: string | null }
export interface PgLink { person_id: string; kind: string; url: string }

const has = (o: Record<string, any>, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Identifiers and links of one person, as the record shows them. */
export interface PersonExtras {
  identifiers: PgIdentifier[];
  scopusAbsent: boolean;
  links: PgLink[];
}

const LINK_FIELDS = {
  socials: { youtube: ['youtube', 'YouTube'], podcast: ['podcast_flux', 'Podcast_flux'], blog: ['blog', 'Blog'], linkedin: ['linkedin', 'LinkedIn'] },
  profiles: {
    cvInstitutionnel: ['cv_institutionnel', 'CV_institutionnel'], cvSiteLabo: ['cv_site_labo', 'CV_site_labo'], cvPdf: ['cv_pdf_docx', 'CV_pdf_docx_'],
    cvHal: ['cv_hal', 'CV_HAL'], academia: ['academia', 'Academia'], researchgate: ['researchgate', 'Researchgate'],
    googleScholar: ['profil_gs', 'Profil_GS'], website: ['site_web', 'Site_web'],
  },
} as const;

export const pgDirectoryRow = (p: PgPerson, m: PgMembership, x: PersonExtras): DirectoryRow => {
  const e = p.extra || {};
  const ids = x.identifiers;
  // Primary value of a scheme (the kept Grist row's), '' when none.
  const primary = (scheme: string) => ids.find((i) => i.scheme === scheme && i.is_primary)?.value ?? '';
  const linkOf = (kind: string, column: string) => (has(e, column) ? String(e[column] ?? '')
    : x.links.filter((l) => l.kind === kind).map((l) => l.url).join('; '));
  const socials = Object.fromEntries(Object.entries(LINK_FIELDS.socials).map(([k, [kind, col]]) => [k, linkOf(kind, col)]));
  const profiles = Object.fromEntries(Object.entries(LINK_FIELDS.profiles).map(([k, [kind, col]]) => [k, linkOf(kind, col)]));
  const rowId = Number(m.id);
  const raw = (column: string) => e[`${column}@G-${rowId}`];
  const role = has(e, `rattachement@G-${rowId}`) ? String(raw('rattachement')).trim().toUpperCase() : (m.role ?? '');
  const employer = p.employer_id !== null ? Number(p.employer_id) : (has(e, 'Employeur') ? e.Employeur : null);
  return {
    rowId,
    uid: p.uid ?? '',
    lastName: p.last_name,
    firstName: p.first_name ?? '',
    civility: has(e, 'Civilite') ? String(e.Civilite) : (p.civility ?? ''),
    email: p.email ?? '',
    nationality: p.nationality ?? '',
    photoUrl: p.photo_url ?? '',
    annuaireUrl: p.directory_url ?? '',
    birthDate: p.birth_date ?? fromGristDate(e.DATE_DE_NAISSANCE_JJ_MM_AAAA),
    corpsGrade: p.corps_grade,
    employmentType: p.employment_type,
    employmentTypeLabel: p.employment_type_label,
    // A label typed in place of a reference is what the record shows (kept by the import even when resolved).
    employer: has(e, 'Employeur') && typeof e.Employeur === 'string' ? e.Employeur : employer,
    employmentStart: p.employment_start ?? fromGristFuzzyDate(e.employment_start_date),
    employmentEnd: p.employment_end ?? fromGristFuzzyDate(e.employment_end_date),
    hrId: normalizeHrId(p.hr_id),
    fte: parseFteCell(p.fte_ratio),
    researchFte: parseFteCell(p.fte_research),
    validation: validationInfo({
      validated: p.presence_validated, status: p.presence_status ?? e.validated_status,
      date: p.presence_validated_on ?? fromGristDate(e.validation_date), source: p.presence_validation_source,
      scope: (p.presence_validation_scope || []) as any, by: p.presence_validated_by,
    }),
    validatedStatus: p.presence_status ?? e.validated_status,
    lab: m.lab_label ?? '',
    team: (m.team_labels || []).join('|'),
    membershipStart: m.start_date ?? fromGristFuzzyDate(raw('affiliation_start_date')),
    membershipEnd: m.end_date ?? fromGristFuzzyDate(raw('affiliation_end_date')),
    membershipType: (MEMBERSHIP_TYPES as string[]).includes(String(m.type || '')) ? (m.type as MembershipType) : undefined,
    role: role as RattachementRole | '',
    groups: String(e.groupes || '').split('|').map((g) => g.trim()).filter(Boolean),
    identifiers: {
      orcid: primary('orcid'),
      idref: primary('idref'),
      halId: primary('idhal'),
      halIdNum: primary('idhal_i'),
      scopusId: has(e, 'ID_SCOPUS') ? String(e.ID_SCOPUS) : (primary('scopus') || (x.scopusAbsent ? 'absent' : '')),
      openalexId: ids.find((i) => i.scheme === 'openalex' && i.source === 'grist:openalex_author_id')?.value ?? '',
      openalexIds: has(e, 'OpenAlex_ids') ? String(e.OpenAlex_ids)
        : ids.filter((i) => i.scheme === 'openalex' && i.source !== 'grist:openalex_author_id').map((i) => i.value).join('|'),
    },
    socials: { bluesky: primary('bluesky'), mastodon: primary('mastodon'), ...socials } as DirectoryRow['socials'],
    profiles: profiles as DirectoryRow['profiles'],
    hdr: p.hdr ?? '',
    hdrYear: has(e, 'ANNEE_HDR') ? e.ANNEE_HDR : (p.hdr_year !== null ? String(p.hdr_year) : ''),
  };
};

/** Institutions → employer index of the rules (name and UAI by id). */
export const pgEmployerIndex = (rows: { id: string | number; name: string; uai: string | null; extra: Record<string, any> }[]): EmployerIndex =>
  new Map(rows.map((r) => [Number(r.id), { name: r.name, uai: r.uai ?? String(r.extra?.UAI ?? '') }]));
