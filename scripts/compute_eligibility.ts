/**
 * Computes the eligibility of the researchers to the open and forthcoming calls reserved by career stage
 * (druid-internal docs/plan-funding-calls.md, lot 5): the rule of each call is read from its collected text
 * (lib/calls/eligibility.ts, ERC Starting / Consolidator so far), every present researcher with a defended thesis
 * (scripts/sync_theses.ts) is evaluated, the eligible and those to check are kept for the view « Candidates ». A call
 * that is closed or no longer states a rule loses its candidates. Refused unless the instance runs on PostgreSQL.
 *
 * Usage (env DRUID_STORAGE=postgres, DRUID_DATABASE_URL):
 *   node scripts/.build/compute_eligibility.cjs [--dry-run]
 * Meant for a nightly job (ofelia), after the collection of the calls and the sync of the theses.
 */
import { closeDatabases, databaseFromEnv, storageKindFromEnv } from '../lib/directory/jobStorage';
import { evaluate, rulesFromCallText } from '../lib/calls/eligibility';
import { createEligibilityStore } from '../lib/calls/eligibilityStore';

const DRY_RUN = process.argv.slice(2).includes('--dry-run');

async function main() {
  if (storageKindFromEnv(process.env) !== 'postgres') throw new Error('DRUID_STORAGE is not postgres: the eligibility needs the PostgreSQL storage');
  const db = databaseFromEnv(process.env);
  const store = createEligibilityStore(db);
  const today = new Date().toISOString().slice(0, 10);
  const calls = await store.openCalls();
  const rules = calls.flatMap((c) => rulesFromCallText(c));
  const people = await store.people(today);
  console.log(`eligibility: ${rules.length} rule(s) in ${calls.length} open or forthcoming calls, ${people.length} present researchers with a defended PhD${DRY_RUN ? ' (dry run)' : ''}`);
  for (const rule of rules) {
    const rows = people
      .map((person) => ({ person, result: evaluate(person.phdOn, rule) }))
      .filter((r) => r.result && r.result.verdict !== 'ineligible')
      .map((r) => ({ person: r.person, verdict: r.result!.verdict, reasons: r.result!.reasons }));
    const eligible = rows.filter((r) => r.verdict === 'eligible').length;
    console.log(`  ${rule.callId} (${rule.scheme}): PhD ${rule.phdFrom} → ${rule.phdTo}, ${eligible} eligible, ${rows.length - eligible} to check`);
    if (!DRY_RUN) await store.saveCall(rule, rows);
  }
  if (!DRY_RUN) {
    const dropped = await store.dropRulesExcept(rules.map((r) => r.callId));
    if (dropped) console.log(`  ${dropped} rule(s) of closed calls dropped`);
  }
}

main()
  .then(() => closeDatabases())
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await closeDatabases();
    process.exit(1);
  });
