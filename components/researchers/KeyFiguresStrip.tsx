import React, { useMemo } from 'react';
import { BarChart3, Users, UserCheck, GraduationCap, PersonStanding, IdCard } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import type { Researcher } from '../../types';
import { directoryKpis } from '../../lib/staffDirectoryAggregates';
import { numberLocale } from '../../lib/i18n';

const fmt = (n: number) => n.toLocaleString(numberLocale());
const pctText = (n: number | null) => (n == null ? '—' : `${n} %`);

/**
 * « Key figures » of the People page: five tiles following the filters of the list (the
 * at-a-glance figures of the former « Charts » view), and the way to the full analyses in
 * the dashboard (People › Directory view; docs/archive/plan-tableau-de-bord-familles.md, D4).
 */
export const KeyFiguresStrip: React.FC<{
  researchers: Researcher[];
  /** Opens the dashboard on the headcount view (absent when the instance has no dashboard). */
  onOpenDashboard?: () => void;
}> = ({ researchers, onOpenDashboard }) => {
  const { t } = useLingui();
  const k = useMemo(() => directoryKpis(researchers), [researchers]);
  const tiles: { label: string; value: string; hint: string; Icon: React.FC<{ className?: string }> }[] = [
    { label: t`Records`, value: fmt(k.total), hint: t`in the current selection`, Icon: Users },
    { label: t`Present`, value: fmt(k.present), hint: t`${fmt(k.leaving)} leaving · ${fmt(k.left)} left`, Icon: UserCheck },
    { label: t`HDR holders`, value: fmt(k.hdr), hint: pctText(k.hdrRate), Icon: GraduationCap },
    { label: t`Women`, value: pctText(k.womenShare), hint: t`${fmt(k.women)} women · ${fmt(k.men)} men`, Icon: PersonStanding },
    { label: t`ORCID`, value: pctText(k.orcidRate), hint: t`${fmt(k.orcid)} records`, Icon: IdCard },
  ];
  return (
    <div className="glass-card px-4 py-3 mb-4 flex flex-wrap items-center gap-x-6 gap-y-3">
      {tiles.map(({ label, value, hint, Icon }) => (
        <div key={label} className="flex items-center gap-2.5 min-w-[140px]">
          <span className="shrink-0 w-8 h-8 rounded-xl grid place-items-center bg-accent/20 text-ink dark:bg-accent/25 dark:text-[#f5f2ea]">
            <Icon className="w-4 h-4" />
          </span>
          <span className="leading-tight">
            <span className="block text-[10.5px] font-bold uppercase tracking-wide text-muted-light dark:text-[#8f897c]">{label}</span>
            <span className="font-disp font-bold text-[20px] text-ink dark:text-[#f5f2ea] tabular-nums">{value}</span>
            <span className="ml-1.5 text-[11px] text-muted-light dark:text-[#8f897c]">{hint}</span>
          </span>
        </div>
      ))}
      {onOpenDashboard && (
        <button
          type="button"
          onClick={onOpenDashboard}
          title={t`Presence, employers, grades, gender balance, identifier coverage — in the dashboard`}
          className="btn-pill !h-9 px-3 text-xs ml-auto"
        >
          <BarChart3 className="w-4 h-4" /> <Trans>All the headcount analyses</Trans>
        </button>
      )}
    </div>
  );
};
