import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Search, Sparkles, X } from 'lucide-react';
import { DashboardDataset, MemberMeta } from './types';
import { Researcher } from '../../types';
import { YearRange } from './overviewAggregates';
import {
  aggregateTeams,
  aggregateTeamRadar,
  hasTeams,
  TEAM_OTHER,
  TeamRadarLevel,
} from './structureAggregates';
import { buildThemeCandidates } from './collabAggregates';
import { PubFilters } from './publicationFilters';
import {
  TeamDonutChart,
  StackedAreaChart,
  StackedBarHChart,
  TeamRadarChart,
  TeamHeatmapChart,
} from './charts/TeamCharts';
import { numberLocale } from '../../lib/i18n';
import { Trans, Plural, useLingui } from '@lingui/react/macro';
import { apiErrorText } from '../../lib/apiErrors';

/** Technical value of the « non assigné » filter (the displayed label is translated). */
const TEAM_UNASSIGNED = '__unassigned__';
const ALL_TEAMS = '__all__';

/** Name normalization for matching member ↔ Druid researcher record. */
function normName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .trim();
}

/**
 * Index of Druid researchers by name variants (first last / last first / displayName).
 * Two distinct researchers normalizing to the same name (homonyms) are neither of them
 * indexed rather than arbitrarily resolving to the first one met — otherwise the member row
 * silently opened the wrong Personnel record (review lot 9a).
 */
function buildResearcherIndex(researchers: Researcher[]): Map<string, Researcher> {
  const idx = new Map<string, Researcher>();
  const collided = new Set<string>();
  for (const r of researchers) {
    const keys = [
      `${r.firstName} ${r.lastName}`,
      `${r.lastName} ${r.firstName}`,
      r.displayName ?? '',
    ];
    for (const k of keys) {
      const n = normName(k);
      if (!n) continue;
      const existing = idx.get(n);
      if (existing && existing !== r) collided.add(n);
      else idx.set(n, r);
    }
  }
  for (const n of collided) idx.delete(n);
  return idx;
}

