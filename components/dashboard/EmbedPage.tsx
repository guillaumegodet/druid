import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { EmbedModeContext } from './EChartCard';
import { useDashboardData } from './useDashboardData';
import { getYearBounds } from './overviewAggregates';
import { EMBED_CHARTS } from './embedRegistry';
import { Trans, useLingui } from '@lingui/react/macro';

/**
 * Public embed page: renders ONE chart of the registry, without the rest of
 * the application or authentication (/embed route excluded from the Keycloak
 * guard in server.cjs; data via /api/public/dashboard/:slug/publications).
 * Parameters: ?struct=<slug>&chart=<id>[&from=YYYY&to=YYYY][&theme=dark]
 */
export const EmbedPage: React.FC = () => {
  const { t } = useLingui();
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const slug = params.get('struct');
  const chartId = params.get('chart') ?? '';
  const themeParam = params.get('theme');

  const [themeReady, setThemeReady] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    if (themeParam === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    setThemeReady(true);
  }, [themeParam]);

  const { data: rawData, loading, error } = useDashboardData(slug, { isPublic: true });

  // « effectifs » scope of shared links: restricted to publications with at
  // least one author matched to the staff (effectifsAuthorIds, minimal field
  // kept in the public variant of dashboard.json).
  const effectifs = params.get('perimetre') === 'effectifs';
  const data = useMemo(() => {
    if (!rawData || !effectifs) return rawData;
    const ids = new Set(rawData.effectifsAuthorIds ?? []);
    if (ids.size === 0) return rawData; // no matching → full scope
    return {
      ...rawData,
      publications: rawData.publications.filter((p) => p.authorIds.some((id) => ids.has(id))),
    };
  }, [rawData, effectifs]);

  const def = EMBED_CHARTS[chartId];

  const range = useMemo(() => {
    const bounds = getYearBounds(data?.publications ?? []);
    const from = Number(params.get('from'));
    const to = Number(params.get('to'));
    return {
      start: Number.isFinite(from) && from > 0 ? from : bounds.min,
      end: Number.isFinite(to) && to > 0 ? to : bounds.max,
    };
  }, [data, params]);

  const message = (text: string) => (
    <div className="p-6 text-sm text-muted-light dark:text-[#8f897c]">{text}</div>
  );

  let body: React.ReactNode;
  if (!slug || !def) {
    body = message(t`Chart not found — check the embed link (struct and chart parameters).`);
  } else if (loading || !themeReady) {
    body = (
      <div className="h-[320px] flex items-center justify-center text-sm text-muted-light dark:text-[#8f897c]">
        <RefreshCw className="w-4 h-4 animate-spin mr-2" /> <Trans>Loading…</Trans>
      </div>
    );
  } else if (error) {
    body = message(
      error === 'no-data'
        ? t`Data unavailable for this structure.`
        : t`Error loading data: ${error}`,
    );
  } else if (data) {
    const { Chart } = def;
    body = <Chart dataset={data} range={range} />;
  }

  return (
    <EmbedModeContext.Provider value={true}>
      <div className="min-h-screen p-3 flex flex-col gap-2">
        {body}
        {data && (
          <p className="px-2 text-[11px] text-muted-lighter dark:text-[#8f897c]">
            {data.name} — {range.start}–{range.end}
            {effectifs && <> · <Trans>staff scope</Trans></>} · <Trans>Source: Druid / druid-biblio (OpenAlex, BSO)</Trans>
          </p>
        )}
      </div>
    </EmbedModeContext.Provider>
  );
};
