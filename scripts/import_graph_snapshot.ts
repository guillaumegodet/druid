/**
 * Loads a snapshot of the identifiers the CRISalid knowledge graph holds for the directory's persons into
 * graph_identifier_state (druid-internal docs/plan-migration-postgresql.md, lot 11 c): the starting point of the
 * removals sent to the graph, then the check that they were applied (the IKG acknowledges none). The snapshot comes
 * from scripts/graph/export_graph_identifiers.sh, run on the host of the graph.
 *
 * DRY-RUN by default: compares the snapshot with the state and the directory and writes the report; `--apply` replaces
 * the state. Refused unless the instance runs on PostgreSQL, and for an empty snapshot. The report (JSON + Markdown)
 * names uids and identifier types, never a value.
 *
 * Usage (env DRUID_STORAGE=postgres, DRUID_DATABASE_URL):
 *   node scripts/.build/import_graph_snapshot.cjs --file=<export> [--taken-at=<ISO date>] [--apply] [--out=<directory>]
 * The snapshot date defaults to the modification time of the file.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { closeDatabases, databaseFromEnv, storageKindFromEnv } from '../lib/directory/jobStorage';
import { comparableValue, isReadableValue, planGraphActions } from '../lib/graph/identifierActions';
import { MAX_REMOVALS_PER_PASS, loadGraphPlanInput, removalsSentBefore, replaceGraphState } from '../lib/graph/pg';
import { compareGraphStates, parseGraphSnapshot, unappliedRemovals } from '../lib/graph/snapshot';

const args = process.argv.slice(2);
const arg = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const APPLY = args.includes('--apply');
const FILE = arg('file');
const OUT = arg('out') || 'scripts/.build/graph_snapshot';

const uidType = (a: { uid: string; type: string }) => `${a.uid} (${a.type})`;

async function main() {
  if (storageKindFromEnv(process.env) !== 'postgres') throw new Error('DRUID_STORAGE is not postgres: the graph actions need the PostgreSQL directory');
  if (!FILE) throw new Error('--file=<export of scripts/graph/export_graph_identifiers.sh> is required');
  const takenAt = new Date(arg('taken-at') || statSync(FILE).mtime).toISOString();
  const snapshot = parseGraphSnapshot(readFileSync(FILE, 'utf8'));
  if (!snapshot.identifiers.length) throw new Error(`no identifier of a directory person in ${FILE}: refused`);

  const db = databaseFromEnv(process.env);
  const input = await loadGraphPlanInput(db);
  const difference = compareGraphStates(input.state, snapshot.identifiers);
  const unapplied = unappliedRemovals(await removalsSentBefore(db, takenAt), snapshot.identifiers);
  const plan = planGraphActions({ ...input, state: snapshot.identifiers });
  const held = new Set(snapshot.identifiers.map((s) => `${s.uid}\u0000${s.type}\u0000${comparableValue(s.value)}`));
  const waitingForPeopleCsv = input.directory
    .filter((d) => isReadableValue(d.type, d.value) && !held.has(`${d.uid}\u0000${d.type}\u0000${comparableValue(d.value)}`)).length;
  const toSend = plan.removals.filter((r) => r.status === 'pending');
  const blocked = plan.removals.filter((r) => r.status === 'blocked');

  if (APPLY) await replaceGraphState(db, snapshot.identifiers);

  const doc = {
    generatedAt: new Date().toISOString(), mode: APPLY ? 'apply' : 'dry-run', takenAt,
    snapshot: {
      identifiers: snapshot.identifiers.length, persons: new Set(snapshot.identifiers.map((s) => s.uid)).size,
      unreadableLines: snapshot.unreadableLines, notLocal: snapshot.notLocal, otherTypes: snapshot.otherTypes,
      conflicts: snapshot.conflicts.map(uidType),
    },
    stateBefore: input.state.length, difference,
    unappliedRemovals: unapplied.map((a) => ({ id: a.id, person: uidType(a), sentAt: a.sent_at })),
    nextPass: {
      toSend: toSend.map(uidType), blocked: blocked.map(uidType), unreadable: plan.unreadable.map(uidType),
      orphans: plan.orphans, refusedAbove: MAX_REMOVALS_PER_PASS,
    },
    waitingForPeopleCsv,
  };
  console.log(`[graph_snapshot] ${doc.mode}, snapshot of ${takenAt}: ${doc.snapshot.identifiers} identifiers of ${doc.snapshot.persons} persons`
    + ` (state: +${difference.added} -${difference.removed} ~${difference.changed} =${difference.unchanged})`);
  console.log(`[graph_snapshot] next pass: ${toSend.length} removals to send${toSend.length > MAX_REMOVALS_PER_PASS ? ' (above the limit: refused unless forced)' : ''},`
    + ` ${blocked.length} blocked, ${plan.unreadable.length} unreadable directory values, ${plan.orphans.length} persons of the graph without a record;`
    + ` ${unapplied.length} sent removals not applied; ${waitingForPeopleCsv} directory identifiers missing from the graph (people.csv)`);
  if (snapshot.conflicts.length) console.log(`[graph_snapshot] ${snapshot.conflicts.length} persons with several values of one type: left out of the state`);

  mkdirSync(OUT, { recursive: true });
  const stamp = doc.generatedAt.replace(/[:.]/g, '-');
  writeFileSync(join(OUT, `graph-snapshot-${stamp}.json`), JSON.stringify(doc, null, 1));
  const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`) : ['—']);
  writeFileSync(join(OUT, `graph-snapshot-${stamp}.md`), [
    `# Instantané du graphe — ${doc.generatedAt} (${doc.mode})`, '',
    `Instantané du ${takenAt} : ${doc.snapshot.identifiers} identifiants, ${doc.snapshot.persons} personnes ; lignes illisibles ${snapshot.unreadableLines},`
      + ` personnes hors annuaire ${snapshot.notLocal}, autres types ${snapshot.otherTypes}.`, '',
    `État précédent : ${doc.stateBefore} lignes → ajoutées ${difference.added}, disparues ${difference.removed}, changées ${difference.changed}, identiques ${difference.unchanged}.`, '',
    `Identifiants de l'annuaire absents du graphe (en attente de people.csv) : ${waitingForPeopleCsv}.`, '',
    `## Retraits envoyés non appliqués (${unapplied.length})`, '', ...list(doc.unappliedRemovals.map((u) => `${u.person}, envoyé le ${u.sentAt}`)), '',
    `## Prochain passage : retraits à envoyer (${toSend.length}, refus au-delà de ${MAX_REMOVALS_PER_PASS})`, '', ...list(doc.nextPass.toSend), '',
    `## Retraits bloqués (${blocked.length}, type refusé par l'IKG)`, '', ...list(doc.nextPass.blocked), '',
    `## Valeurs illisibles dans l'annuaire (${plan.unreadable.length}, fiche à corriger)`, '', ...list(doc.nextPass.unreadable), '',
    `## Personnes du graphe sans fiche (${plan.orphans.length}, à arbitrer)`, '', ...list(plan.orphans), '',
    `## Plusieurs valeurs d'un type dans le graphe (${snapshot.conflicts.length}, hors état)`, '', ...list(doc.snapshot.conflicts), '',
  ].join('\n'));
  console.log(`[graph_snapshot] report: ${OUT}/graph-snapshot-${stamp}.{json,md}`);
  await closeDatabases();
}

main().catch(async (e) => {
  console.error('[graph_snapshot] ✗', e);
  await closeDatabases().catch(() => {});
  process.exit(1);
});
