import React from 'react';
import { useCompactHeader } from '../../hooks/useCompactHeader';
import { UserSearch, RefreshCw, RotateCw, UserPlus } from 'lucide-react';
import type { LdapCandidatesDiff, LdapDiff, LdapResolved } from '../../lib/gristService';
import { Trans, useLingui } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import { LdapCandidatesPage, LdapCandProgress } from './LdapCandidatesPage';
import { LdapVerifyPanel, LdapRunProgress } from './LdapVerifyPanel';
import { LdapMovesPanel } from './LdapMovesPanel';
import type { LdapDeparture } from '../../lib/ldapMoves';
import { PixelBtn } from './alignAtoms';
import { HelpButton } from '../HelpButton';
import { VIEW_HELP } from '../../lib/helpLinks';
import { ViewState, Researcher, Structure } from '../../types';

/**
 * Two-tab LDAP alignment (docs/archive/plan-reorganisation-sync-ldap.md, lot 2), same template as
 * the other alignment tools:
 * - « Rechercher manquants »: records without uid ↔ LDAP staff (LdapCandidatesPage) + LDAP uids
 * without Annuaire record (informative, creation planned in phase 2);
 * - « Vérifier les existants »: LDAP-authoritative fields to update + orphans
 *    (LdapVerifyPanel, ex-modale « Revue de synchronisation LDAP »);
 * - « Arrivées et départs »: staff accounts created / left since a date (LdapMovesPanel, live
 *    LDAP search, no run).
 * Two distinct runs behind the two tabs (/api/sync-ldap-candidates-trigger and
 * /api/sync-ldap-trigger), each with its own progress.
 */

export type LdapAlignMode = 'search' | 'verify' | 'moves';
const MODE_LABEL: Record<LdapAlignMode, MessageDescriptor> = { search: msg`Find missing`, verify: msg`Check existing ones`, moves: msg`Arrivals and departures` };

interface Props {
  mode: LdapAlignMode;
  onModeChange: (m: LdapAlignMode) => void;
  candDiff: LdapCandidatesDiff | null;
  candProgress: LdapCandProgress | null;
  candApplying: boolean;
  onRerunCandidates: () => void;
  onApplyCandidates: (entries: LdapResolved[]) => void;
  onMerge?: (rowIds: [number, number]) => void;
  ldapDiff: LdapDiff | null;
  ldapProgress: LdapRunProgress | null;
  ldapApplying: boolean;
  onRerunLdap: () => void;
  onApplyLdap: (ids: string[]) => void;
  researchers: Researcher[];
  structures: Structure[];
  onCreateFromLdap?: (uid: string) => void;
  onOpenResearcher: (researcher: Researcher) => void;
  onMarkDeparted?: (departure: LdapDeparture, accountLabel: string) => Promise<void>;
}

