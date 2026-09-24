// Run: docker run --rm -v "$PWD":/app -w /app -e VITE_GRIST_DOC_ID=docA -e GRIST_EXTRA_DOC_IDS=5aREUrB1kuFAcVY4GTUDfA,docB -e GRIST_API_KEY=k node:20-slim node scripts/tests/grist-proxy-guard.cjs
// (server.cjs loaded as a module: it does not listen.)
// Harness: the pure decision gristProxyDecision against simulated requests — no Express
// mock nor global.fetch needed since lot 2 (extraction into a pure function, see
// docs/plan-architecture-multi-instances.md), on the same mold as functions-guards.mjs
// (Centrale repo) for gristGuard.
const { gristProxyDecision } = require(require('path').join(__dirname, '../../server.cjs'));
const DOC = 'docA';
// Simulated Grist rows: value of the scope column by id, injected in place
// of a real Grist SQL call.
const ROWS = { Annuaire: { 1: 'LS2N', 2: 'IETR', 3: 'zzz' }, Structures: { 10: 'LS2N[fr]|LS2N[en]' }, Newsletter: { 20: 'ls2n' } };
const fetchRowScopes = async (doc, table, col, ids) => {
  const out = new Map();
  for (const id of ids) if (ROWS[table]?.[id] !== undefined) out.set(id, ROWS[table][id]);
  return out;
};
const run = async (method, path, body, access) => {
  const decision = await gristProxyDecision({ method, path, access, body, fetchRowScopes });
  return decision.ok ? { code: 'NEXT' } : { code: decision.status, err: decision.error };
};
const LAB = { allSlugs: false, labAnchors: ['ls2n'] };
const ETAB = { allSlugs: true, labAnchors: [] };
const NOBODY = { allSlugs: false, labAnchors: [] };
const cases = [
  ['GET racine doc (updatedAt)', 'GET', `docs/${DOC}`, null, LAB, 'NEXT'],
  ['GET liste tables', 'GET', `docs/${DOC}/tables`, null, LAB, 'NEXT'],
  ['GET Annuaire filtré', 'GET', `docs/${DOC}/tables/Annuaire/records?filter=x`, null, LAB, 'NEXT'],
  ['GET autre doc autorisé', 'GET', `docs/docB/tables/T/records`, null, LAB, 'NEXT'],
  ['GET doc inconnu', 'GET', `docs/docZ/tables/Annuaire/records`, null, ETAB, 403],
  ['GET orgs', 'GET', `orgs`, null, ETAB, 403],
  ['GET sql', 'GET', `docs/${DOC}/sql`, null, ETAB, 403],
  ['DELETE doc (étab)', 'DELETE', `docs/${DOC}`, null, ETAB, 403],
  ['PUT', 'PUT', `docs/${DOC}/tables/Annuaire/records`, {}, ETAB, 405],
  ['POST colonnes (étab)', 'POST', `docs/${DOC}/tables/Annuaire/columns`, {}, ETAB, 'NEXT'],
  ['POST colonnes (labo)', 'POST', `docs/${DOC}/tables/Annuaire/columns`, {}, LAB, 403],
  ['POST création table (labo)', 'POST', `docs/${DOC}/tables`, {}, LAB, 403],
  ['PATCH Annuaire ligne du labo', 'PATCH', `docs/${DOC}/tables/Annuaire/records`, { records: [{ id: 1, fields: { Nom: 'X' } }] }, LAB, 'NEXT'],
  ['PATCH Annuaire ligne autre labo', 'PATCH', `docs/${DOC}/tables/Annuaire/records`, { records: [{ id: 2, fields: { Nom: 'X' } }] }, LAB, 403],
  ['PATCH Annuaire ligne parking', 'PATCH', `docs/${DOC}/tables/Annuaire/records`, { records: [{ id: 3, fields: { Nom: 'X' } }] }, LAB, 403],
  ['PATCH Annuaire ligne inconnue', 'PATCH', `docs/${DOC}/tables/Annuaire/records`, { records: [{ id: 99, fields: {} }] }, LAB, 403],
  ['PATCH Annuaire déplace vers autre labo', 'PATCH', `docs/${DOC}/tables/Annuaire/records`, { records: [{ id: 1, fields: { LABO: 'IETR' } }] }, LAB, 403],
  ['PATCH Annuaire sans id', 'PATCH', `docs/${DOC}/tables/Annuaire/records`, { records: [{ fields: {} }] }, LAB, 400],
  ['PATCH Annuaire id chaîne', 'PATCH', `docs/${DOC}/tables/Annuaire/records`, { records: [{ id: '1', fields: {} }] }, LAB, 400],
  ['POST Annuaire dans le labo', 'POST', `docs/${DOC}/tables/Annuaire/records`, { records: [{ fields: { LABO: 'ls2n', Nom: 'N' } }] }, LAB, 'NEXT'],
  ['POST Annuaire sans LABO', 'POST', `docs/${DOC}/tables/Annuaire/records`, { records: [{ fields: { Nom: 'N' } }] }, LAB, 403],
  ['POST Annuaire autre labo', 'POST', `docs/${DOC}/tables/Annuaire/records`, { records: [{ fields: { LABO: 'IETR' } }] }, LAB, 403],
  ['delete ligne du labo', 'POST', `docs/${DOC}/tables/Annuaire/data/delete`, [1], LAB, 'NEXT'],
  ['delete ligne autre labo', 'POST', `docs/${DOC}/tables/Annuaire/data/delete`, [1, 2], LAB, 403],
  ['delete corps invalide', 'POST', `docs/${DOC}/tables/Annuaire/data/delete`, { x: 1 }, LAB, 400],
  ['PATCH Structures (multi-label)', 'PATCH', `docs/${DOC}/tables/Structures/records`, { records: [{ id: 10, fields: { long_labels: 'x' } }] }, LAB, 'NEXT'],
  ['PATCH Newsletter slug', 'PATCH', `docs/${DOC}/tables/Newsletter/records`, { records: [{ id: 20, fields: { statut: 'ok' } }] }, LAB, 'NEXT'],
  ['POST Fusions_log (labo)', 'POST', `docs/${DOC}/tables/Fusions_log/records`, { records: [{ fields: {} }] }, LAB, 'NEXT'],
  ['PATCH Alignement_IdRef (labo)', 'PATCH', `docs/${DOC}/tables/Alignement_IdRef/records`, { records: [{ id: 1, fields: {} }] }, LAB, 403],
  ['PATCH Alignement_IdRef (étab)', 'PATCH', `docs/${DOC}/tables/Alignement_IdRef/records`, { records: [{ id: 1, fields: {} }] }, ETAB, 'NEXT'],
  ['PATCH axes Centrale (labo ec-nantes)', 'PATCH', `docs/5aREUrB1kuFAcVY4GTUDfA/tables/Publications_centrale_axes_strategiques2/records`, { records: [{ id: 5, fields: { Axe_Retenu: 'A' } }] }, { allSlugs: false, labAnchors: ['ecnantes'] }, 'NEXT'],
  ['PATCH axes Centrale (labo ls2n)', 'PATCH', `docs/5aREUrB1kuFAcVY4GTUDfA/tables/Publications_centrale_axes_strategiques2/records`, { records: [{ id: 5, fields: {} }] }, LAB, 403],
  ['PATCH autre table doc annexe (labo)', 'PATCH', `docs/docB/tables/T/records`, { records: [{ id: 5, fields: {} }] }, LAB, 403],
  ['PATCH Annuaire sans session', 'PATCH', `docs/${DOC}/tables/Annuaire/records`, { records: [{ id: 1, fields: {} }] }, null, 403],
  ['PATCH Annuaire sans ancre', 'PATCH', `docs/${DOC}/tables/Annuaire/records`, { records: [{ id: 1, fields: {} }] }, NOBODY, 403],
];
(async () => {
  let ko = 0;
  for (const [name, m, p, b, a, exp] of cases) {
    const r = await run(m, p, b, a);
    const ok = r.code === exp;
    if (!ok) ko++;
    console.log(`${ok ? 'ok ' : 'KO '} ${name} → ${r.code}${r.err ? ' (' + r.err + ')' : ''}${ok ? '' : ' attendu ' + exp}`);
  }
  console.log(ko ? `${ko} failure(s)` : `${cases.length} cases OK`);
  process.exit(ko ? 1 : 0);
})();
