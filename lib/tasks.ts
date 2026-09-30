/**
 * « À traiter › Tâches » (docs/plan-chantiers-taches.md): tasks to carry out outside Druid
 * (IdRef, ORCID, HAL, OpenAlex, Scopus, HR events), stored in the Grist tables `Taches` /
 * `Taches_evenements` and served by the /api/tasks routes of server.cjs.
 *
 * TypeScript twin of scripts/lib/tasks_schema.cjs (identifiers, workflow): the server
 * validates, this module carries the labels (Lingui) and the client helpers. The test
 * lib/__tests__/tasks.test.ts keeps the two in sync.
 */
import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import { translateApiError } from './apiErrors';

export type TaskBase = 'IdRef' | 'ORCID' | 'HAL' | 'OpenAlex' | 'Scopus' | 'Annuaire' | 'RH' | 'Autre';
export type TaskCanal = 'natacha' | 'lot_abes' | 'email_chercheur' | 'support_externe' | 'interne';
export type TaskStatus = 'a_faire' | 'en_cours' | 'en_attente' | 'fait' | 'abandonnee' | 'resolue_auto';
export type TaskPriority = 'basse' | 'normale' | 'haute';
export type TaskEventAction =
  | 'creation' | 'prise_en_charge' | 'email_prepare' | 'en_attente' | 'fait' | 'abandon'
  | 'reouverture' | 'reassignation' | 'modification' | 'commentaire' | 'resolution_auto';

export interface TaskTypeMeta {
  base: TaskBase;
  /** Default channel, editable at creation. */
  canal: TaskCanal;
  /** A ready-to-copy researcher email exists for this type (lot 3). */
  email: boolean;
  label: MessageDescriptor;
}

/** Typology (same ids and defaults as tasks_schema.cjs TASK_TYPES). */
export const TASK_TYPES = {
  idref_ajouter_orcid: { base: 'IdRef', canal: 'lot_abes', email: false, label: msg`IdRef — add the ORCID to the record` },
  idref_ajouter_idhal: { base: 'IdRef', canal: 'lot_abes', email: false, label: msg`IdRef — add the IdHAL to the record` },
  idref_corriger_dates: { base: 'IdRef', canal: 'natacha', email: false, label: msg`IdRef — fix the dates` },
  idref_deces: { base: 'IdRef', canal: 'natacha', email: false, label: msg`IdRef — record a death` },
  idref_corriger_affiliation: { base: 'IdRef', canal: 'natacha', email: false, label: msg`IdRef — fix the affiliation / note` },
  idref_fusionner: { base: 'IdRef', canal: 'natacha', email: false, label: msg`IdRef — merge two records` },
  idref_creer: { base: 'IdRef', canal: 'natacha', email: false, label: msg`IdRef — create the record` },
  idref_corriger_nom: { base: 'IdRef', canal: 'natacha', email: false, label: msg`IdRef — fix the name form` },
  orcid_deux_ids: { base: 'ORCID', canal: 'email_chercheur', email: true, label: msg`ORCID — two identifiers` },
  orcid_absent: { base: 'ORCID', canal: 'email_chercheur', email: true, label: msg`ORCID — no identifier, invite to create one` },
  orcid_profil_vide: { base: 'ORCID', canal: 'email_chercheur', email: true, label: msg`ORCID — empty profile` },
  hal_deux_idhal: { base: 'HAL', canal: 'email_chercheur', email: true, label: msg`HAL — two IdHAL` },
  hal_idhal_absent: { base: 'HAL', canal: 'email_chercheur', email: true, label: msg`HAL — no IdHAL, invite to create one` },
  hal_affiliation_obsolete: { base: 'HAL', canal: 'email_chercheur', email: true, label: msg`HAL — outdated affiliation` },
  openalex_deux_auteurs: { base: 'OpenAlex', canal: 'support_externe', email: false, label: msg`OpenAlex — two authors` },
  openalex_affiliation: { base: 'OpenAlex', canal: 'interne', email: false, label: msg`OpenAlex — wrong affiliation` },
  scopus_deux_ids: { base: 'Scopus', canal: 'support_externe', email: true, label: msg`Scopus — two Author IDs` },
  rh_depart: { base: 'RH', canal: 'natacha', email: false, label: msg`HR — departure to propagate` },
  rh_retraite: { base: 'RH', canal: 'natacha', email: false, label: msg`HR — retirement to propagate` },
  rh_mutation: { base: 'RH', canal: 'natacha', email: false, label: msg`HR — transfer to propagate` },
  rh_deces: { base: 'RH', canal: 'natacha', email: false, label: msg`HR — death to propagate` },
  annuaire_fin_emploi: { base: 'Annuaire', canal: 'interne', email: false, label: msg`Directory — employment end to enter` },
  annuaire_doublon: { base: 'Annuaire', canal: 'interne', email: false, label: msg`Directory — two records for the same person: merge` },
  annuaire_doublon_a_verifier: { base: 'Annuaire', canal: 'interne', email: false, label: msg`Directory — shared identifiers: same person or namesakes?` },
  annuaire_identifiant_partage: { base: 'Annuaire', canal: 'interne', email: false, label: msg`Directory — identifier carried by two people: fix it` },
  autre: { base: 'Autre', canal: 'interne', email: false, label: msg`Other` },
} as const satisfies Record<string, TaskTypeMeta>;

