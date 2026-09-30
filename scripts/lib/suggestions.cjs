/**
 * suggestions.cjs — « Suggestions de l'établissement » of a researcher record
 * (docs/plan-parcours-affiliations.md, lot 5). Pure: server.cjs gathers the inputs (Annuaire rows,
 * career-path entry, alignment caches, detection rules of sync_tasks.cjs, tasks of the person) and
 * this module decides which actions to suggest, in which order. Texts live in the front
 * (lib/suggestions.ts, Lingui): a suggestion is an id + the data its text needs.
 *
 * Priorities (decision S4): 1 = a missing identifier, 2 = an error to fix, 3 = completeness;
 * then `rank` inside a priority. At most MAX_SHOWN are shown.
 */
'use strict';

const MAX_SHOWN = 5;

/** Suggestion id → task type of « À traiter » (Create a task / Prepare the email). */
const SUGGESTION_TASK_TYPES = {
  orcid_creer: 'orcid_absent',
  orcid_rendre_public: 'orcid_profil_vide',
  orcid_ajouter_poste: 'orcid_ajouter_poste',
  idhal_creer: 'hal_idhal_absent',
  idhal_fusionner: 'hal_deux_idhal',
  scopus_corriger: 'scopus_profil_errone',
  scopus_fusionner: 'scopus_deux_ids',
  openalex_fusionner: 'openalex_deux_auteurs',
  orcid_relier_scopus: 'orcid_relier_scopus',
  orcid_cloturer_poste: null,
};
const DEPARTURES = new Set(['depart_confirme', 'depart_declare', 'nouveau_poste_declare', 'depart_observe']);
const OPEN = new Set(['a_faire', 'en_cours', 'en_attente']);

/** A Scopus profile merging homonyms (calibrated on 2026-09-30, lot 5a): many documents, far more than
 * the other sources see, and most of them without an affiliation of the author. */
function scopusLooksMerged(entry) {
  const x = entry && entry.extras;
  if (!x || !x.scopusDocCount) return false;
  const others = Math.max(entry.sources.openalex || 0, entry.sources.graph || 0);
  const scopusPubs = entry.sources.scopus || 0;
  const affiliatedShare = scopusPubs ? (x.scopusAffiliated || 0) / scopusPubs : 1;
  return x.scopusDocCount >= 300 && others > 0 && x.scopusDocCount > 3 * others && affiliatedShare < 0.5;
}

/**
 * @param {object} i
 * @param {object} i.record   { key, orcid, idhal, scopus:[], openalex:[], employmentStart, ended, horsRecherche,
 *                             member (a row with a lab), employedHere (employer = the institution) }
 * @param {object|null} i.entry         career-path entry (sync_affiliation_history.cjs) or null
 * @param {boolean} i.orcidEmpty        the current ORCID is empty or private (orcid alignment cache)
 * @param {object} i.ruleHits           { hal_deux_idhal: string|null, scopus_deux_ids: string|null } descriptions
 * @param {Array}  i.tasks              tasks of the person { id, cle, type, statut }
 * @param {object} i.institution        { name, ror }
 * @returns {{ suggestions: object[], hidden: number }}
 */
function computeSuggestions({ record, entry = null, orcidEmpty = false, ruleHits = {}, tasks = [], institution = {} }) {
  // Lab members only (the Annuaire also lists outside collaborators), and not after the end of employment.
  if (record.ended || record.member === false) return { suggestions: [], hidden: 0 };
  const out = [];
  const add = (id, priority, rank, data = {}) => out.push({ id, priority, rank, data, taskType: SUGGESTION_TASK_TYPES[id] });
  const signals = (entry && entry.signals) || [];
  const periods = (entry && entry.orcid) || [];
  const employments = periods.filter((p) => p.kind === 'employment');
  const departed = signals.some((s) => DEPARTURES.has(s.type));

  // 1 — missing identifiers (not for staff without research duty: an IdHAL / ORCID is not expected there).
  if (!record.orcid && !record.horsRecherche) add('orcid_creer', 1, 1);
  if (!record.idhal && !record.horsRecherche) {
    const halDocs = entry && entry.extras ? entry.extras.halDocs : null;
    add('idhal_creer', 1, halDocs ? 2 : 4, { halDocs: halDocs || 0 });
  }
  if (record.orcid && orcidEmpty) add('orcid_rendre_public', 1, 3, { orcid: record.orcid });

  // 2 — errors to fix.
  if (ruleHits.hal_deux_idhal) add('idhal_fusionner', 2, 1, { detail: ruleHits.hal_deux_idhal });
  if (ruleHits.scopus_deux_ids) add('scopus_fusionner', 2, 2, { detail: ruleHits.scopus_deux_ids });
  const scopusNeverLocal = signals.some((s) => s.type === 'identifiant_suspect' && (s.sources || []).includes('scopus'));
  if (record.scopus.length && (scopusNeverLocal || scopusLooksMerged(entry))) {
    add('scopus_corriger', 2, 3, { scopus: record.scopus[0], reason: scopusNeverLocal ? 'never_local' : 'merged', docCount: entry.extras ? entry.extras.scopusDocCount : null });
  }
  if (record.openalex.length > 1) add('openalex_fusionner', 2, 4, { ids: record.openalex });

  // 3 — completeness (only on a public ORCID read by the career-path job).
  const orcidRead = record.orcid && !orcidEmpty && entry && entry.sources && entry.sources.orcid !== null;
  if (orcidRead && !departed && record.employedHere !== false) {
    if (!employments.length) add('orcid_ajouter_poste', 3, 1, { orcid: record.orcid, institution: institution.name || '', ror: institution.ror || '', start: record.employmentStart || '', missing: 'all' });
    else if (!employments.some((p) => p.cls === 'local')) add('orcid_ajouter_poste', 3, 2, { orcid: record.orcid, institution: institution.name || '', ror: institution.ror || '', start: record.employmentStart || '', missing: 'local' });
  }
  const ext = entry && entry.extras ? entry.extras.orcidExternal : null;
  if (orcidRead && record.scopus.length && Array.isArray(ext) && !ext.includes('Scopus Author ID')) add('orcid_relier_scopus', 3, 3, { orcid: record.orcid, scopus: record.scopus[0] });
  if (orcidRead && departed && employments.some((p) => p.cls === 'local' && !p.end)) add('orcid_cloturer_poste', 3, 4, { orcid: record.orcid });

  // Follow-up (decision S2): a suggestion hidden (task « abandonnee ») or done stays away; an open task
  // — created from the suggestion or by a detection rule of the same type — is shown on the card.
  const kept = [];
  for (const s of out) {
    const own = tasks.find((t) => t.cle === `suggestion:${s.id}:${record.key}`);
    if (own && !OPEN.has(own.statut)) continue;
    const open = own || (s.taskType ? tasks.find((t) => t.type === s.taskType && OPEN.has(t.statut)) : null);
    kept.push({ ...s, task: open ? { id: open.id, statut: open.statut } : null });
  }
  kept.sort((a, b) => a.priority - b.priority || a.rank - b.rank);
  return { suggestions: kept.slice(0, MAX_SHOWN), hidden: Math.max(0, kept.length - MAX_SHOWN) };
}

module.exports = { computeSuggestions, scopusLooksMerged, SUGGESTION_TASK_TYPES, MAX_SHOWN };
