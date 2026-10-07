import React, { useEffect, useMemo, useState } from 'react';
import { DashboardDataset } from './types';
import { YearRange } from './overviewAggregates';
import {
  aggregateCollabTypology,
  aggregateInternalCollab,
  partnerLabProvenance,
  aggregateNationalCollab,
  internalLabsOf,
  hasSubStructures,
  InternalCollabAggregates,
} from './collabAggregates';
import { InternationalTab } from './InternationalTab';
import { PartnerBilanSection } from './PartnerBilanSection';
import { CountrySection } from './CountrySection';
import { PubFilters } from './publicationFilters';
import { TeamDonutChart, RankBarChart } from './charts/TeamCharts';
import { YearlyEvolutionChart } from './charts/YearlyEvolutionChart';
import { SankeyChart } from './charts/SankeyChart';
import { FranceMapChart } from './charts/FranceMapChart';
import {
  EChartCard,
  baseTextStyle,
  baseTooltip,
  baseValueAxis,
  baseCategoryAxis,
  useVizTheme,
} from './EChartCard';
import { VizTheme } from './palette';
import { numberLocale } from '../../lib/i18n';
import { Trans, useLingui } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';

/** Stable color per collaboration category (consistent between donut and evolution). */
function typologyColors(t: VizTheme): Record<string, string> {
  return {
    Internationales: t.series[4], // orange — as in the International tab
    'Nationales (hors NU)': t.series[3], // blue
    'Autre labo Nantes Université': t.series[2], // green
    'Entre labos de la structure': t.series[0], // purple
    'Pas de collaboration': '#8c8677', // neutral gray
  };
}

/** Displayed labels of the collaboration categories (keys = short labels of COLLAB_EXCLUSIVE). */
const TYPOLOGY_LABELS: Record<string, MessageDescriptor> = {
  Internationales: msg({ message: `International`, context: "feminine plural" }),
  'Nationales (hors NU)': msg`National (outside NU)`,
  'Autre labo Nantes Université': msg`Other Nantes Université lab`,
  'Entre labos de la structure': msg`Between labs of the structure`,
  'Pas de collaboration': msg`No collaboration`,
};

/** Stacked yearly evolution per collaboration category (also in the chart registry). */
export const TypologyEvolutionChart: React.FC<{
  data: { keys: string[]; years: number[]; series: { name: string; data: number[] }[] };
}> = ({ data }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const option = useMemo(() => {
    const colors = typologyColors(t);
    return {
      textStyle: baseTextStyle(t),
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...baseTooltip(t) },
      legend: {
        type: 'scroll',
        bottom: 0,
        textStyle: { color: t.inkSecondary, fontSize: 11 },
        icon: 'circle',
        itemWidth: 10,
        itemHeight: 10,
      },
      grid: { left: 8, right: 16, top: 16, bottom: 40, containLabel: true },
      xAxis: { ...baseCategoryAxis(t), data: data.years.map(String) },
      yAxis: baseValueAxis(t),
      series: data.series.map((s, i) => ({
        name: TYPOLOGY_LABELS[s.name] ? tr(TYPOLOGY_LABELS[s.name]) : s.name,
        type: 'bar',
        stack: 'total',
        data: s.data,
        itemStyle: {
          color: colors[s.name] ?? t.series[i % t.series.length],
          borderColor: t.surface,
          borderWidth: 1,
          ...(i === data.series.length - 1 ? { borderRadius: [4, 4, 0, 0] } : {}),
        },
      })),
    };
  }, [data, t, tr]);
  return (
    <EChartCard
      title={tr`Evolution of collaboration types`}
      option={option}
      exportName="collab-typologie-evolution"
    />
  );
};

