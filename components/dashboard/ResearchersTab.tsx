import React, { useMemo, useState } from 'react';
import { DashboardDataset, MemberMeta } from './types';
import { YearRange } from './overviewAggregates';
import { aggregateResearchers, ResearcherItem, TEAM_UNKNOWN } from './structureAggregates';
import { PubFilters } from './publicationFilters';
import { RankBarChart } from './charts/TeamCharts';
import {
  EChartCard,
  baseTextStyle,
  baseTooltip,
  baseValueAxis,
  baseCategoryAxis,
  useVizTheme,
} from './EChartCard';
import { Trans, useLingui } from '@lingui/react/macro';

/** Coloring dimension of the ranking (like the Streamlit « Par chercheur »:
 *  bars colored and grouped by category). */
type ColorDim = 'none' | 'type' | 'employer' | 'team';

const subBtn = (active: boolean) =>
  `pill px-3 py-1 text-xs transition-colors cursor-pointer ${
    active
      ? 'bg-accent text-ink shadow-nav-active'
      : 'bg-white/50 dark:bg-white/5 text-muted dark:text-[#c3beb0] hover:bg-white dark:hover:bg-white/10'
  }`;

/** Horizontal ranking colored by category: one ECharts series per category
 *  (stacked → a single bar per researcher), interactive legend, bars grouped
 *  by category (decreasing totals) then by number of publications. */
const GroupedRankBarChart: React.FC<{
  items: { item: ResearcherItem; cat: string }[];
  dimLabel: string;
  exportName: string;
  onSelect?: (item: ResearcherItem) => void;
}> = ({ items, dimLabel, exportName, onSelect }) => {
  const t = useVizTheme();
  const { t: tr, i18n } = useLingui();
  // Categories ordered by decreasing total; researchers grouped by
  // category, decreasing within. The ECharts Y axis reads bottom to top →
  // reverse to display the first category at the top.
  const { rows, cats } = useMemo(() => {
    const totals = new Map<string, number>();
    for (const { cat, item } of items) totals.set(cat, (totals.get(cat) ?? 0) + item.count);
    const catList = Array.from(totals.keys()).sort((a, b) => totals.get(b)! - totals.get(a)! || a.localeCompare(b, i18n.locale));
    const displayOrder = catList.flatMap((c) =>
      items.filter((x) => x.cat === c).sort((a, b) => b.item.count - a.item.count));
    return { rows: [...displayOrder].reverse(), cats: catList };
  }, [items, i18n.locale]);
  const option = useMemo(() => {
    return {
      textStyle: baseTextStyle(t),
      legend: {
        top: 0,
        type: 'scroll' as const,
        textStyle: { color: t.inkSecondary, fontSize: 11 },
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: { dataIndex: number; value: number | null }[]) => {
          const p = params.find((x) => x.value != null) ?? params[0];
          const row = rows[p.dataIndex];
          const teams = row.item.teams?.join(', ') ?? '';
          const tm = row.item.teams?.length ? `<br/>${tr`Team(s): ${teams}`}` : '';
          return `<b>${row.item.label}</b><br/>${tr`${row.item.count} publication(s)`}<br/>${dimLabel} : ${row.cat}${tm}`;
        },
        ...baseTooltip(t),
      },
      grid: { left: 8, right: 32, top: 34, bottom: 8, containLabel: true },
      xAxis: baseValueAxis(t),
      yAxis: {
        ...baseCategoryAxis(t),
        data: rows.map((r) => r.item.label),
        axisLabel: { color: t.inkSecondary, width: 150, overflow: 'truncate' as const, fontSize: 11 },
      },
      series: cats.map((c, i) => ({
        name: c,
        type: 'bar' as const,
        stack: 'total',
        data: rows.map((r) => (r.cat === c ? r.item.count : null)),
        itemStyle: { color: t.series[i % t.series.length], borderRadius: [0, 4, 4, 0] },
        label: {
          show: true, position: 'right' as const, fontSize: 10, color: t.inkSecondary,
          formatter: (p: { value: number | null }) => (p.value == null ? '' : String(p.value)),
        },
      })),
    };
  }, [rows, cats, dimLabel, t, tr]);
  return (
    <EChartCard
      title={tr`Most prolific researchers`}
      subtitle={tr`Top 20 internal authors, grouped and coloured by ${dimLabel.toLowerCase()}`}
      option={option}
      exportName={exportName}
      shareable={false}
      height={Math.max(300, items.length * 26 + 90)}
      onSeriesClick={
        onSelect ? (p) => rows[p.dataIndex] && onSelect(rows[p.dataIndex].item) : undefined
      }
    />
  );
};

