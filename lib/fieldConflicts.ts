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
};
