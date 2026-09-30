import { useCallback, useEffect, useState } from 'react';
import { ImportConflictsApi, type ConflictTable } from '../lib/importConflicts';

/**
 * Directory-import arbitration tables (`Arbitrage_*`) and their open counts, for the
 * « À traiter › Conflits annuaire » tab and the pill of the Personnel header.
 * `enabled` = false (not an admin) → nothing is fetched. A failure leaves the tab hidden.
 */
export function useImportConflicts(enabled: boolean) {
  const [tables, setTables] = useState<ConflictTable[]>([]);

  const reload = useCallback(async () => {
    if (!enabled) return;
    try { setTables(await ImportConflictsApi.tables()); }
    catch (e) { console.warn('Import conflicts:', e); }
  }, [enabled]);

  useEffect(() => { reload(); }, [reload]);

  return { tables, reload, openCount: tables.reduce((n, x) => n + x.open, 0) };
}
