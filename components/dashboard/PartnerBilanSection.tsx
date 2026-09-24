import React, { useEffect, useMemo, useState } from 'react';
import { Sparkles, Search, X } from 'lucide-react';
import { DashboardDataset, DashboardPublication } from './types';
import { YearRange } from './overviewAggregates';
import { PubFilters } from './publicationFilters';
import {
  buildPartnerCatalog,
  buildPartnerMatcher,
  aggregatePartnerBilan,
  buildThemeCandidates,
  buildThemeMatcher,
} from './collabAggregates';
import { PartnerInstitutionPicker } from './PartnerInstitutionPicker';
import { consortiumPartnerGroups, matchingPartnerGroup } from './consortia';
import { PartnerBreakdownSection } from './PartnerBreakdownSection';
import { TeamDonutChart, RankBarChart } from './charts/TeamCharts';
import { YearlyEvolutionChart } from './charts/YearlyEvolutionChart';
import { numberLocale } from '../../lib/i18n';
import { Trans, Plural, useLingui } from '@lingui/react/macro';
import { apiErrorText } from '../../lib/apiErrors';

/**
 * Thematic AI analysis — step 1 « cadrage » (phase 3): free input of a
 * theme, POST /api/collab-theme/select-topics call (phase 0), editable
 * chips of the retained subfields/topics. Step 2 « synthèse »
 * (phase 4): re-aggregates via aggregatePartnerBilan (buildPartnerMatcher AND
 * buildThemeMatcher, phase 2) on the retained topics, sends the resulting
 * shortlist to POST /api/collab-theme/synthesize, displays the text + the
 * same charts as the general overview but refocused on the theme.
 * Any edit of the chips invalidates the current synthesis (it no longer
 * matches the displayed topics) — it must be regenerated.
 */
