// Saved definition of a report of the « Mes rapports » space
// (docs/plan-mes-rapports.md § 2): global context (structure, period, scope,
// filters) + ordered blocks. A report is recomputed from this definition each
// time it is opened; a PDF is one generation of it.
// The zod schemas are the single validation point: report storage (lot 2),
// the /embed `f` parameter (embedState.ts) and the editor all go through them.

import { z } from 'zod';
import { EMBEDDABLE_IDS, KPI_SET_IDS, TABLE_IDS } from '../embedIds';
import type { PubFilters } from '../publicationFilters';

/** Bounds of a definition (a Grist Text cell holds it, see plan § 3.1). */
export const REPORT_LIMITS = {
  maxBlocks: 150,
  maxJsonBytes: 200_000,
  maxName: 200,
  maxDescription: 2_000,
  maxText: 20_000,
  maxKeys: 60,
  maxString: 300,
} as const;

const str = z.string().max(REPORT_LIMITS.maxString);
const keyList = z.array(str).max(REPORT_LIMITS.maxKeys);
const year = z.number().int().min(1900).max(2100);

/**
 * Serializable publication filters (PubFilters). Strict: an unknown key is an
 * error rather than a silently ignored criterion.
 */
export const pubFiltersSchema = z.strictObject({
  q: str.optional(),
  year: year.optional(),
  pubType: str.optional(),
  oaStatus: str.optional(),
  language: str.optional(),
  journal: str.optional(),
  publisher: str.optional(),
  quartile: str.optional(),
  journalAccess: str.optional(),
  licenceNationale: z.boolean().optional(),
  team: str.optional(),
  sousStructure: str.optional(),
  memberType: str.optional(),
  authorId: z.number().int().optional(),
  hasPhd: z.boolean().optional(),
  collabType: str.optional(),
  country: str.optional(),
  nantesPartner: str.optional(),
  nationalPartner: str.optional(),
  partnerInstitution: str.optional(),
  partnerKeys: keyList.optional(),
  international: z.boolean().optional(),
  domain: str.optional(),
  subfield: str.optional(),
  topic: str.optional(),
  themeKeys: keyList.optional(),
  theme: str.optional(),
  axe: str.optional(),
  sourceCombo: str.optional(),
  hasApc: z.boolean().optional(),
  top10: z.boolean().optional(),
  top1: z.boolean().optional(),
  charterCompliant: z.boolean().optional(),
  charteSeuil: z.number().min(0).max(1).optional(),
  maxAuthors: z.number().int().min(1).optional(),
});

// Compile-time guard: the schema covers every PubFilters field, and only those.
type SchemaKeys = keyof z.infer<typeof pubFiltersSchema>;
type MissingKeys = Exclude<keyof PubFilters, SchemaKeys>;
type ExtraKeys = Exclude<SchemaKeys, keyof PubFilters>;
const _pubFiltersCovered: [MissingKeys, ExtraKeys] extends [never, never] ? true : never = true;
void _pubFiltersCovered;

export const reportPeriodSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('fixed'), start: year, end: year })
    .refine((p) => p.start <= p.end, { message: 'start after end' }),
  z.strictObject({
    kind: z.literal('relative'),
    lastYears: z.number().int().min(1).max(50),
    includeCurrent: z.boolean(),
  }),
]);

export const reportContextSchema = z.strictObject({
  slug: z.string().regex(/^[a-z0-9_-]{1,64}$/),
  perimetre: z.enum(['affiliation', 'effectifs']),
  period: reportPeriodSchema,
  filters: pubFiltersSchema,
});

const contextOverride = reportContextSchema.partial();
/**
 * true: the block's own filters (override.filters) replace the report filters instead of adding
 * to them — a chart added from the dashboard keeps exactly what was shown there.
 */
const ownFilters = z.boolean().optional();
const chartId = z.string().refine((id) => EMBEDDABLE_IDS.has(id), { message: 'unknown chart' });
const blockId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const text = z.string().max(REPORT_LIMITS.maxText);
const shortText = z.string().max(REPORT_LIMITS.maxString);

