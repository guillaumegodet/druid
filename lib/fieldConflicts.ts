/**
 * « To process › Source conflicts » (druid-internal `docs/plan-maj-chercheurs.md`, lot 2 d): client of the
 * /api/field-conflicts routes (server.cjs) and the labels of the sources of the fields merged by source.
 */
import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import { translateApiError } from './apiErrors';

export interface FieldConflict {
  personId: string;
  recordId: number | null;
  uid: string;
  name: string;
  labs: string[];
  /** birth_date | corps_grade */
  field: string;
  value: string | null;
  correctedBy: string | null;
  correctedAt: string | null;
  conflicts: { source: string; value: string; observedAt: string; kind: 'changed_since_manual' | 'new_since_manual' | string }[];
}

export type FieldConflictAction = 'keep' | 'drop' | 'correct';

/** A file or site import and the values it still brings (case 19 of the plan). */
export interface FieldImport {
  id: string;
  source: string;
  label: string | null;
  createdAt: string;
  createdBy: string | null;
  values: number;
  persons: number;
  undoneAt: string | null;
  undoneBy: string | null;
}

/** Readable name of a source (fallback: its code). */
export const SOURCE_LABELS: Record<string, MessageDescriptor> = {
  manual: msg`Corrected`,
  ldap: msg`LDAP`,
  hr_file: msg`HR file`,
  lab_file: msg`Lab file`,
  site: msg`Lab website`,
  partner_directory: msg`Partner directory`,
  legacy: msg`Before tracking`,
  merged_record: msg`Merged record`,
};

export const MERGED_FIELD_LABELS: Record<string, MessageDescriptor> = {
  birth_date: msg`Date of birth`,
  corps_grade: msg`Grade`,
  civility: msg`Title`,
  employment_type: msg`Employment type`,
  employer_id: msg`Employer`,
  employment_start: msg`Employment start`,
  employment_end: msg`Employment end`,
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(translateApiError(String((data as { error?: unknown }).error || '')) || `HTTP ${resp.status}`);
  return data as T;
}

export const FieldConflictsApi = {
  list: () => request<{ available: boolean; items: FieldConflict[] }>('/api/field-conflicts'),
  resolve: (personId: string, field: string, action: FieldConflictAction, value?: string) =>
    request<{ ok: true }>('/api/field-conflicts/resolve', { method: 'POST', body: JSON.stringify({ personId, field, action, value }) }),
  imports: () => request<{ available: boolean; items: FieldImport[] }>('/api/field-imports'),
  undoImport: (id: string) => request<{ values: number; persons: number }>(`/api/field-imports/${encodeURIComponent(id)}/undo`, { method: 'POST' }),
};
