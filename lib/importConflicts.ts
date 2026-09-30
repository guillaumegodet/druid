/**
 * « À traiter › Conflits annuaire <source> »: client of the /api/import-conflicts routes
 * (server.cjs, scripts/lib/import_conflicts.cjs). One Grist table `Arbitrage_<Source>…` per
 * directory import; each row is one Annuaire cell where the import and the current value disagree.
 */
import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import { translateApiError } from './apiErrors';

export interface ConflictTable {
  id: string;
  /** Label derived from the table name (`Arbitrage_Centrale_2026_09` → `Centrale`). */
  source: string;
  open: number;
}

export type ConflictFamily = 'RH' | 'Identifiant' | 'Lien' | '';

export interface ImportConflict {
  id: number;
  /** Annuaire row id. */
  record: number;
  uid: string;
  person: string;
  lab: string;
  family: ConflictFamily;
  /** Annuaire column id. */
  field: string;
  /** Live Annuaire value (display form). */
  current: string;
  imported: string;
  remark: string;
  /** The Annuaire value was edited after the import. */
  changedSinceImport: boolean;
}

export type ConflictChoice = 'import' | 'current' | 'other';
export interface ConflictDecision { id: number; choice: ConflictChoice; value?: string }

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(translateApiError(String((data as { error?: unknown }).error || '')) || `HTTP ${resp.status}`);
  return data as T;
}

export const ImportConflictsApi = {
  tables: () => request<{ tables: ConflictTable[] }>('/api/import-conflicts').then((d) => d.tables),
  list: (table: string) =>
    request<{ source: string; conflicts: ImportConflict[] }>(`/api/import-conflicts/${encodeURIComponent(table)}`),
  resolve: (table: string, decisions: ConflictDecision[]) =>
    request<{ resolved: number; updatedRecords: number }>(`/api/import-conflicts/${encodeURIComponent(table)}/resolve`, {
      method: 'POST', body: JSON.stringify({ decisions }),
    }),
};

/** Server limit per resolve call. */
export const RESOLVE_BATCH = 500;

/** Readable labels of the Annuaire columns that imports usually touch (fallback: column id). */
export const FIELD_LABELS: Record<string, MessageDescriptor> = {
  Civilite: msg`Title`,
  Corps_grade: msg`Grade`,
  TYPE_EMPLOI: msg`Employment type`,
  DATE_DE_NAISSANCE_JJ_MM_AAAA: msg`Date of birth`,
  Nationalite: msg`Nationality`,
  HDR: msg`HDR`,
  ANNEE_HDR: msg`HDR year`,
  Email: msg`Email`,
  ED_de_rattachement: msg`Doctoral school`,
  employment_start_date: msg`Employment start`,
  employment_end_date: msg`Employment end`,
  Employeur: msg`Employer`,
  team: msg`Team`,
  LABO: msg`Lab`,
  campus: msg`Campus`,
  membership_type: msg`Membership type`,
  affiliation_start_date: msg`Affiliation start`,
  affiliation_end_date: msg`Affiliation end`,
  ORCID: msg`ORCID`,
  IdRef: msg`IdRef`,
  IdHAL: msg`IdHAL`,
  IdHAL_i: msg`IdHAL (numeric)`,
  ID_SCOPUS: msg`Scopus Author ID`,
  OpenAlex_ids: msg`OpenAlex ids`,
  openalex_author_id: msg`OpenAlex author`,
  uid_dyna: msg`uid_dyna`,
  annuaire_url: msg`Directory page`,
  photo_url: msg`Photo`,
  Profil_GS: msg`Google Scholar`,
  LinkedIn: msg`LinkedIn`,
  Researchgate: msg`ResearchGate`,
};

export const FAMILY_LABELS: Record<Exclude<ConflictFamily, ''>, MessageDescriptor> = {
  RH: msg`HR`,
  Identifiant: msg`Identifiers`,
  Lien: msg`Links`,
};

/** Placeholder of the « other value » input, by column. */
export const isDateField = (field: string): boolean => field === 'DATE_DE_NAISSANCE_JJ_MM_AAAA';
