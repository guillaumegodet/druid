// AI blocks of the reports (docs/plan-mes-rapports.md § 4.5, lot 8), client side: the code
// computes every figure and picks the publications; ILAAS (POST /api/report-ai,
// scripts/lib/reports_ai.cjs) only groups existing topic labels and writes. The result is Markdown
// stored in the block, editable, and marked « reviewed » by a person before it is trusted.
//
// - domains: topics of the corpus → 3-7 themes (fallback: the 4 OpenAlex domains), then, theme by
//   theme, figures (publications, share, trend, labs, researchers, median FWCI) printed by the code
//   and a synthesis written from the theme's publications;
// - executive: summary, key points and cooperation leads from the key figures of the block scope
//   and the theme analysis of the report (its `domains` block, when written).

import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { translateApiError } from '../../../lib/apiErrors';
import { numberLocale } from '../../../lib/i18n';
import { buildPartnerCatalog, researcherLabel, unitsOfDataset } from '../collabAggregates';
import { KPI_SETS, type KpiItem } from '../kpiItems';
import { halfTrend, median } from '../partnerKpis';
import type { DashboardDataset, DashboardPublication } from '../types';
import type { ReportDefinition } from './definition';
import type { ResolvedBlock } from './resolveReport';
import { restrictDataset } from './restrictDataset';

export type AiTask = 'executive' | 'domains';

export interface AiProgress {
  done: number;
  total: number;
}

export interface AiResult {
  text: string;
  model: string;
}

/** Topics sent to the clustering step (the server keeps at most as many). */
const MAX_TOPICS = 60;
const MAX_PUBLICATIONS = 80;
/** A theme with fewer publications gets its figures but no written synthesis. */
const MIN_THEME_PUBLICATIONS = 3;
/** Publications a theme needs for its trend to be printed. */
const MIN_TREND_PUBLICATIONS = 10;
/** FWCI values a theme needs for its median to be printed. */
const MIN_MEDIAN_VALUES = 5;

