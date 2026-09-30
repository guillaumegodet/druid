import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { abesTaskTypes, type AbesRow } from '../abesExport';
import { TASK_TYPES, TASK_TYPE_IDS, TRANSITIONS, TASK_STATUSES, TASK_BASES, CANAL_LABELS, EVENT_ACTION_LABELS, nextStatuses, taskKey, countOpenTasks, sharedIdTaskUids, mergePairsOf, type Task } from '../tasks';

// The server validates with the CommonJS schema; the UI labels with the TS twin.
const schema = createRequire(import.meta.url)('../../scripts/lib/tasks_schema.cjs');

describe('lib/tasks ↔ scripts/lib/tasks_schema.cjs (docs/plan-chantiers-taches.md, lot 1)', () => {
  it('same task types, with the same base / default channel', () => {
    expect(TASK_TYPE_IDS.sort()).toEqual(Object.keys(schema.TASK_TYPES).sort());
    for (const id of TASK_TYPE_IDS) {
      expect(TASK_TYPES[id].base).toBe(schema.TASK_TYPES[id].base);
      expect(TASK_TYPES[id].canal).toBe(schema.TASK_TYPES[id].canal);
      expect(TASK_TYPES[id].email).toBe(schema.TASK_TYPES[id].email);
      expect(schema.TITLES_FR[id]).toBeTruthy();
    }
  });
  it('same statuses, transitions, bases, channels and event actions', () => {
    expect(TASK_STATUSES).toEqual(schema.STATUSES);
    expect(TRANSITIONS).toEqual(schema.TRANSITIONS);
    expect(TASK_BASES).toEqual(schema.BASES);
    expect(Object.keys(CANAL_LABELS)).toEqual(schema.CANALS);
    expect(Object.keys(EVENT_ACTION_LABELS)).toEqual(schema.EVENT_ACTIONS);
  });
  it('every Choice column of the Grist schema lists exactly the known values', () => {
    const col = (id: string) => JSON.parse(schema.TASKS_COLUMNS.find((c: { id: string }) => c.id === id).fields.widgetOptions).choices;
    expect(col('type')).toEqual(Object.keys(schema.TASK_TYPES));
    expect(col('statut')).toEqual(schema.STATUSES);
    expect(col('canal')).toEqual(schema.CANALS);
  });
});

describe('workflow helpers', () => {
  it('nextStatuses: closed states only reopen; resolue_auto never reachable by hand', () => {
    expect(nextStatuses('fait')).toEqual(['a_faire']);
    expect(nextStatuses('a_faire')).not.toContain('resolue_auto');
    expect(nextStatuses('en_attente')).toContain('fait');
  });
  it('sharedIdTaskUids / mergePairsOf: uids read from the rule key, merge pairs only for possible duplicates', () => {
    const t = (type: string, cle: string) => ({ type, cle });
    expect(sharedIdTaskUids(t('annuaire_doublon', 'annuaire_doublon:E000001A+martin-p-1'))).toEqual(['E000001A', 'martin-p-1']);
    expect(sharedIdTaskUids(t('annuaire_doublon', 'sovisu_conflit:a:b'))).toEqual([]);
    expect(sharedIdTaskUids(t('orcid_deux_ids', 'orcid_deux_ids:a'))).toEqual([]);
    const rows: Record<string, number> = { a: 1, b: 2, c: 3 };
    expect(mergePairsOf(t('annuaire_doublon', 'annuaire_doublon:a+b'), (u) => rows[u])).toEqual([{ uids: ['a', 'b'], rowIds: [1, 2] }]);
    expect(mergePairsOf(t('annuaire_doublon_a_verifier', 'annuaire_doublon_a_verifier:a+b+c+z'), (u) => rows[u]).map((x) => x.uids.join('+'))).toEqual(['a+b', 'a+c', 'b+c']);
    expect(mergePairsOf(t('annuaire_identifiant_partage', 'annuaire_identifiant_partage:a+b'), (u) => rows[u])).toEqual([]);
  });
  it('taskKey and countOpenTasks', () => {
    expect(taskKey('orcid_deux_ids', '12345')).toBe('orcid_deux_ids:12345');
    const mk = (statut: Task['statut']) => ({ statut } as Task);
    expect(countOpenTasks([mk('a_faire'), mk('en_attente'), mk('fait'), mk('resolue_auto'), mk('en_cours')])).toBe(3);
  });
});

