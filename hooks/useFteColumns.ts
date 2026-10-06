import { useEffect, useState } from 'react';
import { GristService } from '../lib/gristService';
import { hasFteColumns } from '../lib/fte';

/**
 * True when the instance's Annuaire has the FTE columns (`etp_quotite`, `etp_recherche`, lib/fte.ts).
 * Documents without them (Centrale, demo) keep the record form unchanged; false while loading or
 * when the column list cannot be read.
 */
export function useFteColumns(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    GristService.fetchAnnuaireColumns()
      .then((cols) => { if (!cancelled) setAvailable(hasFteColumns(cols)); })
      .catch(() => { /* columns unknown → fields hidden */ });
    return () => { cancelled = true; };
  }, []);
  return available;
}
