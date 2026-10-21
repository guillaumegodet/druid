// Runner of the jobs of a multi-tenant deployment (druid-internal docs/plan-druid-saas.md, lots 2 d and 3). Bundled to
// scripts/.build/saas_runner.cjs (`npm run build:saas`), run next to the database (VPS, systemd):
//
//   DATABASE_URL=postgres://druid_owner:…   owner (migrations of the tenant schemas)
//   DATABASE_URL_APP=postgres://druid_app:… application role for the seeding (default: DATABASE_URL)
//   SAAS_BASE_DOMAIN=dirladata.fr          host of a new tenant = <slug>.<base>
//   SAAS_CF_API_TOKEN, SAAS_CF_ZONE_ID, SAAS_WORKER_NAME   route <host>/* → the Worker (skipped when unset)
//   RESEND_API_KEY, EMAIL_FROM             « your Druid is ready » e-mail (skipped when unset)
//   OPENALEX_API_KEY | OPENALEX_MAILTO      OpenAlex calls of the structure alignment (structures.align)
//   node scripts/.build/saas_runner.cjs [--once] [--interval 10]
import { openSaasDb } from '../../lib/saas/tenantDb';
import { runForever, runJobsOnce, type RunnerEnv } from '../../lib/saas/runner';

const args = process.argv.slice(2);
const once = args.includes('--once');
const intervalIdx = args.indexOf('--interval');
const intervalMs = intervalIdx >= 0 ? Math.max(1, Number(args[intervalIdx + 1]) || 10) * 1000 : 10_000;

const main = async (): Promise<void> => {
  const ownerUrl = process.env.DATABASE_URL;
  if (!ownerUrl) throw new Error('DATABASE_URL (owner role) is required');
  const baseDomain = process.env.SAAS_BASE_DOMAIN;
  if (!baseDomain) throw new Error('SAAS_BASE_DOMAIN is required');
  const cf = process.env.SAAS_CF_API_TOKEN && process.env.SAAS_CF_ZONE_ID && process.env.SAAS_WORKER_NAME
    ? { apiToken: process.env.SAAS_CF_API_TOKEN, zoneId: process.env.SAAS_CF_ZONE_ID, workerName: process.env.SAAS_WORKER_NAME }
    : null;
  const env: RunnerEnv = {
    ownerUrl, appUrl: process.env.DATABASE_URL_APP || ownerUrl, baseDomain, cloudflare: cf,
    email: process.env.RESEND_API_KEY ? { RESEND_API_KEY: process.env.RESEND_API_KEY, EMAIL_FROM: process.env.EMAIL_FROM } : null,
    openalexApiKey: process.env.OPENALEX_API_KEY || null, openalexMailto: process.env.OPENALEX_MAILTO || null,
    log: (l) => console.log(`[saas-runner] ${new Date().toISOString()} ${l}`),
  };
  const saas = openSaasDb(ownerUrl);
  const controller = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { env.log!(`${sig}: stopping after the current job`); controller.abort(); });
  try {
    if (once) {
      const { done, failed } = await runJobsOnce(saas, env);
      env.log!(`${done} done, ${failed} failed`);
      if (failed) process.exitCode = 1;
    } else {
      env.log!(`polling every ${intervalMs / 1000} s (route: ${cf ? 'Cloudflare' : 'off'}, e-mail: ${env.email ? 'Resend' : 'off'})`);
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