/** Collaboration types donut, translated labels and stable colors (tab and registry). */
export const TypologyDonutChart: React.FC<{
  data: { key: string; count: number }[];
  subtitle?: string;
}> = ({ data, subtitle }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const colors = typologyColors(t);
  return (
    <TeamDonutChart
      title={tr`Collaboration types`}
      subtitle={subtitle}
      exportName="collab-typologie"
      data={data.map((c) => ({
        name: TYPOLOGY_LABELS[c.key] ? tr(TYPOLOGY_LABELS[c.key]) : c.key,
        value: c.count,
        color: colors[c.key],
      }))}
    />
  );
};

/** Domains of internal co-publications (`idPrefix` = collab-structure | collab-nu). */
export const InternalCollabDomainsChart: React.FC<{
  agg: InternalCollabAggregates;
  idPrefix: string;
  onSelect?: (domain: string) => void;
}> = ({ agg, idPrefix, onSelect }) => {
  const { t } = useLingui();
  return (
    <TeamDonutChart
      title={t`Domains of co-publications`}
      exportName={`${idPrefix}-domaines`}
      data={agg.domains.map((d) => ({ name: d.key, value: d.count }))}
      onSelect={onSelect}
    />
  );
};

/** Subfields of internal co-publications. */
export const InternalCollabSubfieldsChart: React.FC<{
  agg: InternalCollabAggregates;
  idPrefix: string;
  onItemClick?: (subfield: string) => void;
}> = ({ agg, idPrefix, onItemClick }) => {
  const { t } = useLingui();
  return (
    <RankBarChart
      title={t`Subfields of co-publications`}
      exportName={`${idPrefix}-sous-disciplines`}
      data={agg.topSubfields.map((s) => ({ label: s.key, count: s.count, teams: [] }))}
      colorSlot={3}
      height={Math.max(280, agg.topSubfields.length * 26 + 60)}
      onItemClick={onItemClick}
    />
  );
};

/** Collaboration topics by lab (Sankey). */
export const InternalCollabSankeyChart: React.FC<{
  agg: InternalCollabAggregates;
  idPrefix: string;
}> = ({ agg, idPrefix }) => {
  const { t } = useLingui();
  return (
    <SankeyChart
      nodes={agg.sankey.nodes}
      links={agg.sankey.links}
      title={t`Collaboration topics by lab`}
      subtitle={t`Width ∝ shared co-publications (top OpenAlex subfields)`}
      exportName={`${idPrefix}-sankey`}
      height={Math.max(360, agg.sankey.nodes.length * 22 + 80)}
    />
  );
};

