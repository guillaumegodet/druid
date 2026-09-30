/**
 * tasks_schema.cjs — Grist schema of the « À traiter › Tâches » feature
 * (docs/plan-chantiers-taches.md, lot 1): tables `Taches` (one row per task to
 * carry out outside Druid — IdRef, ORCID, HAL, OpenAlex, Scopus, HR events) and
 * `Taches_evenements` (append-only log, the thread of a task).
 *
 * Shared by server.cjs (/api/tasks routes, auto-provisioning on first use)
 * and scripts/add_tasks_tables.cjs (explicit provisioning). The TypeScript twin lib/tasks.ts
 * carries the same identifiers (checked by lib/__tests__/tasks.test.ts).
 * Plain CommonJS, no dependency: server.cjs cannot import TypeScript.
 */
'use strict';

const TASKS_TABLE = 'Taches';
const EVENTS_TABLE = 'Taches_evenements';

/** Provider / area the task concerns. */
const BASES = ['IdRef', 'ORCID', 'HAL', 'OpenAlex', 'Scopus', 'Annuaire', 'RH', 'Autre'];

/** Who / what processes the task (decision of 2026-09-23: no per-role queue yet). */
const CANALS = ['natacha', 'lot_abes', 'email_chercheur', 'support_externe', 'interne'];

/** Workflow. `resolue_auto` is reserved for the detection rules (lot 5). */
const STATUSES = ['a_faire', 'en_cours', 'en_attente', 'fait', 'abandonnee', 'resolue_auto'];

/** Allowed transitions (from → to). Reopening is allowed from every closed state. */
const TRANSITIONS = {
  a_faire: ['en_cours', 'en_attente', 'fait', 'abandonnee'],
  en_cours: ['a_faire', 'en_attente', 'fait', 'abandonnee'],
  en_attente: ['a_faire', 'en_cours', 'fait', 'abandonnee'],
  fait: ['a_faire'],
  abandonnee: ['a_faire'],
  resolue_auto: ['a_faire'],
};

const PRIORITIES = ['basse', 'normale', 'haute'];

/** Task typology: id → base, default channel, whether a researcher email template exists
 * (lot 3). Labels live in lib/tasks.ts (Lingui). Validated with the documentation team at lot 0. */
const TASK_TYPES = {
  idref_ajouter_orcid: { base: 'IdRef', canal: 'lot_abes', email: false },
  idref_ajouter_idhal: { base: 'IdRef', canal: 'lot_abes', email: false },
  idref_corriger_dates: { base: 'IdRef', canal: 'natacha', email: false },
  idref_deces: { base: 'IdRef', canal: 'natacha', email: false },
  idref_corriger_affiliation: { base: 'IdRef', canal: 'natacha', email: false },
  idref_fusionner: { base: 'IdRef', canal: 'natacha', email: false },
  idref_creer: { base: 'IdRef', canal: 'natacha', email: false },
  idref_corriger_nom: { base: 'IdRef', canal: 'natacha', email: false },
  orcid_deux_ids: { base: 'ORCID', canal: 'email_chercheur', email: true },
  orcid_absent: { base: 'ORCID', canal: 'email_chercheur', email: true },
  orcid_profil_vide: { base: 'ORCID', canal: 'email_chercheur', email: true },
  hal_deux_idhal: { base: 'HAL', canal: 'email_chercheur', email: true },
  hal_idhal_absent: { base: 'HAL', canal: 'email_chercheur', email: true },
  hal_affiliation_obsolete: { base: 'HAL', canal: 'email_chercheur', email: true },
  // Researcher self-service since OpenAlex lets authors claim and fix their profile (checked 2026-09-30).
  openalex_deux_auteurs: { base: 'OpenAlex', canal: 'email_chercheur', email: true },
  openalex_affiliation: { base: 'OpenAlex', canal: 'interne', email: false },
  scopus_deux_ids: { base: 'Scopus', canal: 'support_externe', email: true },
  // « Suggestions de l'établissement » of the record (docs/plan-parcours-affiliations.md, lot 5).
  orcid_ajouter_poste: { base: 'ORCID', canal: 'email_chercheur', email: true },
  orcid_relier_scopus: { base: 'ORCID', canal: 'email_chercheur', email: true },
  scopus_profil_errone: { base: 'Scopus', canal: 'email_chercheur', email: true },
  rh_depart: { base: 'RH', canal: 'natacha', email: false },
  rh_retraite: { base: 'RH', canal: 'natacha', email: false },
  rh_mutation: { base: 'RH', canal: 'natacha', email: false },
  rh_deces: { base: 'RH', canal: 'natacha', email: false },
  annuaire_fin_emploi: { base: 'Annuaire', canal: 'interne', email: false },
  annuaire_doublon: { base: 'Annuaire', canal: 'interne', email: false },
  annuaire_doublon_a_verifier: { base: 'Annuaire', canal: 'interne', email: false },
  annuaire_identifiant_partage: { base: 'Annuaire', canal: 'interne', email: false },
  // Career path (docs/plan-parcours-affiliations.md, lot 4): signals of scripts/sync_affiliation_history.cjs.
  parcours_depart_confirme: { base: 'Annuaire', canal: 'interne', email: false },
  parcours_depart_declare: { base: 'Annuaire', canal: 'interne', email: false },
  parcours_depart_observe: { base: 'Annuaire', canal: 'interne', email: false },
  parcours_statut_incoherent: { base: 'Annuaire', canal: 'interne', email: false },
  parcours_identifiant_suspect: { base: 'Annuaire', canal: 'interne', email: false },
  autre: { base: 'Autre', canal: 'interne', email: false },
};

