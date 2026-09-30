/**
 * @file affiliationHistory.ts
 * @description Career path of a researcher (docs/plan-parcours-affiliations.md, lot 3): types of the entry
 * computed by scripts/sync_affiliation_history.cjs, API client (server.cjs, lot 2) and pure helpers used
 * by the « Parcours » block of the record (components/researchers/AffiliationHistorySection.tsx).
 */
import { translateApiError } from './apiErrors';

export type OrgClass = 'local' | 'neutral' | 'other' | 'unknown';

export interface AhEstablishment {
  key: string;
  name: string;
  country: string;
  cls: OrgClass;
  byYear: Record<string, number>;
  first: number | null;
  last: number | null;
  count: number;
  labs: { name: string; count: number }[];
}
export interface AhPeriod {
  kind: 'employment' | 'invited';
  name: string;
  lab: string;
  cls: OrgClass;
  country: string;
  start: string;
  end: string;
  role: string;
  dept: string;
}
export type AhSignalType =
  | 'depart_confirme' | 'depart_declare' | 'nouveau_poste_declare' | 'depart_observe'
  | 'scopus_courante_non_locale' | 'arrivee' | 'identifiant_suspect' | 'statut_incoherent';
export interface AhSignal {
  type: AhSignalType;
  strength: 'very_strong' | 'strong' | 'medium' | 'suggestion' | 'control';
  date?: string;
  destination?: string;
  destinationStart?: string;
  establishment?: string;
  count?: number;
  rule?: 'last_local' | 'dominant';
  sources?: string[];
  source?: 'orcid' | 'publications';
  lastPub?: number | null;
  endYear?: number;
  lastLocal?: number;
  orcidOpenLocal?: boolean;
}
export interface AhPublication {
  y: number | null;
  doi?: string;
  t: string;
  s: string[];      // sources: graph | openalex | scopus
  c: OrgClass[];    // classes of the publication (local wins over other)
  e: number[];      // indexes in `establishments`
}
export interface AhEntry {
  computedAt: string;
  ids: { uid: string; orcid: string; openalex: string[]; scopus: string[] };
  sources: { graph: number | null; openalex: number | null; scopus: number | null; orcid: number | null; scopusProfile: boolean };
  incomplete: string[];
  totals: { pubs: number; withAffiliation: number; undated: number };
  firstLocal: number | null;
  lastLocal: number | null;
  establishments: AhEstablishment[];
  orcid: AhPeriod[];
  scopusProfile: { current: { name: string; cls: OrgClass }[]; history: { name: string; cls: OrgClass }[]; range: { start: number | null; end: number | null } } | null;
  signals: AhSignal[];
  pubs: AhPublication[];
}
export interface AhRun { running: boolean; done: number; total: number; startedAt: string | null }
export type AhResponse = { entry: AhEntry; run: AhRun | null };

/** Error of the API carrying its HTTP status (404 = not computed yet, with the run state). */
export class AhError extends Error {
  constructor(message: string, public status: number, public run: AhRun | null = null) { super(message); }
}

/** Key of a record for the API: uid_dyna, or g<rowId> for records without uid (same key as the job). */
export const affiliationHistoryKey = (r: { uid?: string; gristRowId?: number }): string | null =>
  (r.uid ? r.uid : r.gristRowId ? `g${r.gristRowId}` : null);

async function request(url: string, init?: RequestInit): Promise<AhResponse> {
  const resp = await fetch(url, init);
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new AhError(translateApiError(String((data as { error?: unknown }).error || '')) || `HTTP ${resp.status}`, resp.status, (data as { run?: AhRun }).run ?? null);
  return data as AhResponse;
}
export const AffiliationHistoryApi = {
  get: (key: string) => request(`/api/researchers/${encodeURIComponent(key)}/affiliation-history`),
  refresh: (key: string) => request(`/api/researchers/${encodeURIComponent(key)}/affiliation-history/refresh`, { method: 'POST' }),
};