/** Block shared by internal collaborations (intra-structure, other NU labs). */
const InternalCollabSection: React.FC<{
  agg: InternalCollabAggregates;
  caption: string;
  metricLabel: string;
  idPrefix: string;
  labWord: string;
  /** Filter to apply for a co-signing lab (sub-structure or NU lab). */
  labFilter?: (lab: string) => PubFilters;
  onOpenList?: (filters: PubFilters) => void;
}> = ({ agg, caption, metricLabel, idPrefix, labWord, labFilter, onOpenList }) => {
  const { t } = useLingui();
  if (agg.total === 0) {
    return (
      <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
        <Trans>No publication concerned over the period.</Trans>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted dark:text-[#c3beb0] px-1">
        {caption} — <strong className="text-ink dark:text-[#f5f2ea]">
          {agg.total.toLocaleString(numberLocale())}
        </strong>{' '}
        {metricLabel}.
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RankBarChart
          title={t`Most co-signing ${labWord}`}
          exportName={`${idPrefix}-top`}
          data={agg.topLabs.map((l) => ({ label: l.key, count: l.count, teams: [] }))}
          colorSlot={2}
          height={Math.max(280, agg.topLabs.length * 26 + 60)}
          onItemClick={onOpenList && labFilter ? (lab) => onOpenList(labFilter(lab)) : undefined}
        />
        <YearlyEvolutionChart
          data={agg.byYear}
          title={t`Yearly evolution`}
          exportName={`${idPrefix}-evolution`}
          colorSlot={2}
        />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-2">
          <InternalCollabDomainsChart
            agg={agg}
            idPrefix={idPrefix}
            onSelect={onOpenList ? (domain) => onOpenList({ domain }) : undefined}
          />
        </div>
        <div className="lg:col-span-3">
          <InternalCollabSubfieldsChart
            agg={agg}
            idPrefix={idPrefix}
            onItemClick={onOpenList ? (subfield) => onOpenList({ subfield }) : undefined}
          />
        </div>
      </div>
      {agg.sankey.links.length > 0 && <InternalCollabSankeyChart agg={agg} idPrefix={idPrefix} />}
    </div>
  );
};

type SubTab = 'typology' | 'structure' | 'nantes' | 'national' | 'international' | 'country' | 'partners';
const SUB_TABS: SubTab[] = ['typology', 'structure', 'nantes', 'national', 'international', 'country', 'partners'];

/** Sub-tab of the shareable link (`?sub=`, docs/plan-collaboration-pays.md § 2). */
const readSubTab = (): SubTab => {
  const v = new URLSearchParams(window.location.search).get('sub');
  return SUB_TABS.includes(v as SubTab) ? (v as SubTab) : 'typology';
};
const writeSubTab = (sub: SubTab | null) => {
  const p = new URLSearchParams(window.location.search);
  if (sub && sub !== 'typology') p.set('sub', sub);
  else p.delete('sub');
  window.history.replaceState(window.history.state, '', `${window.location.pathname}?${p.toString()}`);
};

/**
 * « Collaborations » tab — full port of the Streamlit _tab_collaborations,
 * in four nested scopes: within the structure (composite structures),
 * with the other « Nantes Université » labs, national (outside NU) and
 * international.
 */
export const CollaborationsTab: React.FC<{
  dataset: DashboardDataset;
  range: YearRange;
  onOpenList?: (filters: PubFilters) => void;
}> = ({ dataset, range, onOpenList }) => {
  const { t: tr } = useLingui();
  const { publications } = dataset;
  const composite = useMemo(() => hasSubStructures(publications), [publications]);
  const [sub, setSub] = useState<SubTab>(readSubTab);
  useEffect(() => writeSubTab(sub), [sub]);
  // A shared link may point to « Within the structure » on a structure without sub-structures.
  useEffect(() => { if (sub === 'structure' && !composite) setSub('typology'); }, [sub, composite]);
  useEffect(() => () => writeSubTab(null), []);

  const typology = useMemo(
    () => aggregateCollabTypology(publications, range),
    [publications, range],
  );
  const intra = useMemo(
    () =>
      sub === 'structure'
        ? aggregateInternalCollab(publications, range, internalLabsOf)
        : null,
    [publications, range, sub],
  );
  const nantes = useMemo(
    () =>
      sub === 'nantes'
        ? aggregateInternalCollab(publications, range, (p) => p.nantesPartners)
        : null,
    [publications, range, sub],
  );
  const nantesProvenance = useMemo(
    () => (sub === 'nantes' ? partnerLabProvenance(publications, range) : null),
    [publications, range, sub],
  );
  const national = useMemo(
    () => (sub === 'national' ? aggregateNationalCollab(publications, range) : null),
    [publications, range, sub],
  );

  const subTabs: { key: SubTab; label: string }[] = [
    { key: 'typology', label: tr`Typology` },
    ...(composite ? [{ key: 'structure' as SubTab, label: tr`Within the structure` }] : []),
    { key: 'nantes', label: tr`Nantes Université` },
    { key: 'national', label: tr`National` },
    { key: 'international', label: tr({ message: `International`, context: "feminine plural" }) },
    { key: 'country', label: tr`By country` },
    { key: 'partners', label: tr`Partner institutions` },
  ];

  const subBtn = (active: boolean) =>
    `pill px-3 py-1 text-xs transition-colors cursor-pointer ${
      active
        ? 'bg-accent text-ink shadow-nav-active'
        : 'bg-white/50 dark:bg-white/5 text-muted dark:text-[#c3beb0] hover:bg-white dark:hover:bg-white/10'
    }`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {subTabs.map(({ key, label }) => (
          <button key={key} type="button" className={subBtn(sub === key)} onClick={() => setSub(key)}>
            {label}
          </button>
        ))}
      </div>

      {sub === 'typology' && (
        <>
          {typology.typed === 0 ? (
            <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
              <Trans>The collaboration typology is not filled in for this corpus (run <code className="font-mono text-xs">scripts/backfill_collaborations.py</code>).</Trans>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
              <div className="lg:col-span-2">
                <TypologyDonutChart
                  data={typology.byCategory}
                  subtitle={tr`Broadest category per publication · ${typology.typed.toLocaleString(numberLocale())} typed publications`}
                />
              </div>
              <div className="lg:col-span-3">
                <TypologyEvolutionChart data={typology.byYear} />
              </div>
            </div>
          )}
        </>
      )}

      {sub === 'structure' && intra && (
        <InternalCollabSection
          agg={intra}
          caption={tr`Co-publications between ${dataset.lab} labs (≥ 2 internal sub-structures signing)`}
          metricLabel={tr`internal co-publications`}
          idPrefix="collab-structure"
          labWord={tr`Labs`}
          onOpenList={onOpenList}
          labFilter={(lab) => ({ sousStructure: lab })}
        />
      )}

      {sub === 'nantes' && nantes && (
        <InternalCollabSection
          agg={nantes}
          caption={tr`Co-publications with other Nantes Université labs (outside the current structure)`}
          metricLabel={tr`publications with ≥ 1 other NU lab`}
          idPrefix="collab-nu"
          labWord={tr`Labs`}
          onOpenList={onOpenList}
          labFilter={(lab) => ({ nantesPartner: lab })}
        />
      )}
      {sub === 'nantes' && nantes && nantes.total > 0 && nantesProvenance && nantesProvenance.graphOnly > 0 && (
        <p className="text-xs text-muted-light dark:text-[#8f897c] px-1">
          <Trans>
            Including {nantesProvenance.graphOnly.toLocaleString(numberLocale())} publications found only through the co-authors' lab memberships in the CRISalid graph (for instance clinicians who sign « CHU Nantes » without their lab).
          </Trans>
        </p>
      )}

      {sub === 'national' && national && (
        <>
          {national.total === 0 ? (
            <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
              <Trans>No national partners identified (run <code className="font-mono text-xs">scripts/backfill_collaborations.py</code>).</Trans>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted dark:text-[#c3beb0] px-1">
                <Trans>
                  Co-signing French institutions (outside Nantes Université) — <strong className="text-ink dark:text-[#f5f2ea]">{national.total.toLocaleString(numberLocale())}</strong> publications with ≥ 1 national partner.
                </Trans>
              </p>
              <FranceMapChart points={national.mapPoints} />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <RankBarChart
                  title={tr`Most co-signing institutions`}
                  exportName="collab-national-top"
                  data={national.topInstitutions.map((i) => ({ label: i.key, count: i.count, teams: [] }))}
                  colorSlot={3}
                  height={Math.max(280, national.topInstitutions.length * 26 + 60)}
                  onItemClick={onOpenList ? (name) => onOpenList({ nationalPartner: name }) : undefined}
                />
                <YearlyEvolutionChart
                  data={national.byYear}
                  title={tr`Yearly evolution`}
                  exportName="collab-national-evolution"
                  colorSlot={3}
                />
              </div>
            </div>
          )}
        </>
      )}

      {sub === 'international' && <InternationalTab dataset={dataset} range={range} />}

      {sub === 'country' && <CountrySection dataset={dataset} range={range} onOpenList={onOpenList} />}

      {sub === 'partners' && (
        <PartnerBilanSection dataset={dataset} range={range} onOpenList={onOpenList} />
      )}
    </div>
  );
};
