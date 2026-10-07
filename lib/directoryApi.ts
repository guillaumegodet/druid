// Browser client of the directory domain API (/api/v1, druid-internal docs/plan-migration-postgresql.md,
// lot 1). The server reads the storage (Grist today, PostgreSQL later for the directory), maps it to the
// Druid model and keeps only what the user's rights allow: the browser no longer reads the raw rows.
import { t } from '@lingui/core/macro';
import type { Researcher, Structure } from '../types';
import type { AbesExportMark, Institution, MergeLogEntry } from './directory/gristMapping';
import type { NewsletterItem } from './publications/newsletter';
import type { AxisCorrectionRow } from './publications/axes';

export const DIRECTORY_API_BASE = '/api/v1';

/** `GET /api/v1/<path>` → its `items` (envelope `{ items, updatedAt? }`). Throws on an HTTP error. */
async function fetchItems<T>(path: string): Promise<T[]> {
  const resp = await fetch(`${DIRECTORY_API_BASE}/${path}`, { headers: { Accept: 'application/json' } });
  const resource = path.split(/[/?]/)[0];
  if (!resp.ok) throw new Error(t`Directory unavailable (${resource}, HTTP ${resp.status}).`);
  const body = await resp.json();
  return Array.isArray(body?.items) ? body.items : [];
}

export const DirectoryApi = {
  people: (): Promise<Researcher[]> => fetchItems<Researcher>('people'),
  structures: (): Promise<Structure[]> => fetchItems<Structure>('structures'),
  institutions: (): Promise<Institution[]> => fetchItems<Institution>('institutions'),
  abesExports: (): Promise<AbesExportMark[]> => fetchItems<AbesExportMark>('abes-exports'),
  merges: (limit: number): Promise<MergeLogEntry[]> => fetchItems<MergeLogEntry>(`merges?limit=${limit}`),
  newsletter: (slug: string): Promise<NewsletterItem[]> =>
    fetchItems<NewsletterItem>(`newsletter?slug=${encodeURIComponent(slug)}`),
  axisCorrections: (slug: string): Promise<AxisCorrectionRow[]> =>
    fetchItems<AxisCorrectionRow>(`axis-corrections/${encodeURIComponent(slug)}`),
};
