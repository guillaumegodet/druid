// In-page preview of a report (docs/plan-mes-rapports.md § 4.3): the resolved blocks rendered
// with the registry components — the same data, periods and parameters as the PDF.

import React from 'react';
import { AlertTriangle, EyeOff, RefreshCw } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { EMBED_CHARTS } from '../dashboard/embedRegistry';
import { KpiSetCards } from '../dashboard/KpiCards';
import { KPI_SETS } from '../dashboard/kpiItems';
import { parseMarkdownLite, type MdInline } from '../dashboard/report/markdownLite';
import type { ResolvedBlock, ResolvedReport } from '../dashboard/report/resolveReport';
import { FEATURE_LABELS } from './ChartPicker';

const Inline: React.FC<{ runs: MdInline[] }> = ({ runs }) => (
  <>
    {runs.map((r, i) => {
      if (r.url) return <a key={i} href={r.url} target="_blank" rel="noreferrer" className="underline">{r.text}</a>;
      if (r.bold) return <strong key={i}>{r.text}</strong>;
      if (r.italic) return <em key={i}>{r.text}</em>;
      return <React.Fragment key={i}>{r.text}</React.Fragment>;
    })}
  </>
);

export const MarkdownView: React.FC<{ md: string }> = ({ md }) => (
  <div className="flex flex-col gap-2 text-[15px] leading-relaxed text-ink dark:text-[#e8e4d8]">
    {parseMarkdownLite(md).map((n, i) =>
      n.kind === 'heading' ? (
        <h4 key={i} className={`font-disp font-semibold ${n.level === 1 ? 'text-lg' : 'text-base'}`}><Inline runs={n.inline} /></h4>
      ) : n.kind === 'bullets' ? (
        <ul key={i} className="list-disc pl-5">
          {n.items.map((it, j) => <li key={j}><Inline runs={it} /></li>)}
        </ul>
      ) : (
        <p key={i}><Inline runs={n.inline} /></p>
      ),
    )}
  </div>
);

const Placeholder: React.FC<{ children: React.ReactNode; spin?: boolean }> = ({ children, spin }) => (
  <div className="glass-card p-5 flex items-center gap-2 text-sm text-muted-light dark:text-[#8f897c]">
    {spin ? <RefreshCw className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
    {children}
  </div>
);

const BlockBody: React.FC<{ rb: ResolvedBlock }> = ({ rb }) => {
  const { t } = useLingui();
  const b = rb.block;
  if (b.kind === 'section') {
    return <h3 className="font-disp font-bold text-2xl text-ink dark:text-[#f5f2ea] pt-2 border-l-4 border-accent pl-3">{b.title || '—'}</h3>;
  }
  if (b.kind === 'text') {
    return b.markdown.trim()
      ? <div className="glass-card p-5"><MarkdownView md={b.markdown} /></div>
      : <Placeholder><Trans>Empty text block</Trans></Placeholder>;
  }
  if (b.kind === 'ai' || b.kind === 'table') {
    return <Placeholder><Trans>This kind of block is not available yet.</Trans></Placeholder>;
  }
  const slug = rb.scope?.slug ?? '';
  if (rb.status === 'loading') return <Placeholder spin><Trans>Loading the data of {slug}…</Trans></Placeholder>;
  if (rb.status === 'no-data') return <Placeholder><Trans>No data available for {slug}, or no access to it.</Trans></Placeholder>;
  if (rb.status === 'unknown-chart') return <Placeholder><Trans>This chart no longer exists.</Trans></Placeholder>;
  if (rb.status === 'missing-feature') {
    const reasons = rb.missing.map((f) => t(FEATURE_LABELS[f])).join(', ');
    return <Placeholder><Trans>Not available for {slug}: {reasons}.</Trans></Placeholder>;
  }
  if (!rb.dataset || !rb.scope) return null;
  if (b.kind === 'kpis') {
    const set = KPI_SETS[b.setId];
    return (
      <div className="flex flex-col gap-2">
        {set && <h4 className="section-label">{t(set.label)}</h4>}
        <KpiSetCards setId={b.setId} dataset={rb.dataset} range={rb.scope.range} />
      </div>
    );
  }
  const entry = EMBED_CHARTS[b.chartId];
  return (
    <div className="flex flex-col gap-1.5">
      {b.title?.trim() && <h4 className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea] px-1">{b.title}</h4>}
      {rb.trivial.length > 0 && (
        <p className="text-xs text-[#9a6b00] dark:text-[#f4d24a] px-1 flex items-center gap-1">
          <AlertTriangle className="w-3.5 h-3.5" /> <Trans>This chart says little under the current filters.</Trans>
        </p>
      )}
      <entry.Chart dataset={rb.dataset} range={rb.scope.range} params={rb.params} />
      {b.note?.trim() && <p className="text-sm text-ink dark:text-[#e8e4d8] px-1 whitespace-pre-line">{b.note}</p>}
    </div>
  );
};

export const ReportPreview: React.FC<{
  resolved: ResolvedReport;
  selectedId: string | null;
  onSelect: (id: string) => void;
}> = ({ resolved, selectedId, onSelect }) => {
  if (resolved.blocks.length === 0) {
    return (
      <div className="glass-card p-8 text-center text-sm text-muted dark:text-[#c3beb0]">
        <Trans>This report is empty. Add a section, a chart, key figures or text from the left-hand column.</Trans>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {resolved.blocks.map((rb) => (
        <div
          key={rb.block.id}
          onClickCapture={() => onSelect(rb.block.id)}
          className={`relative rounded-2xl transition-shadow ${selectedId === rb.block.id ? 'ring-2 ring-accent ring-offset-2 ring-offset-transparent' : ''} ${rb.block.hidden ? 'opacity-45' : ''}`}
        >
          {rb.block.hidden && (
            <span className="absolute right-3 top-3 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-ink/80 text-white text-[11px]">
              <EyeOff className="w-3 h-3" /> <Trans>Hidden from the PDF</Trans>
            </span>
          )}
          <BlockBody rb={rb} />
        </div>
      ))}
    </div>
  );
};
