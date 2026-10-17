// PostgreSQL store of the calls added by hand (druid-internal docs/plan-funding-calls.md, lot 6): the funders and
// programmes of the `manual` source, created on the fly from the form or the catalogue, the calls with their review
// state (to_validate → validated / rejected), the duplicates by URL. Server side only (lib/calls/manual.ts for the rules).
import { createHash } from 'node:crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { DB } from '../db/schema.gen';
import { contentHashOf } from './collect';
import {
  catalogueCallInput, catalogueColumns, catalogueRowOf, LIMITS, MANUAL_SOURCE, manualFunderId, manualProgrammeId, validateManualCall,
  type CatalogueRow, type FunderView, type ManualCall, type ManualCallView, type ManualProgrammeRef, type ManualProgrammeView, type ReviewStatus,
} from './manual';
import type { CallStatus, FunderCategory } from './programmes';

type Queryable = Kysely<DB> | Transaction<DB>;

export class ManualCallError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

/** URL compared for the duplicates: no fragment, no trailing slash, host in lower case. */
export const normalizedUrl = (url: string): string => {
  try {
    const u = new URL(url);
    u.hash = '';
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return url.trim();
  }
};

/** Id of a new call: from the reference of the catalogue, else its programme, URL and title (a page of a funder may
 * list several calls, so the URL alone is not enough). */
export const manualCallId = (key: { reference?: string; url?: string; programmeId: string; title: string }): string => {
  const basis = key.reference ? `ref:${key.reference.trim().toLowerCase()}` : `call:${key.programmeId}|${key.url ? normalizedUrl(key.url) : ''}|${key.title.toLowerCase()}`;
  return `M-${createHash('sha1').update(basis).digest('hex').slice(0, 12).toUpperCase()}`;
};

const iso = (v: Date | string | null | undefined): string => (v instanceof Date ? v.toISOString() : v ?? '');
const taxonomyOf = (v: unknown): Record<string, string> =>
  Object.fromEntries(Object.entries(v && typeof v === 'object' ? v as Record<string, unknown> : {}).filter(([, x]) => typeof x === 'string').map(([k, x]) => [k, x as string]));
const textOf = (v: unknown): string => (v && typeof v === 'object' && typeof (v as { text?: unknown }).text === 'string' ? (v as { text: string }).text : '');

/** A row of a catalogue in the preview or the report of an import (line = row of the spreadsheet, header = 1). */
export interface CatalogueLine {
  line: number;
  title: string;
  programme: string;
  action: 'new' | 'update' | 'error';
  errors: string[];
  callId: string | null;
}

export interface CatalogueReport {
  /** Header of the file → field recognised. */
  columns: Record<string, keyof CatalogueRow>;
  ignored: string[];
  lines: CatalogueLine[];
  applied: boolean;
  /** Rows beyond LIMITS.csvRows, left out. */
  truncated: number;
}

export interface SaveOptions {
  /** Edit of this call (a call added by hand); a new call otherwise. */
  callId?: string;
  /** Reference of the row in a catalogue: the same reference updates the same call. */
  reference?: string;
  reviewStatus: Exclude<ReviewStatus, 'rejected'>;
  user: string;
}

