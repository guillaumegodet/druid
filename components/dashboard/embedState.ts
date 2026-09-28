// Filters and chart parameters carried by /embed links (docs/plan-mes-rapports.md
// § 4.1): `f` = publication filters, `p` = chart parameters, each a compact JSON
// object in base64url. The « interactive version » links of a report reopen each
// chart exactly as filtered in the report.
// Untrusted input: size-capped, validated by the report schemas, and the
// public page refuses the filters that target a person or need the private
// corpus.

import { sanitizeChartParams } from './chartMeta';
import type { PubFilters } from './publicationFilters';
import { pubFiltersSchema } from './report/definition';
import { hasActiveFilter } from './report/restrictDataset';

/** Max length of an encoded parameter (a URL stays well under browser limits). */
export const MAX_EMBED_PARAM_LENGTH = 4_000;

/**
 * Filters refused by the public /embed page: `authorId` singles out a person,
 * `memberType` needs the staff list, absent from the public variant of the data.
 */
export const PUBLIC_FORBIDDEN_FILTERS: (keyof PubFilters)[] = ['authorId', 'memberType'];

export function encodeEmbedParam(value: object): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decoded JSON value, or null when the parameter is malformed or oversized. */
export function decodeEmbedParam(raw: string): unknown {
  if (raw.length > MAX_EMBED_PARAM_LENGTH || !/^[A-Za-z0-9_-]*$/.test(raw)) return null;
  try {
    const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

/** `error` set = the link is refused (and `filters` is empty). */
export interface EmbedFiltersResult {
  filters: PubFilters;
  error: 'malformed' | 'forbidden' | null;
}

/** `f` parameter of /embed → filters (empty object when absent). */
export function parseEmbedFilters(raw: string | null, opts: { isPublic: boolean }): EmbedFiltersResult {
  if (raw == null || raw === '') return { filters: {}, error: null };
  const parsed = pubFiltersSchema.safeParse(decodeEmbedParam(raw));
  if (!parsed.success) return { filters: {}, error: 'malformed' };
  const filters = parsed.data;
  if (opts.isPublic && PUBLIC_FORBIDDEN_FILTERS.some((k) => filters[k] != null)) {
    return { filters: {}, error: 'forbidden' };
  }
  return { filters, error: null };
}

/** `p` parameter of /embed → chart parameters (unknown keys dropped, values clamped). */
export function parseEmbedParams(raw: string | null, chartId: string): Record<string, number> {
  if (raw == null || raw === '') return {};
  const value = decodeEmbedParam(raw);
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return {};
  return sanitizeChartParams(chartId, value as Record<string, unknown>);
}

/** Query parameters to append to an /embed URL (only the non-empty ones). */
export function embedStateParams(
  filters: PubFilters | undefined,
  params: Record<string, number> | undefined,
): [string, string][] {
  const out: [string, string][] = [];
  if (filters && hasActiveFilter(filters)) out.push(['f', encodeEmbedParam(filters)]);
  if (params && Object.keys(params).length > 0) out.push(['p', encodeEmbedParam(params)]);
  return out;
}
