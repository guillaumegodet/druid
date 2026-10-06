import React, { useMemo, useState } from 'react';
import { Users, Gauge, TrendingUp, Activity, Download, AlertTriangle } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import type { DashboardDataset } from './types';
import type { YearRange } from './overviewAggregates';
import type { PubFilters } from './publicationFilters';
import { YearRangeSelector } from './YearRangeSelector';
import { KpiCard } from './KpiCards';
import {
  EChartCard, baseTextStyle, baseTooltip, baseValueAxis, baseCategoryAxis, useVizTheme,
} from './EChartCard';
import {
  AGE_UNKNOWN, CATEGORY_KEYS, CategoryKey, MEMBERSHIP_KEYS, MembershipKey, StaffFilter, StaffMember,
  agePyramid, categoryKeyOf, membershipKeyOf, publicationRateByAge, publicationsDistribution,
  publicationsPerMember, staffKpis, PublicationRateResult,
} from './staffAggregates';
import { numberLocale } from '../../lib/i18n';

/** Fixed colour slot of each category, the same in every chart of the section. */
const CATEGORY_SLOT: Record<CategoryKey, number> = { permanent: 3, non_permanent: 1, doctorant: 0, emeritus: 5, none: 7 };

const chip = (active: boolean) =>
  `pill px-3 py-1 text-xs transition-colors cursor-pointer ${
    active
      ? 'bg-accent text-ink shadow-nav-active'
      : 'bg-white/50 dark:bg-white/5 text-muted dark:text-[#c3beb0] hover:bg-white dark:hover:bg-white/10'
  }`;
const groupLabel = 'text-[11px] font-semibold uppercase tracking-[.08em] text-muted-lighter dark:text-[#8f897c] w-28 shrink-0';

