import React from 'react';
import { ClipboardList, GitCompareArrows, GitMerge, History } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { useCompactHeader } from '../../hooks/useCompactHeader';
import { MergeLogPanel } from './MergeLogPanel';
import { TasksPage } from './TasksPage';
import { ImportConflictsPage } from './ImportConflictsPage';
import { FieldConflictsPage } from './FieldConflictsPage';
import type { FieldConflict, IdentifierConflict } from '../../lib/fieldConflicts';
import type { ConflictTable } from '../../lib/importConflicts';
import { HelpButton } from '../HelpButton';
import { TODO_TAB_HELP } from '../../lib/helpLinks';

export type TodoTab = 'taches' | 'conflits' | 'sources' | 'fusions';
const TODO_TABS: readonly string[] = ['taches', 'conflits', 'sources', 'fusions'];

type TasksProps = React.ComponentProps<typeof TasksPage>;

interface Props {
  tab: TodoTab;
  onTabChange: (tab: TodoTab) => void;
  tasksOpenCount: number;
  tasks: TasksProps;
  /** « Fusions » tab: the merge log, with restore (MergeLogPanel). */
  merges: { onRestored: () => void; refreshKey: number };
  /** « Tâches » tab available (capability HAS_TASKS: server routes). */
  withTasks: boolean;
  /** Directory-import arbitration tables (`Arbitrage_*`); the tab shows when there is one. */
  conflictTables: ConflictTable[];
  onOpenConflictRecord: (record: number, uid: string) => void;
  onConflictsResolved: () => void;
  /** Source conflicts (fields merged by source, PostgreSQL): the tab shows when the storage has them. */
  fieldConflicts: { available: boolean; items: FieldConflict[]; identifiers: IdentifierConflict[]; reload: () => Promise<void> };
}

/**
 * « À traiter » section of the Personnel tab (docs/archive/plan-chantiers-taches.md, lot 2): what is
 * left to do: the tasks to carry out (TasksPage), the directory-import conflicts (ImportConflictsPage, when an
 * `Arbitrage_*` table exists), the source conflicts, and the merge log (« Fusions », with restore). The former
 * « Doublons » tab (records sharing a uid_dyna) was dropped on 2026-11-28: a uid is unique on PostgreSQL, a
 * membership added to a person is qualified at once, and what remains to qualify is a task of the rule
 * `appartenance_a_qualifier`. URL ?page=TASKS&tab=taches|conflits|sources|fusions (the former `doublons` and any
 * unknown value ⇒ the first tab available). Admin-only (decision of 2026-09-23).
 */
export const TodoPage: React.FC<Props> = ({ tab: requestedTab, onTabChange, tasksOpenCount, tasks, merges, withTasks, conflictTables, onOpenConflictRecord, onConflictsResolved, fieldConflicts }) => {
  const withConflicts = withTasks && conflictTables.length > 0;
  const withSources = withTasks && fieldConflicts.available;
  const available = (x: string): boolean => TODO_TABS.includes(x)
    && (x === 'fusions' || (withTasks && (x === 'taches' || (x === 'conflits' && withConflicts) || (x === 'sources' && withSources))));
  const tab: TodoTab = available(requestedTab) ? requestedTab : withTasks ? 'taches' : 'fusions';
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
                {tab === 'fusions'
                  ? <Trans>Merges of records carried out in Druid — each one can be restored</Trans>
                  : tab === 'taches'
                    ? <Trans>Corrections to carry out outside Druid (IdRef, ORCID, HAL, OpenAlex, Scopus, HR) — who does what, and where it stands</Trans>
                    : tab === 'sources'
                      ? <Trans>Manual corrections that a source contradicts since they were made — keep them or go back to the sources</Trans>
                      : <Trans>Values of an imported directory that differ from Druid — choose which one to keep</Trans>}
              </p>
            </div>
            <HelpButton path={TODO_TAB_HELP[tab]} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
              {withSources && (
                <button onClick={() => onTabChange('sources')} className={tabCls(tab === 'sources')} title={t`Manual corrections contradicted by a source since`}>
                  <GitMerge className="w-4 h-4" /> <Trans>Source conflicts</Trans> {counter(fieldConflicts.items.length + fieldConflicts.identifiers.length)}
                </button>
              )}
            </>
          )}
          <button onClick={() => onTabChange('fusions')} className={tabCls(tab === 'fusions')} title={t`Merge log: merges carried out, to restore if needed`}>
            <History className="w-4 h-4" /> <Trans>Merges</Trans>
          </button>
        </div>
      </header>
      {tab === 'fusions'
        ? <div className="flex-1 overflow-auto px-4 md:px-7 pb-6" data-page-scroll><MergeLogPanel defaultOpen onRestored={merges.onRestored} refreshKey={merges.refreshKey} /></div>
        : tab === 'taches' ? <TasksPage {...tasks} />
          : tab === 'sources' ? <FieldConflictsPage items={fieldConflicts.items} identifiers={fieldConflicts.identifiers} onReload={fieldConflicts.reload} onOpenResearcher={onOpenConflictRecord} onResolved={onConflictsResolved} />
          : <ImportConflictsPage tables={conflictTables} onOpenResearcher={onOpenConflictRecord} onResolved={onConflictsResolved} />}
    </div>
  );
};
