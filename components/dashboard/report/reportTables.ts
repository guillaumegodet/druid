// Tables of report `table` blocks (docs/plan-mes-rapports.md § 2): plain rows computed from the
// block dataset, shown in the preview and printed (paginated) in the PDF. First table: the list
// of publications, annex of the « Collaboration avec une université » template (decision D6).
// The researcher pairs table reads the block's remote payload (REMOTE_TABLES of chartMeta.ts).

import { i18n, type MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { YearRange } from '../overviewAggregates';
import { unitsOfDataset } from '../collabAggregates';
import type { PairsResponse } from '../pairsApi';
import { pairAuthorLabel, pairTrendLabel } from '../pairsKpis';
import type { DashboardDataset } from '../types';

export interface TableColumn {
  label: MessageDescriptor;
  /** Relative width in the PDF (sum per table normalized). */
  width: number;
}

export interface TableRows {
  columns: TableColumn[];
  rows: string[][];
  /** Rows left out by the limit. */
  omitted: number;
  /** DOI link of each row (same order), when there is one. */
  links?: (string | null)[];
}

export interface ReportTable {
  label: MessageDescriptor;
  /**
   * `dataset` = restricted corpus of the block (null for a table fed by a remote source);
   * `remote` = payload of its remote source.
   */
  build: (dataset: DashboardDataset | null, range: YearRange, limit: number, remote?: unknown) => TableRows;
}

const EMPTY_ROWS: TableRows = { columns: [], rows: [], omitted: 0 };

export const DEFAULT_TABLE_LIMIT = 500;

/** ⚠️ Keys = TABLE_IDS (embedIds.ts). */
export const REPORT_TABLES: Record<string, ReportTable> = {
  publications: {
    label: msg`List of publications`,
    build: (dataset, range, limit) => {
      if (!dataset) return EMPTY_ROWS;
      const units = unitsOfDataset(dataset);
      const pubs = dataset.publications
        .filter((p) => typeof p.year === 'number' && p.year >= range.start && p.year <= range.end)
        .sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || (a.title ?? '').localeCompare(b.title ?? ''));
      const shown = pubs.slice(0, limit);
      const labsOf = (p: (typeof pubs)[number]) => units.of(p).join(', ');
      return {
        columns: [
          { label: msg`Year`, width: 8 },
          { label: msg`Title`, width: 50 },
          { label: msg`Journal`, width: 24 },
          { label: units.kind === 'teams' ? msg`Teams` : msg`Labs`, width: 18 },
        ],
        rows: shown.map((p) => [String(p.year ?? ''), p.title ?? '—', p.journal ?? '', labsOf(p)]),
        links: shown.map((p) => (p.doi ? `https://doi.org/${p.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '')}` : null)),
        omitted: pubs.length - shown.length,
      };
    },
  },
  // Most frequent pairs first (the order of the /pairs response).
  pairs: {
    label: msg`Researcher pairs`,
    build: (_dataset, _range, limit, remote) => {
      const r = remote as PairsResponse | undefined;
      if (!r) return EMPTY_ROWS;
      const shown = r.pairs.slice(0, limit);
      const fmtDistance = (d: number | null) => (d == null ? '—' : d.toFixed(2));
      return {
        columns: [
          { label: msg`Researcher`, width: 28 },
          { label: msg`Researcher`, width: 28 },
          { label: msg`Joint pubs`, width: 9 },
          { label: msg`Years`, width: 11 },
          { label: msg`Trend`, width: 12 },
          { label: msg`Distance`, width: 10 },
        ],
        rows: shown.map((p) => [
          pairAuthorLabel(p.a),
          pairAuthorLabel(p.b),
          String(p.shared),
          p.first === p.last ? String(p.first) : `${p.first}–${p.last}`,
          pairTrendLabel(p.trend),
          fmtDistance(p.distance),
        ]),
        // Pairs beyond the 2 000 returned by the route count as omitted too.
        omitted: Math.max(r.total, r.pairs.length) - shown.length,
      };
    },
  },
};

/** Title of a table block (translated). */
export const tableLabel = (tableId: string): string =>
  REPORT_TABLES[tableId] ? i18n._(REPORT_TABLES[tableId].label) : tableId;
