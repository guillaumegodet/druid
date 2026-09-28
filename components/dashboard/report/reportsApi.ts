// Client of the « Mes rapports » storage (docs/plan-mes-rapports.md, lot 2): the /api/reports
// routes (server.cjs on Nantes, functions/api/reports on Cloudflare, one shared module
// scripts/lib/reports_store.cjs), or the browser's localStorage on a read-only instance (public
// demo, decision R8: no sharing, no server history).
// Definitions are validated with the full schema (definition.ts) before saving and after
// loading: a stored definition that no longer fits the schema comes back with
// `definition: null` and the reason in `definitionError`, it is never rendered.

import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { translateApiError } from '../../../lib/apiErrors';
import { canWrite } from '../../../lib/auth';
import { parseReportDefinition, type ReportDefinition } from './definition';

export type ReportRole = 'owner' | 'editor' | 'viewer' | 'admin';
export type ReportVisibility = 'private' | 'instance';
export type ShareRole = 'viewer' | 'editor';

export interface ReportSummary {
  id: number;
  name: string;
  description: string;
  templateId: string | null;
  owner: string;
  visibility: ReportVisibility;
  createdAt: string | null;
  updatedAt: string | null;
  role: ReportRole;
  lastGeneratedAt?: string | null;
  /** Number of grantees (own reports only). */
  shareCount?: number;
  /** Published by a super admin as a template of the instance. */
  publishedTemplate?: boolean;
}

export interface ReportShare {
  grantee: string;
  role: ShareRole;
  grantedBy?: string;
  grantedAt?: string;
}

export interface StoredReport extends ReportSummary {
  definition: ReportDefinition | null;
  /** Why the stored definition was refused by the schema (null when valid). */
  definitionError: string | null;
  /** Grantees, for the owner and super admins. */
  shares?: ReportShare[];
}

export interface ReportLists {
  mine: ReportSummary[];
  shared: ReportSummary[];
  instance: ReportSummary[];
  /** Instance templates (offered in « New report »). */
  templates: ReportSummary[];
}

export interface ReportGeneration {
  id: number;
  generatedAt: string;
  generatedBy: string;
  definitionSnapshot: unknown;
  publicationCount: number | null;
  dataDate: string | null;
  aiTexts: unknown;
  pdfRef: string | null;
  sharedFrozen: boolean;
}

export interface GenerationInput {
  definitionSnapshot: unknown;
  publicationCount?: number;
  dataDate?: string;
  aiTexts?: unknown;
}

export interface ReportUpdate {
  definition?: ReportDefinition;
  visibility?: ReportVisibility;
  /** Super admins: publish (or withdraw) the report as an instance template. */
  publishedTemplate?: boolean;
  /** updatedAt of the version being edited: the save is refused if the report moved on. */
  expectedUpdatedAt?: string | null;
}

export interface ReportsBackend {
  /** `browser` on a read-only instance: own reports only, no sharing nor history. */
  kind: 'server' | 'browser';
  list(): Promise<ReportLists>;
  get(id: number): Promise<StoredReport>;
  create(definition: ReportDefinition, visibility?: ReportVisibility): Promise<StoredReport>;
  update(id: number, update: ReportUpdate): Promise<StoredReport>;
  remove(id: number): Promise<void>;
  duplicate(id: number, name?: string): Promise<StoredReport>;
  listShares(id: number): Promise<ReportShare[]>;
  setShares(id: number, shares: { grantee: string; role: ShareRole }[]): Promise<ReportShare[]>;
  listGenerations(id: number): Promise<ReportGeneration[]>;
  addGeneration(id: number, input: GenerationInput): Promise<ReportGeneration>;
}

/** Same head as the server refusal, so that both read the same once translated. */
const invalidDefinition = (detail: string) => new Error(translateApiError(`Invalid report definition: ${detail}`));

/** Throws when the definition does not fit the schema; returns it otherwise. */
function checked(definition: ReportDefinition): ReportDefinition {
  const r = parseReportDefinition(definition);
  if (r.ok === false) throw invalidDefinition(r.error);
  return definition;
}

/** Stored report as received: validates the definition without throwing. */
function withValidatedDefinition(raw: Omit<StoredReport, 'definition' | 'definitionError'> & { definition: unknown }): StoredReport {
  const r = parseReportDefinition(raw.definition);
  return r.ok === true
    ? { ...raw, definition: r.value, definitionError: null }
    : { ...raw, definition: null, definitionError: r.error };
}

// ── Server backend ───────────────────────────────────────────────────────────

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err: Error & { status?: number } = new Error(
      translateApiError(String((data as { error?: unknown }).error || '')) || `HTTP ${resp.status}`,
    );
    err.status = resp.status;
    throw err;
  }
  return data as T;
}

/** HTTP status of an API refusal (409 = the report changed since it was loaded). */
export const errorStatus = (e: unknown): number | undefined => (e as { status?: number } | null)?.status;
const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body ?? {}) });
type RawReport = { report: Omit<StoredReport, 'definitionError'> & { definition: unknown } };

