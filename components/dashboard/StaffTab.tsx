import React, { useMemo } from 'react';
import { Users, UserCheck, GraduationCap, PersonStanding, IdCard, ArrowUpRight } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import type { Researcher } from '../../types';
import { PRESENCE_LABELS } from '../../lib/researcherLabels';
import { Presence } from '../../types';
import { numberLocale } from '../../lib/i18n';
import { KpiCard } from './KpiCards';
import {
  EChartCard, baseTextStyle, baseTooltip, baseValueAxis, baseCategoryAxis, useVizTheme,
} from './EChartCard';
import type { VizTheme } from './palette';
import {
  AGE_GROUPS, AgeGroup, CountRow, IDENTIFIER_KEYS, IdentifierKey, PRESENCE_SLICES, PresenceSlice,
  ageGroups, directoryKpis, genderBreakdown, identifierCoverage, presenceBreakdown, primaryLabOf, topCounts,
} from '../../lib/staffDirectoryAggregates';

const fmt = (n: number) => n.toLocaleString(numberLocale());
const pctText = (n: number | null) => (n == null ? '—' : `${n} %`);

/** Donut of named slices (presence, gender). */
const Donut: React.FC<{
  title: string;
  subtitle?: string;
  exportName: string;
  items: { name: string; value: number; color: string }[];
}> = ({ title, subtitle, exportName, items }) => {
  const t = useVizTheme();
  const present = useMemo(() => items.filter((d) => d.value > 0), [items]);
  const option = useMemo(() => ({
    textStyle: baseTextStyle(t),
    tooltip: { trigger: 'item', formatter: '{b} : {c} ({d} %)', ...baseTooltip(t) },
    legend: { type: 'scroll', bottom: 0, textStyle: { color: t.inkSecondary, fontSize: 11 }, icon: 'circle', itemWidth: 10, itemHeight: 10 },
    series: [{
      type: 'pie',
      radius: ['42%', '68%'],
      center: ['50%', '44%'],
      avoidLabelOverlap: true,
      itemStyle: { borderColor: t.surface, borderWidth: 2 },
      label: { formatter: '{b}\n{d} %', color: t.inkSecondary, fontSize: 11 },
      data: present.map((d) => ({ name: d.name, value: d.value, itemStyle: { color: d.color } })),
    }],
  }), [present, t]);
  return <EChartCard title={title} subtitle={subtitle} option={option} exportName={exportName} shareable={false} />;
};

/** Horizontal ranking (employers, grades, employment types, labs). */
const Bars: React.FC<{
  title: string;
  subtitle?: string;
  exportName: string;
  rows: CountRow[];
  color: string;
  /** Label of the empty value. */
  emptyLabel: string;
  /** Total behind the percentages shown in the tooltip. */
  total: number;
}> = ({ title, subtitle, exportName, rows, color, emptyLabel, total }) => {
  const t = useVizTheme();
  const option = useMemo(() => {
    const sorted = [...rows].reverse();
    return {
      textStyle: baseTextStyle(t),
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (p: { dataIndex: number; value: number }[]) => {
          const row = sorted[p[0].dataIndex];
          const share = total > 0 ? Math.round((row.count / total) * 100) : 0;
          return `${row.name || emptyLabel} : ${fmt(row.count)} (${share} %)`;
        },
        ...baseTooltip(t),
      },
      grid: { left: 8, right: 40, top: 8, bottom: 8, containLabel: true },
      xAxis: baseValueAxis(t),
      yAxis: {
        ...baseCategoryAxis(t),
        data: sorted.map((d) => d.name || emptyLabel),
        axisLabel: { color: t.inkSecondary, width: 200, overflow: 'truncate' as const, fontSize: 11 },
      },
      series: [{
        type: 'bar',
        data: sorted.map((d) => d.count),
        itemStyle: { color, borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', fontSize: 10, color: t.inkSecondary },
      }],
    };
  }, [rows, color, emptyLabel, total, t]);
  return (
    <EChartCard
      title={title}
      subtitle={subtitle}
      option={option}
      exportName={exportName}
      shareable={false}
      height={Math.max(220, rows.length * 30 + 50)}
      emptyMessage={rows.length === 0 ? emptyLabel : undefined}
    />
  );
};