export const createManualCallsStore = (db: Kysely<DB>) => {
  const funders = async (): Promise<FunderView[]> =>
    (await db.selectFrom('funder').select(['funder_id', 'name', 'category']).orderBy('name').execute())
      .map((f) => ({ funderId: f.funder_id, name: f.name, category: f.category as FunderCategory }));

  const programmes = async (): Promise<ManualProgrammeView[]> =>
    (await db.selectFrom('funding_programme as p').innerJoin('funder as f', 'f.funder_id', 'p.funder_id')
      .select(['p.programme_id', 'p.name', 'p.active', 'f.funder_id', 'f.name as funder_name', 'f.category'])
      .where('p.source', '=', MANUAL_SOURCE).orderBy('f.name').orderBy('p.name').execute())
      .map((p) => ({ programmeId: p.programme_id, name: p.name, funderId: p.funder_id, funderName: p.funder_name, category: p.category as FunderCategory, active: p.active }));

  /** The programme of the call, created (with its funder) when new; a programme of a collector is refused. */
  const resolveProgramme = async (trx: Queryable, ref: ManualProgrammeRef): Promise<string> => {
    if ('programmeId' in ref) {
      const p = await trx.selectFrom('funding_programme').select(['source']).where('programme_id', '=', ref.programmeId).executeTakeFirst();
      if (!p) throw new ManualCallError('Unknown programme', 404);
      if (p.source !== MANUAL_SOURCE) throw new ManualCallError('This programme is collected automatically: add the call to a programme of its own');
      return ref.programmeId;
    }
    let funderId: string;
    if ('funderId' in ref.funder) {
      funderId = ref.funder.funderId;
      if (!(await trx.selectFrom('funder').select('funder_id').where('funder_id', '=', funderId).executeTakeFirst())) throw new ManualCallError('Unknown funder', 404);
    } else {
      // A funder of the same name is reused, whoever created it.
      const known = await trx.selectFrom('funder').select('funder_id').where(sql<boolean>`lower(name) = lower(${ref.funder.name})`).executeTakeFirst();
      funderId = known?.funder_id ?? manualFunderId(ref.funder.name);
      if (!known) {
        await trx.insertInto('funder').values({ funder_id: funderId, name: ref.funder.name, country: ref.funder.country ?? 'FR', category: ref.funder.category, url: '' })
          .onConflict((oc) => oc.column('funder_id').doNothing()).execute();
      }
    }
    const same = await trx.selectFrom('funding_programme').select('programme_id').where('funder_id', '=', funderId).where('source', '=', MANUAL_SOURCE)
      .where(sql<boolean>`lower(name) = lower(${ref.name})`).executeTakeFirst();
    if (same) return same.programme_id;
    const programmeId = manualProgrammeId(funderId, ref.name);
    const taken = await trx.selectFrom('funding_programme').select('source').where('programme_id', '=', programmeId).executeTakeFirst();
    if (taken && taken.source !== MANUAL_SOURCE) throw new ManualCallError('A collected programme already has this identifier');
    if (!taken) {
      await trx.insertInto('funding_programme').values({
        programme_id: programmeId, funder_id: funderId, name: ref.name, kind: 'thematic', url: '', source: MANUAL_SOURCE, refresh: 'manual', subset_label: '', active: true,
      }).execute();
    }
    return programmeId;
  };

  /** Calls with the same URL (any source), the call being edited aside. */
  const duplicatesOf = async (url: string, exceptCallId?: string): Promise<{ callId: string; title: string; programmeId: string }[]> => {
    if (!url) return [];
    const target = normalizedUrl(url);
    // Same host and path up to the trailing slash, compared in SQL on a prefix then exactly here.
    let q = db.selectFrom('funding_call').select(['call_id', 'title', 'programme_id', 'url']).where('url', 'ilike', `${target.replace(/[\\%_]/g, '\\$&')}%`);
    if (exceptCallId) q = q.where('call_id', '<>', exceptCallId);
    return (await q.limit(20).execute()).filter((c) => normalizedUrl(c.url) === target)
      .map((c) => ({ callId: c.call_id, title: c.title, programmeId: c.programme_id }));
  };

  const list = async (): Promise<ManualCallView[]> => {
    const rows = await db.selectFrom('funding_call as c')
      .innerJoin('funding_programme as p', 'p.programme_id', 'c.programme_id').innerJoin('funder as f', 'f.funder_id', 'p.funder_id')
      .select(['c.call_id', 'c.programme_id', 'c.subset', 'c.title', 'c.summary', 'c.objectives', 'c.scope', 'c.eligibility', 'c.budget', 'c.opening_date',
        'c.deadlines', 'c.url', 'c.lang', 'c.status', 'c.taxonomy', 'c.review_status', 'c.added_by', 'c.reviewed_by', 'c.reviewed_at', 'c.updated_at',
        'p.name as programme_name', 'f.funder_id', 'f.name as funder_name'])
      .select((eb) => eb.selectFrom('call_match as m').select(sql<string>`count(*)`.as('n')).whereRef('m.call_id', '=', 'c.call_id').as('matches'))
      .where('p.source', '=', MANUAL_SOURCE)
      .orderBy(sql`c.review_status = 'to_validate'`, 'desc').orderBy('c.updated_at', 'desc').execute();
    return rows.map((c) => ({
      callId: c.call_id, programmeId: c.programme_id, programmeName: c.programme_name, funderId: c.funder_id, funderName: c.funder_name,
      subset: c.subset, title: c.title, summary: c.summary, objectives: c.objectives, scope: c.scope,
      eligibility: textOf(c.eligibility), budget: textOf(c.budget), openingDate: c.opening_date ? iso(c.opening_date).slice(0, 10) : null,
      deadlines: c.deadlines, url: c.url, lang: c.lang === 'en' ? 'en' : 'fr', status: c.status as CallStatus, taxonomy: taxonomyOf(c.taxonomy),
      reviewStatus: c.review_status as ReviewStatus, addedBy: c.added_by, reviewedBy: c.reviewed_by,
      reviewedAt: c.reviewed_at ? iso(c.reviewed_at) : null, updatedAt: iso(c.updated_at), matches: Number(c.matches ?? 0),
    }));
  };

  const isManual = async (trx: Queryable, callId: string): Promise<{ summary: string; summary_fr: string } | null> =>
    (await trx.selectFrom('funding_call as c').innerJoin('funding_programme as p', 'p.programme_id', 'c.programme_id')
      .select(['c.summary', 'c.summary_fr']).where('c.call_id', '=', callId).where('p.source', '=', MANUAL_SOURCE).executeTakeFirst()) ?? null;

  /** Writes a call (new or edited); returns its id and whether it was created. */
  const save = async (call: ManualCall, options: SaveOptions): Promise<{ callId: string; created: boolean; programmeId: string }> =>
    db.transaction().execute(async (trx) => {
      const programmeId = await resolveProgramme(trx, call.programme);
      const callId = options.callId ?? manualCallId({ reference: options.reference, url: call.url, programmeId, title: call.title });
      const existing = await isManual(trx, callId);
      if (options.callId && !existing) throw new ManualCallError('Unknown call', 404);
      if (!existing && (await trx.selectFrom('funding_call').select('call_id').where('call_id', '=', callId).executeTakeFirst())) {
        throw new ManualCallError('A collected call already has this identifier', 409);
      }
      // The summary is in the language of the call: a French one is its own translation; an unchanged one keeps it.
      const summaryFr = call.lang === 'fr' ? call.summary : existing && existing.summary === call.summary ? existing.summary_fr : '';
      const validated = options.reviewStatus === 'validated';
      const fields = {
        programme_id: programmeId, subset: call.subset, title: call.title, summary: call.summary, summary_fr: summaryFr,
        objectives: call.objectives, scope: call.scope, eligibility: JSON.stringify(call.eligibility ? { text: call.eligibility } : {}),
        budget: JSON.stringify(call.budget ? { text: call.budget } : {}), opening_date: call.openingDate, deadlines: call.deadlines,
        url: call.url, lang: call.lang, content_hash: contentHashOf(call.objectives, call.scope), status: call.status,
        taxonomy: JSON.stringify(call.taxonomy),
        review_status: options.reviewStatus,
        ...(validated ? { reviewed_by: options.user, reviewed_at: sql<Date>`now()` } : { reviewed_by: '', reviewed_at: null }),
      };
      if (existing) {
        await trx.updateTable('funding_call').set({ ...fields, updated_at: sql`now()` }).where('call_id', '=', callId).execute();
      } else {
        await trx.insertInto('funding_call').values({ call_id: callId, ...fields, added_by: options.user }).execute();
      }
      return { callId, created: !existing, programmeId };
    });

  /** Validates, rejects or sends back a call added by hand; false when it is not one. */
  const setReview = async (callId: string, status: ReviewStatus, user: string): Promise<boolean> => {
    if (!(await isManual(db, callId))) return false;
    await db.updateTable('funding_call').set({
      review_status: status, updated_at: sql`now()`,
      ...(status === 'to_validate' ? { reviewed_by: '', reviewed_at: null } : { reviewed_by: user, reviewed_at: sql<Date>`now()` }),
    }).where('call_id', '=', callId).execute();
    return true;
  };

  /** Deletes a call added by hand that no engine matched yet (a matched call is rejected instead). */
  const remove = async (callId: string): Promise<'deleted' | 'matched' | 'unknown'> => {
    if (!(await isManual(db, callId))) return 'unknown';
    if (await db.selectFrom('call_match').select('pair_id').where('call_id', '=', callId).executeTakeFirst()) return 'matched';
    await db.deleteFrom('funding_call').where('call_id', '=', callId).execute();
    return 'deleted';
  };

  /** Ids of the calls a catalogue would update (same reference, URL or title), to tell new rows from updates. */
  const existingIds = async (callIds: string[]): Promise<Set<string>> =>
    new Set(callIds.length ? (await db.selectFrom('funding_call').select('call_id').where('call_id', 'in', callIds).execute()).map((r) => r.call_id) : []);

  /** Programme a reference resolves to without creating it (preview of a catalogue): its id, or null when new. */
  const programmeIdOf = async (ref: ManualProgrammeRef): Promise<string | null> => {
    if ('programmeId' in ref) return ref.programmeId;
    let funderId: string | undefined;
    if ('funderId' in ref.funder) funderId = ref.funder.funderId;
    else funderId = (await db.selectFrom('funder').select('funder_id').where(sql<boolean>`lower(name) = lower(${ref.funder.name})`).executeTakeFirst())?.funder_id;
    if (!funderId) return null;
    return (await db.selectFrom('funding_programme').select('programme_id').where('funder_id', '=', funderId).where('source', '=', MANUAL_SOURCE)
      .where(sql<boolean>`lower(name) = lower(${ref.name})`).executeTakeFirst())?.programme_id ?? null;
  };

  /** Preview (apply: false) or import of a catalogue: rows read by the browser (header → cell), checked one by one. */
  const importCatalogue = async (rows: Record<string, unknown>[], headers: string[], options: { apply: boolean; validate: boolean; user: string; today: string }): Promise<CatalogueReport> => {
    const { known, ignored } = catalogueColumns(headers);
    if (!Object.values(known).includes('title')) throw new ManualCallError('No column of the file is a title (« Titre », « Title », « Intitulé »)');
    const lines: CatalogueLine[] = [];
    const seen = new Set<string>();
    for (const [i, raw] of rows.slice(0, LIMITS.csvRows).entries()) {
      const row = catalogueRowOf(raw, known);
      if (!Object.values(row).some(Boolean)) continue;
      const { call, errors } = validateManualCall(catalogueCallInput(row), options.today);
      const programme = row.programmeId || [row.funder, row.programme].filter(Boolean).join(' › ');
      const line: CatalogueLine = { line: i + 2, title: row.title, programme, action: 'error', errors, callId: null };
      lines.push(line);
      if (!call) continue;
      if (options.apply) {
        try {
          const saved = await save(call, { reference: row.reference || undefined, reviewStatus: options.validate ? 'validated' : 'to_validate', user: options.user });
          line.callId = saved.callId;
          line.action = saved.created ? 'new' : 'update';
        } catch (e) {
          line.errors.push(e instanceof Error ? e.message : String(e));
        }
        continue;
      }
      const programmeId = await programmeIdOf(call.programme);
      if ('programmeId' in call.programme && !programmeId) { line.errors.push('Unknown programme'); continue; }
      line.callId = programmeId || row.reference ? manualCallId({ reference: row.reference || undefined, url: call.url, programmeId: programmeId ?? '', title: call.title }) : null;
      line.action = line.callId && (seen.has(line.callId) || (await existingIds([line.callId])).has(line.callId)) ? 'update' : 'new';
      if (line.callId) seen.add(line.callId);
    }
    return { columns: known, ignored, lines, applied: options.apply, truncated: Math.max(0, rows.length - LIMITS.csvRows) };
  };

  return { funders, programmes, list, duplicatesOf, save, setReview, remove, existingIds, programmeIdOf, importCatalogue };
};

export type ManualCallsStore = ReturnType<typeof createManualCallsStore>;