export const serverReportsBackend: ReportsBackend = {
  kind: 'server',
  list: () => request<ReportLists>('/api/reports').then((l) => ({ ...l, templates: l.templates ?? [] })),
  get: (id) => request<RawReport>(`/api/reports/${id}`).then((d) => withValidatedDefinition(d.report)),
  // async: a schema refusal comes back as a rejected promise, like a server refusal.
  create: async (definition, visibility = 'private') =>
    withValidatedDefinition((await request<RawReport>('/api/reports', post({ definition: checked(definition), visibility }))).report),
  update: async (id, update) => {
    if (update.definition) checked(update.definition);
    const d = await request<RawReport>(`/api/reports/${id}`, { method: 'PATCH', body: JSON.stringify(update) });
    return withValidatedDefinition(d.report);
  },
  remove: (id) => request<{ ok: boolean }>(`/api/reports/${id}/delete`, post({})).then(() => undefined),
  duplicate: (id, name) =>
    request<RawReport>(`/api/reports/${id}/duplicate`, post(name ? { name } : {}))
      .then((d) => withValidatedDefinition(d.report)),
  listShares: (id) => request<{ shares: ReportShare[] }>(`/api/reports/${id}/shares`).then((d) => d.shares),
  setShares: (id, shares) =>
    request<{ shares: ReportShare[] }>(`/api/reports/${id}/shares`, post({ shares })).then((d) => d.shares),
  listGenerations: (id) =>
    request<{ generations: ReportGeneration[] }>(`/api/reports/${id}/generations`).then((d) => d.generations),
  addGeneration: (id, input) =>
    request<{ generation: ReportGeneration }>(`/api/reports/${id}/generations`, post(input)).then((d) => d.generation),
};

// ── Browser backend (read-only instance) ─────────────────────────────────────

export const LOCAL_REPORTS_KEY = 'druid.reports.v1';

interface LocalReport {
  id: number;
  definition: unknown;
  createdAt: string;
  updatedAt: string;
}
interface LocalState {
  nextId: number;
  reports: LocalReport[];
}

const storageError = () => new Error(i18n._(msg`Browser storage unavailable: reports cannot be saved here.`));
const notInBrowser = () => new Error(i18n._(msg`Sharing and history are not available on this read-only instance.`));
const notFound = () => new Error(translateApiError('Report not found'));

/** Reports kept in `storage` (localStorage in the app; injectable for tests). */
export function browserReportsBackend(storage: () => Storage | null, now: () => Date = () => new Date()): ReportsBackend {
  const read = (): LocalState => {
    try {
      const raw = storage()?.getItem(LOCAL_REPORTS_KEY);
      const state = raw ? (JSON.parse(raw) as LocalState) : null;
      return state && Array.isArray(state.reports) ? state : { nextId: 1, reports: [] };
    } catch {
      return { nextId: 1, reports: [] };
    }
  };
  const write = (state: LocalState) => {
    try {
      const s = storage();
      if (!s) throw storageError();
      s.setItem(LOCAL_REPORTS_KEY, JSON.stringify(state));
    } catch {
      throw storageError();
    }
  };
  const toStored = (r: LocalReport): StoredReport => {
    const def = r.definition as Partial<ReportDefinition> | null;
    return withValidatedDefinition({
      id: r.id,
      name: String(def?.name ?? ''),
      description: String(def?.description ?? ''),
      templateId: def?.templateId ?? null,
      owner: '',
      visibility: 'private',
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      role: 'owner',
      definition: r.definition,
    });
  };
  const find = (state: LocalState, id: number) => {
    const r = state.reports.find((x) => x.id === id);
    if (!r) throw notFound();
    return r;
  };
  const backend: ReportsBackend = {
    kind: 'browser',
    list: async () => ({
      mine: read().reports
        .map((r) => {
          const { definition: _d, definitionError: _e, ...summary } = toStored(r);
          return summary;
        })
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))),
      shared: [],
      instance: [],
      templates: [],
    }),
    get: async (id) => toStored(find(read(), id)),
    create: async (definition) => {
      checked(definition);
      const state = read();
      const at = now().toISOString();
      const r: LocalReport = { id: state.nextId, definition, createdAt: at, updatedAt: at };
      write({ nextId: state.nextId + 1, reports: [...state.reports, r] });
      return toStored(r);
    },
    update: async (id, update) => {
      const state = read();
      const r = find(state, id);
      if (update.expectedUpdatedAt && update.expectedUpdatedAt !== r.updatedAt) {
        const err: Error & { status?: number } = new Error(translateApiError('Report changed since it was loaded'));
        err.status = 409;
        throw err;
      }
      const next: LocalReport = {
        ...r,
        definition: update.definition ? checked(update.definition) : r.definition,
        updatedAt: now().toISOString(),
      };
      write({ ...state, reports: state.reports.map((x) => (x.id === id ? next : x)) });
      return toStored(next);
    },
    remove: async (id) => {
      const state = read();
      find(state, id);
      write({ ...state, reports: state.reports.filter((x) => x.id !== id) });
    },
    duplicate: async (id, name) => {
      const src = toStored(find(read(), id));
      if (!src.definition) throw invalidDefinition(src.definitionError ?? '');
      return backend.create({ ...src.definition, name: name?.trim() || src.definition.name });
    },
    listShares: async () => [],
    setShares: async () => { throw notInBrowser(); },
    listGenerations: async () => [],
    addGeneration: async () => { throw notInBrowser(); },
  };
  return backend;
}

const localStorageOrNull = (): Storage | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

let browserBackend: ReportsBackend | null = null;

/** Backend of the current instance: the API, or the browser on a read-only instance. */
export function reportsBackend(): ReportsBackend {
  if (canWrite()) return serverReportsBackend;
  browserBackend ??= browserReportsBackend(localStorageOrNull);
  return browserBackend;
}