describe('tasks_schema.cjs — choices of an existing table', () => {
  it('missingChoicePatches appends the unknown values, keeps order, options and hand-typed values', () => {
    const current = [
      { id: 'type', fields: { widgetOptions: JSON.stringify({ choices: ['autre', 'rh_depart', 'fait_main'], choiceOptions: { autre: { fillColor: '#eee' } } }) } },
      { id: 'statut', fields: { widgetOptions: JSON.stringify({ choices: schema.STATUSES }) } },
      { id: 'titre', fields: { widgetOptions: '' } },
    ];
    const patches = schema.missingChoicePatches(schema.TASKS_COLUMNS, current);
    expect(patches.map((x: { id: string }) => x.id)).toEqual(['type']);
    const opts = JSON.parse(patches[0].fields.widgetOptions);
    expect(opts.choices.slice(0, 3)).toEqual(['autre', 'rh_depart', 'fait_main']);
    expect(opts.choices).toContain('annuaire_doublon');
    expect(new Set(opts.choices).size).toBe(opts.choices.length);
    expect(opts.choiceOptions.autre.fillColor).toBe('#eee');
    // Columns missing from Grist (base, canal…) are not patched: created with the table only.
    expect(schema.missingChoicePatches(schema.TASKS_COLUMNS, [])).toEqual([]);
  });
});

describe('tasks_schema.cjs — server-side validation', () => {
  const now = '2026-09-23T10:00:00.000Z';
  it('normalizeCreate fills defaults from the type and builds a French title', () => {
    const f = schema.normalizeCreate({ type: 'idref_ajouter_orcid', nom: 'DUPONT Jean', uid_dyna: '42', chercheurRowId: 7 }, { author: 'durand-j', nowIso: now });
    expect(f).toMatchObject({ base: 'IdRef', canal: 'lot_abes', statut: 'a_faire', priorite: 'normale', chercheur: 7, cree_par: 'durand-j', cree_le: now, origine: 'manuel', cle: '' });
    expect(f.titre).toBe('Ajouter l’ORCID dans la notice IdRef — DUPONT Jean');
  });
  it('normalizeCreate: rule origin sets the dedup key, bad values fall back, unknown type refused', () => {
    const f = schema.normalizeCreate({ type: 'orcid_deux_ids', uid_dyna: '42', canal: 'nope', priorite: 'urgent' }, { author: 'x', nowIso: now, origine: 'regle:deux_orcid' });
    expect(f.cle).toBe('orcid_deux_ids:42');
    expect(f.canal).toBe('email_chercheur');
    expect(f.priorite).toBe('normale');
    expect(() => schema.normalizeCreate({ type: 'bogus' }, { author: 'x' })).toThrow(schema.TaskInputError);
    expect(() => schema.normalizeCreate({ chercheurRowId: 3 }, { author: 'x' })).toThrow(/Unknown task type/);
  });
  it('applyTransition: stamps who/when, refuses forbidden moves, reopening clears the closure', () => {
    const base = { statut: 'a_faire', pris_par: '' };
    const took = schema.applyTransition(base, 'en_cours', { author: 'nat', nowIso: now });
    expect(took.patch).toEqual({ statut: 'en_cours', pris_par: 'nat', pris_le: now });
    expect(took.event.action).toBe('prise_en_charge');
    const wait = schema.applyTransition({ ...base, ...took.patch }, 'en_attente', { author: 'nat', nowIso: now, motif: 'mail sent' });
    expect(wait.patch).toEqual({ statut: 'en_attente', attente_motif: 'mail sent' });
    const done = schema.applyTransition({ ...base, ...wait.patch }, 'fait', { author: 'nat', nowIso: now, resolution: 'merged' });
    expect(done.patch).toMatchObject({ statut: 'fait', fait_par: 'nat', fait_le: now, resolution: 'merged' });
    expect(() => schema.applyTransition({ statut: 'fait' }, 'en_cours', { author: 'nat' })).toThrow(/Transition not allowed/);
    const reopen = schema.applyTransition({ statut: 'fait', fait_par: 'nat' }, 'a_faire', { author: 'nat', nowIso: now });
    expect(reopen.patch).toEqual({ statut: 'a_faire', fait_par: '', fait_le: '', resolution: '', attente_motif: '' });
    expect(reopen.event.action).toBe('reouverture');
  });
  it('statusOf: an empty status typed in Grist reads as a_faire; normalizePatch refuses empty patches', () => {
    expect(schema.statusOf({ statut: '' })).toBe('a_faire');
    expect(schema.statusOf({ statut: 'en_attente' })).toBe('en_attente');
    expect(schema.normalizePatch({ assignee: ' nat ' })).toEqual({ assignee: 'nat' });
    expect(() => schema.normalizePatch({ statut: 'fait' })).toThrow(/Nothing to update/);
  });
});

