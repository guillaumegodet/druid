/**
 * Reads the doctoral theses of the researchers from theses.fr by their IdRef (druid-internal
 * docs/plan-funding-calls.md, lot 5): the date of the PhD drives the eligibility to the young researcher schemes.
 * People with a primary IdRef are checked once, then again after `--max-age-days` or when their IdRef changes; the
 * theses they authored replace those of the previous check (a thesis typed by hand stays). Refused unless the instance
 * runs on PostgreSQL.
 *
 * Usage (env DRUID_STORAGE=postgres, DRUID_DATABASE_URL):
 *   node scripts/.build/sync_theses.cjs [--limit=2000] [--max-age-days=180] [--uid=dupont-j,martin-c] [--dry-run]
 * Meant for a weekly job (ofelia); the outgoing calls go through the proxy of the instance when NODE_USE_ENV_PROXY=1
 * and HTTPS_PROXY are set. Two requests at a time, with a pause, to stay polite with the national portal.
 */
import { closeDatabases, databaseFromEnv, storageKindFromEnv } from '../lib/directory/jobStorage';
import { parseThesesPerson, phdOf, THESES_PERSON_API, type Thesis } from '../lib/thesis';
import { createThesisStore, type ThesisCheckTarget } from '../lib/thesisStore';

const args = process.argv.slice(2);
const option = (name: string): string | undefined => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const LIMIT = Number(option('limit') || 2000);
const MAX_AGE_DAYS = Number(option('max-age-days') || 180);
const UIDS = (option('uid') || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const DRY_RUN = args.includes('--dry-run');
const CONCURRENCY = 2;
const PAUSE_MS = 250;
const USER_AGENT = 'Druid (doctoral theses of the directory; https://github.com/guillaumegodet/druid)';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Theses of an IdRef; null when theses.fr does not know the person. Throws on a network or server failure. */
async function fetchTheses(idref: string): Promise<Thesis[] | null> {
  const res = await fetch(`${THESES_PERSON_API}${encodeURIComponent(idref)}`, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
  // An unknown person is a 400 « Person not found »; another 4xx/5xx is a failure.
  if (res.status === 400 || res.status === 404) {
    const body = await res.json().catch(() => null) as { message?: string } | null;
    if (res.status === 404 || /not found/i.test(body?.message ?? '')) return null;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseThesesPerson(await res.json());
}

async function main() {
  if (storageKindFromEnv(process.env) !== 'postgres') throw new Error('DRUID_STORAGE is not postgres: the theses need the PostgreSQL storage');
  const db = databaseFromEnv(process.env);
  const store = createThesisStore(db);
  const targets = await store.due({ limit: LIMIT, maxAgeDays: MAX_AGE_DAYS, uids: UIDS });
  console.log(`theses: ${targets.length} people to check${DRY_RUN ? ' (dry run)' : ''}`);
  const stats = { checked: 0, unknown: 0, withPhd: 0, inProgress: 0, errors: 0 };
  const queue: ThesisCheckTarget[] = [...targets];
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    for (let t = queue.shift(); t; t = queue.shift()) {
      let theses: Thesis[] | null = null;
      let error = '';
      try {
        theses = await fetchTheses(t.idref);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
      stats.checked++;
      if (stats.checked % 200 === 0) console.log(`  … ${stats.checked}/${targets.length}`);
      if (error) stats.errors++;
      else if (theses === null) stats.unknown++;
      else if (phdOf(theses)) stats.withPhd++;
      else if (theses.some((x) => x.status === 'in_progress')) stats.inProgress++;
      if (DRY_RUN) {
        const phd = theses && phdOf(theses);
        console.log(`  ${t.uid ?? t.personId} ${t.idref}: ${error || (theses === null ? 'unknown to theses.fr' : phd ? `PhD ${phd.defendedOn} ${phd.institution}` : `${theses.length} thesis(es), none defended`)}`);
      } else {
        await store.saveCheck(t, theses, error);
      }
      await sleep(PAUSE_MS);
    }
  }));
  console.log(`theses: ${stats.checked} checked, ${stats.withPhd} with a PhD, ${stats.inProgress} PhD in progress, ${stats.unknown} unknown to theses.fr, ${stats.errors} error(s)`);
  if (!DRY_RUN) {
    const c = await store.coverage();
    console.log(`coverage: ${c.checked}/${c.withIdref} people with an IdRef checked, ${c.withPhd} with a defended thesis`);
  }
}

main()
  .then(() => closeDatabases())
  .catch(async (err) => {
    console.error(err instanceof Error ? err.message : err);
    await closeDatabases();
    process.exit(1);
  });
