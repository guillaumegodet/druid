// Remote data of report blocks (druid-internal `docs/plan-binomes-chercheurs.md`, lot 2b): some charts,
// key figures and tables are not computed from the dataset but fetched from an authenticated route
// of the instance (ChartMeta.remote). The report loads them once per distinct request, like the
// datasets (useReportDatasets), then resolves and renders the blocks synchronously — the preview,
// the PDF capture and the PDF composition read the same payload.

import { useEffect, useMemo, useState } from 'react';
import type { ChartParams, RemoteSource } from '../chartMeta';
import type { YearRange } from '../overviewAggregates';
import { fetchPairs, pairsParamsOf } from '../pairsApi';

/** What a block needs from a remote source (one fetch per distinct `key`). */
export interface RemoteRequest {
  key: string;
  source: RemoteSource;
  slug: string;
  range: YearRange;
  /** Block parameters of the source (REMOTE_PARAMS / CHART_META params), sanitized. */
  params: ChartParams;
}

/** Payloads per request key: undefined = loading, null = unavailable (no data, no access, no route). */
export type RemoteDataByKey = Record<string, unknown>;

const sortedEntries = (params: ChartParams) => Object.entries(params).sort(([a], [b]) => a.localeCompare(b));

export function remoteRequest(source: RemoteSource, slug: string, range: YearRange, params: ChartParams): RemoteRequest {
  const key = JSON.stringify([source, slug, range.start, range.end, sortedEntries(params)]);
  return { key, source, slug, range, params };
}

const FETCHERS: Record<RemoteSource, (r: RemoteRequest) => Promise<unknown>> = {
  pairs: (r) => fetchPairs(r.slug, pairsParamsOf(r.range, r.params)),
};

/** Payloads already requested (bounded; a failed request is forgotten so that reopening retries). */
const cache = new Map<string, Promise<unknown>>();
const CACHE_MAX = 40;

export function loadRemote(r: RemoteRequest): Promise<unknown> {
  let p = cache.get(r.key);
  if (!p) {
    p = FETCHERS[r.source](r).then(
      (v) => v ?? null,
      (e) => {
        cache.delete(r.key);
        console.warn(`Report: remote data « ${r.source} » of « ${r.slug} » unavailable`, e);
        return null;
      },
    );
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(r.key, p);
  }
  return p;
}

/** Payloads of the given requests, loaded in parallel. */
export function useReportRemote(requests: RemoteRequest[]): RemoteDataByKey {
  const byKey = useMemo(() => new Map(requests.map((r) => [r.key, r])), [requests]);
  const keys = [...byKey.keys()].sort().join('\n');
  const [data, setData] = useState<RemoteDataByKey>({});
  useEffect(() => {
    let cancelled = false;
    for (const r of byKey.values()) {
      loadRemote(r).then((v) => { if (!cancelled) setData((cur) => (r.key in cur ? cur : { ...cur, [r.key]: v })); });
    }
    return () => { cancelled = true; };
    // `keys` identifies the requests; `byKey` changes with every resolution.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);
  return data;
}
