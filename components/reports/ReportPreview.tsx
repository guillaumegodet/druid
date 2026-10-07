// In-page preview of a report (docs/plan-mes-rapports.md § 4.3): the resolved blocks rendered
// with the registry components — the same data, periods and parameters as the PDF.

import React, { useMemo } from 'react';
import { AlertTriangle, EyeOff, RefreshCw, Sparkles } from 'lucide-react';
import { AI_TASK_LABELS, aiFrameLabel } from '../dashboard/report/reportAi';
import { Trans, useLingui } from '@lingui/react/macro';
import { EMBED_CHARTS } from '../dashboard/embedRegistry';
import { KpiSetCards } from '../dashboard/KpiCards';
import { KPI_SETS } from '../dashboard/kpiItems';
import { parseMarkdownLite, type MdInline } from '../dashboard/report/markdownLite';
import type { ResolvedBlock, ResolvedReport } from '../dashboard/report/resolveReport';
import { DEFAULT_TABLE_LIMIT, REPORT_TABLES, tableLabel } from '../dashboard/report/reportTables';
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

/** Rows shown in the preview (the PDF prints up to the block limit). */
const PREVIEW_ROWS = 30;

const TableBlock: React.FC<{ tableId: string; rb: ResolvedBlock; limit?: number }> = ({ tableId, rb, limit }) => {
  const { t } = useLingui();
  const table = REPORT_TABLES[tableId];
  const data = useMemo(
    () => (table && rb.dataset && rb.scope ? table.build(rb.dataset, rb.scope.range, limit ?? DEFAULT_TABLE_LIMIT) : null),
    [table, rb.dataset, rb.scope, limit],
  );
  if (!data) return null;
  const rest = data.rows.length - PREVIEW_ROWS;
  return (
    <div className="glass-card p-4 flex flex-col gap-2">
      <h4 className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea]">{tableLabel(tableId)}</h4>
      <div className="overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-muted dark:text-[#c3beb0]">
              {data.columns.map((c, i) => <th key={i} className="py-1 pr-3 font-semibold">{t(c.label)}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.rows.slice(0, PREVIEW_ROWS).map((row, r) => (
              <tr key={r} className="border-t border-ink/5 dark:border-white/10 align-top">
                {row.map((cell, i) => (
                  <td key={i} className="py-1 pr-3">
                    {i === 1 && data.links?.[r]
                      ? <a href={data.links[r]!} target="_blank" rel="noreferrer" className="underline decoration-dotted">{cell}</a>
                      : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(rest > 0 || data.omitted > 0) && (
        <p className="text-xs text-muted-light dark:text-[#8f897c]">
          <Trans>Preview limited to {PREVIEW_ROWS} rows; the PDF prints {data.rows.length} of {data.rows.length + data.omitted}.</Trans>
        </p>
      )}
    </div>
  );
};

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
  if (b.kind === 'ai') {
    if (!b.text?.trim()) {
      return (
        <Placeholder>
          <Sparkles className="w-4 h-4" /> {t(AI_TASK_LABELS[b.task])} — <Trans>not generated yet: use « Generate » in the block settings (left column).</Trans>
        </Placeholder>
      );
    }
    return (
      <div className="glass-card p-5 border-l-4 border-accent flex flex-col gap-2">
        <p className={`text-xs font-semibold flex items-center gap-1.5 ${b.reviewedBy ? 'text-muted-light dark:text-[#8f897c]' : 'text-[#9a6b00] dark:text-[#f4d24a]'}`}>
          <Sparkles className="w-3.5 h-3.5" /> {aiFrameLabel(b)}
        </p>
        <MarkdownView md={b.text} />
      </div>
    );
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
  if (b.kind === 'table') return <TableBlock tableId={b.tableId} rb={rb} limit={b.limit} />;
  if (b.kind === 'kpis') {
    const set = KPI_SETS[b.setId];
    return (
      <div className="flex flex-col gap-2">
        {set && <h4 className="section-label">{t(set.label)}</h4>}
        <KpiSetCards setId={b.setId} dataset={rb.dataset} range={rb.scope.range} source={rb.source} filters={rb.scope.filters} />
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
      <entry.Chart dataset={rb.dataset} range={rb.scope.range} params={rb.params} filters={rb.scope.filters} source={rb.source} />
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
