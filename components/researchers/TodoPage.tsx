import React from 'react';
import { ClipboardList, Copy, Building2 } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { useCompactHeader } from '../../hooks/useCompactHeader';
import { DuplicatesPage } from './DuplicatesPage';
import { TasksPage } from './TasksPage';
import { OpenAlexAffiliationsPage } from './OpenAlexAffiliationsPage';
import { HelpButton } from '../HelpButton';
import { TODO_TAB_HELP } from '../../lib/helpLinks';

export type TodoTab = 'doublons' | 'taches' | 'affiliations';

type DuplicatesProps = React.ComponentProps<typeof DuplicatesPage>;
type TasksProps = React.ComponentProps<typeof TasksPage>;

interface Props {
  tab: TodoTab;
  onTabChange: (tab: TodoTab) => void;
  duplicatesCount: number;
  tasksOpenCount: number;
  duplicates: Omit<DuplicatesProps, 'embedded'>;
  tasks: TasksProps;
  /** « Tâches » + « Affiliations OpenAlex » tabs available (capability HAS_TASKS: server routes). */
  withTasks: boolean;
  /** Opens the ETL console of a lab (Administration), from the « Affiliations OpenAlex » tab. */
  onOpenConsole?: (slug: string) => void;
}

/**
 * « À traiter » section of the Personnel tab (docs/plan-chantiers-taches.md, lot 2): what is
 * left to do, in two tabs — the uid_dyna duplicates (DuplicatesPage, unchanged) and the tasks
 * to carry out outside Druid (TasksPage), plus the read-only OpenAlex affiliations (lot 6).
 * URL ?page=TASKS&tab=doublons|taches|affiliations; the pill of the
 * Personnel header carries the sum of both counters. Admin-only (decision of 2026-09-23).
 */
export const TodoPage: React.FC<Props> = ({ tab: requestedTab, onTabChange, duplicatesCount, tasksOpenCount, duplicates, tasks, withTasks, onOpenConsole }) => {
  const tab: TodoTab = withTasks ? requestedTab : 'doublons';
  const { t } = useLingui();
  const { compact, onScrollCapture } = useCompactHeader();
  const tabCls = (active: boolean) =>
    `inline-flex items-center gap-2 h-10 px-4 rounded-full font-disp text-[13px] font-semibold transition-colors ${active ? 'bg-accent border border-accent-strong text-ink' : 'bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/15 text-muted dark:text-[#8f897c] hover:bg-white dark:hover:bg-white/15'}`;
  const counter = (n: number) => n > 0 && <span className="px-1.5 py-0.5 rounded-full bg-[rgba(231,111,154,.2)] text-[#b23b3b] dark:text-[#f08c8c] text-[11px] font-bold">{n}</span>;
  return (
    <div className="flex flex-col h-full" onScrollCapture={onScrollCapture}>
      <header className="page-header px-4 md:px-7 pt-6 pb-2" data-compact={compact || undefined}>
        <div className="page-header-top flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <ClipboardList className="page-header-icon w-7 h-7 text-[#b23b3b] dark:text-[#f08c8c]" />
            <div>
              <h1 className="font-disp text-3xl md:text-[38px] font-bold tracking-tight text-ink dark:text-[#f5f2ea] leading-none"><Trans>To process</Trans></h1>
              <p className="page-header-sub text-[15px] text-muted dark:text-[#8f897c] mt-1.5">
                {tab === 'doublons'
                  ? <Trans>Records sharing the same uid_dyna — merge, or qualify a legitimate multi-affiliation</Trans>
                  : tab === 'taches'
                    ? <Trans>Corrections to carry out outside Druid (IdRef, ORCID, HAL, OpenAlex, Scopus, HR) — who does what, and where it stands</Trans>
                    : <Trans>Publications with a suspicious OpenAlex affiliation, detected by the ETL console</Trans>}
              </p>
            </div>
            <HelpButton path={TODO_TAB_HELP[tab]} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => onTabChange('doublons')} className={tabCls(tab === 'doublons')} title={t`Records sharing the same uid_dyna`}>
            <Copy className="w-4 h-4" /> <Trans>Duplicates</Trans> {counter(duplicatesCount)}
          </button>
          {withTasks && (
            <>
              <button onClick={() => onTabChange('taches')} className={tabCls(tab === 'taches')} title={t`Tasks to carry out outside Druid`}>
                <ClipboardList className="w-4 h-4" /> <Trans>Tasks</Trans> {counter(tasksOpenCount)}
              </button>
              <button onClick={() => onTabChange('affiliations')} className={tabCls(tab === 'affiliations')} title={t`Suspicious OpenAlex affiliations (ETL console), read-only`}>
                <Building2 className="w-4 h-4" /> <Trans>OpenAlex affiliations</Trans>
              </button>
            </>
          )}
        </div>
      </header>
      {tab === 'doublons' ? <DuplicatesPage embedded {...duplicates} />
        : tab === 'taches' ? <TasksPage {...tasks} />
          : <OpenAlexAffiliationsPage onOpenConsole={onOpenConsole} />}
    </div>
  );
};