async function callAi<T>(body: object): Promise<T & { model: string }> {
  const resp = await fetch('/api/report-ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(translateApiError(String((data as { error?: unknown }).error || '')) || `HTTP ${resp.status}`);
  return data as T & { model: string };
}

const fmt = (n: number) => n.toLocaleString(numberLocale());
const inRange = (d: DashboardDataset, r: { start: number; end: number }) =>
  d.publications.filter((p) => typeof p.year === 'number' && p.year >= r.start && p.year <= r.end);

/** Labels the prompts need: the structure, and the partners named by the block filters. */
function labels(rb: ResolvedBlock) {
  const ds = rb.dataset!;
  const keys = rb.scope?.filters.partnerKeys ?? [];
  const names = keys.length && rb.source
    ? new Map(buildPartnerCatalog(rb.source.publications).map((c) => [c.key, c.name]))
    : new Map<string, string>();
  return {
    structureLabel: ds.name && ds.name !== ds.lab ? `${ds.lab} — ${ds.name}` : ds.lab,
    partnerLabel: keys.map((k) => names.get(k) ?? k.replace(/^(international|national):/, '')).join(', '),
  };
}

/** Code-computed figures of a theme (the only figures of the text). */
function themeFigures(members: DashboardPublication[], total: number, ds: DashboardDataset, range: { start: number; end: number }) {
  const parts = [i18n._(msg`${fmt(members.length)} publications (${Math.round((members.length / Math.max(1, total)) * 100)}% of the corpus)`)];
  // Small themes: a trend or a median would be noise (« −100 % » on 3 publications), and the model
  // comments on whatever figure it is given.
  const trend = members.length >= MIN_TREND_PUBLICATIONS ? halfTrend(members, range) : null;
  if (trend && trend.change != null) parts.push(i18n._(msg`trend ${trend.change > 0 ? '+' : ''}${trend.change}%`));
  const units = unitsOfDataset(ds);
  if (units.kind) {
    const counts = new Map<string, number>();
    for (const p of members) for (const u of units.of(p)) counts.set(u, (counts.get(u) ?? 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([u, n]) => `${u} (${n})`);
    if (top.length) parts.push(units.kind === 'labs' ? i18n._(msg`labs: ${top.join(', ')}`) : i18n._(msg`teams: ${top.join(', ')}`));
  }
  const researchers = new Set(members.flatMap((p) => p.authorIds)).size;
  parts.push(i18n._(msg`${fmt(researchers)} researchers involved`));
  const fwcis = members.flatMap((p) => (typeof p.fwci === 'number' ? [p.fwci] : []));
  const fwci = fwcis.length >= MIN_MEDIAN_VALUES ? median(fwcis) : null;
  if (fwci != null) parts.push(i18n._(msg`median FWCI ${fwci.toLocaleString(numberLocale(), { maximumFractionDigits: 2 })}`));
  return parts.join(' · ');
}

/** Analysis by major theme (Markdown: one `##` heading per theme, figures, synthesis). */
export async function generateDomainsText(
  rb: ResolvedBlock,
  lang: 'fr' | 'en',
  onProgress: (p: AiProgress) => void = () => {},
): Promise<AiResult> {
  const ds = rb.dataset!;
  const range = rb.scope!.range;
  const pubs = inRange(ds, range);
  const { structureLabel, partnerLabel } = labels(rb);
  const topicCounts = new Map<string, number>();
  for (const p of pubs) for (const t of new Set(p.topics)) topicCounts.set(t, (topicCounts.get(t) ?? 0) + 1);
  const items = [...topicCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_TOPICS).map(([label, count]) => ({ label, count }));
  if (!items.length) throw new Error(translateApiError('No publication to analyze'));

  onProgress({ done: 0, total: 1 });
  const clustered = await callAi<{ domains: { label: string; summary: string; topics: string[] }[] }>({
    task: 'clusters', items, lang, structureLabel, partnerLabel,
  });
  let model = clustered.model;
  // Fallback: the 4 OpenAlex domains when the model returned nothing usable.
  const themes = clustered.domains.length
    ? clustered.domains.map((d) => ({ label: d.label, summary: d.summary, of: (p: DashboardPublication) => p.topics.some((t) => d.topics.includes(t)) }))
    : [...new Set(pubs.flatMap((p) => p.domains))].map((dom) => ({ label: dom, summary: '', of: (p: DashboardPublication) => p.domains.includes(dom) }));
  const withMembers = themes
    .map((th) => ({ ...th, members: pubs.filter(th.of) }))
    .filter((th) => th.members.length > 0)
    .sort((a, b) => b.members.length - a.members.length);
  const authorsById = new Map(ds.authors.map((a) => [a.id, a]));

  const sections: string[] = [];
  const toWrite = withMembers.filter((th) => th.members.length >= MIN_THEME_PUBLICATIONS).length;
  let done = 0;
  onProgress({ done: 1, total: toWrite + 1 });
  for (const th of withMembers) {
    const figures = themeFigures(th.members, pubs.length, ds, range);
    let synthesis = '';
    if (th.members.length >= MIN_THEME_PUBLICATIONS) {
      const researcherCounts = new Map<number, number>();
      for (const p of th.members) for (const id of new Set(p.authorIds)) researcherCounts.set(id, (researcherCounts.get(id) ?? 0) + 1);
      const researchers = [...researcherCounts.entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 12)
        .map(([id, count]) => ({ label: authorsById.get(id) ? researcherLabel(authorsById.get(id)!) : `#${id}`, count }));
      const publications = [...th.members]
        .sort((a, b) => (b.citedByCount ?? 0) - (a.citedByCount ?? 0) || (b.year ?? 0) - (a.year ?? 0))
        .slice(0, MAX_PUBLICATIONS)
        .map((p) => ({
          title: p.title, year: p.year, journal: p.journal,
          authors: [...new Set(p.authorIds.map((id) => authorsById.get(id)?.label).filter(Boolean))],
        }));
      const r = await callAi<{ synthesis: string }>({
        task: 'cluster-synthesis', lang, structureLabel, partnerLabel,
        domain: { label: th.label, summary: th.summary, figures }, publications, researchers,
      });
      synthesis = r.synthesis;
      model = r.model;
      done += 1;
      onProgress({ done: done + 1, total: toWrite + 1 });
    }
    sections.push([`## ${th.label}`, `*${figures}*`, synthesis].filter(Boolean).join('\n\n'));
  }
  const unthemed = pubs.filter((p) => !themes.some((th) => th.of(p))).length;
  if (unthemed) sections.push(i18n._(msg`*${fmt(unthemed)} publications do not fall into any of these themes.*`));
  return { text: sections.join('\n\n'), model };
}

/** Key figures handed to the executive summary: the collaboration sets, else overview + impact. */
function keyFigures(rb: ResolvedBlock): KpiItem[] {
  const ds = rb.dataset!;
  const range = rb.scope!.range;
  const filters = rb.scope!.filters;
  const ctx = { source: rb.source, filters };
  // Volume figures on the whole scope: the block may leave the large collaborations out (D2), and the
  // model would otherwise read « 0 % of large collaborations » (seen on Ottawa, 2026-09-28).
  const { maxAuthors, ...volumeFilters } = filters;
  const volume = maxAuthors != null && rb.source
    ? restrictDataset(rb.source, { filters: volumeFilters })
    : ds;
  const [volumeSet, impactSet] = filters.partnerKeys?.length ? ['partner', 'partner-impact'] : ['overview', 'impact'];
  const items = [
    ...KPI_SETS[volumeSet].items(volume, range, { ...ctx, filters: volumeFilters }),
    ...KPI_SETS[impactSet].items(ds, range, ctx),
  ];
  if (maxAuthors != null) {
    items.push({
      key: 'impact-scope',
      label: i18n._(msg`Impact indicators`),
      value: i18n._(msg`without the publications of more than ${maxAuthors} authors`),
    });
  }
  return items;
}

/** Executive summary, key points and cooperation leads (Markdown). */
export async function generateExecutiveText(
  rb: ResolvedBlock,
  def: ReportDefinition,
  lang: 'fr' | 'en',
  onProgress: (p: AiProgress) => void = () => {},
): Promise<AiResult> {
  const { structureLabel, partnerLabel } = labels(rb);
  const domains = def.blocks.find((b) => b.kind === 'ai' && b.task === 'domains' && b.text?.trim());
  onProgress({ done: 0, total: 1 });
  const r = await callAi<{ summary: string; keyPoints: string[]; leads: string[] }>({
    task: 'executive', lang, structureLabel, partnerLabel,
    keyFigures: keyFigures(rb).map((f) => ({ label: f.label, value: f.value, hint: f.hint })),
    domainTexts: domains && domains.kind === 'ai' ? domains.text : '',
  });
  onProgress({ done: 1, total: 1 });
  const bullets = (xs: string[]) => xs.map((x) => `- ${x}`).join('\n');
  const text = [
    r.summary,
    r.keyPoints.length ? `### ${i18n._(msg`Key points`)}\n\n${bullets(r.keyPoints)}` : '',
    r.leads.length ? `### ${i18n._(msg`Cooperation leads`)}\n\n${bullets(r.leads)}` : '',
  ].filter(Boolean).join('\n\n');
  return { text, model: r.model };
}

export function generateAiText(
  task: AiTask,
  rb: ResolvedBlock,
  def: ReportDefinition,
  onProgress?: (p: AiProgress) => void,
): Promise<AiResult> {
  return task === 'domains'
    ? generateDomainsText(rb, def.lang, onProgress)
    : generateExecutiveText(rb, def, def.lang, onProgress);
}

/** Label of the frame around an AI text (preview and PDF). */
export function aiFrameLabel(b: { model?: string; reviewedBy?: string; reviewedAt?: string }): string {
  const who = b.model ? `ILAAS, ${b.model}` : 'ILAAS';
  return b.reviewedBy
    ? i18n._(msg`Text generated by AI (${who}) — reviewed by ${b.reviewedBy} on ${b.reviewedAt ?? ''}`)
    : i18n._(msg`Text generated by AI (${who}) — not reviewed yet`);
}

export const AI_TASK_LABELS = {
  executive: msg`AI summary`,
  domains: msg`AI analysis by major theme`,
};