describe('lot 6 — ABES export closes the covered « lot ABES » tasks', () => {
  const task = (id: number, fields: Record<string, unknown>) => ({ id, fields: { statut: 'a_faire', canal: 'lot_abes', ...fields } });
  it('closes open lot_abes tasks of a covered type, matched by row id then uid; leaves the rest', () => {
    const tasks = [
      task(1, { type: 'idref_ajouter_orcid', chercheur: 10 }),
      task(2, { type: 'idref_ajouter_idhal', chercheur: 10 }),                 // type not covered
      task(3, { type: 'idref_ajouter_orcid', uid_dyna: 'abc', chercheur: 0 }), // matched on uid
      task(4, { type: 'idref_ajouter_orcid', chercheur: 10, canal: 'natacha' }), // other channel
      task(5, { type: 'idref_ajouter_orcid', chercheur: 10, statut: 'fait' }),   // already closed
      task(6, { type: 'idref_ajouter_orcid', chercheur: 99 }),                 // not exported
    ];
    const items = [{ rowId: 10, uid: 'x', types: ['idref_ajouter_orcid'] }, { rowId: 0, uid: 'abc', types: ['idref_ajouter_orcid'] }];
    const { patches, events } = schema.abesSentPatches(tasks, items, { author: 'durand-j', date: '2026-09-23', nowIso: 'T' });
    expect(patches.map((p: { id: number }) => p.id)).toEqual([1, 3]);
    expect(patches[0].fields).toMatchObject({ statut: 'fait', fait_par: 'durand-j', resolution: 'Envoyé à l’ABES (lot du 2026-09-23)' });
    expect(events.map((e: { tache: number; action: string }) => [e.tache, e.action])).toEqual([[1, 'fait'], [3, 'fait']]);
  });
});

describe('abesTaskTypes', () => {
  it('maps the actions of an exported row to the task types it covers', () => {
    const row = { orcid_action: 'AJOUT', idhal_action: 'OK', etab_action: '', etab2_action: '', labo_action: 'MAJ_DATES', labo2_action: '', note_340_action: '' } as unknown as AbesRow;
    expect(abesTaskTypes(row)).toEqual(['idref_ajouter_orcid', 'idref_corriger_affiliation', 'idref_corriger_dates']);
    for (const ty of abesTaskTypes(row)) expect(TASK_TYPE_IDS).toContain(ty);
  });
});
