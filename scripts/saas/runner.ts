// Runner of the jobs of a multi-tenant deployment (druid-internal docs/plan-druid-saas.md, lots 2 d and 3). Bundled to
// scripts/.build/saas_runner.cjs (`npm run build:saas`), run next to the database (VPS, systemd) from a checkout of
// Druid where `npm run build:server` was run (the scripts need server-api.cjs):
//
//   DATABASE_URL=postgres://druid_owner:…   owner (migrations of the tenant schemas)
//   DATABASE_URL_APP=postgres://druid_app:… application role for the seeding and the scripts (default: DATABASE_URL)
//   SAAS_BASE_DOMAIN=dirladata.fr          host of a new tenant = <slug>.<base>
//   SAAS_CF_API_TOKEN, SAAS_CF_ZONE_ID, SAAS_WORKER_NAME   route <host>/* → the Worker (skipped when unset)
//   RESEND_API_KEY, EMAIL_FROM             « your Druid is ready » e-mail and the alerts (skipped when unset)
//   SAAS_ALERT_EMAIL                       ops address told of two failures in a row of a job (lot 3 e)
//   OPENALEX_API_KEY | OPENALEX_MAILTO      OpenAlex calls of the structure alignment and of the scripts
//   SAAS_SECRETS_KEY                       key of the tenant secrets (Scopus…), 32 bytes base64 (lib/saas/secrets.ts)
//   SAAS_DRUID_ROOT                        checkout of Druid (default: the working directory)
//   SAAS_WORK_DIR                          per-tenant files of the alignment scripts (default: <root>/saas-work)
//   SAAS_ETL_DATA_DIR, SAAS_ETL_COMMAND     ETL of druid-biblio (lot 3 c): data folder of the tenants, command of one
//                                          lab with {slug} (e.g. "python3 /opt/druid-biblio/scripts/run_structure_etl.py {slug}")
//   SAAS_R2_ENDPOINT, SAAS_R2_BUCKET, SAAS_R2_ACCESS_KEY_ID, SAAS_R2_SECRET_ACCESS_KEY   dashboards (lib/saas/r2.ts)
//   SAAS_MEMORY_FLOOR_MB                   no job claimed under this MemAvailable (default 1200)
//   SAAS_NIGHT_WINDOW=20-6                 UTC hours of the scheduled refreshes (lot 3 d)
//   SAAS_RUNNER_NAME                       name of this runner (default <host>:<pid>)
//   node scripts/.build/saas_runner.cjs [--once] [--interval 10] [--schedule-now]
import { openSaasDb } from '../../lib/saas/tenantDb';
import { defaultRunnerName, recoverStaleJobs, runForever, runJobsOnce, scheduleRefreshes, type RunnerEnv } from '../../lib/saas/runner';
import { assetStoreFromEnv } from '../../lib/saas/r2';

const args = process.argv.slice(2);
const once = args.includes('--once');
const scheduleNow = args.includes('--schedule-now');
const intervalIdx = args.indexOf('--interval');
const intervalMs = intervalIdx >= 0 ? Math.max(1, Number(args[intervalIdx + 1]) || 10) * 1000 : 10_000;

const nightWindowOf = (raw: string | undefined): [number, number] | undefined => {
  const m = String(raw || '').match(/^(\d{1,2})-(\d{1,2})$/);
  return m ? [Math.min(23, Number(m[1])), Math.min(24, Number(m[2]))] : undefined;
};

const main = async (): Promise<void> => {
  const ownerUrl = process.env.DATABASE_URL;
  if (!ownerUrl) throw new Error('DATABASE_URL (owner role) is required');
  const baseDomain = process.env.SAAS_BASE_DOMAIN;
  if (!baseDomain) throw new Error('SAAS_BASE_DOMAIN is required');
  const cf = process.env.SAAS_CF_API_TOKEN && process.env.SAAS_CF_ZONE_ID && process.env.SAAS_WORKER_NAME
    ? { apiToken: process.env.SAAS_CF_API_TOKEN, zoneId: process.env.SAAS_CF_ZONE_ID, workerName: process.env.SAAS_WORKER_NAME }
    : null;
  const etlCommand = String(process.env.SAAS_ETL_COMMAND || '').trim().split(/\s+/).filter(Boolean);
  const env: RunnerEnv = {
    ownerUrl, appUrl: process.env.DATABASE_URL_APP || ownerUrl, baseDomain, cloudflare: cf,
    email: process.env.RESEND_API_KEY ? { RESEND_API_KEY: process.env.RESEND_API_KEY, EMAIL_FROM: process.env.EMAIL_FROM } : null,
    alertEmail: process.env.SAAS_ALERT_EMAIL || null,
    openalexApiKey: process.env.OPENALEX_API_KEY || null, openalexMailto: process.env.OPENALEX_MAILTO || null,
    name: process.env.SAAS_RUNNER_NAME || defaultRunnerName(),
    druidRoot: process.env.SAAS_DRUID_ROOT || process.cwd(),
    workDir: process.env.SAAS_WORK_DIR || undefined,
    secretsKey: process.env.SAAS_SECRETS_KEY || null,
    etl: process.env.SAAS_ETL_DATA_DIR && etlCommand.length ? { dataDir: process.env.SAAS_ETL_DATA_DIR, command: etlCommand } : null,
    assets: assetStoreFromEnv(process.env),
    memoryFloorMb: process.env.SAAS_MEMORY_FLOOR_MB === undefined ? 1200 : Math.max(0, Number(process.env.SAAS_MEMORY_FLOOR_MB) || 0),
    nightWindow: nightWindowOf(process.env.SAAS_NIGHT_WINDOW),
    log: (l) => console.log(`[saas-runner] ${new Date().toISOString()} ${l}`),
  };
  const saas = openSaasDb(ownerUrl);
  const controller = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { env.log!(`${sig}: stopping after the current job`); controller.abort(); });
  try {
    const stale = await recoverStaleJobs(saas, env.name!);
    if (stale) env.log!(`${stale} stale job(s) of ${env.name} failed`);
    if (scheduleNow) {
      const queued = await scheduleRefreshes(saas, env, { ignoreWindow: true, batch: 1000 });
      env.log!(`scheduled etl.build for ${queued.length} tenant(s)${queued.length ? `: ${queued.join(', ')}` : ''}`);
    }
    if (once) {
      const { done, failed, cancelled } = await runJobsOnce(saas, env);
      env.log!(`${done} done, ${failed} failed, ${cancelled} cancelled`);
      if (failed) process.exitCode = 1;
    } else {
      env.log!(`polling every ${intervalMs / 1000} s (route: ${cf ? 'Cloudflare' : 'off'}, e-mail: ${env.email ? 'Resend' : 'off'}, ETL: ${env.etl ? 'on' : 'off'}, assets: ${env.assets ? 'S3' : 'disk only'}, secrets: ${env.secretsKey ? 'on' : 'off'})`);
      await runForever(saas, env, intervalMs, undefined, controller.signal);
    }
  } finally {
    await saas.destroy();
  }
};

main().catch((err) => {
  console.error(`[saas-runner] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