/** Event kinds of the log. */
const EVENT_ACTIONS = [
  'creation', 'prise_en_charge', 'email_prepare', 'en_attente', 'fait', 'abandon',
  'reouverture', 'reassignation', 'modification', 'commentaire', 'resolution_auto',
];

/** French default titles (stored in Grist, read by the documentation team there): `{nom}` is replaced. The
 * Druid UI shows the Lingui label of the type instead (lib/tasks.ts). */
const TITLES_FR = {
  idref_ajouter_orcid: 'Ajouter l’ORCID dans la notice IdRef',
  idref_ajouter_idhal: 'Ajouter l’IdHAL dans la notice IdRef',
  idref_corriger_dates: 'Corriger les dates de la notice IdRef',
  idref_deces: 'Indiquer le décès dans la notice IdRef',
  idref_corriger_affiliation: 'Corriger l’affiliation / la note de la notice IdRef',
  idref_fusionner: 'Fusionner deux notices IdRef',
  idref_creer: 'Créer la notice IdRef',
  idref_corriger_nom: 'Corriger la forme du nom dans IdRef',
  orcid_deux_ids: 'Deux ORCID : demander la fusion au chercheur',
  orcid_absent: 'Pas d’ORCID : inviter le chercheur à en créer un',
  orcid_profil_vide: 'Profil ORCID vide : inviter le chercheur à le compléter',
  hal_deux_idhal: 'Deux IdHAL : demander la fusion (support HAL)',
  hal_idhal_absent: 'Pas d’IdHAL : inviter le chercheur à en créer un',
  hal_affiliation_obsolete: 'Affiliation HAL obsolète',
  openalex_deux_auteurs: 'Plusieurs profils OpenAlex : revendiquer et fusionner',
  openalex_affiliation: 'Affiliation OpenAlex erronée',
  scopus_deux_ids: 'Deux Scopus Author ID : demander la fusion',
  orcid_ajouter_poste: 'Profil ORCID : ajouter le poste dans l’établissement',
  orcid_relier_scopus: 'Relier le profil Scopus au profil ORCID',
  scopus_profil_errone: 'Profil Scopus erroné : demander la correction',
  rh_depart: 'Départ à répercuter (IdRef, HAL, Annuaire)',
  rh_retraite: 'Retraite à répercuter (IdRef, HAL, Annuaire)',
  rh_mutation: 'Mutation à répercuter (IdRef, HAL, Annuaire)',
  rh_deces: 'Décès à répercuter (IdRef, HAL, Annuaire)',
  annuaire_fin_emploi: 'Fin d’emploi à saisir dans l’Annuaire',
  annuaire_doublon: 'Deux fiches pour la même personne : fusionner',
  annuaire_doublon_a_verifier: 'Identifiants communs : même personne ou homonymes ?',
  annuaire_identifiant_partage: 'Identifiant porté par deux personnes : le corriger',
  parcours_depart_confirme: 'Départ confirmé par plusieurs sources : saisir la fin d’emploi',
  parcours_depart_declare: 'Départ déclaré dans ORCID : saisir la fin d’emploi',
  parcours_depart_observe: 'Départ probable d’après les publications : vérifier',
  parcours_statut_incoherent: 'Fiche close mais activité locale récente : vérifier la date de fin',
  parcours_identifiant_suspect: 'Identifiants jamais affiliés à l’établissement : homonyme ?',
  autre: 'Autre',
};

