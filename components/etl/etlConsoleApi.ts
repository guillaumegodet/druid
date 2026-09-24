// Client of the native ETL console: /api/etl/structures/* endpoints of
// server.cjs (admin role), relayed to the /api/structures routes of
// druid-etl-api (biblio_etl/structures_api.py on the druid-biblio side). Contract and
// lots: docs/archive/plan-console-etl-native.md. Keycloak session required — same
// origin, the cookie is sent automatically.

export interface SousStructure {
  id: string;
  acronym: string;
  name: string;
}

/** config.yaml fields managed by the form (biblio_etl/config.py DEFAULT_CONFIG). */
export interface StructureConfig {
  slug: string;
  name: string;
  acronym: string;
  openalex_id: string;
  year_from: number;
  year_to: number;
  etpr: number;
  mailto: string;
  team_label: string;
  bso_markers: string[];
  bso_url: string;
  hal_collection: string;
  hal_year_from: number;
  crisalid_structure_uid: string;
  teams: { num: string; acronym: string; name: string }[];
  sous_structures: SousStructure[];
  druid_tabs_hidden: string[];
  filter_to_effectifs: boolean;
  grist: { labo_acronyme: string };
  affiliation_controle: { mots_cles_positifs: string[]; mots_cles_negatifs: string[] };
  charte: { modele: string };
  charte_modele_defaut?: string;
}

/** Body accepted by POST config / POST create: multi-line text lists tolerated. */
export type StructureConfigPayload = Partial<
  Omit<StructureConfig, 'bso_markers' | 'affiliation_controle' | 'teams' | 'charte_modele_defaut'>
> & {
  bso_markers?: string | string[];
  affiliation_controle?: { mots_cles_positifs: string | string[]; mots_cles_negatifs: string | string[] };
};

export interface FileInfo {
  exists: boolean;
  updatedAt: string | null;
  rows?: number;
}

export interface StructureFiles {
  config: FileInfo;
  parquet: FileInfo;
  dashboard: FileInfo;
  effectifs: FileInfo;
  bso: FileInfo;
  journalsAccess: FileInfo;
  hlmExport: { exists: boolean };
}

export interface EtlStatus {
  state: string; // running | done | error | never-run
  startedAt?: string | null;
  endedAt?: string | null;
  log?: string[];
  warnings?: string[];
  error?: string | null;
  running?: boolean;
  runningJob?: string | null;
}

export interface StructureSummary {
  slug: string;
  name: string | null;
  acronym: string | null;
  openalex_id: string | null;
  year_from: number | null;
  year_to: number | null;
  grist_labo_acronyme: string | null;
  hasDashboard: boolean;
  dashboardUpdatedAt: string | null;
  hasParquet: boolean;
  parquetUpdatedAt: string | null;
  effectifsRows: number | null;
  state: string | null;
  running: boolean;
  endedAt: string | null;
  startedAt: string | null;
}

export interface StructureDetail {
  slug: string;
  config: StructureConfig;
  files: StructureFiles;
  status: EtlStatus;
  state: string | null;
  running: boolean;
  endedAt: string | null;
  startedAt: string | null;
}

export interface ConsoleMeta {
  druidTabs: { key: string; label: string }[];
  teamLabels: string[];
  correctionStatuses: string[];
}

export interface GristTeam {
  num: string;
  acronym: string;
  name: string;
}

/** Row of effectifs.csv (free columns: `Type`, `Nom de famille`, `Prénom`, `Équipes`, `Labo`, `Employeur`…). */
export type EffectifRow = Record<string, string>;

export interface EffectifsResponse {
  rows: EffectifRow[];
  count: number;
  columns?: string[];
  updatedAt: string | null;
}

/** Statistics of fetch_effectifs (biblio_etl/grist.py) — `LABO` rows of the Annuaire. */
export interface EffectifsSyncStats {
  labo?: string;
  total_labo?: number;
  valides_retenus?: number;
  non_valides_ignores?: number;
  departs_ignores?: number;
}