/** « Membres par équipe » table with a link to the researcher's record (Effectifs). */
const MembersByTeamSection: React.FC<{
  dataset: DashboardDataset;
  range: YearRange;
  researchers?: Researcher[];
  onOpenResearcher?: (r: Researcher) => void;
}> = ({ dataset, range, researchers = [], onOpenResearcher }) => {
  const { t, i18n } = useLingui();
  const { members, publications, teamLabel } = dataset;
  const [teamFilter, setTeamFilter] = useState<string>(ALL_TEAMS);
  const unassignedLabel = t`Unassigned`;

  const researcherIndex = useMemo(() => buildResearcherIndex(researchers), [researchers]);

  // Publications per internal author over the period
  const pubCountByAuthor = useMemo(() => {
    const m = new Map<number, number>();
    for (const p of publications) {
      if (typeof p.year !== 'number' || p.year < range.start || p.year > range.end) continue;
      for (const id of new Set<number>(p.authorIds)) m.set(id, (m.get(id) ?? 0) + 1);
    }
    return m;
  }, [publications, range]);

  const teams = useMemo(() => {
    const set = new Set<string>();
    for (const m of members) for (const tm of m.teams) if (tm) set.add(tm);
    return Array.from(set).sort();
  }, [members]);

  const rows = useMemo(() => {
    const teamsOf = (m: MemberMeta) => (m.teams.length ? m.teams : [TEAM_UNASSIGNED]);
    return members
      .filter((m) => teamFilter === ALL_TEAMS || teamsOf(m).includes(teamFilter))
      .map((m) => ({
        ...m,
        teamsDisplay: teamsOf(m).map((tm) => (tm === TEAM_UNASSIGNED ? unassignedLabel : tm)).join(', '),
        pubCount: m.authorId != null ? pubCountByAuthor.get(m.authorId) ?? 0 : 0,
        researcher: researcherIndex.get(normName(m.label)),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, i18n.locale));
  }, [members, teamFilter, pubCountByAuthor, researcherIndex, unassignedLabel, i18n.locale]);

  if (members.length === 0) return null;

  const matched = rows.filter((r) => r.researcher).length;

  return (
    <div className="glass-card flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
        <div>
          <h3 className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea]">
            <Trans>Members by {teamLabel}</Trans>
          </h3>
          <p className="text-xs text-muted-light dark:text-[#8f897c] mt-0.5">
            <Plural value={rows.length} one="# member" other="# members" />
            {researchers.length > 0 && <> · <Trans>{matched} with a record in People (click to open)</Trans></>}
          </p>
        </div>
        <select
          className="input-soft !w-auto py-1.5 pr-7 text-sm font-semibold cursor-pointer"
          value={teamFilter}
          onChange={(e) => setTeamFilter(e.target.value)}
          title={teamLabel}
        >
          <option value={ALL_TEAMS}>{t`All ${teamLabel}s`}</option>
          {teams.map((tm) => (
            <option key={tm} value={tm}>
              {tm}
            </option>
          ))}
          <option value={TEAM_UNASSIGNED}>{unassignedLabel}</option>
        </select>
      </div>

      <div className="overflow-x-auto px-2 pb-3 max-h-[480px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white/90 dark:bg-[#2b2a26]/95 backdrop-blur">
            <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted-light dark:text-[#8f897c]">
              <th className="px-3 py-2"><Trans>Member</Trans></th>
              <th className="px-3 py-2 w-52"><Trans>Type</Trans></th>
              <th className="px-3 py-2 w-56">{teamLabel.charAt(0).toUpperCase() + teamLabel.slice(1)}(s)</th>
              <th className="px-3 py-2 w-28 text-right"><Trans>Publications ({range.start}–{range.end})</Trans></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.label}-${i}`} className="border-t border-ink/5 dark:border-white/5">
                <td className="px-3 py-1.5">
                  {r.researcher && onOpenResearcher ? (
                    <button
                      type="button"
                      onClick={() => onOpenResearcher(r.researcher as Researcher)}
                      title={t`Open the record in People`}
                      className="inline-flex items-center gap-1.5 font-semibold text-ink dark:text-accent hover:underline text-left"
                    >
                      {r.label}
                      <ExternalLink className="w-3 h-3 opacity-60" />
                    </button>
                  ) : (
                    <span className="text-ink dark:text-[#f5f2ea]">{r.label}</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-muted dark:text-[#c3beb0]">{r.type ?? '—'}</td>
                <td className="px-3 py-1.5 text-muted dark:text-[#c3beb0]">{r.teamsDisplay}</td>
                <td className="px-3 py-1.5 text-right text-muted dark:text-[#c3beb0]">
                  {r.pubCount > 0 ? r.pubCount.toLocaleString(numberLocale()) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

type RadarMode = 'auto' | 'ai';
type RadarView = 'radar' | 'heatmap';

/**
 * « Profil disciplinaire des équipes » card, full width. Header: Automatic
 * mode (most frequent topics) / By theme (AI), and OpenAlex level of the axes
 * (subfield or topic — one level at a time so that the shares are
 * comparable). AI mode: same principle as ThemeFraming
 * (PartnerBilanSection.tsx) — POST /api/collab-theme/select-topics has ILAAS
 * pick topics of the current level among those actually present in the
 * corpus, chips editable in the card. No synthesis: the selected topics
 * are directly the axes of the radar (aggregateTeamRadar).
 */
const TeamRadarSection: React.FC<{ dataset: DashboardDataset; range: YearRange }> = ({
  dataset,
  range,
}) => {
  const { t } = useLingui();
  const { publications } = dataset;
  const [mode, setMode] = useState<RadarMode>('auto');
  const [view, setView] = useState<RadarView>('radar');
  const [level, setLevel] = useState<TeamRadarLevel>('subfield');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [analyzedFor, setAnalyzedFor] = useState<string | null>(null);
  const [themeKeys, setThemeKeys] = useState<string[] | null>(null);
  const [addQuery, setAddQuery] = useState('');

  const candidates = useMemo(
    () => buildThemeCandidates(publications, range, () => true, 60),
    [publications, range],
  );
  const levelCandidates = level === 'subfield' ? candidates.subfields : candidates.topics;

  // Corpus (period) or level changed → the candidates are no longer the same,
  // the ongoing AI selection no longer makes sense.
  useEffect(() => {
    setThemeKeys(null);
    setAnalyzedFor(null);
    setStatus('idle');
    setError(null);
    setAddQuery('');
  }, [candidates, level]);

  const selectedKeys = mode === 'ai' ? themeKeys : null;
  // The heatmap stays readable with more teams than the radar.
  const maxSeries = view === 'heatmap' ? 12 : 6;
  const radar = useMemo(
    () =>
      aggregateTeamRadar(publications, range, {
        level,
        maxSeries,
        selectedKeys: selectedKeys ?? undefined,
      }),
    [publications, range, level, maxSeries, selectedKeys],
  );

  const analyze = async () => {
    const theme = query.trim();
    if (!theme) return;
    setStatus('loading');
    setError(null);
    try {
      const r = await fetch('/api/collab-theme/select-topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theme,
          domains: [],
          subfields: level === 'subfield' ? levelCandidates : [],
          topics: level === 'topic' ? levelCandidates : [],
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setThemeKeys((level === 'subfield' ? data.subfields : data.topics) ?? []);
      setAnalyzedFor(theme);
      setStatus('idle');
    } catch (e: unknown) {
      setError(e instanceof Error ? apiErrorText(e) : String(e));
      setStatus('error');
    }
  };

  const addable = useMemo(() => {
    const q = addQuery.trim().toLowerCase();
    if (q.length < 2 || themeKeys == null) return [];
    const selected = new Set(themeKeys);
    return levelCandidates
      .filter((k) => !selected.has(k) && k.toLowerCase().includes(q))
      .slice(0, 8);
  }, [addQuery, levelCandidates, themeKeys]);

  const levelName = level === 'subfield' ? t`subfield` : t`topic`;
  const axisCount = radar.indicators.length;
  const subtitle =
    mode === 'auto'
      ? t`Share of each team's publications across the ${axisCount} most frequent OpenAlex ${levelName}s`
      : themeKeys && themeKeys.length > 0
        ? t`Share of each team's publications across the ${levelName}s selected for “${analyzedFor}”`
        : t`The topics selected by the AI become the axes of the radar`;

  const emptyMessage =
    mode === 'ai' && themeKeys == null
      ? t`Describe a theme above: the AI selects the matching OpenAlex ${levelName}s among those found in the unit's publications.`
      : mode === 'ai' && themeKeys?.length === 0
        ? t`No ${levelName} seems to match “${analyzedFor}” in these publications — rephrase, or add one manually.`
        : radar.series.length === 0 || axisCount === 0
          ? t`Not enough OpenAlex ${levelName}s to draw the disciplinary profile.`
          : undefined;

  const pill = (active: boolean) =>
    `pill px-2.5 py-1 text-xs cursor-pointer transition-colors ${
      active
        ? 'bg-accent text-ink shadow-nav-active'
        : 'bg-white/50 dark:bg-white/5 text-muted dark:text-[#c3beb0] hover:bg-white dark:hover:bg-white/10'
    }`;

  const headerExtra = (
    <div className="flex flex-wrap items-center gap-2 mr-2">
      <div className="flex items-center gap-1">
        <button type="button" className={pill(view === 'radar')} onClick={() => setView('radar')} title={t`Radar`}>
          <Trans>Radar</Trans>
        </button>
        <button type="button" className={pill(view === 'heatmap')} onClick={() => setView('heatmap')} title={t`Teams × topics heatmap`}>
          <Trans>Heatmap</Trans>
        </button>
      </div>
      <span className="w-px h-4 bg-ink/10 dark:bg-white/10" aria-hidden />
      <div className="flex items-center gap-1">
        <button type="button" className={pill(mode === 'auto')} onClick={() => setMode('auto')}>
          <Trans>Automatic</Trans>
        </button>
        <button type="button" className={`${pill(mode === 'ai')} inline-flex items-center gap-1`} onClick={() => setMode('ai')}>
          <Sparkles className="w-3 h-3" /> <Trans>By theme (AI)</Trans>
        </button>
      </div>
      <label className="flex items-center gap-1.5 text-xs text-muted dark:text-[#c3beb0]">
        {t`Level:`}
        <select
          className="input-soft !w-auto !py-1 !px-2 text-xs font-semibold cursor-pointer"
          value={level}
          onChange={(e) => setLevel(e.target.value as TeamRadarLevel)}
        >
          <option value="subfield">{t`Subfield`}</option>
          <option value="topic">{t({ message: `Topic`, context: "OpenAlex" })}</option>
        </select>
      </label>
    </div>
  );

  const toolbar =
    mode === 'ai' ? (
      <div className="flex flex-col gap-2 pt-1">
        <div className="flex flex-wrap gap-2">
          <input
            className="input-soft flex-1 min-w-[240px] py-1.5 text-sm"
            placeholder={t`e.g. maritime decarbonisation, AI and health…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && analyze()}
          />
          <button
            type="button"
            onClick={analyze}
            disabled={!query.trim() || status === 'loading'}
            className="pill px-3 py-1.5 text-xs bg-accent text-ink shadow-nav-active cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            {status === 'loading' ? t`Analysing…` : t`Suggest axes`}
          </button>
        </div>
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        {themeKeys && themeKeys.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-light dark:text-[#8f897c] mr-1">
              <Trans>Radar axes (click to remove):</Trans>
            </span>
            {themeKeys.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setThemeKeys(themeKeys.filter((x) => x !== k))}
                title={t`Remove this axis`}
                className="pill inline-flex items-center gap-1 pl-3 pr-2 py-1 text-xs bg-accent/20 dark:bg-accent/15 text-ink dark:text-[#f5f2ea] hover:bg-accent/35 dark:hover:bg-accent/25 cursor-pointer"
              >
                {k}
                <X className="w-3 h-3 opacity-60" />
              </button>
            ))}
          </div>
        )}
        {themeKeys && (
          <div className="relative w-full max-w-sm">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-lighter" />
            <input
              className="input-soft !w-full !pl-7 py-1 text-xs"
              placeholder={t`+ add an axis (${levelName})…`}
              value={addQuery}
              onChange={(e) => setAddQuery(e.target.value)}
            />
            {addable.length > 0 && (
              <div className="absolute z-10 mt-1 w-full glass-card-strong p-1 flex flex-col gap-0.5 max-h-48 overflow-y-auto">
                {addable.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      setThemeKeys([...themeKeys, k]);
                      setAddQuery('');
                    }}
                    className="text-left px-2.5 py-1 rounded-md text-xs text-ink dark:text-[#f5f2ea] hover:bg-accent/20 dark:hover:bg-accent/15 cursor-pointer"
                  >
                    {k}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    ) : undefined;

  if (view === 'heatmap') {
    return (
      <TeamHeatmapChart
        data={radar}
        subtitle={subtitle}
        headerExtra={headerExtra}
        toolbar={toolbar}
        emptyMessage={emptyMessage}
      />
    );
  }
  return (
    <TeamRadarChart
      data={radar}
      subtitle={subtitle}
      headerExtra={headerExtra}
      toolbar={toolbar}
      emptyMessage={emptyMessage}
      height={520}
    />
  );
};

/** « Équipes » tab (ported from the SoVisu+ mockups + the Streamlit members table). */
export const TeamsTab: React.FC<{
  dataset: DashboardDataset;
  range: YearRange;
  researchers?: Researcher[];
  onOpenResearcher?: (r: Researcher) => void;
  onOpenList?: (filters: PubFilters) => void;
}> = ({ dataset, range, researchers, onOpenResearcher, onOpenList }) => {
  const { t } = useLingui();
  const { publications } = dataset;
  const agg = useMemo(() => aggregateTeams(publications, range), [publications, range]);
  // The « Autres » fallback aggregates several teams → no exact filter possible.
  const openTeam = (team: string, extra?: PubFilters) =>
    onOpenList && team !== TEAM_OTHER ? onOpenList({ team, ...extra }) : undefined;

  if (!hasTeams(publications) && dataset.members.length === 0) {
    return (
      <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
        <Trans>
          The teams of this structure are not filled in (no staff matched to authors). Add a staff file with teams in druid-biblio to enable this tab.
        </Trans>
      </div>
    );
  }

  if (!hasTeams(publications)) {
    return (
      <div className="flex flex-col gap-4">
        <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
          <Trans>
            The publications of this structure are not yet matched to teams — only the member list is available.
          </Trans>
        </div>
        <MembersByTeamSection
          dataset={dataset}
          range={range}
          researchers={researchers}
          onOpenResearcher={onOpenResearcher}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-2">
          <TeamDonutChart
            title={t`Breakdown by team`}
            subtitle={t`A publication counts in each of its teams`}
            exportName="equipes-repartition"
            data={agg.byTeam.map((tm) => ({ name: tm.key, value: tm.count }))}
            onSelect={onOpenList ? (name) => openTeam(name) : undefined}
          />
        </div>
        <div className="lg:col-span-3">
          <StackedAreaChart
            title={t`Evolution by team`}
            exportName="equipes-evolution"
            data={agg.byYear}
            onSelect={onOpenList ? (team, year) => openTeam(team, { year }) : undefined}
          />
        </div>
      </div>
      <StackedBarHChart
        title={t`Types by team`}
        exportName="equipes-types"
        data={agg.byType}
        onSelect={onOpenList ? (team, type) => openTeam(team, type ? { pubType: type } : undefined) : undefined}
      />
      <TeamRadarSection dataset={dataset} range={range} />
      <MembersByTeamSection
        dataset={dataset}
        range={range}
        researchers={researchers}
        onOpenResearcher={onOpenResearcher}
      />
    </div>
  );
};