export type TaskType = keyof typeof TASK_TYPES;
export const TASK_TYPE_IDS = Object.keys(TASK_TYPES) as TaskType[];
export const isTaskType = (v: string): v is TaskType => v in TASK_TYPES;

export const TASK_BASES: TaskBase[] = ['IdRef', 'ORCID', 'HAL', 'OpenAlex', 'Scopus', 'Annuaire', 'RH', 'Autre'];

export const CANAL_LABELS: Record<TaskCanal, MessageDescriptor> = {
  natacha: msg`Authorities correspondent (IdRef)`,
  lot_abes: msg`ABES batch (export)`,
  email_chercheur: msg`Email to the researcher`,
  support_externe: msg`External support (provider)`,
  interne: msg`Internal (Druid)`,
};

export const STATUS_LABELS: Record<TaskStatus, MessageDescriptor> = {
  a_faire: msg`To do`,
  en_cours: msg`In progress`,
  en_attente: msg`Waiting`,
  fait: msg`Done`,
  abandonnee: msg`Dropped`,
  resolue_auto: msg`Resolved (verified)`,
};

export const PRIORITY_LABELS: Record<TaskPriority, MessageDescriptor> = {
  basse: msg`Low`,
  normale: msg`Normal`,
  haute: msg`High`,
};

export const EVENT_ACTION_LABELS: Record<TaskEventAction, MessageDescriptor> = {
  creation: msg`Created`,
  prise_en_charge: msg`Taken over`,
  email_prepare: msg`Email prepared`,
  en_attente: msg`Put on hold`,
  fait: msg`Done`,
  abandon: msg`Dropped`,
  reouverture: msg`Reopened`,
  reassignation: msg`Reassigned`,
  modification: msg`Edited`,
  commentaire: msg`Comment`,
  resolution_auto: msg`Resolved automatically`,
};

export const TASK_STATUSES: TaskStatus[] = ['a_faire', 'en_cours', 'en_attente', 'fait', 'abandonnee', 'resolue_auto'];
export const OPEN_STATUSES: TaskStatus[] = ['a_faire', 'en_cours', 'en_attente'];
export const isOpenStatus = (s: TaskStatus): boolean => OPEN_STATUSES.includes(s);

/** Same table as tasks_schema.cjs TRANSITIONS. */
export const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  a_faire: ['en_cours', 'en_attente', 'fait', 'abandonnee'],
  en_cours: ['a_faire', 'en_attente', 'fait', 'abandonnee'],
  en_attente: ['a_faire', 'en_cours', 'fait', 'abandonnee'],
  fait: ['a_faire'],
  abandonnee: ['a_faire'],
  resolue_auto: ['a_faire'],
};
export const nextStatuses = (from: TaskStatus): TaskStatus[] => TRANSITIONS[from] ?? [];

/** Dedup key of a rule-generated task (lot 5). */
export const taskKey = (type: TaskType, uid: string): string => `${type}:${uid}`;

/** Task types of the `annuaire_ids_partages` rule whose records may be one person: the detail
 * offers the merge assistant. */
export const MERGEABLE_TASK_TYPES: ReadonlySet<string> = new Set(['annuaire_doublon', 'annuaire_doublon_a_verifier']);

/** uid_dyna of the records of a « shared identifiers » task, read from its key
 * (`<type>:<uid>+<uid>[+<uid>…]`, scripts/sync_tasks.cjs); [] for any other task. */
export const sharedIdTaskUids = (task: Pick<Task, 'type' | 'cle'>): string[] => {
  const prefix = `${task.type}:`;
  if (!MERGEABLE_TASK_TYPES.has(task.type) && task.type !== 'annuaire_identifiant_partage') return [];
  if (!task.cle.startsWith(prefix)) return [];
  const uids = task.cle.slice(prefix.length).split('+').filter(Boolean);
  return uids.length > 1 ? uids : [];
};