// ── Pure helpers ─────────────────────────────────────────────────────────────
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Leading year of a fuzzy date (AAAA[-MM[-JJ]]); null when empty. */
export const yearOf = (d?: string | null): number | null => {
  const m = String(d || '').match(/^(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
};

export interface TimelineRow {
  name: string;
  cls: OrgClass;
  country: string;
  estIndex: number | null;          // index in entry.establishments (null = ORCID only)
  periods: AhPeriod[];              // ORCID periods of this establishment
  byYear: Record<string, number>;
  count: number;
  first: number | null;
  last: number | null;
  inScopus: 'current' | 'history' | null;
}

/**
 * Rows of the timeline and of the table: every establishment of the publications, plus the ORCID
 * establishments no publication mentions; ORCID periods and Scopus history attached by name.
 * Order: local first, then by last year (most recent first), then by count. `max` keeps the chart
 * readable (the table shows everything).
 */
export function timelineRows(entry: AhEntry, max = Infinity): TimelineRow[] {
  const rows: TimelineRow[] = entry.establishments.map((e, i) => ({
    name: e.name, cls: e.cls, country: e.country, estIndex: i, periods: [], byYear: e.byYear,
    count: e.count, first: e.first, last: e.last, inScopus: null,
  }));
  const byName = new Map(rows.map((r) => [norm(r.name), r]));
  for (const p of entry.orcid) {
    const k = norm(p.name);
    let row = byName.get(k);
    if (!row) {
      row = { name: p.name, cls: p.cls, country: p.country, estIndex: null, periods: [], byYear: {}, count: 0, first: null, last: null, inScopus: null };
      rows.push(row);
      byName.set(k, row);
    }
    row.periods.push(p);
  }
  for (const [list, tag] of [[entry.scopusProfile?.history || [], 'history'], [entry.scopusProfile?.current || [], 'current']] as const) {
    for (const a of list) { const row = byName.get(norm(a.name)); if (row) row.inScopus = tag; }
  }
  const lastOf = (r: TimelineRow) => Math.max(r.last || 0, ...r.periods.map((p) => (p.end ? yearOf(p.end) || 0 : 9999)));
  const rank = (c: OrgClass) => (c === 'local' ? 0 : c === 'other' ? 1 : c === 'neutral' ? 2 : 3);
  rows.sort((a, b) => rank(a.cls) - rank(b.cls) || lastOf(b) - lastOf(a) || b.count - a.count);
  return rows.slice(0, max);
}

/** Year range of the timeline (publications, ORCID periods, Druid employment), padded to ≥ 5 years. */
export function yearRange(rows: TimelineRow[], employment: { start?: string; end?: string }, now: number): [number, number] {
  const ys: number[] = [];
  for (const r of rows) {
    for (const y of Object.keys(r.byYear)) ys.push(parseInt(y, 10));
    for (const p of r.periods) { const s = yearOf(p.start); const e = yearOf(p.end); if (s) ys.push(s); if (e) ys.push(e); }
  }
  const es = yearOf(employment.start); const ee = yearOf(employment.end);
  if (es) ys.push(es);
  if (ee) ys.push(ee);
  if (!ys.length) return [now - 4, now];
  let lo = Math.min(...ys); const hi = Math.min(Math.max(...ys, lo), now);
  if (hi - lo < 4) lo = hi - 4;
  return [lo, hi];
}

/** Display order of the signals in the banner (strongest departure first, controls last). */
const SIGNAL_ORDER: AhSignalType[] = ['depart_confirme', 'depart_declare', 'nouveau_poste_declare', 'depart_observe', 'scopus_courante_non_locale', 'statut_incoherent', 'identifiant_suspect', 'arrivee'];
export const sortSignals = (s: AhSignal[]): AhSignal[] => [...s].sort((a, b) => SIGNAL_ORDER.indexOf(a.type) - SIGNAL_ORDER.indexOf(b.type));

/**
 * Suggested employment end date of the signals (D7: the ORCID date wins), only when the record has no
 * end date yet; the departure signals are computed for records without end date anyway.
 */
export function suggestedEndDate(signals: AhSignal[], currentEnd?: string): string | null {
  if (currentEnd) return null;
  for (const type of ['depart_confirme', 'depart_declare', 'depart_observe'] as const) {
    const s = signals.find((x) => x.type === type);
    if (s?.date) return s.date;
  }
  return null;
}
/** Suggested employment start date (arrival), only when the record has none. */
export const suggestedStartDate = (signals: AhSignal[], currentStart?: string): string | null =>
  (currentStart ? null : signals.find((s) => s.type === 'arrivee')?.date || null);

/** Publications of one establishment (index in entry.establishments), most recent first. */
export const publicationsOf = (entry: AhEntry, estIndex: number): AhPublication[] =>
  entry.pubs.filter((p) => p.e.includes(estIndex)).sort((a, b) => (b.y || 0) - (a.y || 0));
