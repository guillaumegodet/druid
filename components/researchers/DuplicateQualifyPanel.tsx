import React, { useState } from 'react';
import { Users, History, HelpCircle, RefreshCw, ShieldCheck } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';

export type QualifyMode = 'concomitant' | 'successif' | 'a_revoir';

interface Row { gristRowId: number; name: string; labo: string; validated: boolean }

interface DuplicateQualifyPanelProps {
  rows: Row[];
  busy?: boolean;
  onQualify: (args: { mode: QualifyMode; principalRowId?: number; endDate?: string }) => void;
}

/**
 * Qualification of a group of rows sharing a uid (duplicate merge plan, lot 1):
 * the principal row is designated, then the multi-affiliation type — concurrent
 * (the other rows become SECONDAIRE) or successive (HISTORIQUE, with an optional
 * end date) — or the group is flagged « à revoir ». Nothing is merged or deleted.
 */
export const DuplicateQualifyPanel: React.FC<DuplicateQualifyPanelProps> = ({ rows, busy = false, onQualify }) => {
  const { t } = useLingui();
  const defaultPrincipal = rows.find((r) => r.validated)?.gristRowId ?? rows[0]?.gristRowId;
  const [principal, setPrincipal] = useState<number | undefined>(defaultPrincipal);
  const [endDate, setEndDate] = useState('');

  const btn = 'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-semibold border transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  return (
    <div className="mt-2 w-full rounded-xl bg-white/50 dark:bg-white/[.04] border border-ink/5 dark:border-white/10 px-3 py-2.5 space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
        <span className="font-semibold text-muted dark:text-[#8f897c]"><Trans>Main row:</Trans></span>
        {rows.map((r) => (
          <label key={r.gristRowId} className="inline-flex items-center gap-1.5 cursor-pointer text-ink dark:text-[#e7e2d6]">
            <input type="radio" name={`principal-${rows[0].gristRowId}`} checked={principal === r.gristRowId} onChange={() => setPrincipal(r.gristRowId)} disabled={busy} />
            <span>{r.name || '—'}</span>
            <span className="font-mono text-muted dark:text-[#8f897c]">{r.labo || '∅'}</span>
            {r.validated && <ShieldCheck className="w-3 h-3 text-[#1f7a4d] dark:text-[#5fd39a]" />}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || principal === undefined} onClick={() => onQualify({ mode: 'concomitant', principalRowId: principal })}
          title={t`The person belongs to both labs at the same time: the other rows become SECONDAIRE.`}
          className={`${btn} bg-white/75 dark:bg-white/10 border-white/80 dark:border-white/15 text-ink dark:text-[#f5f2ea] hover:bg-white dark:hover:bg-white/15`}>
          <Users className="w-3.5 h-3.5" /> <Trans>Concurrent</Trans>
        </button>
        <span className="inline-flex items-center gap-1.5">
          <button type="button" disabled={busy || principal === undefined} onClick={() => onQualify({ mode: 'successif', principalRowId: principal, endDate: endDate || undefined })}
            title={t`The person moved to another lab: the other rows become HISTORIQUE (optional end date).`}
            className={`${btn} bg-white/75 dark:bg-white/10 border-white/80 dark:border-white/15 text-ink dark:text-[#f5f2ea] hover:bg-white dark:hover:bg-white/15`}>
            <History className="w-3.5 h-3.5" /> <Trans>Successive</Trans>
          </button>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={busy}
            title={t`End date of the former affiliation (optional, leave empty if unknown)`}
            className="h-7 px-2 rounded-md text-[12px] bg-white/70 dark:bg-white/10 border border-ink/10 dark:border-white/15 text-ink dark:text-[#f5f2ea] [color-scheme:light] dark:[color-scheme:dark]" />
        </span>
        <button type="button" disabled={busy} onClick={() => onQualify({ mode: 'a_revoir' })}
          title={t`Undetermined case: remembered so it stops coming back at every review, no role set.`}
          className={`${btn} bg-transparent border-ink/10 dark:border-white/15 text-muted dark:text-[#8f897c] hover:text-ink dark:hover:text-[#f5f2ea]`}>
          <HelpCircle className="w-3.5 h-3.5" /> <Trans context="needs rework">To review</Trans>
        </button>
        {busy && <RefreshCw className="w-3.5 h-3.5 animate-spin text-muted-faint" />}
      </div>
    </div>
  );
};