export const reportBlockSchema = z.discriminatedUnion('kind', [
  z.strictObject({ id: blockId, hidden: z.boolean().optional(), kind: z.literal('section'), title: shortText }),
  z.strictObject({
    id: blockId,
    hidden: z.boolean().optional(),
    kind: z.literal('chart'),
    chartId,
    title: shortText.optional(),
    note: text.optional(),
    override: contextOverride.optional(),
    ownFilters,
    params: z.record(z.string().max(40), z.union([z.number(), z.string().max(40)])).optional(),
  }),
  z.strictObject({
    id: blockId,
    hidden: z.boolean().optional(),
    kind: z.literal('kpis'),
    setId: z.string().refine((id) => KPI_SET_IDS.has(id), { message: 'unknown key-figure set' }),
    override: contextOverride.optional(),
    ownFilters,
  }),
  z.strictObject({
    id: blockId,
    hidden: z.boolean().optional(),
    kind: z.literal('table'),
    tableId: z.string().refine((id) => TABLE_IDS.has(id), { message: 'unknown table' }),
    limit: z.number().int().min(1).max(5_000).optional(),
    override: contextOverride.optional(),
    ownFilters,
  }),
  z.strictObject({ id: blockId, hidden: z.boolean().optional(), kind: z.literal('text'), markdown: text }),
  z.strictObject({
    id: blockId,
    hidden: z.boolean().optional(),
    kind: z.literal('ai'),
    /** executive = summary, key points and leads; domains = analysis by major theme (reportAi.ts). */
    task: z.enum(['executive', 'domains']),
    /** Scope of the corpus the text is written from (e.g. large collaborations left out, D2). */
    override: contextOverride.optional(),
    ownFilters,
    text: text.optional(),
    reviewedBy: shortText.optional(),
    reviewedAt: shortText.optional(),
    model: shortText.optional(),
  }),
]);

export const reportDefinitionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  name: z.string().trim().min(1).max(REPORT_LIMITS.maxName),
  description: z.string().max(REPORT_LIMITS.maxDescription),
  templateId: z.string().max(60).optional(),
  templateParams: z.record(z.string().max(40), z.unknown()).optional(),
  context: reportContextSchema,
  /** Printed in the footer of every PDF page (e.g. « Document de travail interne », decision D7). */
  footerNote: z.string().max(200).optional(),
  blocks: z.array(reportBlockSchema).max(REPORT_LIMITS.maxBlocks)
    .refine((bs) => new Set(bs.map((b) => b.id)).size === bs.length, { message: 'duplicate block id' }),
  lang: z.enum(['fr', 'en']),
});

export type ReportPeriod = z.infer<typeof reportPeriodSchema>;
export type ReportContext = z.infer<typeof reportContextSchema>;
export type ReportBlock = z.infer<typeof reportBlockSchema>;
export type ReportDefinition = z.infer<typeof reportDefinitionSchema>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Validates an untrusted definition (storage, import): size first, then shape. */
export function parseReportDefinition(input: unknown): ParseResult<ReportDefinition> {
  let size: number;
  try {
    size = new TextEncoder().encode(JSON.stringify(input) ?? '').length;
  } catch {
    return { ok: false, error: 'not serializable' };
  }
  if (size > REPORT_LIMITS.maxJsonBytes) return { ok: false, error: 'definition too large' };
  const r = reportDefinitionSchema.safeParse(input);
  if (!r.success) {
    const first = r.error.issues[0];
    return { ok: false, error: `${first.path.join('.') || '(root)'}: ${first.message}` };
  }
  return { ok: true, value: r.data };
}

let blockSeq = 0;
/**
 * New block id (unique within a report). The counter keeps ids built in one burst (a template of
 * 60 blocks) distinct — the time and random parts alone could collide, and the schema refuses
 * duplicate ids.
 */
export const newBlockId = (): string =>
  `b${Date.now().toString(36)}${(blockSeq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;
