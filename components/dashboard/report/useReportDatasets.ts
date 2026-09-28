// Datasets of every structure a report reads (reportSlugs), through the dashboard cache, with
// the Grist corrections of the strategic axes applied (docs/plan-mes-rapports.md § 9.4: a report
// shows what the Axes tab shows). A structure without data — or not readable by the viewer —
// maps to null; its blocks say so instead of failing the whole report.

import { useEffect, useMemo, useState } from 'react';
import { applyAxisCorrections, AXES_GRIST, fetchAxisCorrections } from '../axesCorrections';
import type { DashboardDataset } from '../types';
import { loadDashboardDataset } from '../useDashboardData';
import type { DatasetsBySlug } from './resolveReport';

const corrected = new Map<string, DashboardDataset | null>();

async function loadForReport(slug: string): Promise<DashboardDataset | null> {
  if (corrected.has(slug)) return corrected.get(slug) ?? null;
  const base = await loadDashboardDataset(slug);
  let out = base;
  if (base && AXES_GRIST[slug]) {
    try {
      const index = await fetchAxisCorrections(slug);
      if (index) out = applyAxisCorrections(base, index);
    } catch (e) {
      // Same fallback as the Axes tab: the ETL classification.
      console.warn(`Report: axis corrections of « ${slug} » unavailable`, e);
    }
  }
  if (out) corrected.set(slug, out);
  return out;
}

export function useReportDatasets(slugs: string[]): DatasetsBySlug {
  const key = slugs.join('|');
  const [datasets, setDatasets] = useState<DatasetsBySlug>({});
  useEffect(() => {
    let cancelled = false;
    for (const slug of key ? key.split('|') : []) {
      loadForReport(slug)
        .then((d) => { if (!cancelled) setDatasets((cur) => ({ ...cur, [slug]: d })); })
        .catch(() => { if (!cancelled) setDatasets((cur) => ({ ...cur, [slug]: null })); });
    }
    return () => { cancelled = true; };
  }, [key]);
  // Only the requested slugs (a structure removed from the report no longer counts).
  return useMemo(() => {
    const out: DatasetsBySlug = {};
    for (const slug of key ? key.split('|') : []) out[slug] = datasets[slug];
    return out;
  }, [datasets, key]);
}
