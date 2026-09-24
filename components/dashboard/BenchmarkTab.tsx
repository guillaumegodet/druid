import React, { useEffect, useMemo, useState } from 'react';
import {
  Target, Award, Quote, TrendingUp, Layers3, Search, X, Users, SlidersHorizontal, Save, ChevronRight, Compass,
} from 'lucide-react';
import { DashboardDataset } from './types';
import { BenchmarkLeidenIndicator } from './types';
import { YearRange } from './overviewAggregates';
import {
  computeSpecialisationProfile,
  describeSpecialisation,
  computeCitationWeightedSignature,
  computePeerGroupIndicators,
  computeWeightedScore,
  computeGeographicPeerGroup,
  computeSizeDecilePeerGroup,
  computeConsortiumPeerGroups,
  computeEstablishmentTypePeerGroups,
  rankPeersByWeightedScore,
  computePeerRelativeTopicSignature,
  MIN_SIGNATURE_COUNT,
  SignatureSubfield,
  SubfieldCitationImpact,
  LeidenPeer,
  LeidenWeights,
  PredefinedPeerGroup,
  RankedPeer,
  PeerTopicDistributionResponse,
  TopicPeerSignature,
  LEIDEN_WEIGHT_PRESETS,
} from './benchmarkAggregates';
import { KpiCard } from './KpiCards';
import {
  EChartCard,
  baseTextStyle,
  baseTooltip,
  baseValueAxis,
  baseCategoryAxis,
  useVizTheme,
} from './EChartCard';
import { numberLocale } from '../../lib/i18n';
import { usePersistedState } from '../../lib/usePersistedState';
import { Trans, Plural, useLingui } from '@lingui/react/macro';
import { i18n, type MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { apiErrorText } from '../../lib/apiErrors';

const nf = (v: number) => v.toLocaleString(numberLocale());

/** Short HTML ordinal for ECharts tooltips (« 42<sup>e</sup> » / « 42<sup>nd</sup> »). */
const ordinalHtml = (n: number): string => {
  if (i18n.locale === 'en') {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return `${n}<sup>${s[(v - 20) % 10] ?? s[v] ?? s[0]}</sup>`;
  }
  return `${n}<sup>e</sup>`;
};
/** Same ordinal in plain text (summary sentence). */
const ordinalText = (n: number): string => ordinalHtml(n).replace(/<\/?sup>/g, '');

/** Mirror of MAX_PEER_TOPIC_RORS on the group_api.py side — deliberate cap of the on-demand
 * computation of the peer-relative signature at Topic level (phase 7). */
const MAX_PEER_TOPIC_RORS = 15;

const LEIDEN_LABELS: Record<string, MessageDescriptor> = {
  P: msg`Publications (P)`,
  MNCS: msg`Mean normalised impact (MNCS)`,
  PP_top10: msg`Share in the world top 10%`,
  PP_top1: msg`Share in the world top 1%`,
  PP_collab: msg`Collaborative share`,
  PP_int_collab: msg`International collaboration share`,
  PP_OA: msg`Open access share`,
  PP_10_cits: msg`Share with ≥ 10 citations`,
};
/** Translated label of a Leiden indicator (raw key as fallback). */
const leidenLabel = (key: string): string => (LEIDEN_LABELS[key] ? i18n._(LEIDEN_LABELS[key]) : key);
/** Indicators available in « publications core » mode (default) — the only mode where MNCS/
 * PP_top_* (field-normalized) are computed by Leiden. */
const LEIDEN_ORDER = ['P', 'MNCS', 'PP_top10', 'PP_top1', 'PP_collab', 'PP_int_collab', 'PP_OA'];
/** Indicators available in « toutes les publications » mode (see
 * the benchmark action plan phase 3) — PP_10_cits (absolute citation
 * threshold, not normalized) replaces MNCS/PP_top_*, unavailable outside the core
 * subset. Deliberately not a mere relabeling: Leiden simply does not compute
 * these normalized indicators outside the core corpus. */
const LEIDEN_ORDER_ALL_PUBS = ['P', 'PP_10_cits', 'PP_collab', 'PP_int_collab', 'PP_OA'];
const LEIDEN_DEFINITIONS: Record<string, MessageDescriptor> = {
  P: msg`Number of publications over 2020-2023 (Leiden Ranking Open Edition).`,
  MNCS: msg`Mean Normalized Citation Score: mean citation impact, normalised by field/year/type. 1 = world average.`,
  PP_top10: msg`Share of publications among the 10% most cited worldwide (comparable field/year).`,
  PP_top1: msg`Share of publications among the 1% most cited worldwide (comparable field/year).`,
  PP_collab: msg`Share of publications co-signed with at least one other institution.`,
  PP_int_collab: msg`Share of publications co-signed with at least one foreign institution.`,
  PP_OA: msg`Share of open access publications (all types).`,
  PP_10_cits: msg`Share of publications with at least 10 citations — absolute threshold, NOT normalised by field/year (unlike PP_top10/PP_top1): the only citation impact indicator computed by Leiden outside the “core” subset.`,
};
const leidenDefinition = (key: string): string => (LEIDEN_DEFINITIONS[key] ? i18n._(LEIDEN_DEFINITIONS[key]) : leidenLabel(key));

/** « ? » badge — explanation on hover/focus, for acronyms and technical notions
 * that have no chart methodology sheet (tables, KPIs). */
const HelpTip: React.FC<{ text: string }> = ({ text }) => (
  <span
    tabIndex={0}
    title={text}
    className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full border border-muted-light dark:border-[#8f897c] text-[9px] leading-none text-muted-light dark:text-[#8f897c] cursor-help shrink-0 align-middle"
  >
    ?
  </span>
);

/** Filter/method chip (e.g. « publications core », « comptage complet »,
 * « période 2020–2023 ») — makes explicit what is today implicit/scattered
 * between methodology notes and header (see the benchmark action plan
 * phase 1, takes up the « FilterChip » idea from the benchmark dev journal). Purely informative
 * for now (no active filter behind it) — will become clickable if a real
 * core/non-core toggle is added in phase 3. */
const FilterChip: React.FC<{ label: string; hint?: string }> = ({ label, hint }) => (
  <span
    title={hint}
    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-accent/15 text-ink dark:text-[#f5f2ea] border border-accent/25 cursor-default"
  >
    {label}
  </span>
);

const FilterChipRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex flex-wrap gap-1.5 px-1 -mt-1">{children}</div>
);

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(numberLocale(), { year: 'numeric', month: 'long', day: 'numeric' }) : null;

/** Section title (page level — groups several charts under the same reading
 * question), distinct from individual chart titles. */
const SectionHeader: React.FC<{ title: string; subtitle?: string }> = ({ title, subtitle }) => (
  <div className="px-1 pt-3 first:pt-0">
    <h2 className="font-disp font-bold text-lg text-ink dark:text-[#f5f2ea]">{title}</h2>
    {subtitle && <p className="text-sm text-muted dark:text-[#c3beb0] mt-0.5">{subtitle}</p>}
  </div>
);

/** Collapses the technical detail by default (comparison with peers, subfields
 * one by one…) so that a non-bibliometrician reader only has, by default, the summary
 * reading in front of them — the detail stays one click away for whoever wants to dig. */
const CollapsibleSection: React.FC<{
  title: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, icon, defaultOpen = false, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-sm font-semibold text-ink dark:text-[#f5f2ea] hover:text-accent transition-colors cursor-pointer w-fit"
      >
        <ChevronRight className={`w-4 h-4 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        {icon}
        {title}
      </button>
      {open && <div className="flex flex-col gap-4 pl-1">{children}</div>}
    </div>
  );
};

/** Percentiles Leiden Ranking Open Edition (barres horizontales 0-100). */
const LeidenPercentileChart: React.FC<{
  indicators: Record<string, { value: number; percentile: number | null }>;
  order?: string[];
  title?: string;
  subtitle?: string;
  exportName?: string;
  percentileLabel?: string;
}> = ({
  indicators,
  order = LEIDEN_ORDER,
  title: titleProp,
  subtitle: subtitleProp,
  exportName = 'benchmark-leiden-percentiles',
  percentileLabel: percentileLabelProp,
}) => {
  const t = useVizTheme();
  const { t: tr, i18n: li } = useLingui();
  const title = titleProp ?? tr`Position vs Leiden Ranking Open Edition`;
  const subtitle = subtitleProp ?? tr`World percentile (0-100) among the universities of the reference set · higher = better ranked`;
  const percentileLabel = percentileLabelProp ?? tr`world percentile`;
  const rows = order
    .map((key) => ({ key, ...indicators[key] }))
    .filter((r) => r.percentile != null);
  const option = useMemo(
    () => ({
      textStyle: baseTextStyle(t),
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (p: { dataIndex: number }[]) => {
          const d = rows[p[0].dataIndex];
          return `${leidenLabel(d.key)}<br/>${ordinalHtml(d.percentile as number)} ${percentileLabel} ${tr`(value: ${d.value})`}`;
        },
        ...baseTooltip(t),
      },
      grid: { left: 8, right: 32, top: 8, bottom: 8, containLabel: true },
      xAxis: { ...baseValueAxis(t), min: 0, max: 100, name: tr`percentile`, nameTextStyle: { color: t.inkMuted, fontSize: 11 } },
      yAxis: {
        ...baseCategoryAxis(t),
        data: rows.map((r) => leidenLabel(r.key)),
        axisLabel: { color: t.inkSecondary, fontSize: 11, width: 220, overflow: 'truncate' as const },
      },
      series: [
        {
          type: 'bar',
          data: rows.map((r) => ({ value: r.percentile, itemStyle: { color: t.series[0], borderRadius: [0, 4, 4, 0] } })),
          label: { show: true, position: 'right', fontSize: 10, color: t.inkSecondary, formatter: '{c}' },
        },
      ],
    }),
    [rows, t, tr, percentileLabel, li.locale],
  );
  return (
    <EChartCard
      title={title}
      subtitle={subtitle}
      option={option}
      exportName={exportName}
      height={Math.max(260, rows.length * 42 + 90)}
      shareable={false}
    />
  );
};

/** Most over-represented subfields vs the OpenAlex world baseline. */
const SignatureChart: React.FC<{ data: SignatureSubfield[] }> = ({ data }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const option = useMemo(() => {
    const sorted = [...data].sort((a, b) => a.ratio - b.ratio);
    return {
      textStyle: baseTextStyle(t),
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (p: { dataIndex: number }[]) => {
          const d = sorted[p[0].dataIndex];
          return `${d.key}<br/>${tr`${nf(d.count)} publication(s) — × ${d.ratio.toFixed(1)} vs world share (${(d.worldShare * 100).toFixed(2)}% of world publications)`}`;
        },
        ...baseTooltip(t),
      },
      grid: { left: 8, right: 48, top: 8, bottom: 8, containLabel: true },
      xAxis: { ...baseValueAxis(t), name: tr`× world share`, nameTextStyle: { color: t.inkMuted, fontSize: 11 } },
      yAxis: {
        ...baseCategoryAxis(t),
        data: sorted.map((d) => d.key),
        axisLabel: { color: t.inkSecondary, fontSize: 11, width: 240, overflow: 'truncate' as const },
      },
      series: [
        {
          type: 'bar',
          data: sorted.map((d) => ({
            value: Math.round(d.ratio * 10) / 10,
            itemStyle: { color: t.series[4], borderRadius: [0, 4, 4, 0] },
          })),
          label: { show: true, position: 'right', fontSize: 10, color: t.inkSecondary, formatter: '×{c}' },
        },
      ],
    };
  }, [data, t, tr]);
  return (
    <EChartCard
      title={tr`Disciplinary signatures vs world reference`}
      subtitle={tr`Ratio local share / OpenAlex world share · subfields with ≥ ${MIN_SIGNATURE_COUNT} publications`}
      option={option}
      exportName="benchmark-signature"
      height={Math.max(300, data.length * 28 + 90)}
      shareable={false}
    />
  );
};

/** Subfields with high citation intensity (see
 * the benchmark action plan phase 6) — NOT the same reading as
 * SignatureChart above: purely local ratio (share of citations / share of the
 * institution's publications), without comparison to the world. Complements volume with
 * impact, without claiming to reproduce Leiden's normalized methodology. */
const CitationImpactChart: React.FC<{ data: SubfieldCitationImpact[] }> = ({ data }) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const option = useMemo(() => {
    const sorted = [...data].sort((a, b) => a.impactRatio - b.impactRatio);
    return {
      textStyle: baseTextStyle(t),
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (p: { dataIndex: number }[]) => {
          const d = sorted[p[0].dataIndex];
          return `${d.key}<br/>${tr`${nf(d.citations)} citation(s) over ${nf(d.count)} publication(s) — × ${d.impactRatio.toFixed(1)} this subfield's share of publications`}`;
        },
        ...baseTooltip(t),
      },
      grid: { left: 8, right: 48, top: 8, bottom: 8, containLabel: true },
      xAxis: { ...baseValueAxis(t), name: tr`× citation intensity`, nameTextStyle: { color: t.inkMuted, fontSize: 11 } },
      yAxis: {
        ...baseCategoryAxis(t),
        data: sorted.map((d) => d.key),
        axisLabel: { color: t.inkSecondary, fontSize: 11, width: 240, overflow: 'truncate' as const },
      },
      series: [
        {
          type: 'bar',
          data: sorted.map((d) => ({
            value: Math.round(d.impactRatio * 10) / 10,
            itemStyle: { color: t.series[5], borderRadius: [0, 4, 4, 0] },
          })),
          label: { show: true, position: 'right', fontSize: 10, color: t.inkSecondary, formatter: '×{c}' },
        },
      ],
    };
  }, [data, t, tr]);
  return (
    <EChartCard
      title={tr`Subfields with high citation intensity`}
      subtitle={tr`Share of citations / share of publications, locally · no world comparison here · subfields with ≥ ${MIN_SIGNATURE_COUNT} publications`}
      option={option}
      exportName="benchmark-citation-impact"
      height={Math.max(280, data.length * 28 + 90)}
      shareable={false}
    />
  );
};

/** Disciplinary signature at OpenAlex Topic level, compared with the selected peer
 * group (phase 7) — NOT the same reading as SignatureChart (vs world) nor
 * CitationImpactChart (vs local volume): ratio vs a peer group chosen by
 * the user, at Topic granularity (finer than the subfield). */
const TopicPeerSignatureChart: React.FC<{ data: TopicPeerSignature[]; peerCount: number }> = ({
  data,
  peerCount,
}) => {
  const t = useVizTheme();
  const { t: tr } = useLingui();
  const option = useMemo(() => {
    const sorted = [...data].sort((a, b) => a.ratio - b.ratio);
    return {
      textStyle: baseTextStyle(t),
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (p: { dataIndex: number }[]) => {
          const d = sorted[p[0].dataIndex];
          return `${d.key}<br/>${tr`${nf(d.count)} publication(s) — × ${d.ratio.toFixed(1)} vs the peer group (${(d.peerShare * 100).toFixed(2)}% of the group's publications on this topic)`}`;
        },
        ...baseTooltip(t),
      },
      grid: { left: 8, right: 48, top: 8, bottom: 8, containLabel: true },
      xAxis: { ...baseValueAxis(t), name: tr`× peer group share`, nameTextStyle: { color: t.inkMuted, fontSize: 11 } },
      yAxis: {
        ...baseCategoryAxis(t),
        data: sorted.map((d) => d.key),
        axisLabel: { color: t.inkSecondary, fontSize: 11, width: 240, overflow: 'truncate' as const },
      },
      series: [
        {
          type: 'bar',
          data: sorted.map((d) => ({
            value: Math.round(d.ratio * 10) / 10,
            itemStyle: { color: t.series[6], borderRadius: [0, 4, 4, 0] },
          })),
          label: { show: true, position: 'right', fontSize: 10, color: t.inkSecondary, formatter: '×{c}' },
        },
      ],
    };
  }, [data, t, tr]);
  return (
    <EChartCard
      title={tr`Disciplinary signature vs peer group (Topic level)`}
      subtitle={tr`Ratio local share / share of the group of ${nf(peerCount)} selected peers · subfields with ≥ ${MIN_SIGNATURE_COUNT} publications`}
      option={option}
      exportName="benchmark-topic-peer-signature"
      height={Math.max(280, data.length * 28 + 90)}
      shareable={false}
    />
  );
};

/** P (count) as an integer; the other Leiden indicators are 0-1 fractions → %. */
const formatIndicatorValue = (key: string, value: number) =>
  key === 'P' || key === 'MNCS' ? nf(Math.round(value * 100) / 100) : `${(value * 100).toFixed(1)} %`;

// usePersistedState (per-structure preference: peer group, weighting, views) is
// extracted into lib/usePersistedState.ts (lot 3 of the multi-instance architecture plan) —
// duplicated identically in docker/druid-demo, which already had it as a separate file.

/** Named peer list saved server-side (Grist table BenchmarkPeerGroups),
 * associated with the user's Keycloak profile — see server.cjs. */
interface SavedPeerGroup {
  id: number;
  name: string;
  rors: string[];
  updatedAt: string | null;
}

/** Search + manual selection of universities from the Leiden Ranking Open Edition baseline
 * as a peer group (see work/druid/benchmark.md §6.2, « manuel » option). The named lists
 * below are, unlike the predefined groups (geo/decile/consortium),
 * a personal preference saved server-side — associated with the user's profile
 * rather than with their browser's localStorage, hence available on any workstation. */
const PeerGroupPicker: React.FC<{
  peers: LeidenPeer[];
  ownRor: string | null;
  selected: string[];
  onChange: (rors: string[]) => void;
  predefinedGroups?: PredefinedPeerGroup[];
  savedGroups?: SavedPeerGroup[];
  savedGroupsError?: string | null;
  onSaveGroup?: (name: string) => Promise<void>;
  onDeleteGroup?: (id: number) => Promise<void>;
}> = ({
  peers, ownRor, selected, onChange, predefinedGroups = [],
  savedGroups = [], savedGroupsError = null, onSaveGroup, onDeleteGroup,
}) => {
  const { t } = useLingui();
  const [query, setQuery] = useState('');
  const [groupName, setGroupName] = useState('');
  const [savingGroup, setSavingGroup] = useState(false);
  const saveGroup = async () => {
    const name = groupName.trim();
    if (!name || !onSaveGroup || selected.length === 0) return;
    setSavingGroup(true);
    try {
      await onSaveGroup(name);
      setGroupName('');
    } finally {
      setSavingGroup(false);
    }
  };
  const selectedPeers = useMemo(
    () => peers.filter((p) => p.ror && selected.includes(p.ror)),
    [peers, selected],
  );
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return peers
      .filter(
        (p) =>
          p.ror &&
          p.ror !== ownRor &&
          !selected.includes(p.ror) &&
          (p.university?.toLowerCase().includes(q) || p.country?.toLowerCase().includes(q)),
      )
      .slice(0, 8);
  }, [peers, query, selected, ownRor]);

  return (
    <div className="glass-card p-4 flex flex-col gap-3">
      <div>
        <h3 className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea] flex items-center gap-1.5">
          <Users className="w-4 h-4" /> <Trans>Comparable universities</Trans>
          <HelpTip text={t`The percentile below is recomputed only among the universities chosen here (+ the institution), instead of the 2,831 universities of the world reference set.`} />
        </h3>
        <p className="text-xs text-muted-light dark:text-[#8f897c] mt-0.5">
          <Trans>
            Choose universities from the Leiden Ranking Open Edition reference set to recompute the percentile within this group rather than the whole world.
          </Trans>
        </p>
      </div>
      {predefinedGroups.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {predefinedGroups.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => onChange(g.rors)}
              title={t`Replaces the current selection with this predefined group`}
              className="pill inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-accent/20 dark:bg-accent/15 text-ink dark:text-[#f5f2ea] hover:bg-accent/35 dark:hover:bg-accent/25 cursor-pointer"
            >
              {g.label} · <Plural value={g.rors.length} one="# university" other="# universities" />
            </button>
          ))}
        </div>
      )}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-lighter" />
        <input
          className="input-soft !w-full !pl-8 py-1.5 text-sm"
          placeholder={t`Search for a university or a country…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {matches.length > 0 && (
          <div className="absolute z-10 mt-1 w-full glass-card-strong p-1 flex flex-col gap-0.5 max-h-64 overflow-y-auto">
            {matches.map((p) => (
              <button
                key={p.ror}
                type="button"
                onClick={() => {
                  onChange([...selected, p.ror as string]);
                  setQuery('');
                }}
                className="text-left px-2.5 py-1.5 rounded-md text-sm text-ink dark:text-[#f5f2ea] hover:bg-accent/20 dark:hover:bg-accent/15 cursor-pointer"
              >
                {p.university}
                <span className="text-xs text-muted-light dark:text-[#8f897c] ml-1.5">{p.country}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {selectedPeers.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {selectedPeers.map((p) => (
            <button
              key={p.ror}
              type="button"
              onClick={() => onChange(selected.filter((r) => r !== p.ror))}
              title={t`Remove this university`}
              className="pill inline-flex items-center gap-1 pl-3 pr-2 py-1 text-xs bg-accent/20 dark:bg-accent/15 text-ink dark:text-[#f5f2ea] hover:bg-accent/35 dark:hover:bg-accent/25 cursor-pointer"
            >
              {p.university}
              <X className="w-3 h-3 opacity-60" />
            </button>
          ))}
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-xs text-muted-light dark:text-[#8f897c] hover:underline ml-1 cursor-pointer"
          >
            <Trans>Clear all</Trans>
          </button>
        </div>
      )}
      {onSaveGroup && (
        <div className="flex flex-col gap-2 pt-1 border-t border-line/60">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold text-ink dark:text-[#f5f2ea] flex items-center gap-1">
              <Trans>My saved lists</Trans>
              <HelpTip text={t`Saved on the server and tied to your profile (not the browser): available from any computer, unlike the weighting views below which stay local to this browser.`} />
            </h4>
          </div>
          <div className="flex items-center gap-2">
            <input
              className="input-soft flex-1 py-1.5 text-sm"
              placeholder={t`Name of this list (e.g. “My Euniwell”)…`}
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveGroup()}
            />
            <button
              type="button"
              onClick={saveGroup}
              disabled={!groupName.trim() || selected.length === 0 || savingGroup}
              title={selected.length === 0 ? t`Select at least one university before saving` : undefined}
              className="pill inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-ink dark:text-[#f5f2ea] bg-accent/25 hover:bg-accent/35 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" /> <Trans>Save the selection</Trans>
            </button>
          </div>
          {savedGroupsError && (
            <p className="text-xs text-red-600 dark:text-red-400">
              <Trans>Lists unavailable: {savedGroupsError}</Trans>
            </p>
          )}
          {savedGroups.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {savedGroups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => onChange(g.rors)}
                  title={t`Load this list (replaces the current selection)`}
                  className="pill inline-flex items-center gap-1 pl-3 pr-2 py-1 text-xs bg-ink/5 dark:bg-white/10 text-ink dark:text-[#f5f2ea] hover:bg-accent/25 dark:hover:bg-accent/20 cursor-pointer"
                >
                  {g.name} · {nf(g.rors.length)}
                  {onDeleteGroup && (
                    <X
                      className="w-3 h-3 opacity-60 hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteGroup(g.id);
                      }}
                    />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/** Raw comparison table (institution + selected peers) on the retained
 * Leiden Ranking Open Edition indicators. */
const PeerComparisonTable: React.FC<{
  ownLabel: string;
  ownIndicators: Record<string, { value: number }>;
  peers: LeidenPeer[];
}> = ({ ownLabel, ownIndicators, peers }) => {
  const { i18n: li } = useLingui(); // re-rendered on language change (leidenDefinition outside the macro)
  void li.locale;
  const keys = LEIDEN_ORDER.filter((k) => ownIndicators[k] != null);
  return (
    <div className="glass-card p-4 overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-line">
            <th className="text-left py-2 pr-3 font-semibold text-ink dark:text-[#f5f2ea]"><Trans>University</Trans></th>
            {keys.map((k) => (
              <th
                key={k}
                className="text-right py-2 px-2 font-semibold text-ink dark:text-[#f5f2ea] whitespace-nowrap"
              >
                <span className="inline-flex items-center gap-1">
                  {k}
                  <HelpTip text={leidenDefinition(k)} />
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-line/60 bg-accent/10 dark:bg-accent/10 font-semibold">
            <td className="py-1.5 pr-3 text-ink dark:text-[#f5f2ea]">{ownLabel}</td>
            {keys.map((k) => (
              <td key={k} className="text-right py-1.5 px-2 text-ink dark:text-[#f5f2ea] whitespace-nowrap">
                {formatIndicatorValue(k, ownIndicators[k].value)}
              </td>
            ))}
          </tr>
          {peers.map((p) => (
            <tr key={p.ror} className="border-b border-line/40">
              <td className="py-1.5 pr-3 text-muted dark:text-[#c3beb0]">
                {p.university} <span className="text-xs text-muted-light dark:text-[#8f897c]">{p.country}</span>
              </td>
              {keys.map((k) => (
                <td key={k} className="text-right py-1.5 px-2 text-muted dark:text-[#c3beb0] whitespace-nowrap">
                  {p.indicators[k] != null ? formatIndicatorValue(k, p.indicators[k]) : '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/** Large horizontal 0-100 gauge: weighted composite score. */
const ScoreGauge: React.FC<{ score: number }> = ({ score }) => {
  const t = useVizTheme();
  const color = score >= 66 ? t.series[1] : score >= 33 ? t.series[0] : t.series[3];
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="font-disp font-bold text-[32px] leading-none text-ink dark:text-[#f5f2ea]">
          {score.toFixed(1)}
        </span>
        <span className="text-xs text-muted-light dark:text-[#8f897c]">/ 100</span>
      </div>
      <div className="h-2.5 rounded-full bg-ink/10 dark:bg-white/10 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>
    </div>
  );
};

/**
 * Weighting (composite score) — see work/druid/benchmark.md §6.1. Sliders per
 * Leiden Ranking Open Edition indicator (already percentiles, hence combinable),
 * predefined profiles as a starting point, and saving of several named views
 * to compare different strategic readings of the same dataset.
 */
const WeightingPanel: React.FC<{
  weights: LeidenWeights;
  onChange: (w: LeidenWeights) => void;
  score: { score: number | null; contributions: { key: string; weight: number; percentile: number }[] } | null;
  reference: 'world' | 'peers';
  onReferenceChange: (r: 'world' | 'peers') => void;
  hasPeerGroup: boolean;
  savedViews: { name: string; weights: LeidenWeights }[];
  onSavedViewsChange: (v: { name: string; weights: LeidenWeights }[]) => void;
}> = ({ weights, onChange, score, reference, onReferenceChange, hasPeerGroup, savedViews, onSavedViewsChange }) => {
  const { t } = useLingui();
  const [viewName, setViewName] = useState('');
  const setWeight = (key: string, w: number) => onChange({ ...weights, [key]: w });

  const saveView = () => {
    const name = viewName.trim();
    if (!name) return;
    const others = savedViews.filter((v) => v.name !== name);
    onSavedViewsChange([...others, { name, weights }]);
    setViewName('');
  };

  return (
    <div className="glass-card p-4 flex flex-col gap-4">
      <div>
        <h3 className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea] flex items-center gap-1.5">
          <SlidersHorizontal className="w-4 h-4" /> <Trans>Weighting — composite score</Trans>
          <HelpTip text={t`Average of the selected Leiden Ranking Open Edition percentiles, weighted by the sliders below. An indicator set to 0 is excluded from the computation. Limited to the Scientific impact axis: the disciplinary profile has no comparable reference distribution (see note below).`} />
        </h3>
        <p className="text-xs text-muted-light dark:text-[#8f897c] mt-0.5">
          <Trans>
            Decide for yourself what matters: sliders at 0 to exclude an indicator, predefined profiles as a starting point. “An indicator-building workshop, not yet another ranking” (see framing note §1).
          </Trans>
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {Object.entries(LEIDEN_WEIGHT_PRESETS).map(([key, preset]) => (
          <button
            key={key}
            type="button"
            title={t(preset.description)}
            onClick={() => onChange(preset.weights)}
            className="pill px-3 py-1 text-xs text-ink dark:text-[#f5f2ea] bg-ink/5 dark:bg-white/10 hover:bg-accent/25 dark:hover:bg-accent/20 cursor-pointer"
          >
            {t(preset.label)}
          </button>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
        {LEIDEN_ORDER.map((key) => (
          <div key={key} className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-xs">
              <span className="inline-flex items-center gap-1 text-ink dark:text-[#f5f2ea] font-medium">
                {leidenLabel(key)}
                <HelpTip text={leidenDefinition(key)} />
              </span>
              <span className="text-muted-light dark:text-[#8f897c]">{t`weight ${weights[key] ?? 0}`}</span>
            </div>
            <input
              type="range"
              min={0}
              max={5}
              step={1}
              value={weights[key] ?? 0}
              onChange={(e) => setWeight(key, Number(e.target.value))}
              className="w-full accent-accent"
            />
          </div>
        ))}
      </div>

      {hasPeerGroup && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-light dark:text-[#8f897c]"><Trans>Reference:</Trans></span>
          <div className="inline-flex rounded-lg overflow-hidden border border-line">
            <button
              type="button"
              onClick={() => onReferenceChange('world')}
              className={`px-2.5 py-1 cursor-pointer ${reference === 'world' ? 'bg-accent/30 text-ink dark:text-[#f5f2ea] font-semibold' : 'text-muted-light dark:text-[#8f897c]'}`}
            >
              <Trans>World</Trans>
            </button>
            <button
              type="button"
              onClick={() => onReferenceChange('peers')}
              className={`px-2.5 py-1 cursor-pointer ${reference === 'peers' ? 'bg-accent/30 text-ink dark:text-[#f5f2ea] font-semibold' : 'text-muted-light dark:text-[#8f897c]'}`}
            >
              <Trans>Comparable universities</Trans>
            </button>
          </div>
        </div>
      )}

      {score?.score != null ? (
        <div className="flex flex-col gap-2 pt-1">
          <div className="flex items-baseline gap-2">
            <span className="font-disp font-bold text-2xl text-ink dark:text-[#f5f2ea]">{score.score.toFixed(1)}</span>
            <span className="text-sm text-muted-light dark:text-[#8f897c]">
              <Trans>/ 100 — reported at the top of the page on every change</Trans>
            </span>
          </div>
          <div className="flex flex-col gap-1">
            {score.contributions
              .slice()
              .sort((a, b) => b.weight - a.weight)
              .map((c) => (
                <div key={c.key} className="flex items-center gap-2 text-xs">
                  <span className="w-28 shrink-0 text-muted dark:text-[#c3beb0]">{leidenLabel(c.key)}</span>
                  <div className="flex-1 h-1.5 rounded-full bg-ink/10 dark:bg-white/10 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${Math.max(2, c.percentile)}%` }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-right text-muted-light dark:text-[#8f897c]">
                    <span dangerouslySetInnerHTML={{ __html: ordinalHtml(c.percentile) }} /> · {t`weight ${c.weight}`}
                  </span>
                </div>
              ))}
          </div>
        </div>
      ) : (
        <div className="text-sm text-muted-light dark:text-[#8f897c]">
          <Trans>All sliders are at 0 — choose a profile or raise at least one indicator.</Trans>
        </div>
      )}

      <div className="flex flex-col gap-2 pt-1 border-t border-line/60">
        <div className="flex items-center gap-2">
          <input
            className="input-soft flex-1 py-1.5 text-sm"
            placeholder={t`Name of this view (e.g. “Excellence 2026”)…`}
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveView()}
          />
          <button
            type="button"
            onClick={saveView}
            disabled={!viewName.trim()}
            className="pill inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-ink dark:text-[#f5f2ea] bg-accent/25 hover:bg-accent/35 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" /> <Trans>Save this view</Trans>
          </button>
        </div>
        {savedViews.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {savedViews.map((v) => (
              <button
                key={v.name}
                type="button"
                onClick={() => onChange(v.weights)}
                title={t`Load this view`}
                className="pill inline-flex items-center gap-1 pl-3 pr-2 py-1 text-xs bg-ink/5 dark:bg-white/10 text-ink dark:text-[#f5f2ea] hover:bg-accent/25 dark:hover:bg-accent/20 cursor-pointer"
              >
                {v.name}
                <X
                  className="w-3 h-3 opacity-60 hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSavedViewsChange(savedViews.filter((sv) => sv.name !== v.name));
                  }}
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/** « A, B et C » / « A, B and C » — to embed a peer list in a summary sentence. */
function joinList(items: string[]): string {
  if (items.length === 0) return '';
  try {
    return new Intl.ListFormat(numberLocale(), { style: 'long', type: 'conjunction' }).format(items);
  } catch {
    return items.join(', ');
  }
}

/** Name of the predefined profile matching the current weights, « personnalisée » otherwise —
 * so that the summary sentence stays readable even when the user has adjusted a
 * slider by hand. */
function matchingPresetLabel(weights: LeidenWeights): string {
  const preset = Object.values(LEIDEN_WEIGHT_PRESETS).find(
    (p) => JSON.stringify(p.weights) === JSON.stringify(weights),
  );
  const name = preset ? i18n._(preset.label) : null;
  return name ? i18n._(msg`“${name}” weighting`) : i18n._(msg`custom weighting`);
}

/**
 * Summary at the top of the page: the composite score (big number) + a reading sentence
 * in plain language, so that a hurried reader (VP research, presidency) leaves with
 * the essentials without having to decode MNCS/PP_top10/Herfindahl. The detail stays below
 * for whoever wants to dig. See work/druid/benchmark.md §2 (persona) and §1 (« atelier de
 * construction d'indicateurs, pas un classement de plus »).
 */
const SynthesisHeader: React.FC<{
  institutionLabel: string;
  score: { score: number | null; contributions: unknown[] } | null;
  presetLabel: string;
  peerCount: number;
  nearestPeers: RankedPeer[];
  topSignature?: SignatureSubfield;
}> = ({ institutionLabel, score, presetLabel, peerCount, nearestPeers, topSignature }) => {
  const { t } = useLingui();
  const sentence = (() => {
    if (score?.score == null) {
      return t`Adjust the weighting below (sliders per indicator, or a predefined profile) to get a summary score.`;
    }
    // see the benchmark action plan phase 4: the composite score mainly
    // serves to understand who the institution compares with under the chosen
    // weighting, not to display an isolated rank — the sentence names the closest peers
    // rather than sticking to the percentile alone.
    const peerNames = joinList(nearestPeers.slice(0, 3).map((p) => p.university));
    const count = nf(peerCount);
    const percentile = ordinalText(Number(score.score.toFixed(0)));
    const base =
      peerNames
        ? t`According to the ${presetLabel} chosen below, ${institutionLabel} stands at a level close to ${peerNames} — among the ${count} universities of the Leiden Ranking Open Edition.`
        : t`${institutionLabel} sits at the ${percentile} world percentile among the ${count} universities of the Leiden Ranking Open Edition, according to the ${presetLabel} chosen below.`;
    if (!topSignature) return base;
    const ratio = topSignature.ratio.toFixed(1);
    return `${base} ${t`Most marked specialisation: ${topSignature.key} (× ${ratio} the world average of publications in this field).`}`;
  })();

  return (
    <div className="glass-card-strong p-5 flex flex-col sm:flex-row gap-4 sm:items-center">
      <div className="shrink-0 w-14 h-14 rounded-2xl grid place-items-center bg-accent/25 text-ink dark:text-[#f5f2ea]">
        <Compass className="w-7 h-7" />
      </div>
      <div className="flex-1 flex flex-col sm:flex-row sm:items-center gap-3">
        {score?.score != null && (
          <div className="shrink-0">
            <ScoreGauge score={score.score} />
          </div>
        )}
        <p className="text-sm text-ink dark:text-[#f5f2ea] leading-snug">{sentence}</p>
      </div>
    </div>
  );
};

/** Institutions of the world baseline closest on the current weighted score —
 * the « liste de pairs » that gives substance to the summary sentence above. Clicking one
 * adds it to the manual comparison group (§ « Comparer à des universités choisies ») rather
 * than remaining a mere passive list. */
const NearestPeersRow: React.FC<{
  peers: RankedPeer[];
  selected: string[];
  onAdd: (ror: string) => void;
}> = ({ peers, selected, onAdd }) => {
  const { t } = useLingui();
  if (peers.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1 -mt-2">
      <span className="text-xs text-muted-light dark:text-[#8f897c]">
        <Trans>Closest institutions on this weighting:</Trans>
      </span>
      {peers.map((p) => {
        const already = selected.includes(p.ror);
        return (
          <button
            key={p.ror}
            type="button"
            disabled={already}
            onClick={() => onAdd(p.ror)}
            title={already ? t`Already in the comparison group` : t`Add to the comparison group`}
            className="pill inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-accent/15 dark:bg-accent/10 text-ink dark:text-[#f5f2ea] hover:bg-accent/30 dark:hover:bg-accent/20 disabled:opacity-50 disabled:cursor-default cursor-pointer"
          >
            {p.university}
            {p.country && <span className="text-muted-light dark:text-[#8f897c]">· {p.country}</span>}
          </button>
        );
      })}
    </div>
  );
};

/**
 * « Benchmark » tab: direct OpenAlex positioning (institution, live via
 * /institutions/{id}) + Leiden Ranking Open Edition percentile (if the baseline was
 * imported on the ETL side) + disciplinary specificity profile. See work/druid/benchmark.md
 * for the full roadmap (comparison with peers, thematic signatures,
 * societal/economic impact — later phases).
 *
 * ⚠️ Deliberate double display (decision §3 of the doc): the « official » OpenAlex figures
 * (whole institution, all fields) and the structure's publication corpus
 * (often restricted in time or to the staff scope) do not coincide — this
 * is not an error, they are two different views of the same institution.
 */
export const BenchmarkTab: React.FC<{ dataset: DashboardDataset; range: YearRange }> = ({
  dataset,
  range,
}) => {
  const t = useVizTheme();
  const { t: tr, i18n: li } = useLingui();
  const profile = useMemo(
    () => computeSpecialisationProfile(dataset.publications, range, dataset.benchmark?.topicsReference),
    [dataset.publications, range, dataset.benchmark?.topicsReference],
  );
  // li.locale: labels produced outside the component (benchmarkAggregates.ts via i18n._).
  const specialisationReading = useMemo(() => describeSpecialisation(profile), [profile, li.locale]);
  // Phase 6 of the benchmark review follow-up plan — signature weighted by
  // citation impact rather than by volume alone, see benchmarkAggregates.ts.
  const citationImpact = useMemo(
    () => computeCitationWeightedSignature(dataset.publications, range),
    [dataset.publications, range],
  );
  const leiden = dataset.benchmark?.leiden ?? null;
  const ownRor = dataset.benchmark?.openalex.ror
    ? dataset.benchmark.openalex.ror.replace(/^https?:\/\/ror\.org\//, '')
    : null;
  const predefinedPeerGroups = useMemo(() => {
    if (!leiden) return [];
    return [
      computeGeographicPeerGroup(leiden.peers, ownRor, leiden.country),
      computeSizeDecilePeerGroup(leiden.peers, ownRor),
      ...computeConsortiumPeerGroups(leiden.peers, ownRor),
      ...computeEstablishmentTypePeerGroups(leiden.peers, ownRor),
    ].filter((g): g is PredefinedPeerGroup => g != null);
  }, [leiden, ownRor, li.locale]);
  // Drill-down by major Leiden field (phase 5) and core/non-core toggle (phase 3, see
  // the benchmark action plan). A selected field forces the
  // « publications core » mode (no non-core variant per field, see §3.5/§4.5 of the
  // benchmark MVP spec) — the core/non-core toggle, for its part, remains a simple display of
  // the headline indicator (§2 below): the custom peer group and the composite
  // score stay computed in core mode, the only mode with all the field-normalized
  // indicators needed for a multi-indicator weighting.
  const [selectedDomain, setSelectedDomain] = usePersistedState<string | null>(
    `druid-benchmark-domain:${dataset.slug}`,
    null,
  );
  const [pubsScope, setPubsScope] = useState<'core' | 'all'>('core');
  const domainView = selectedDomain ? (leiden?.domains.find((d) => d.name === selectedDomain) ?? null) : null;
  // A persisted field (localStorage) that no longer exists in the reloaded Leiden baseline
  // silently fell back to the whole institution while leaving the « Domaine :
  // … » chip and the <select> showing the stale field as active — self-cleanup rather than a
  // affichage trompeur (revue lot 9a).
  useEffect(() => {
    if (selectedDomain && leiden && !leiden.domains.some((d) => d.name === selectedDomain)) {
      setSelectedDomain(null);
    }
  }, [leiden, selectedDomain, setSelectedDomain]);
  const activeIndicators: Record<string, BenchmarkLeidenIndicator> | null =
    domainView?.indicators ?? leiden?.indicators ?? null;
  const activePeers: LeidenPeer[] = domainView?.peers ?? leiden?.peers ?? [];
  const [selectedPeerRors, setSelectedPeerRors] = usePersistedState<string[]>(
    `druid-benchmark-peers:${dataset.slug}`,
    [],
  );
  const [weights, setWeights] = usePersistedState<LeidenWeights>(
    `druid-benchmark-weights:${dataset.slug}`,
    LEIDEN_WEIGHT_PRESETS.balanced.weights,
  );
  const [savedViews, setSavedViews] = usePersistedState<{ name: string; weights: LeidenWeights }[]>(
    `druid-benchmark-views:${dataset.slug}`,
    [],
  );
  const [weightReference, setWeightReference] = useState<'world' | 'peers'>('world');

  // Named peer lists, saved server-side and associated with the Keycloak profile
  // (see server.cjs /api/benchmark/peer-groups) — unlike selectedPeerRors and
  // savedViews above/below, which stay in localStorage, specific to this browser.
  const [savedPeerGroups, setSavedPeerGroups] = useState<SavedPeerGroup[]>([]);
  const [savedPeerGroupsError, setSavedPeerGroupsError] = useState<string | null>(null);
  const refreshSavedPeerGroups = async () => {
    try {
      const res = await fetch('/api/benchmark/peer-groups');
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || tr`HTTP error ${res.status}`);
      setSavedPeerGroups(body.groups as SavedPeerGroup[]);
      setSavedPeerGroupsError(null);
    } catch (e) {
      setSavedPeerGroupsError(e instanceof Error ? apiErrorText(e) : tr`Unknown error`);
    }
  };
  useEffect(() => {
    refreshSavedPeerGroups();
  }, []);
  // saveGroup/onDeleteGroup (BenchmarkPeerGroupPicker) are called fire-and-forget (onClick,
  // no .catch): without surfacing the failure in savedPeerGroupsError (already displayed below), a
  // failed save or delete showed nothing to the user — review lot 9a.
  const saveCurrentPeerGroup = async (name: string) => {
    try {
      const res = await fetch('/api/benchmark/peer-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, rors: selectedPeerRors }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || tr`HTTP error ${res.status}`);
      await refreshSavedPeerGroups();
    } catch (e) {
      setSavedPeerGroupsError(e instanceof Error ? apiErrorText(e) : tr`Unknown error`);
      throw e;
    }
  };
  const deleteSavedPeerGroup = async (id: number) => {
    try {
      const res = await fetch(`/api/benchmark/peer-groups/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || tr`HTTP error ${res.status}`);
      }
      await refreshSavedPeerGroups();
    } catch (e) {
      setSavedPeerGroupsError(e instanceof Error ? apiErrorText(e) : tr`Unknown error`);
      throw e;
    }
  };
  const selectedPeers = useMemo(
    () => activePeers.filter((p) => p.ror && selectedPeerRors.includes(p.ror)),
    [activePeers, selectedPeerRors],
  );
  const peerGroupIndicators = useMemo(
    () =>
      activeIndicators && selectedPeerRors.length > 0
        ? computePeerGroupIndicators(activeIndicators, activePeers, selectedPeerRors)
        : null,
    [activeIndicators, activePeers, selectedPeerRors],
  );
  const weightingIndicators: Record<string, BenchmarkLeidenIndicator> | null =
    weightReference === 'peers' && peerGroupIndicators ? peerGroupIndicators : activeIndicators;
  const weightedScore = useMemo(
    () => (weightingIndicators ? computeWeightedScore(weightingIndicators, weights) : null),
    [weightingIndicators, weights],
  );
  // « Avec qui je me compare » (cf. the benchmark action plan phase 4) :
  // weighted score recomputed for every university of the active subset (world or
  // selected field) — same basis for everyone, independent of the world/peers toggle
  // above, for a stable comparison — used to spot the institutions closest
  // on this weighting.
  const worldRanking = useMemo(
    () => rankPeersByWeightedScore(activePeers, activePeers, weights),
    [activePeers, weights],
  );
  const ownWorldScore = useMemo(
    () => worldRanking.find((r) => r.ror === ownRor)?.score ?? null,
    [worldRanking, ownRor],
  );
  const nearestPeers = useMemo(() => {
    if (ownWorldScore == null) return [];
    return worldRanking
      .filter((r) => r.ror !== ownRor && r.score != null)
      .map((r) => ({ ...r, diff: Math.abs((r.score as number) - ownWorldScore) }))
      .sort((a, b) => a.diff - b.diff)
      .slice(0, 5);
  }, [worldRanking, ownWorldScore, ownRor]);

  // Truly peer-relative disciplinary signature at fine OpenAlex Topic level (phase
  // 7 of the benchmark review follow-up plan) — fetched on demand for the
  // peer group manually selected above (NOT the predefined groups in
  // full, see MAX_PEER_TOPIC_RORS on the backend side), cached server-side.
  const [peerTopicData, setPeerTopicData] = useState<PeerTopicDistributionResponse | null>(null);
  const [peerTopicLoading, setPeerTopicLoading] = useState(false);
  const [peerTopicError, setPeerTopicError] = useState<string | null>(null);
  const fetchPeerTopicDistribution = async () => {
    if (!ownRor || selectedPeerRors.length === 0) return;
    setPeerTopicLoading(true);
    setPeerTopicError(null);
    try {
      const res = await fetch('/api/benchmark/topic-distribution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rors: [...new Set([ownRor, ...selectedPeerRors])] }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || tr`HTTP error ${res.status}`);
      setPeerTopicData(body.data as PeerTopicDistributionResponse);
    } catch (e) {
      setPeerTopicError(e instanceof Error ? apiErrorText(e) : tr`Unknown error`);
    } finally {
      setPeerTopicLoading(false);
    }
  };
  const topicPeerSignature = useMemo(
    () =>
      peerTopicData
        ? computePeerRelativeTopicSignature(dataset.publications, range, peerTopicData, ownRor)
        : [],
    [peerTopicData, dataset.publications, range, ownRor],
  );

  if (!dataset.benchmark) {
    return (
      <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
        <Trans>
          The Benchmark is only available at institution level (positioning built to match the granularity of the Leiden Ranking Open Edition) — this structure is not eligible, or the matching OpenAlex institution could not be resolved.
        </Trans>
      </div>
    );
  }

  const oa = dataset.benchmark.openalex;

  return (
    <div className="flex flex-col gap-5">
      <SynthesisHeader
        institutionLabel={leiden?.university ?? oa.openalexId}
        score={weightedScore}
        presetLabel={matchingPresetLabel(weights)}
        peerCount={leiden?.peerCount ?? 0}
        nearestPeers={nearestPeers}
        topSignature={profile.signature?.[0]}
      />
      <NearestPeersRow
        peers={nearestPeers}
        selected={selectedPeerRors}
        onAdd={(ror) => setSelectedPeerRors([...new Set([...selectedPeerRors, ror])])}
      />

      {/* ── Impact scientifique ─────────────────────────────────────────── */}
      <SectionHeader
        title={tr`Scientific impact`}
        subtitle={tr`Position of the institution as seen by OpenAlex, compared with the Leiden Ranking Open Edition (CWTS).`}
      />
      <p className="text-xs text-muted-light dark:text-[#8f897c] px-1 -mt-2">
        <Trans>
          Figures for the whole institution, all fields and all years — independent of the period/scope selected at the top of the page. They <em>do not match</em> those of the other tabs (publication corpus exported for this structure): this is expected, not an error (see §3 of the framing note).
        </Trans>
        <HelpTip text={tr`The OpenAlex scope (institutions.lineage: institution + “child” ROR structures) does not always exactly match the scope retained by Leiden for the same university, which applies a case-by-case curated selection rather than an automatic ROR hierarchy. Usually a minor gap, worth keeping in mind for a composite/merged institution.`} />
      </p>

      {leiden && (
        <FilterChipRow>
          <FilterChip
            label={selectedDomain || pubsScope === 'core' ? tr`Core publications (Leiden)` : tr`All publications`}
            hint={tr`“Core” subset defined by Leiden (indexed international journals, excluding conference proceedings) — the only base on which field-normalised indicators (MNCS, share in the top 10%/1%) are computed.`}
          />
          <FilterChip
            label={leiden.fracCounting ? tr`Fractional counting` : tr`Full counting`}
            hint={tr`Full counting: each co-signed publication counts as 1 in the total of each co-authoring institution (no fractional sharing between co-authors).`}
          />
          {leiden.period && <FilterChip label={tr`Period ${leiden.period}`} />}
          {selectedDomain && <FilterChip label={tr`Field: ${selectedDomain}`} />}
          {fmtDate(leiden.importedAt) && (
            <FilterChip
              label={tr`Reference set imported on ${fmtDate(leiden.importedAt)}`}
              hint={tr`Date of the last import of the Leiden Ranking Open Edition — published yearly, no automatic update between two imports.`}
            />
          )}
        </FilterChipRow>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label={tr`Publications (OpenAlex)`}
          value={nf(oa.worksCount ?? 0)}
          hint={tr`Whole institution, all years`}
          icon={<Target className="w-5 h-5" />}
          color={t.series[0]}
        />
        <KpiCard
          label={tr`Citations received`}
          value={nf(oa.citedByCount ?? 0)}
          icon={<Quote className="w-5 h-5" />}
          color={t.series[3]}
        />
        <KpiCard
          label={tr`h-index`}
          value={oa.hIndex != null ? nf(oa.hIndex) : '—'}
          hint={oa.i10Index != null ? tr`i10: ${nf(oa.i10Index)}` : undefined}
          icon={<Award className="w-5 h-5" />}
          color={t.series[2]}
        />
        <KpiCard
          label={tr`2-year mean citedness`}
          value={oa.meanCitedness2yr != null ? oa.meanCitedness2yr.toFixed(2) : '—'}
          icon={<TrendingUp className="w-5 h-5" />}
          color={t.series[5]}
        />
      </div>

      {leiden ? (
        <>
          <div className="flex flex-wrap items-center gap-3 px-1">
            <div className="inline-flex rounded-full bg-accent/10 dark:bg-accent/10 p-0.5 text-xs items-center">
              <button
                type="button"
                onClick={() => setPubsScope('core')}
                className={`px-3 py-1 rounded-full cursor-pointer transition-colors ${
                  pubsScope === 'core' || selectedDomain
                    ? 'bg-accent/40 text-ink dark:text-[#f5f2ea] font-semibold'
                    : 'text-muted-light dark:text-[#8f897c]'
                }`}
              >
                <Trans>Core publications</Trans>
              </button>
              <button
                type="button"
                onClick={() => setPubsScope('all')}
                disabled={!!selectedDomain || !leiden.allPubsIndicators}
                title={selectedDomain ? tr`Unavailable per major field — Leiden does not compute this family of indicators at field level` : undefined}
                className={`px-3 py-1 rounded-full cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  pubsScope === 'all' && !selectedDomain
                    ? 'bg-accent/40 text-ink dark:text-[#f5f2ea] font-semibold'
                    : 'text-muted-light dark:text-[#8f897c]'
                }`}
              >
                <Trans>All publications</Trans>
              </button>
              <HelpTip text={tr`In “all publications” mode, the headline normalised indicator changes nature: PP_10_cits (share of publications with ≥ 10 citations, absolute threshold) replaces PP_top10/MNCS (field-normalised percentile), unavailable outside the core subset. These are not equivalent indicators — the custom peer group and the composite score below are still computed in core mode.`} />
            </div>
            {leiden.domains.length > 0 && (
              <select
                value={selectedDomain ?? ''}
                onChange={(e) => setSelectedDomain(e.target.value || null)}
                className="input-soft text-xs py-1.5"
              >
                <option value="">{tr`All fields (whole institution)`}</option>
                {leiden.domains.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <WeightingPanel
            weights={weights}
            onChange={setWeights}
            score={weightedScore}
            reference={weightReference}
            onReferenceChange={setWeightReference}
            hasPeerGroup={peerGroupIndicators != null}
            savedViews={savedViews}
            onSavedViewsChange={setSavedViews}
          />

          {selectedDomain ? (
            <LeidenPercentileChart
              indicators={activeIndicators ?? {}}
              title={tr`Position — ${selectedDomain}`}
              subtitle={tr`World percentile (0-100) among the reference universities in this field · always in core publications mode`}
            />
          ) : pubsScope === 'all' && leiden.allPubsIndicators ? (
            <>
              <LeidenPercentileChart
                indicators={leiden.allPubsIndicators}
                order={LEIDEN_ORDER_ALL_PUBS}
                title={tr`Position — all publications`}
                subtitle={tr`World percentile (0-100), “all publications” mode — headline indicator differs from core mode, see tooltip above`}
              />
              <p className="text-xs text-muted-light dark:text-[#8f897c] px-1 -mt-2">
                <Trans>
                  The custom peer group and the composite score above are still computed in “core publications” mode, the only mode in which Leiden computes all the field-normalised indicators needed for a multi-criteria weighting.
                </Trans>
              </p>
            </>
          ) : null}

          <CollapsibleSection
            title={tr`Compare with chosen universities`}
            icon={<Users className="w-4 h-4" />}
            defaultOpen
          >
            <p className="text-xs text-muted-light dark:text-[#8f897c] -mt-1">
              <Trans>Period {leiden.period} · {nf(activePeers.length)} universities in the reference set</Trans>
              {selectedDomain ? <> <Trans>in this field</Trans></> : ''}
              {leiden.university ? <> · <Trans>listed as “{leiden.university}”</Trans></> : ''}
              {leiden.country ? ` (${leiden.country})` : ''}.
            </p>
            <PeerGroupPicker
              peers={leiden.peers}
              ownRor={ownRor}
              selected={selectedPeerRors}
              onChange={setSelectedPeerRors}
              predefinedGroups={predefinedPeerGroups}
              savedGroups={savedPeerGroups}
              savedGroupsError={savedPeerGroupsError}
              onSaveGroup={saveCurrentPeerGroup}
              onDeleteGroup={deleteSavedPeerGroup}
            />
            {peerGroupIndicators && (
              <>
                <PeerComparisonTable
                  ownLabel={leiden.university ?? oa.openalexId}
                  ownIndicators={activeIndicators ?? leiden.indicators}
                  peers={selectedPeers}
                />
                <LeidenPercentileChart
                  indicators={peerGroupIndicators}
                  title={tr`Position vs chosen universities`}
                  subtitle={tr`Percentile among the ${nf(selectedPeers.length + 1)} universities of the group (the selected ones + the institution) · higher = better ranked`}
                  exportName="benchmark-peer-group-percentiles"
                  percentileLabel={tr`percentile within this group`}
                />
              </>
            )}
          </CollapsibleSection>
        </>
      ) : (
        <div className="glass-card p-4 text-sm text-muted-light dark:text-[#8f897c]">
          <Trans>
            Leiden Ranking Open Edition reference set not yet imported on the ETL side — only the direct OpenAlex positioning is available for now (see §4.3 of the framing note and <code className="font-mono text-xs">scripts/import_leiden_reference.py</code>).
          </Trans>
        </div>
      )}

      {/* ── Profil disciplinaire ────────────────────────────────────────── */}
      <SectionHeader
        title={tr`Disciplinary profile`}
        subtitle={tr`What the institution publishes on, and where it stands out from OpenAlex world output.`}
      />
      <FilterChipRow>
        <FilterChip
          label={tr`Full corpus (not core-filtered)`}
          hint={tr`Unlike the Scientific impact axis above, this profile covers all publications, without restriction to Leiden's “core” subset — a core-only filter would under-represent publications outside indexed international journals (conference proceedings, humanities and social sciences in particular).`}
        />
        <FilterChip label={tr`Period ${range.start}–${range.end}`} hint={tr`Period filter selected at the top of the page — applies here, unlike the OpenAlex figures of the Scientific impact axis above.`} />
      </FilterChipRow>

      {profile.signature ? (
        profile.signature.length > 0 ? (
          <SignatureChart data={profile.signature} />
        ) : (
          <div className="glass-card p-4 text-sm text-muted-light dark:text-[#8f897c]">
            <Trans>
              No subfield reaches the threshold of {MIN_SIGNATURE_COUNT} publications over the selected period to compute a reliable disciplinary signature.
            </Trans>
          </div>
        )
      ) : (
        <div className="glass-card p-4 text-sm text-muted-light dark:text-[#8f897c]">
          <Trans>
            OpenAlex world reference (fields/subfields) not yet imported on the ETL side — the local disciplinary profile remains available above, without world comparison (see <code className="font-mono text-xs">scripts/import_openalex_topics_reference.py</code>).
          </Trans>
        </div>
      )}

      {leiden && (
        <CollapsibleSection title={tr`Signature vs peer group (Topic level)`} icon={<Users className="w-4 h-4" />}>
          <p className="text-xs text-muted-light dark:text-[#8f897c] -mt-1">
            <Trans>
              Computed on demand for the peer group selected in “Compare with chosen universities” (Scientific impact axis, above) — queries OpenAlex live for each institution of the group, at Topic granularity (finer than the 5 Leiden major fields), then caches the result server-side.
            </Trans>
          </p>
          {selectedPeerRors.length === 0 ? (
            <div className="glass-card p-4 text-sm text-muted-light dark:text-[#8f897c]">
              <Trans>
                First select a peer group in the “Compare with chosen universities” section of the Scientific impact axis, above.
              </Trans>
            </div>
          ) : selectedPeerRors.length > MAX_PEER_TOPIC_RORS ? (
            <div className="glass-card p-4 text-sm text-muted-light dark:text-[#8f897c]">
              <Trans>
                Group of {nf(selectedPeerRors.length)} institutions too large for this on-demand computation (max {MAX_PEER_TOPIC_RORS}) — reduce the selection above.
              </Trans>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={fetchPeerTopicDistribution}
                disabled={peerTopicLoading}
                className="pill w-fit px-4 py-1.5 text-sm bg-accent/25 dark:bg-accent/15 text-ink dark:text-[#f5f2ea] hover:bg-accent/40 dark:hover:bg-accent/25 disabled:opacity-50 disabled:cursor-wait cursor-pointer"
              >
                {peerTopicLoading
                  ? tr`Computing…`
                  : peerTopicData
                    ? tr`Recompute for the current selection`
                    : tr`Compute the signature vs these ${nf(selectedPeerRors.length)} peers`}
              </button>
              {peerTopicError && (
                <div className="text-sm text-red-600 dark:text-red-400">{peerTopicError}</div>
              )}
              {topicPeerSignature.length > 0 && (
                <TopicPeerSignatureChart data={topicPeerSignature} peerCount={selectedPeerRors.length} />
              )}
              {peerTopicData && topicPeerSignature.length === 0 && !peerTopicLoading && !peerTopicError && (
                <div className="glass-card p-4 text-sm text-muted-light dark:text-[#8f897c]">
                  <Trans>
                    No usable common topic between the local corpus and the peer group over the selected period.
                  </Trans>
                </div>
              )}
            </>
          )}
        </CollapsibleSection>
      )}

      <CollapsibleSection title={tr`Detail by subfield`} icon={<Layers3 className="w-4 h-4" />}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label={tr`Specialisation index`}
            value={profile.herfindahl.toFixed(3)}
            hint={tr`Herfindahl over subfields · close to 0 = diversified`}
            icon={<Layers3 className="w-5 h-5" />}
            color={t.series[6]}
          />
          <KpiCard
            label={tr`Active subfields`}
            value={nf(profile.nbSubfields)}
            hint={tr`out of ${nf(profile.totalPubs)} publications over the period`}
            icon={<Layers3 className="w-5 h-5" />}
            color={t.series[7]}
          />
        </div>
        {specialisationReading && (
          <p className="text-xs text-muted-light dark:text-[#8f897c] px-1 -mt-1">
            <Trans>{specialisationReading.qualifier} profile: the observed concentration is equivalent to {nf(specialisationReading.effectiveN)} subfields of equal weight</Trans>
            {specialisationReading.coreCount > 0 && (
              <>
                {' '}— {specialisationReading.coreCount === 1
                  ? tr`the most active subfield alone accounts for ${specialisationReading.corePct}% of publications, out of ${nf(profile.nbSubfields)} active in total.`
                  : tr`the ${nf(specialisationReading.coreCount)} most active subfields account for ${specialisationReading.corePct}% of publications, out of ${nf(profile.nbSubfields)} active in total.`}
              </>
            )}
          </p>
        )}
        {citationImpact.length > 0 && (
          <>
            <p className="text-xs text-muted-light dark:text-[#8f897c] px-1">
              <Trans>
                Complementary, purely local reading (no world comparison here, unlike the signature vs world reference above): which subfields gather more citations than their share of publication volume would suggest.
              </Trans>
            </p>
            <CitationImpactChart data={citationImpact} />
          </>
        )}
      </CollapsibleSection>
    </div>
  );
};