/** « Chercheurs » tab — the most prolific internal authors. */
export const ResearchersTab: React.FC<{
  dataset: DashboardDataset;
  range: YearRange;
  onOpenList?: (filters: PubFilters) => void;
}> = ({ dataset, range, onOpenList }) => {
  const { t } = useLingui();
  const UNKNOWN_CAT = t`Not provided`;
  const { publications, authors, members, teamLabel } = dataset;
  const openAuthor = (item: ResearcherItem) =>
    onOpenList && item.id != null ? onOpenList({ authorId: item.id }) : undefined;
  const data = useMemo(
    () => aggregateResearchers(publications, authors, range),
    [publications, authors, range],
  );

  // Cross-reference ranking ↔ staff (type, employer) by authorId.
  const memberById = useMemo(() => {
    const m = new Map<number, MemberMeta>();
    for (const mm of members ?? []) if (mm.authorId != null) m.set(mm.authorId, mm);
    return m;
  }, [members]);

  // Dimensions offered only if the data exists (the employer is missing from
  // exports prior to 2026-07-09, the public variant has no staff data).
  const dims = useMemo(() => {
    const list: { key: ColorDim; label: string }[] = [{ key: 'none', label: t`None` }];
    const linked = data.filter((d) => d.id != null && memberById.has(d.id));
    if (linked.some((d) => memberById.get(d.id!)?.type)) list.push({ key: 'type', label: t`Type` });
    if (linked.some((d) => memberById.get(d.id!)?.employer)) list.push({ key: 'employer', label: t`Employer` });
    if (data.some((d) => d.teams.some((tm) => tm && tm !== TEAM_UNKNOWN))) {
      list.push({ key: 'team', label: teamLabel.charAt(0).toUpperCase() + teamLabel.slice(1) });
    }
    return list;
  }, [data, memberById, teamLabel, t]);

  const [dim, setDim] = useState<ColorDim>('none');
  const effectiveDim = dims.some((d) => d.key === dim) ? dim : 'none';

  const grouped = useMemo(() => {
    if (effectiveDim === 'none') return [];
    const catOf = (d: ResearcherItem): string => {
      if (effectiveDim === 'team') return d.teams.find((tm) => tm && tm !== TEAM_UNKNOWN) ?? UNKNOWN_CAT;
      const m = d.id != null ? memberById.get(d.id) : undefined;
      if (effectiveDim === 'type') return m?.type || UNKNOWN_CAT;
      return m?.employer || UNKNOWN_CAT;
    };
    return data.map((item) => ({ item, cat: catOf(item) }));
  }, [data, effectiveDim, memberById, UNKNOWN_CAT]);

  if (data.length === 0) {
    return (
      <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
        <Trans>No internal author identified over the period.</Trans>
      </div>
    );
  }

  const dimLabel = dims.find((d) => d.key === effectiveDim)?.label ?? t`None`;

  return (
    <div className="flex flex-col gap-3">
      {dims.length > 1 && (
        <div className="flex flex-wrap items-center gap-3 px-1">
          <span className="text-[11px] font-semibold uppercase tracking-[.08em] text-muted-lighter dark:text-[#8f897c]">
            <Trans>Colour and grouping</Trans>
          </span>
          <div className="flex items-center gap-1.5">
            {dims.map(({ key, label }) => (
              <button key={key} type="button" className={subBtn(effectiveDim === key)} onClick={() => setDim(key)}>
                {label}
              </button>
            ))}
          </div>
          {effectiveDim !== 'none' && (
            <span className="text-[11px] text-muted-lighter dark:text-[#8f897c]">
              <Trans>grouped by {dimLabel.toLowerCase()} — sharing unavailable for this view</Trans>
            </span>
          )}
        </div>
      )}
      {effectiveDim === 'none' ? (
        <RankBarChart
          title={t`Most prolific researchers`}
          subtitle={t`Top 20 internal authors (number of publications over the period)`}
          exportName="chercheurs-classement"
          data={data}
          colorSlot={3}
          height={Math.max(280, data.length * 26 + 60)}
          onItemSelect={onOpenList ? openAuthor : undefined}
        />
      ) : (
        <GroupedRankBarChart
          items={grouped}
          dimLabel={dimLabel}
          exportName="chercheurs-classement"
          onSelect={onOpenList ? openAuthor : undefined}
        />
      )}
    </div>
  );
};