const ThemeFraming: React.FC<{
  dataset: DashboardDataset;
  range: YearRange;
  partnerMatcher: (p: DashboardPublication) => boolean;
  selectedPartnerKeys: string[];
  institutionLabel: string;
  onOpenList?: (filters: PubFilters) => void;
}> = ({ dataset, range, partnerMatcher, selectedPartnerKeys, institutionLabel, onOpenList }) => {
  const { t } = useLingui();
  const candidates = useMemo(
    () => buildThemeCandidates(dataset.publications, range, partnerMatcher),
    [dataset.publications, range, partnerMatcher],
  );
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [analyzedFor, setAnalyzedFor] = useState<string | null>(null);
  const [themeKeys, setThemeKeys] = useState<string[] | null>(null);
  const [themeDomains, setThemeDomains] = useState<string[]>([]);
  const [addQuery, setAddQuery] = useState('');
  const [synthStatus, setSynthStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [synthError, setSynthError] = useState<string | null>(null);
  const [synthResult, setSynthResult] = useState<{
    synthesis: string;
    highlightedResearchers: string[];
    highlightedTitles: string[];
  } | null>(null);

  // The institution selection changed (different candidates) → the ongoing
  // analysis no longer makes sense, reset it rather than keeping it stale.
  useEffect(() => {
    setThemeKeys(null);
    setThemeDomains([]);
    setAnalyzedFor(null);
    setStatus('idle');
    setError(null);
  }, [candidates]);

  // The retained chips determine the shortlist sent to the LLM — any edit
  // (new analysis or manual add/remove) invalidates an already generated synthesis.
  useEffect(() => {
    setSynthResult(null);
    setSynthError(null);
    setSynthStatus('idle');
  }, [themeKeys]);

  const themeBilan = useMemo(() => {
    if (!themeKeys || themeKeys.length === 0) return null;
    const themeMatcher = buildThemeMatcher(themeKeys);
    const combined = (p: DashboardPublication) => partnerMatcher(p) && themeMatcher(p);
    return aggregatePartnerBilan(dataset.publications, range, combined, dataset.authors);
  }, [themeKeys, partnerMatcher, dataset.publications, dataset.authors, range]);

  const generate = async () => {
    if (!themeBilan || themeBilan.total === 0) return;
    setSynthStatus('loading');
    setSynthError(null);
    try {
      const r = await fetch('/api/collab-theme/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          theme: analyzedFor,
          institutionLabel,
          publications: themeBilan.publications.map((p) => ({
            title: p.title,
            year: p.year,
            subfields: p.subfields,
            topics: p.topics,
            authors: p.authorNames,
          })),
          topResearchers: themeBilan.topResearchers.map((r) => ({ label: r.label, count: r.count })),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setSynthResult(data);
      setSynthStatus('idle');
    } catch (e: unknown) {
      setSynthError(e instanceof Error ? apiErrorText(e) : String(e));
      setSynthStatus('error');
    }
  };

  const analyze = async () => {
    const theme = query.trim();
    if (!theme) return;
    setStatus('loading');
    setError(null);
    try {
      const r = await fetch('/api/collab-theme/select-topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme, ...candidates }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setThemeKeys([...(data.subfields ?? []), ...(data.topics ?? [])]);
      setThemeDomains(data.domains ?? []);
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
    return [...candidates.subfields, ...candidates.topics]
      .filter((k) => !selected.has(k) && k.toLowerCase().includes(q))
      .slice(0, 8);
  }, [addQuery, candidates, themeKeys]);

  return (
    <div className="glass-card p-4 flex flex-col gap-3">
      <div>
        <h3 className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea] flex items-center gap-1.5">
          <Sparkles className="w-4 h-4" /> <Trans>Thematic analysis (AI)</Trans>
        </h3>
        <p className="text-xs text-muted-light dark:text-[#8f897c] mt-0.5">
          <Trans>
            Describe the topic you are interested in for {institutionLabel} — the AI suggests subjects among those actually present in these publications, to be corrected before running the analysis.
          </Trans>
        </p>
      </div>
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
          {status === 'loading' ? t`Analysing…` : t`Analyse`}
        </button>
      </div>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      {themeKeys && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-light dark:text-[#8f897c]">
            {themeDomains.length > 0
              ? t`Subjects selected for “${analyzedFor}” (domains: ${themeDomains.join(', ')}) — correct if needed:`
              : t`Subjects selected for “${analyzedFor}” — correct if needed:`}
          </p>
          {themeKeys.length === 0 ? (
            <p className="text-sm text-muted-light dark:text-[#8f897c]">
              <Trans>
                No subject seems to match this topic in these publications. You can add some manually below, or rephrase the topic.
              </Trans>
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              {themeKeys.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setThemeKeys(themeKeys.filter((x) => x !== k))}
                  title={t`Remove this subject`}
                  className="pill inline-flex items-center gap-1 pl-3 pr-2 py-1 text-xs bg-accent/20 dark:bg-accent/15 text-ink dark:text-[#f5f2ea] hover:bg-accent/35 dark:hover:bg-accent/25 cursor-pointer"
                >
                  {k}
                  <X className="w-3 h-3 opacity-60" />
                </button>
              ))}
            </div>
          )}
          <div className="relative w-full max-w-sm">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-lighter" />
            <input
              className="input-soft !w-full !pl-7 py-1 text-xs"
              placeholder={t`+ add a subject…`}
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

          {themeKeys.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={generate}
                disabled={!themeBilan || themeBilan.total === 0 || synthStatus === 'loading'}
                className="pill px-3 py-1.5 text-xs bg-accent text-ink shadow-nav-active cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {synthStatus === 'loading' ? t`Generating the analysis…` : t`Generate the analysis`}
              </button>
              {themeBilan && (
                <span className="text-xs text-muted-light dark:text-[#8f897c]">
                  {themeBilan.total === 0
                    ? t`No publication matches these subjects over the displayed period.`
                    : <Plural value={themeBilan.total} one="# matching publication" other="# matching publications" />}
                </span>
              )}
            </div>
          )}

          {synthError && <p className="text-xs text-red-600 dark:text-red-400">{synthError}</p>}

          {synthResult && themeBilan && themeBilan.total > 0 && (
            <div className="flex flex-col gap-4 pt-1">
              <div className="glass-card-strong p-4 flex flex-col gap-2">
                <p className="text-sm text-ink dark:text-[#f5f2ea] whitespace-pre-line">
                  {synthResult.synthesis}
                </p>
                {onOpenList && (
                  <button
                    type="button"
                    onClick={() =>
                      onOpenList({ partnerKeys: selectedPartnerKeys, themeKeys: themeKeys ?? [] })
                    }
                    className="pill self-start px-3 py-1.5 text-xs bg-accent/20 dark:bg-accent/15 text-ink dark:text-[#f5f2ea] hover:bg-accent/35 dark:hover:bg-accent/25 cursor-pointer"
                  >
                    <Trans>View the {themeBilan.total.toLocaleString(numberLocale())} publications</Trans>
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                <div className="lg:col-span-2">
                  <TeamDonutChart
                    title={t`Domains (selected subject)`}
                    exportName="partner-theme-domaines"
                    data={themeBilan.domains.map((d) => ({ name: d.key, value: d.count }))}
                  />
                </div>
                <div className="lg:col-span-3">
                  <YearlyEvolutionChart
                    data={themeBilan.byYear}
                    title={t`Yearly evolution (selected subject)`}
                    exportName="partner-theme-evolution"
                    colorSlot={1}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <RankBarChart
                  title={t`Subfields (selected subject)`}
                  exportName="partner-theme-subfields"
                  data={themeBilan.topSubfields.map((s) => ({ label: s.key, count: s.count, teams: [] }))}
                  colorSlot={3}
                  height={Math.max(220, themeBilan.topSubfields.length * 26 + 60)}
                />
                <RankBarChart
                  title={t`Featured Nantes Université researchers`}
                  exportName="partner-theme-chercheurs"
                  data={themeBilan.topResearchers.map((r) => ({
                    ...r,
                    // Visual marker of the researchers highlighted by the LLM synthesis
                    // (among those provided — never invented, see server.cjs). Sorting
                    // stays by publication volume (RankBarChart), the star
                    // only flags the mention in the text above.
                    label: synthResult.highlightedResearchers.includes(r.label) ? `★ ${r.label}` : r.label,
                  }))}
                  colorSlot={2}
                  height={Math.max(220, themeBilan.topResearchers.length * 26 + 60)}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Phase 4 of the « sélecteur d'institutions » plan (see work/druid/
 * plan-action-collab-picker.md, 2026-09-03) : panneau complet — picker
 * (phase 2) + thematic/researcher overview (phase 1) + link to the list of
 * publications concerned (phase 3, via PubFilters.partnerKeys). Standalone and
 * reusable: mounted in InternationalTab.tsx and in the national sub-tab of
 * CollaborationsTab.tsx — selection specific to each mount (no
 * persistence across tabs or sessions for this first version).
 */
export const PartnerBilanSection: React.FC<{
  dataset: DashboardDataset;
  range: YearRange;
  onOpenList?: (filters: PubFilters) => void;
}> = ({ dataset, range, onOpenList }) => {
  const { t } = useLingui();
  const catalog = useMemo(() => buildPartnerCatalog(dataset.publications), [dataset.publications]);
  // Consortia (EUniWell…) with members among the corpus partners
  // — picker chips (lot 1, docs/archive/plan-collab-consortium.md). The institution's
  // ROR is only set for an institution export (benchmark).
  const predefinedGroups = useMemo(
    () => consortiumPartnerGroups(catalog, dataset.benchmark?.openalex.ror ?? null),
    [catalog, dataset.benchmark],
  );
  const [selected, setSelected] = useState<string[]>([]);
  const matcher = useMemo(() => buildPartnerMatcher(selected), [selected]);
  const matchedGroup = useMemo(
    () => matchingPartnerGroup(predefinedGroups, selected),
    [predefinedGroups, selected],
  );
  const institutionLabel = useMemo(() => {
    if (selected.length === 0) return '';
    if (matchedGroup) return matchedGroup.label;
    if (selected.length > 1) return t`this group (${selected.length} institutions)`;
    return catalog.find((c) => c.key === selected[0])?.name ?? t`this institution`;
  }, [catalog, matchedGroup, selected, t]);
  const bilan = useMemo(
    () =>
      selected.length > 0
        ? aggregatePartnerBilan(dataset.publications, range, matcher, dataset.authors)
        : null,
    [dataset.publications, dataset.authors, range, matcher, selected],
  );

  return (
    <div className="flex flex-col gap-4">
      <PartnerInstitutionPicker
        catalog={catalog}
        selected={selected}
        onChange={setSelected}
        predefinedGroups={predefinedGroups}
      />

      {bilan && bilan.total === 0 && (
        <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
          {selected.length > 1
            ? t`No joint publication with this group of institutions over the displayed period.`
            : t`No joint publication with this institution over the displayed period.`}
        </div>
      )}

      {bilan && bilan.total > 0 && (
        <div className="flex flex-col gap-4">
          <div className="glass-card-strong p-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted dark:text-[#c3beb0]">
              <strong className="text-ink dark:text-[#f5f2ea]">
                {bilan.total.toLocaleString(numberLocale())}
              </strong>{' '}
              <Plural value={bilan.total} one="publication with" other="publications with" />{' '}
              {institutionLabel}{' '}
              <Trans>over the period.</Trans>
            </p>
            {onOpenList && (
              <button
                type="button"
                onClick={() => onOpenList({ partnerKeys: selected })}
                className="pill px-3 py-1.5 text-xs bg-accent text-ink shadow-nav-active cursor-pointer shrink-0"
              >
                <Trans>View the {bilan.total.toLocaleString(numberLocale())} publications</Trans>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-2">
              <TeamDonutChart
                title={t`Domains of co-publications`}
                exportName="partner-bilan-domaines"
                data={bilan.domains.map((d) => ({ name: d.key, value: d.count }))}
                onSelect={
                  onOpenList ? (domain) => onOpenList({ domain, partnerKeys: selected }) : undefined
                }
              />
            </div>
            <div className="lg:col-span-3">
              <YearlyEvolutionChart
                data={bilan.byYear}
                title={t`Yearly evolution`}
                exportName="partner-bilan-evolution"
                colorSlot={4}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <RankBarChart
              title={t`Subfields of co-publications`}
              exportName="partner-bilan-subfields"
              data={bilan.topSubfields.map((s) => ({ label: s.key, count: s.count, teams: [] }))}
              colorSlot={3}
              height={Math.max(280, bilan.topSubfields.length * 26 + 60)}
              onItemClick={
                onOpenList ? (subfield) => onOpenList({ subfield, partnerKeys: selected }) : undefined
              }
            />
            <RankBarChart
              title={t`Nantes Université researchers involved`}
              exportName="partner-bilan-chercheurs"
              data={bilan.topResearchers}
              colorSlot={2}
              height={Math.max(280, bilan.topResearchers.length * 26 + 60)}
              onItemSelect={onOpenList ? (item) => onOpenList({ authorId: item.id, partnerKeys: selected }) : undefined}
            />
          </div>

          {selected.length >= 2 && (
            <PartnerBreakdownSection
              dataset={dataset}
              range={range}
              selectedKeys={selected}
              catalog={catalog}
              groupLabel={institutionLabel}
              missingMembers={matchedGroup?.missing ?? []}
              onOpenList={onOpenList}
            />
          )}

          <ThemeFraming
            dataset={dataset}
            range={range}
            partnerMatcher={matcher}
            selectedPartnerKeys={selected}
            institutionLabel={institutionLabel}
            onOpenList={onOpenList}
          />
        </div>
      )}
    </div>
  );
};