/** Pairs of Annuaire rows (Grist row ids) the merge assistant can open for a task, resolved
 * through the loaded directory; pairs with a record not found are left out. */
export const mergePairsOf = (task: Pick<Task, 'type' | 'cle'>, rowIdOfUid: (uid: string) => number | undefined): { uids: [string, string]; rowIds: [number, number] }[] => {
  if (!MERGEABLE_TASK_TYPES.has(task.type)) return [];
  const uids = sharedIdTaskUids(task);
  const pairs: { uids: [string, string]; rowIds: [number, number] }[] = [];
  for (let i = 0; i < uids.length; i++) {
    for (let j = i + 1; j < uids.length; j++) {
      const [a, b] = [rowIdOfUid(uids[i]), rowIdOfUid(uids[j])];
      if (a && b && a !== b) pairs.push({ uids: [uids[i], uids[j]], rowIds: [a, b] });
    }
  }
  return pairs;
};

export interface Task {
  id: number;
  cle: string;
  type: TaskType | string;
  base: TaskBase | string;
  canal: TaskCanal | string;
  titre: string;
  description: string;
  /** Grist row id of the Annuaire record (0 = not linked → « to complete » badge). */
  chercheur: number;
  uid_dyna: string;
  nom: string;
  labo: string;
  lien: string;
  statut: TaskStatus;
  assignee: string;
  priorite: TaskPriority | string;
  origine: string;
  cree_par: string;
  cree_le: string;
  pris_par: string;
  pris_le: string;
  attente_motif: string;
  fait_par: string;
  fait_le: string;
  resolution: string;
  verifie_le: string;
}

export interface TaskEvent {
  id: number;
  tache: number;
  date: string;
  auteur: string;
  action: TaskEventAction | string;
  detail: string;
}

export interface TaskCreateInput {
  type: TaskType;
  base?: TaskBase;
  canal?: TaskCanal;
  titre?: string;
  description?: string;
  chercheurRowId?: number;
  uid_dyna?: string;
  nom?: string;
  labo?: string;
  lien?: string;
  priorite?: TaskPriority;
  assignee?: string;
}

export type TaskPatchInput = Partial<Pick<Task, 'assignee' | 'priorite' | 'canal' | 'description' | 'titre' | 'lien'>>;

export const countOpenTasks = (tasks: Task[]): number => tasks.filter((x) => isOpenStatus(x.statut)).length;

/** Row of the Grist table Corrections_affiliations_Openalex (read-only « Affiliations OpenAlex »
 * tab, lot 6; edited in Administration › ETL console). */
export interface OpenAlexAffiliationCorrection {
  id: number;
  labo_slug: string;
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

/** One exported ABES row, as sent to /api/tasks/abes-sent (lib/abesExport.ts abesTaskTypes). */
export interface AbesSentItem { rowId: number; uid: string; types: string[] }

// ── API client ─────────────────────────────────────────────────────────────
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const resp = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(translateApiError(String((data as { error?: unknown }).error || '')) || `HTTP ${resp.status}`);
  return data as T;
}

export const TasksApi = {
  list: () => request<{ tasks: Task[] }>('/api/tasks').then((d) => d.tasks),
  events: (id: number) => request<{ events: TaskEvent[] }>(`/api/tasks/${id}/events`).then((d) => d.events),
  create: (input: TaskCreateInput) =>
    request<{ task: Task }>('/api/tasks', { method: 'POST', body: JSON.stringify(input) }).then((d) => d.task),
  patch: (id: number, patch: TaskPatchInput) =>
    request<{ task: Task }>(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }).then((d) => d.task),
  transition: (id: number, statut: TaskStatus, extra: { motif?: string; resolution?: string } = {}) =>
    request<{ task: Task }>(`/api/tasks/${id}/transition`, { method: 'POST', body: JSON.stringify({ statut, ...extra }) }).then((d) => d.task),
  openalexAffiliations: () =>
    request<{ corrections: OpenAlexAffiliationCorrection[] }>('/api/tasks/openalex-affiliations').then((d) => d.corrections),
  abesSent: (date: string, items: AbesSentItem[]) =>
    request<{ closed: number }>('/api/tasks/abes-sent', { method: 'POST', body: JSON.stringify({ date, items }) }).then((d) => d.closed),
  addEvent: (id: number, action: 'commentaire' | 'email_prepare', detail: string) =>
    request<{ event: TaskEvent }>(`/api/tasks/${id}/events`, { method: 'POST', body: JSON.stringify({ action, detail }) }).then((d) => d.event),
};