/** Colour of each presence slice on the current palette. */
const presenceColor = (t: VizTheme, key: PresenceSlice): string =>
  ({ home: t.series[2], external: t.series[1], unknown: t.inkMuted, depart: t.series[4], parti: t.series[3] })[key];

/**
 * « Directory » view of the People family (« Effectifs › Annuaire » in French): the Druid directory as of today, restricted to the
 * records with an active affiliation to the dashboard structure (lib/staffDirectoryAggregates.ts,
 * docs/plan-tableau-de-bord-familles.md D3). Charts are not shareable: the directory is not part
 * of the druid-biblio export behind the embed page and the reports.
 */
export const StaffTab: React.FC<{
  researchers: Researcher[];
  /** Displayed name of the structure (dataset.lab). */
  structureLabel: string;
  /** Age groups from the birth dates — only when the biblio export lacks the age pyramid. */
  showAgeGroups: boolean;
  /** Opens the People page filtered on this structure. */
  onOpenPeople?: () => void;
}> = ({ researchers, structureLabel, showAgeGroups, onOpenPeople }) => {
  const { t: tr, i18n } = useLingui();
  const t = useVizTheme();
  const notProvided = tr`Not provided`;

  const kpis = useMemo(() => directoryKpis(researchers), [researchers]);
  const presence = useMemo(() => presenceBreakdown(researchers), [researchers]);
  const gender = useMemo(() => genderBreakdown(researchers), [researchers]);
  const ids = useMemo(() => identifierCoverage(researchers), [researchers]);
  const employers = useMemo(() => topCounts(researchers, (r) => r.employment.employer, 8), [researchers]);
  const grades = useMemo(() => topCounts(researchers, (r) => r.employment.grade, 8), [researchers]);
  const contracts = useMemo(() => topCounts(researchers, (r) => r.employment.contractType, 10), [researchers]);
  const labs = useMemo(() => topCounts(researchers, primaryLabOf, 8), [researchers]);
  const currentYear = new Date().getFullYear();
  const ages = useMemo(() => ageGroups(researchers, currentYear), [researchers, currentYear]);

  const presenceItems = useMemo(() => {
    const labels: Record<PresenceSlice, string> = {
      home: tr`Present — institution`,
      external: tr`Present — other employer`,
      unknown: tr`Present — employer not specified`,
      depart: tr(PRESENCE_LABELS[Presence.DEPART]),
      parti: tr(PRESENCE_LABELS[Presence.PARTI]),
    };
    return PRESENCE_SLICES.map((key) => ({ name: labels[key], value: presence[key], color: presenceColor(t, key) }));
  }, [presence, t, tr]);

  const genderItems = useMemo(() => [
    { name: tr`Women`, value: gender.women, color: t.series[6] },
    { name: tr`Men`, value: gender.men, color: t.series[3] },
    { name: tr`Other`, value: gender.other, color: t.series[0] },
    { name: tr`Unknown`, value: gender.unknown, color: t.inkMuted },
  ], [gender, t, tr]);

  const idOption = useMemo(() => {
    const names: Record<IdentifierKey, string> = { orcid: 'ORCID', idref: 'IdRef', hal: 'HAL', scopus: 'Scopus', openalex: 'OpenAlex' };
    const total = researchers.length;
    return {
      textStyle: baseTextStyle(t),
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (p: { dataIndex: number; value: number }[]) => {
          const key = IDENTIFIER_KEYS[p[0].dataIndex];
          const share = total > 0 ? Math.round((ids[key] / total) * 100) : 0;
          return `${names[key]} : ${fmt(ids[key])} / ${fmt(total)} (${share} %)`;
        },
        ...baseTooltip(t),
      },
      grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
      xAxis: { ...baseCategoryAxis(t), data: IDENTIFIER_KEYS.map((k) => names[k]) },
      yAxis: { ...baseValueAxis(t), max: total > 0 ? total : undefined },
      series: [{
        type: 'bar',
        data: IDENTIFIER_KEYS.map((k) => ids[k]),
        itemStyle: { color: t.series[0], borderRadius: [4, 4, 0, 0] },
        barMaxWidth: 48,
        label: {
          show: true,
          position: 'top',
          fontSize: 10,
          color: t.inkSecondary,
          formatter: (p: { value: number }) => (total > 0 ? `${Math.round((p.value / total) * 100)} %` : ''),
        },
      }],
    };
  }, [ids, researchers.length, t]);

  const ageOption = useMemo(() => {
    const labels: Record<AgeGroup, string> = {
      under30: tr`30 and under`, '31to45': tr`31–45`, '46to60': tr`46–60`, over60: tr`61 and over`,
    };
    return {
      textStyle: baseTextStyle(t),
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...baseTooltip(t) },
      grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
      xAxis: { ...baseCategoryAxis(t), data: AGE_GROUPS.map((k) => labels[k]) },
      yAxis: baseValueAxis(t),
      series: [{
        type: 'bar',
        data: AGE_GROUPS.map((k) => ages[k]),
        itemStyle: { color: t.series[2], borderRadius: [4, 4, 0, 0] },
        barMaxWidth: 48,
        label: { show: true, position: 'top', fontSize: 10, color: t.inkSecondary },
      }],
    };
  }, [ages, t, tr]);

  const kpiColor = (slot: number) => t.series[slot];
  const presentHint = tr`${fmt(kpis.leaving)} leaving · ${fmt(kpis.left)} left`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <p className="text-[12px] text-muted-light dark:text-[#8f897c]">
          <Trans>
            Druid directory as of {new Date().toLocaleDateString(i18n.locale)} — {fmt(researchers.length)} records with an active affiliation to {structureLabel}. Live data, independent of the period and scope above.
          </Trans>
        </p>
        {onOpenPeople && (
          <button type="button" className="btn-pill !h-8 px-3 text-xs" onClick={onOpenPeople}>
            <ArrowUpRight className="w-3.5 h-3.5" /> <Trans>Open the list in People</Trans>
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
        <KpiCard label={tr`Headcount`} value={fmt(kpis.total)} hint={presentHint} icon={<Users className="w-4 h-4" />} color={kpiColor(3)} />
        <KpiCard label={tr`Present`} value={fmt(kpis.present)} hint={tr`${fmt(presence.home)} institution · ${fmt(presence.external)} other employer`} icon={<UserCheck className="w-4 h-4" />} color={kpiColor(2)} />
        <KpiCard label={tr`HDR holders`} value={fmt(kpis.hdr)} hint={tr`${pctText(kpis.hdrRate)} of the headcount`} icon={<GraduationCap className="w-4 h-4" />} color={kpiColor(1)} />
        <KpiCard label={tr`Women`} value={pctText(kpis.womenShare)} hint={tr`${fmt(kpis.women)} women · ${fmt(kpis.men)} men`} icon={<PersonStanding className="w-4 h-4" />} color={kpiColor(6)} />
        <KpiCard label={tr`ORCID filled in`} value={pctText(kpis.orcidRate)} hint={tr`${fmt(kpis.orcid)} records`} icon={<IdCard className="w-4 h-4" />} color={kpiColor(0)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
        <Donut title={tr`Presence and employer`} subtitle={tr`Present staff by employer kind, then announced and effective departures`} exportName="effectifs-presence" items={presenceItems} />
        <Donut title={tr`Gender balance`} subtitle={tr`From the civility of the records`} exportName="effectifs-genre" items={genderItems} />
        <EChartCard title={tr`Identifier coverage`} subtitle={tr`Records carrying each identifier (share of the headcount)`} option={idOption} exportName="effectifs-identifiants" shareable={false} />
        {showAgeGroups && (
          <EChartCard title={tr`Age groups`} subtitle={tr`Age in ${currentYear}, records with a birth date`} option={ageOption} exportName="effectifs-ages" shareable={false} />
        )}
        <Bars title={tr`Employers`} subtitle={tr`Top 8 paying institutions`} exportName="effectifs-employeurs" rows={employers} color={t.series[1]} emptyLabel={notProvided} total={researchers.length} />
        <Bars title={tr`Grades`} subtitle={tr`Top 8 corps / grades`} exportName="effectifs-grades" rows={grades} color={t.series[3]} emptyLabel={notProvided} total={researchers.length} />
        <Bars title={tr`Employment types`} subtitle={tr`Top 10`} exportName="effectifs-types-emploi" rows={contracts} color={t.series[5]} emptyLabel={notProvided} total={researchers.length} />
        {labs.filter((l) => l.name).length > 1 && (
          <Bars title={tr`Breakdown by lab`} subtitle={tr`Primary affiliation, top 8`} exportName="effectifs-labos" rows={labs} color={t.series[0]} emptyLabel={notProvided} total={researchers.length} />
        )}
      </div>
    </div>
  );
};