const str = (v, max = 4000) => (v == null ? '' : String(v)).trim().slice(0, max);
const oneOf = (list, v, def) => (list.includes(v) ? v : def);

class TaskInputError extends Error {}

/**
 * Validates and normalizes a creation payload (from /api/tasks or an import script)
 * into the Grist fields of a `Taches` row. Throws TaskInputError on bad input.
 * `author` always comes from the server session, never from the payload.
 */
function normalizeCreate(body, { author, nowIso = new Date().toISOString(), origine = 'manuel' }) {
  const b = body && typeof body === 'object' ? body : {};
  const type = str(b.type, 64);
  if (!TASK_TYPES[type]) throw new TaskInputError(`Unknown task type: ${type || '(empty)'}`);
  const meta = TASK_TYPES[type];
  const chercheurRowId = Number.isInteger(b.chercheurRowId) && b.chercheurRowId > 0 ? b.chercheurRowId : 0;
  const nom = str(b.nom, 200);
  const titre = str(b.titre, 300) || `${TITLES_FR[type]}${nom ? ` — ${nom}` : ''}`;
  const uid = str(b.uid_dyna, 64);
  const canal = oneOf(CANALS, str(b.canal, 32), meta.canal);
  return {
    cle: origine.startsWith('regle:') && uid ? `${type}:${uid}` : '',
    type,
    base: oneOf(BASES, str(b.base, 32), meta.base),
    canal,
    titre,
    description: str(b.description),
    chercheur: chercheurRowId,
    uid_dyna: uid,
    nom,
    labo: str(b.labo, 100),
    lien: str(b.lien, 1000),
    statut: 'a_faire',
    assignee: str(b.assignee, 100),
    priorite: oneOf(PRIORITIES, str(b.priorite, 16), 'normale'),
    origine,
    cree_par: author,
    cree_le: nowIso,
    pris_par: '', pris_le: '', attente_motif: '', fait_par: '', fait_le: '', resolution: '', verifie_le: '',
  };
}

/** Editable fields of a PATCH /api/tasks/:id (never the workflow columns). */
function normalizePatch(body) {
  const b = body && typeof body === 'object' ? body : {};
  const patch = {};
  if ('assignee' in b) patch.assignee = str(b.assignee, 100);
  if ('priorite' in b) patch.priorite = oneOf(PRIORITIES, str(b.priorite, 16), 'normale');
  if ('canal' in b) patch.canal = oneOf(CANALS, str(b.canal, 32), 'interne');
  if ('description' in b) patch.description = str(b.description);
  if ('titre' in b && str(b.titre, 300)) patch.titre = str(b.titre, 300);
  if ('lien' in b) patch.lien = str(b.lien, 1000);
  if (Object.keys(patch).length === 0) throw new TaskInputError('Nothing to update');
  return patch;
}

/** Empty status (row typed directly in Grist) reads as `a_faire`. */
const statusOf = (fields) => oneOf(STATUSES, str(fields && fields.statut, 32), 'a_faire');

/**
 * Computes the Grist patch and the log event of a status change. Throws
 * TaskInputError when the transition is not allowed.
 */