export const LdapAlignPage: React.FC<Props> = ({ mode, onModeChange, candDiff, candProgress, candApplying, onRerunCandidates, onApplyCandidates, onMerge, ldapDiff, ldapProgress, ldapApplying, onRerunLdap, onApplyLdap, researchers, structures, onCreateFromLdap, onOpenResearcher, onMarkDeparted }) => {
  const { t } = useLingui();
  const running = mode === 'search' ? !!candProgress?.running : mode === 'verify' ? !!ldapProgress?.running : false;
  const ldapWithoutRecord = ldapDiff?.ldapWithoutRecord ?? [];

  const ldapWithoutRecordSection = (
    <section>
      <div className="flex items-center gap-2 pb-2 mb-2 border-b border-ink/5 dark:border-white/5 text-muted-lighter dark:text-[#8f897c]">
        <UserPlus className="w-4 h-4" />
        <h3 className="font-disp text-base font-bold tracking-tight text-ink dark:text-[#f5f2ea]"><Trans>LDAP uid without Directory record ({ldapWithoutRecord.length})</Trans></h3>
      </div>
      <p className="text-[12.5px] text-muted-light dark:text-[#8f897c] mb-2">
        {ldapDiff
          ? <Trans>LDAP people without a Directory record — automatic creation planned for Phase 2 (requires extending the LDAP extraction to name/first name/email). List from the last LDAP sync (“Check existing ones” tab).</Trans>
          : <Trans>List available after an LDAP sync (“Check existing ones” tab).</Trans>}
      </p>
      {ldapWithoutRecord.length > 0 && (
        <div className="flex flex-wrap gap-1.5 max-h-32 overflow-auto">
          {ldapWithoutRecord.map((uid) => (
            <span key={uid} className="px-2.5 py-0.5 rounded-full bg-white/40 dark:bg-white/5 border border-ink/5 dark:border-white/10 font-mono text-[11px] text-muted-light dark:text-[#8f897c]">{uid}</span>
          ))}
        </div>
      )}
    </section>
  );

  const { compact, onScrollCapture } = useCompactHeader();
  return (
    <div className="flex flex-col h-full" onScrollCapture={onScrollCapture}>
      <header className="page-header px-4 md:px-7 pt-6 pb-2" data-compact={compact || undefined}>
        <div className="page-header-top flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <UserSearch className="page-header-icon w-7 h-7 text-ink dark:text-accent" />
            <div>
              <h1 className="font-disp text-3xl md:text-[38px] font-bold tracking-tight text-ink dark:text-[#f5f2ea] leading-none"><Trans>LDAP alignment</Trans></h1>
              <p className="page-header-sub text-[15px] text-muted dark:text-[#8f897c] mt-1.5">
                {mode === 'search'
                  ? <Trans>Link records without a uid to LDAP staff</Trans>
                  : mode === 'verify'
                    ? <Trans>Carry over to the Directory the LDAP-authoritative fields that changed (status, employment, name…)</Trans>
                    : <Trans>Spot the staff who arrived or left since a date</Trans>}
              </p>
            </div>
            <HelpButton path={VIEW_HELP[ViewState.LDAP_ALIGN]} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(['search', 'verify', 'moves'] as LdapAlignMode[]).map((m) => (
            <button key={m} onClick={() => onModeChange(m)} disabled={running}
              className={`inline-flex items-center h-10 px-4 rounded-full font-disp text-[13px] font-semibold transition-colors disabled:opacity-50 ${mode === m ? 'bg-accent border border-accent-strong text-ink' : 'bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/15 text-muted dark:text-[#8f897c] hover:bg-white dark:hover:bg-white/15'}`}>
              {t(MODE_LABEL[m])}
            </button>
          ))}
          <div className="flex-1" />
          {mode === 'verify' && (
            <PixelBtn onClick={onRerunLdap} disabled={running} tone="bg-ink text-white hover:bg-black dark:bg-accent dark:text-ink dark:hover:bg-accent-strong"
              title={t`Re-reads LDAP (~93,000 accounts, in the background) then recomputes the comparison with the Directory`}>
              {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />}
              {running ? t`Syncing… ${ldapProgress?.done ?? 0}/${ldapProgress?.total ?? '?'}` : t`Re-run the LDAP sync`}
            </PixelBtn>
          )}
        </div>
      </header>

      {mode === 'search' ? (
        <div className="flex-1 min-h-0">
          <LdapCandidatesPage embedded diff={candDiff} progress={candProgress} applying={candApplying} onRerun={onRerunCandidates} onApply={onApplyCandidates} onMerge={onMerge} footer={ldapWithoutRecordSection} />
        </div>
      ) : mode === 'moves' ? (
        <div className="flex-1 min-h-0">
          <LdapMovesPanel researchers={researchers} structures={structures} onCreate={onCreateFromLdap} onOpenResearcher={onOpenResearcher} onMarkDeparted={onMarkDeparted} />
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <LdapVerifyPanel diff={ldapDiff} progress={ldapProgress} applying={ldapApplying} onApply={onApplyLdap} />
        </div>
      )}
    </div>
  );
};
