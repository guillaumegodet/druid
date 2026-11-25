import { useCallback, useEffect, useState } from 'react';
import { FieldConflictsApi, type FieldConflict } from '../lib/fieldConflicts';

/**
 * Source conflicts (druid-internal `docs/plan-maj-chercheurs.md`, lot 2 d) for the « To process › Source conflicts »
 * tab and the pill of the Personnel header. `enabled` = false (not an admin) → nothing is fetched; a failure, or a
 * storage without them (Grist), leaves the tab hidden.
 */
export function useFieldConflicts(enabled: boolean) {
  const [items, setItems] = useState<FieldConflict[]>([]);
  const [available, setAvailable] = useState(false);

  const reload = useCallback(async () => {
    if (!enabled) return;
    try {
      const r = await FieldConflictsApi.list();
      setAvailable(r.available);
      setItems(r.items);
    } catch (e) { console.warn('Source conflicts:', e); }
  }, [enabled]);

  useEffect(() => { reload(); }, [reload]);

  return { items, available, reload, openCount: items.length };
}
