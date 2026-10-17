import React from 'react';
import { ClipboardList, Copy, GitCompareArrows } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { useCompactHeader } from '../../hooks/useCompactHeader';
import { DuplicatesPage } from './DuplicatesPage';
import { TasksPage } from './TasksPage';
import { ImportConflictsPage } from './ImportConflictsPage';
import type { ConflictTable } from '../../lib/importConflicts';
import { HelpButton } from '../HelpButton';
import { TODO_TAB_HELP } from '../../lib/helpLinks';

export type TodoTab = 'doublons' | 'taches' | 'conflits';
const TODO_TABS: readonly string[] = ['doublons', 'taches', 'conflits'];

type DuplicatesProps = React.ComponentProps<typeof DuplicatesPage>;
type TasksProps = React.ComponentProps<typeof TasksPage>;

interface Props {
  tab: TodoTab;
  onTabChange: (tab: TodoTab) => void;
  duplicatesCount: number;
  tasksOpenCount: number;
  duplicates: Omit<DuplicatesProps, 'embedded'>;
  tasks: TasksProps;
  /** « Tâches » tab available (capability HAS_TASKS: server routes). */
  withTasks: boolean;
  /** Directory-import arbitration tables (`Arbitrage_*`); the tab shows when there is one. */
  conflictTables: ConflictTable[];
  onOpenConflictRecord: (record: number, uid: string) => void;
  onConflictsResolved: () => void;
}

/**
 * « À traiter » section of the Personnel tab (docs/archive/plan-chantiers-taches.md, lot 2): what is
 * left to do: the uid_dyna duplicates (DuplicatesPage, unchanged), the tasks to carry out
 * outside Druid (TasksPage) and the directory-import conflicts (ImportConflictsPage, when an
 * `Arbitrage_*` table exists). The read-only « OpenAlex affiliations » tab (lot 6) was dropped on
 * 2026-10-12 with the Grist corrections table (druid-internal plan-migration-postgresql.md, lot 14 b).
 * URL ?page=TASKS&tab=doublons|taches|conflits (any other value ⇒ doublons); the pill of the
 * Personnel header carries the sum of both counters. Admin-only (decision of 2026-09-23).
 */
export const TodoPage: React.FC<Props> = ({ tab: requestedTab, onTabChange, duplicatesCount, tasksOpenCount, duplicates, tasks, withTasks, conflictTables, onOpenConflictRecord, onConflictsResolved }) => {
  const withConflicts = withTasks && conflictTables.length > 0;
  const tab: TodoTab = !withTasks || !TODO_TABS.includes(requestedTab) || (requestedTab === 'conflits' && !withConflicts)
    ? 'doublons' : requestedTab;
  // One import source ⇒ named in the tab (« Directory conflicts Centrale »); several ⇒ chosen in the tab.
  const conflictSource = conflictTables.length === 1 ? conflictTables[0].source : '';
  const conflictsOpen = conflictTables.reduce((n, x) => n + x.open, 0);
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
                    : <Trans>Values of an imported directory that differ from Druid — choose which one to keep</Trans>}
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
              {withConflicts && (
                <button onClick={() => onTabChange('conflits')} className={tabCls(tab === 'conflits')} title={t`Conflicts left by a directory import`}>
                  <GitCompareArrows className="w-4 h-4" /> {conflictSource ? t`Directory conflicts ${conflictSource}` : t`Directory conflicts`} {counter(conflictsOpen)}
                </button>
              )}
            </>
          )}
        </div>
      </header>
      {tab === 'doublons' ? <DuplicatesPage embedded {...duplicates} />
        : tab === 'taches' ? <TasksPage {...tasks} />
          : <ImportConflictsPage tables={conflictTables} onOpenResearcher={onOpenConflictRecord} onResolved={onConflictsResolved} />}
    </div>
  );
};