export interface EffectifsSyncResponse extends Partial<EffectifsResponse> {
  written: boolean;
  count: number;
  labo: string;
  stats: EffectifsSyncStats;
  warning?: string;
}

export interface DetectResponse {
  suspects: number;
  added: number;
  alreadyPresent: number;
  columnsCreated: number;
}

/** Record of the Grist table Corrections_affiliations_Openalex. */
export interface Correction {
  id: number;
  work_id: string;
  doi: string;
  titre: string;
  annee: number | string;
  auteur: string;
  affiliation_brute: string;
  url_openalex: string;
  raison_detection: string;
  statut: string;
  date_detection: string;
  date_soumission: string;
  date_resolution: string;
  notes: string;
}

export type CorrectionPatch = Partial<Pick<Correction, 'statut' | 'date_soumission' | 'date_resolution' | 'notes'>>;

async function asJson<T>(resp: Response): Promise<T> {
  if (resp.status === 401) {
    // Keycloak session expired or lost (e.g. Druid container recreated: in-memory
    // sessions): go through the login again, which brings back to the application.
    window.location.assign('/auth/login');
    return new Promise<T>(() => {}); // the navigation interrupts the flow
  }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error((data as { error?: string }).error || `Erreur HTTP ${resp.status}`);
  }
  return data as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

const base = '/api/etl/structures';
const enc = encodeURIComponent;

export const EtlConsoleApi = {
  list: async (): Promise<{ structures: StructureSummary[]; runningJob: string | null }> =>
    asJson(await fetch(base)),

  meta: async (): Promise<ConsoleMeta> => asJson(await fetch(`${base}/meta`)),

  get: async (slug: string): Promise<StructureDetail> => asJson(await fetch(`${base}/${enc(slug)}`)),

  create: async (payload: StructureConfigPayload & { slug?: string }): Promise<StructureDetail> =>
    asJson(await fetch(base, json('POST', payload))),

  saveConfig: async (slug: string, payload: StructureConfigPayload): Promise<StructureDetail> =>
    asJson(await fetch(`${base}/${enc(slug)}/config`, json('POST', payload))),

  launch: async (slug: string, redownloadBso: boolean): Promise<{ state: string }> =>
    asJson(await fetch(`${base}/${enc(slug)}/etl`, json('POST', { redownloadBso }))),

  status: async (slug: string): Promise<EtlStatus> => asJson(await fetch(`${base}/${enc(slug)}/status`)),

  teams: async (slug: string): Promise<{ labo: string; teams: GristTeam[]; fallbackTeams: GristTeam[] }> =>
    asJson(await fetch(`${base}/${enc(slug)}/teams`)),

  effectifs: async (slug: string): Promise<EffectifsResponse> =>
    asJson(await fetch(`${base}/${enc(slug)}/effectifs`)),

  /** Resyncs effectifs.csv from the Grist Annuaire (validated, excluding departures). */
  syncEffectifs: async (slug: string): Promise<EffectifsSyncResponse> =>
    asJson(await fetch(`${base}/${enc(slug)}/effectifs/sync`, json('POST', {}))),

  /** Detects the suspicious affiliations in the parquet and pushes them to the Grist table. */
  detectAffiliations: async (slug: string): Promise<DetectResponse> =>
    asJson(await fetch(`${base}/${enc(slug)}/affiliations/detect`, json('POST', {}))),

  corrections: async (slug: string): Promise<{ corrections: Correction[]; count: number; statuses: string[] }> =>
    asJson(await fetch(`${base}/${enc(slug)}/corrections`)),

  updateCorrection: async (slug: string, id: number, patch: CorrectionPatch): Promise<{ id: number }> =>
    asJson(await fetch(`${base}/${enc(slug)}/corrections/${id}`, json('POST', patch))),
};