const fmt = (n: number, digits = 0) =>
  n.toLocaleString(numberLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Translated labels of the filter values, age brackets and categories. */
function useStaffLabels() {
  const { t } = useLingui();
  return useMemo(() => {
    const membership: Record<MembershipKey, string> = {
      stat_mmb: t`Statutory`, assoc_mmb: t`Associate`, second_mmb: t`Secondary`, visit_mmb: t`Visiting`, none: t`Not provided`,
    };
    const category: Record<CategoryKey, string> = {
      permanent: t`Permanent staff`, non_permanent: t`Non-permanent staff`, doctorant: t`PhD students`,
      emeritus: t`Emeriti`, none: t`Not provided`,
    };
    const bracket = (key: string): string => {
      if (key === AGE_UNKNOWN) return t`Age unknown`;
      let m = /^<(\d+)$/.exec(key);
      if (m) return t`Under ${m[1]}`;
      m = /^(\d+)\+$/.exec(key);
      if (m) return t`${m[1]} and over`;
      return key;
    };
    return { membership, category, bracket };
  }, [t]);
}

/** Population filter of the Researchers tab (lab membership × category × presence). */
export const StaffFilterBar: React.FC<{
  filter: StaffFilter;
  onChange: (f: StaffFilter) => void;
  dataset: Pick<DashboardDataset, 'members' | 'formerMembers'>;
  period: YearRange;
  periodBounds: { min: number; max: number };
  onPeriodChange: (r: YearRange) => void;
}> = ({ filter, onChange, dataset, period, periodBounds, onPeriodChange }) => {
  const { t } = useLingui();
  const labels = useStaffLabels();
  const toggle = <K extends string>(list: K[], key: K): K[] =>
    list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
  // Values offered only when present in the staff (current and former members).
  const all = [...dataset.members, ...(dataset.formerMembers ?? [])];
  const memberships = MEMBERSHIP_KEYS.filter((k) => all.some((m) => membershipKeyOf(m) === k));
  const categories = CATEGORY_KEYS.filter((k) => all.some((m) => categoryKeyOf(m) === k));
  const presets: { label: string; f: Partial<StaffFilter> }[] = [
    { label: t`Everyone`, f: { memberships: [...MEMBERSHIP_KEYS], categories: [...CATEGORY_KEYS] } },
    {
      label: t`Statutory members and PhD students`,
      f: { memberships: ['stat_mmb', 'none'], categories: ['permanent', 'doctorant'] },
    },
    { label: t`Permanent staff`, f: { memberships: [...MEMBERSHIP_KEYS], categories: ['permanent'] } },
  ];
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  return (
    <div className="glass-card p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={groupLabel}><Trans>Presets</Trans></span>
        {presets.map((p) => {
          const active = same(filter.memberships, p.f.memberships!) && same(filter.categories, p.f.categories!);
          return (
            <button key={p.label} type="button" className={chip(active)} onClick={() => onChange({ ...filter, ...p.f })}>
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={groupLabel} title={t`Lab membership type (Annuaire « membership_type »)`}><Trans>Membership</Trans></span>
        {memberships.map((k) => (
          <button key={k} type="button" className={chip(filter.memberships.includes(k))}
            onClick={() => onChange({ ...filter, memberships: toggle(filter.memberships, k) })}>
            {labels.membership[k]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={groupLabel} title={t`From the grade, else the employment type`}><Trans>Category</Trans></span>
        {categories.map((k) => (
          <button key={k} type="button" className={chip(filter.categories.includes(k))}
            onClick={() => onChange({ ...filter, categories: toggle(filter.categories, k) })}>
            {labels.category[k]}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className={groupLabel}><Trans>Presence</Trans></span>
        <button type="button" className={chip(filter.presence === 'current')} onClick={() => onChange({ ...filter, presence: 'current' })}>
          <Trans>Current members</Trans>
        </button>
        <button type="button" className={chip(filter.presence === 'period')} onClick={() => onChange({ ...filter, presence: 'period' })}
          title={t`Also counts the validated members who left during the period, pro rata of their presence`}>
          <Trans>Present during the period</Trans>
        </button>
        <span className="mx-2 h-5 w-px bg-ink/10 dark:bg-white/10" />
        <span className="text-[11px] font-semibold uppercase tracking-[.08em] text-muted-lighter dark:text-[#8f897c]"><Trans>Period</Trans></span>
        <YearRangeSelector bounds={periodBounds} range={period} onChange={onPeriodChange} />
      </div>
    </div>
  );
};

/** Staff indicators and charts of the Researchers tab (lot 4 of the research FTE plan). */
export const StaffSection: React.FC<{
  dataset: DashboardDataset;
  staff: StaffMember[];
  filter: StaffFilter;
  period: YearRange;
  asOf: string;
  onOpenList?: (filters: PubFilters) => void;
}> = ({ dataset, staff, filter, period, asOf, onOpenList }) => {
  const { t } = useLingui();
  const theme = useVizTheme();
  const labels = useStaffLabels();
  const { publications } = dataset;
  const rate = useMemo(() => publicationRateByAge(publications, staff, period, asOf), [publications, staff, period, asOf]);
  const perMember = useMemo(() => publicationsPerMember(publications, staff, period, asOf), [publications, staff, period, asOf]);
  const kpis = useMemo(() => staffKpis(perMember, staff, rate), [perMember, staff, rate]);
  const pyramid = useMemo(() => agePyramid(staff, Number(asOf.slice(0, 4))), [staff, asOf]);
  const distribution = useMemo(() => publicationsDistribution(perMember), [perMember]);
  const [pyramidMode, setPyramidMode] = useState<'headcount' | 'fte'>('headcount');
  const currentYear = Number(asOf.slice(0, 4));
  const periodLabel = `${period.start}–${period.end}`;

  const populationLabel = useMemo(() => {
    const m = filter.memberships.length === MEMBERSHIP_KEYS.length ? t`all memberships` : filter.memberships.map((k) => labels.membership[k]).join(', ');
    const c = filter.categories.length === CATEGORY_KEYS.length ? t`all categories` : filter.categories.map((k) => labels.category[k]).join(', ');
    const p = filter.presence === 'period' ? t`members present during the period` : t`current members`;
    return `${m} · ${c} · ${p}`;
  }, [filter, labels, t]);

  const openBracket = (key: string, authorYears: string[]) => {
    if (!onOpenList || authorYears.length === 0) return;
    const label = key === 'overall' ? t`All brackets` : labels.bracket(key);
    onOpenList({ authorYears, authorYearsLabel: t`Age ${label}, ${periodLabel} (${populationLabel})` });
  };

  const rateOption = useMemo(() => ({
    textStyle: baseTextStyle(theme),
    tooltip: {
      trigger: 'axis' as const,
      axisPointer: { type: 'shadow' as const },
      formatter: (ps: { dataIndex: number }[]) => {
        const b = rate.brackets[ps[0].dataIndex];
        const est = b.estimatedFteYears > 0 ? ` ${t`(of which ${fmt(b.estimatedFteYears, 1)} estimated)`}` : '';
        return [
          `<b>${labels.bracket(b.key)}</b>`,
          t`${fmt(b.rate ?? 0, 2)} publications per research FTE per year`,
          t`${b.publications} publications`,
          `${t`${fmt(b.fteYears, 1)} research FTE-years`}${est}`,
          t`${b.people} people`,
        ].join('<br/>');
      },
      ...baseTooltip(theme),
    },
    grid: { left: 8, right: 24, top: 28, bottom: 8, containLabel: true },
    xAxis: { ...baseCategoryAxis(theme), data: rate.brackets.map((b) => labels.bracket(b.key)) },
    yAxis: { ...baseValueAxis(theme), name: t`Publications / research FTE / year`, nameTextStyle: { color: theme.inkMuted, fontSize: 11, align: 'left' as const } },
    series: [{
      type: 'bar' as const,
      data: rate.brackets.map((b) => (b.rate === null ? null : Number(b.rate.toFixed(2)))),
      itemStyle: { color: theme.series[CATEGORY_SLOT.permanent], borderRadius: [4, 4, 0, 0] },
      barMaxWidth: 64,
      label: { show: true, position: 'top' as const, color: theme.inkSecondary, fontSize: 11, formatter: (p: { value: number }) => fmt(p.value, 1) },
      markLine: rate.overall.rate === null ? undefined : {
        silent: true,
        symbol: 'none',
        lineStyle: { color: theme.inkMuted, type: 'dashed' as const },
        label: { color: theme.inkSecondary, fontSize: 11, formatter: t`All brackets ${fmt(rate.overall.rate, 1)}` },
        data: [{ yAxis: Number(rate.overall.rate.toFixed(2)) }],
      },
    }],
  }), [rate, theme, labels, t]);

  const heatmapOption = useMemo(() => {
    const cells = rate.brackets.flatMap((b, y) => b.byYear.map((v, x) => [x, y, v]));
    const max = cells.reduce((m, c) => Math.max(m, c[2]), 0);
    return {
      textStyle: baseTextStyle(theme),
      tooltip: {
        position: 'top' as const,
        formatter: (p: { value: [number, number, number] }) =>
          `${labels.bracket(rate.brackets[p.value[1]].key)} — ${rate.years[p.value[0]]} : ${t`${p.value[2]} publications`}`,
        ...baseTooltip(theme),
      },
      grid: { left: 8, right: 16, top: 8, bottom: 40, containLabel: true },
      xAxis: { ...baseCategoryAxis(theme), data: rate.years.map(String), splitArea: { show: true, areaStyle: { color: [theme.surface] } } },
      yAxis: { ...baseCategoryAxis(theme), data: rate.brackets.map((b) => labels.bracket(b.key)), splitArea: { show: true, areaStyle: { color: [theme.surface] } } },
      visualMap: {
        min: 0, max: max || 1, calculable: true, orient: 'horizontal' as const, left: 'center', bottom: 0,
        inRange: { color: theme.seqRamp }, textStyle: { color: theme.inkSecondary, fontSize: 11 },
      },
      series: [{
        type: 'heatmap' as const,
        data: cells,
        itemStyle: { borderColor: theme.surface, borderWidth: 2, borderRadius: 3 },
        label: { show: true, color: theme.ink, fontSize: 11 },
      }],
    };
  }, [rate, theme, labels, t]);

  const pyramidOption = useMemo(() => {
    const values = pyramidMode === 'headcount' ? pyramid.headcount : pyramid.researchFte;
    return {
      textStyle: baseTextStyle(theme),
      legend: { top: 0, textStyle: { color: theme.inkSecondary, fontSize: 11 } },
      tooltip: { trigger: 'axis' as const, axisPointer: { type: 'shadow' as const }, ...baseTooltip(theme) },
      grid: { left: 8, right: 24, top: 32, bottom: 8, containLabel: true },
      xAxis: baseValueAxis(theme),
      yAxis: { ...baseCategoryAxis(theme), data: pyramid.brackets.map(labels.bracket) },
      series: pyramid.categories.map((c, ci) => ({
        name: labels.category[c],
        type: 'bar' as const,
        stack: 'total',
        data: values.map((row) => (row[ci] ? Number(row[ci].toFixed(2)) : null)),
        itemStyle: { color: theme.series[CATEGORY_SLOT[c]] },
        barMaxWidth: 36,
      })),
    };
  }, [pyramid, pyramidMode, theme, labels]);

  const distributionOption = useMemo(() => ({
    textStyle: baseTextStyle(theme),
    legend: { top: 0, textStyle: { color: theme.inkSecondary, fontSize: 11 } },
    tooltip: { trigger: 'axis' as const, axisPointer: { type: 'shadow' as const }, ...baseTooltip(theme) },
    grid: { left: 8, right: 24, top: 32, bottom: 8, containLabel: true },
    xAxis: { ...baseCategoryAxis(theme), data: distribution.steps, name: t`Publications`, nameLocation: 'middle' as const, nameGap: 26, nameTextStyle: { color: theme.inkMuted, fontSize: 11 } },
    yAxis: { ...baseValueAxis(theme), minInterval: 1 },
    series: distribution.categories.map((c, ci) => ({
      name: labels.category[c],
      type: 'bar' as const,
      stack: 'total',
      data: distribution.members.map((row) => row[ci] || null),
      itemStyle: { color: theme.series[CATEGORY_SLOT[c]] },
    })),
  }), [distribution, theme, labels, t]);

  const methodText = t`Rate = publications ÷ (research FTE × years of presence in the lab over the period). Age = publication year − birth year. A publication counts once in each age bracket where it has an author present that year. PhD students, emeriti and members without research FTE are out of the rate. Research FTE: value of the Annuaire, otherwise default from the grade (teacher-researcher 0.5, researcher 1, support staff 0), flagged as estimated. Brackets of fewer than 3 people are merged with a neighbour. Authors are matched to members by name: a member publishing under another spelling counts 0. The current year stops at the reference date. « All brackets » counts each publication once: it is lower than the sum of the brackets, and its rate may lie below most of them (a publication co-signed by two brackets counts in each).`;

  const downloadCsv = () => {
    const esc = (v: string | number) => {
      const s = String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const dec = (n: number | null, d: number) => (n === null ? '' : n.toFixed(d));
    const row = (label: string, b: Omit<PublicationRateResult['brackets'][number], 'key'>) =>
      [esc(label), b.people, dec(b.fteYears, 2), dec(b.estimatedFteYears, 2), b.publications, dec(b.rate, 2)].join(',');
    const lines = [
      'tranche_age,personnes,etp_recherche_annees,dont_etp_estimes,publications,publications_par_etp_an',
      ...rate.brackets.map((b) => row(labels.bracket(b.key), b)),
      row(t`All brackets`, rate.overall),
      '',
      esc(`${t`Structure`}: ${dataset.lab} · ${t`Period`}: ${periodLabel} · ${t`Population`}: ${populationLabel}`),
      esc(t`Method`) + ',' + esc(methodText),
    ];
    const blob = new Blob([`﻿${lines.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `taux-publication-age-etp-${dataset.slug}-${period.start}-${period.end}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };


  const pyramidToggle = (
    <div className="flex items-center gap-1.5">
      <button type="button" className={chip(pyramidMode === 'headcount')} onClick={() => setPyramidMode('headcount')}><Trans>Headcount</Trans></button>
      <button type="button" className={chip(pyramidMode === 'fte')} onClick={() => setPyramidMode('fte')}><Trans>Research FTE</Trans></button>
    </div>
  );

  const masked = rate.excluded.maskedUnknownAge;
  return (
    <div className="flex flex-col gap-4">
      {period.end >= currentYear && (
        <div className="glass-card p-3 flex items-start gap-2 text-xs text-muted dark:text-[#c3beb0]">
          <AlertTriangle className="w-4 h-4 shrink-0 text-status-external" />
          <Trans>The period includes {currentYear}, whose publications are not all harvested yet: the rate of that year is underestimated.</Trans>
        </div>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard label={t`Headcount`} value={fmt(kpis.headcount)} icon={<Users className="w-5 h-5" />} color={theme.series[3]}
          hint={filter.presence === 'period' ? t`Former members: ${staff.filter((m) => m.former).length}` : undefined} />
        <KpiCard label={t`Research FTE`} value={fmt(kpis.researchFte, 1)} icon={<Gauge className="w-5 h-5" />} color={theme.series[5]}
          hint={kpis.estimatedResearchFte > 0 ? t`of which ${fmt(kpis.estimatedResearchFte, 1)} estimated from the grade` : t`PhD students and emeriti excluded`} />
        <KpiCard label={t`Publications / research FTE / year`} value={kpis.publicationsPerFteYear === null ? '—' : fmt(kpis.publicationsPerFteYear, 2)}
          icon={<TrendingUp className="w-5 h-5" />} color={theme.series[2]} hint={periodLabel}
          onClick={onOpenList && rate.overall.authorYears.length ? () => openBracket('overall', rate.overall.authorYears) : undefined} />
        <KpiCard label={t`Publishing members`} value={kpis.publishingShare === null ? '—' : `${fmt(kpis.publishingShare * 100)} %`}
          icon={<Activity className="w-5 h-5" />} color={theme.series[0]}
          hint={kpis.unmatched > 0 ? t`Without matched author (excluded): ${kpis.unmatched}` : periodLabel} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <EChartCard
          title={t`Publication rate by age bracket`}
          subtitle={t`Publications per research FTE and per year, ${periodLabel} — age at publication; PhD students and emeriti excluded`}
          option={rateOption}
          exportName="chercheurs-taux-age-etp"
          shareable={false}
          height={340}
          emptyMessage={rate.brackets.length === 0 ? t`No research FTE in this population (missing values, or only PhD students and emeriti).` : undefined}
          onSeriesClick={onOpenList ? (p) => { const b = rate.brackets[p.dataIndex]; if (b) openBracket(b.key, b.authorYears); } : undefined}
        />
        <EChartCard
          title={t`Publications by age bracket and year`}
          subtitle={t`A publication counts once in each bracket where it has an author`}
          option={heatmapOption}
          exportName="chercheurs-age-annee"
          shareable={false}
          height={340}
          emptyMessage={rate.brackets.length === 0 ? t`No research FTE in this population (missing values, or only PhD students and emeriti).` : undefined}
        />
        <EChartCard
          title={t`Age pyramid`}
          subtitle={t`Age in ${currentYear}, by category`}
          option={pyramidOption}
          exportName="chercheurs-pyramide-ages"
          shareable={false}
          height={320}
          headerExtra={pyramidToggle}
          emptyMessage={pyramid.brackets.length === 0 ? t`Too few people with a known birth year to show the ages.` : undefined}
        />
        <EChartCard
          title={t`Publications per member`}
          subtitle={distribution.unmatched > 0
            ? t`Members by number of publications over ${periodLabel} — without matched author (left out): ${distribution.unmatched}`
            : t`Members by number of publications over ${periodLabel}`}
          option={distributionOption}
          exportName="chercheurs-publications-par-membre"
          shareable={false}
          height={320}
        />
      </div>

      <div className="glass-card p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea]">
            <Trans>Rate by age bracket — table</Trans>
          </h3>
          <button type="button" className="btn-pill !h-8 px-3 text-xs inline-flex items-center gap-1.5" onClick={downloadCsv}>
            <Download className="w-3.5 h-3.5" /> <Trans>Download CSV</Trans>
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted-light dark:text-[#8f897c]">
              <tr>
                <th className="px-3 py-2"><Trans>Age bracket</Trans></th>
                <th className="px-3 py-2 text-right"><Trans>Number of people</Trans></th>
                <th className="px-3 py-2 text-right"><Trans>Research FTE-years</Trans></th>
                <th className="px-3 py-2 text-right"><Trans>Publications</Trans></th>
                <th className="px-3 py-2 text-right"><Trans>Publications / FTE / year</Trans></th>
              </tr>
            </thead>
            <tbody>
              {[...rate.brackets, { ...rate.overall, key: 'overall' }].map((b) => (
                <tr key={b.key} className={`border-t border-ink/5 dark:border-white/10 ${b.key === 'overall' ? 'font-semibold' : ''}`}>
                  <td className="px-3 py-2">{b.key === 'overall' ? t`All brackets` : labels.bracket(b.key)}</td>
                  <td className="px-3 py-2 text-right">{b.people}</td>
                  <td className="px-3 py-2 text-right" title={b.estimatedFteYears > 0 ? t`of which ${fmt(b.estimatedFteYears, 1)} estimated from the grade` : undefined}>
                    {fmt(b.fteYears, 1)}{b.estimatedFteYears > 0 ? ' *' : ''}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {onOpenList && b.authorYears.length ? (
                      <button type="button" className="underline decoration-dotted hover:text-accent-strong" onClick={() => openBracket(b.key, b.authorYears)}>
                        {fmt(b.publications)}
                      </button>
                    ) : fmt(b.publications)}
                  </td>
                  <td className="px-3 py-2 text-right">{b.rate === null ? '—' : fmt(b.rate, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-muted-light dark:text-[#8f897c]">
          <Trans>Population: {populationLabel}.</Trans>{' '}
          {rate.excluded.phdOrEmeritus + rate.excluded.noResearchFte > 0 && (
            <Trans>Out of the rate: PhD students or emeriti ({rate.excluded.phdOrEmeritus}), without research FTE ({rate.excluded.noResearchFte}).</Trans>
          )}{' '}
          {masked > 0 && <Trans>Unknown age not shown: {masked} (fewer than 3 people).</Trans>}{' '}
          {rate.excluded.undatedFormer > 0 && <Trans>Former members without end date (left out): {rate.excluded.undatedFormer}.</Trans>}{' '}
          {rate.brackets.some((b) => b.estimatedFteYears > 0) && <Trans>* includes research FTE estimated from the grade.</Trans>}
        </p>
        <details className="text-[11px] text-muted-light dark:text-[#8f897c]">
          <summary className="cursor-pointer font-semibold"><Trans>Method</Trans></summary>
          <p className="mt-1 leading-relaxed">{methodText}</p>
        </details>
      </div>
    </div>
  );
};