function applyTransition(fields, to, { author, nowIso = new Date().toISOString(), motif = '', resolution = '' }) {
  const from = statusOf(fields);
  if (!STATUSES.includes(to)) throw new TaskInputError(`Unknown status: ${to}`);
  if (!(TRANSITIONS[from] || []).includes(to)) throw new TaskInputError(`Transition not allowed: ${from} → ${to}`);
  const patch = { statut: to };
  let action = 'modification';
  let detail = '';
  if (to === 'en_cours') {
    Object.assign(patch, { pris_par: author, pris_le: nowIso });
    action = 'prise_en_charge';
  } else if (to === 'en_attente') {
    patch.attente_motif = str(motif, 500);
    if (!fields.pris_par) Object.assign(patch, { pris_par: author, pris_le: nowIso });
    action = 'en_attente';
    detail = patch.attente_motif;
  } else if (to === 'fait' || to === 'abandonnee') {
    Object.assign(patch, { fait_par: author, fait_le: nowIso, resolution: str(resolution, 1000) });
    action = to === 'fait' ? 'fait' : 'abandon';
    detail = patch.resolution;
  } else if (to === 'a_faire') {
    Object.assign(patch, { fait_par: '', fait_le: '', resolution: '', attente_motif: '' });
    action = 'reouverture';
    detail = str(resolution || motif, 500);
  }
  return { patch, event: { date: nowIso, auteur: author, action, detail } };
}

/**
 * ABES export (docs/plan-chantiers-taches.md, lot 6): open `lot_abes` tasks covered by the rows
 * just marked as sent are closed as done. `items` = [{ rowId, uid, types }] where `types` lists
 * the task types an exported row covers (lib/abesExport.ts abesTaskTypes). A task matches on the
 * Annuaire row id first, then on uid_dyna. Returns the Taches patches and the log events.
 */
function abesSentPatches(tasks, items, { author, date, nowIso = new Date().toISOString() }) {
  const byRow = new Map();
  const byUid = new Map();
  for (const it of items || []) {
    const types = new Set(it.types || []);
    if (!types.size) continue;
    if (it.rowId) byRow.set(Number(it.rowId), types);
    if (it.uid) byUid.set(String(it.uid), types);
  }
  const patches = [];
  const events = [];
  for (const t of tasks || []) {
    const f = t.fields || {};
    if (f.canal !== 'lot_abes' || !['a_faire', 'en_cours', 'en_attente'].includes(statusOf(f))) continue;
    const types = (f.chercheur && byRow.get(Number(f.chercheur))) || (f.uid_dyna && byUid.get(String(f.uid_dyna)));
    if (!types || !types.has(f.type)) continue;
    const { patch, event } = applyTransition(f, 'fait', { author, nowIso, resolution: `Envoyé à l’ABES (lot du ${date})` });
    patches.push({ id: t.id, fields: patch });
    events.push({ tache: t.id, ...event });
  }
  return { patches, events };
}

const choice = (id, label, choices) => ({
  id, fields: { label, type: 'Choice', widgetOptions: JSON.stringify({ choices }) },
});
const text = (id, label) => ({ id, fields: { label, type: 'Text' } });

/** `Taches` columns. Dates are ISO text (same convention as Fusions_log / Newsletter:
 * written by the server, no Grist Date parsing surprises). */
const TASKS_COLUMNS = [
  text('cle', 'Clé (type:uid_dyna, tâches générées)'),
  choice('type', 'Type', Object.keys(TASK_TYPES)),
  choice('base', 'Base', BASES),
  choice('canal', 'Canal', CANALS),
  text('titre', 'Titre'),
  text('description', 'Description'),
  { id: 'chercheur', fields: { label: 'Chercheur', type: 'Ref:Annuaire' } },
  text('uid_dyna', 'uid_dyna'),
  text('nom', 'Nom (dénormalisé)'),
  text('labo', 'Labo'),
  text('lien', 'Lien (notice / profil)'),
  choice('statut', 'Statut', STATUSES),
  text('assignee', 'Assigné à (Keycloak)'),
  choice('priorite', 'Priorité', PRIORITIES),
  text('origine', 'Origine (manuel | regle:<nom>)'),
  text('cree_par', 'Créé par'),
  text('cree_le', 'Créé le (ISO)'),
  text('pris_par', 'Pris en charge par'),
  text('pris_le', 'Pris en charge le (ISO)'),
  text('attente_motif', 'Motif d’attente'),
  text('fait_par', 'Fait par'),
  text('fait_le', 'Fait le (ISO)'),
  text('resolution', 'Résolution'),
  text('verifie_le', 'Vérifié le (ISO, règles)'),
];

