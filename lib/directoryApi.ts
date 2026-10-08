// Browser client of the directory domain API (/api/v1, druid-internal docs/plan-migration-postgresql.md,
// lot 1). The server reads the storage (Grist today, PostgreSQL later for the directory), maps it to the
// Druid model and keeps only what the user's rights allow: the browser no longer reads the raw rows.
import { t } from '@lingui/core/macro';
import type { Researcher, Structure } from '../types';
import type { ValidationInfo } from './validation';
import type { AnnuaireColumnMeta } from './directory/annuaireWrite';
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

/** Write request (JSON body); an error answer throws its `error` text, translated by apiErrorText. */
async function send<T>(method: 'POST' | 'PUT' | 'PATCH', path: string, body: unknown): Promise<T> {
  const resp = await fetch(`${DIRECTORY_API_BASE}/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await resp.json().catch(() => null);
  const resource = path.split(/[/?]/)[0];
  if (!resp.ok) throw new Error(payload?.error || t`Directory unavailable (${resource}, HTTP ${resp.status}).`);
  return payload as T;
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
  annuaireColumns: (): Promise<AnnuaireColumnMeta[]> => fetchItems<AnnuaireColumnMeta>('people/columns'),
  /** Labs of the directory rows already carrying this uid (within the user's labs). */
  labsOfUid: (uid: string): Promise<string[]> => fetchItems<string>(`people/uid/${encodeURIComponent(uid)}/labs`),

  // ── Writes (lot 2 a) ───────────────────────────────────────────────────
  createPerson: (researcher: Researcher): Promise<{ recordId: number }> => send('POST', 'people', researcher),
  updatePerson: (recordId: number, researcher: Researcher): Promise<unknown> => send('PUT', `people/${recordId}`, researcher),
  setGroups: (entries: { recordId: number; groups: string[] }[]): Promise<unknown> => send('PATCH', 'people/groups', { entries }),
  setOpenalexId: (recordId: number, openalexId: string): Promise<unknown> =>
    send('PATCH', `people/${recordId}/openalex-id`, { openalexId }),
  applyValidations: (entries: { recordId: number; validation: ValidationInfo }[]): Promise<unknown> =>
    send('POST', 'people/validations', { entries }),
  markAbesSent: async (entries: { recordId: number; hash: string }[], date: string): Promise<number> =>
    (await send<{ updated: number }>('POST', 'abes-exports', { entries, date })).updated,
  createStructure: async (structure: Structure): Promise<string> => (await send<{ id: string }>('POST', 'structures', structure)).id,
  updateStructure: (recordId: number, structure: Structure): Promise<unknown> => send('PUT', `structures/${recordId}`, structure),
};
