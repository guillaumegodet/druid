// Browser client of the directory domain API (/api/v1, druid-internal docs/plan-migration-postgresql.md,
// lot 1). The server reads the storage (Grist today, PostgreSQL later), maps it to the Druid model and
// keeps only what the user's rights allow: the browser no longer reads the raw Annuaire / Structures rows.
import { t } from '@lingui/core/macro';
import type { Researcher, Structure } from '../types';
import type { Institution } from './directory/gristMapping';

export const DIRECTORY_API_BASE = '/api/v1';

/** `GET /api/v1/<resource>` → its `items` (envelope `{ items, updatedAt }`). Throws on an HTTP error. */
async function fetchItems<T>(resource: string): Promise<T[]> {
  const resp = await fetch(`${DIRECTORY_API_BASE}/${resource}`, { headers: { Accept: 'application/json' } });
  if (!resp.ok) throw new Error(t`Directory unavailable (${resource}, HTTP ${resp.status}).`);
  const body = await resp.json();
  return Array.isArray(body?.items) ? body.items : [];
}

export const DirectoryApi = {
  people: (): Promise<Researcher[]> => fetchItems<Researcher>('people'),
  structures: (): Promise<Structure[]> => fetchItems<Structure>('structures'),
  institutions: (): Promise<Institution[]> => fetchItems<Institution>('institutions'),
};