const EVENTS_COLUMNS = [
  { id: 'tache', fields: { label: 'Tâche', type: `Ref:${TASKS_TABLE}` } },
  text('date', 'Date (ISO)'),
  text('auteur', 'Auteur'),
  choice('action', 'Action', EVENT_ACTIONS),
  text('detail', 'Détail'),
];

/**
 * Choices to append to the Choice columns of an existing table: the values this Druid knows
 * (a task type added after the table was created…) that the Grist column does not list yet.
 * Grist keeps a value outside the list but shows it as invalid. Existing choices (order,
 * colours, values typed by hand) are kept. Pure: `current` = the /columns response.
 */
function missingChoicePatches(columns, current) {
  const byId = new Map((current || []).map((c) => [c.id, c.fields || {}]));
  const patches = [];
  for (const col of columns) {
    if (col.fields.type !== 'Choice' || !byId.has(col.id)) continue;
    let opts = {};
    try { opts = JSON.parse(byId.get(col.id).widgetOptions || '{}') || {}; } catch { /* unreadable ⇒ rebuilt */ }
    const have = Array.isArray(opts.choices) ? opts.choices : [];
    const missing = JSON.parse(col.fields.widgetOptions).choices.filter((v) => !have.includes(v));
    if (missing.length) patches.push({ id: col.id, fields: { widgetOptions: JSON.stringify({ ...opts, choices: [...have, ...missing] }) } });
  }
  return patches;
}

/**
 * Creates the two tables when missing and completes the choices of their Choice columns
 * (idempotent). `fetchImpl` lets the caller inject a fetch (proxy agent in scripts).
 * Returns the list of created tables.
 */
async function ensureTasksTables({ apiBase, doc, headers, fetchImpl = fetch, log = () => {} }) {
  const resp = await fetchImpl(`${apiBase}/docs/${doc}/tables`, { headers });
  if (!resp.ok) throw new Error(`Grist HTTP ${resp.status} (tables list)`);
  const have = new Set(((await resp.json()).tables || []).map((t) => t.id));
  const created = [];
  for (const [id, columns] of [[TASKS_TABLE, TASKS_COLUMNS], [EVENTS_TABLE, EVENTS_COLUMNS]]) {
    if (have.has(id)) {
      const cols = await fetchImpl(`${apiBase}/docs/${doc}/tables/${id}/columns`, { headers });
      if (!cols.ok) throw new Error(`Grist HTTP ${cols.status} (columns of ${id})`);
      const patches = missingChoicePatches(columns, (await cols.json()).columns);
      if (!patches.length) continue;
      const patch = await fetchImpl(`${apiBase}/docs/${doc}/tables/${id}/columns`, {
        method: 'PATCH', headers, body: JSON.stringify({ columns: patches }),
      });
      if (!patch.ok) throw new Error(`Grist HTTP ${patch.status} (choices of ${id}): ${await patch.text()}`);
      log(`✓ ${id}: choices completed (${patches.map((p) => p.id).join(', ')})`);
      continue;
    }
    const create = await fetchImpl(`${apiBase}/docs/${doc}/tables`, {
      method: 'POST', headers, body: JSON.stringify({ tables: [{ id, columns }] }),
    });
    if (!create.ok) throw new Error(`Grist HTTP ${create.status} (create ${id}): ${await create.text()}`);
    created.push(id);
    log(`✓ table ${id} created (${columns.length} columns)`);
  }
  return created;
}

module.exports = {
  TASKS_TABLE, EVENTS_TABLE, BASES, CANALS, STATUSES, TRANSITIONS, PRIORITIES, TASK_TYPES,
  EVENT_ACTIONS, TASKS_COLUMNS, EVENTS_COLUMNS, TITLES_FR, TaskInputError, normalizeCreate,
  normalizePatch, statusOf, applyTransition, abesSentPatches, missingChoicePatches, ensureTasksTables,
};
