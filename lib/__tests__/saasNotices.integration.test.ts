// Lifecycle e-mails of the runner against the control plane (druid-internal docs/plan-druid-saas.md, lot 6 d): a failed
// job is told to the member who started it, to the owners when the scheduler did, to nobody when the console did,
// once per series of failures; the ops address hears of the second failure, or of the first one of a platform job;
// the owners of a tenant nobody signed in to for 90 days are told once, again only after a new inactive spell.
// Needs DATABASE_URL (owner) and dbmate; Resend faked (global fetch), handlers faked (no child process).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { enqueueJob } from '../saas/controlPlane';
import { runJobsOnce, scheduleLifecycle, type JobHandler, type RunnerEnv } from '../saas/runner';
import { migrateControlPlane, openSaasDb } from '../saas/tenantDb';

const url = process.env.DATABASE_URL;
const saas = url ? openSaasDb(url) : null;
const SLUG = 'zz-notice-alpha';
const OWNER = 'owner-notice@example.org';
const ADMIN = 'admin-notice@example.org';
const OPS = 'ops-notice@example.org';
const DAY = 86_400_000;

const fail: JobHandler = async () => { throw new Error('child 1: etl\nHTTPError 500 for https://api.example.org/works?api_key=SECRET42'); };
const succeed: JobHandler = async () => {};
const env = (): RunnerEnv => ({ ownerUrl: url!, baseDomain: 'example.org', email: { RESEND_API_KEY: 'test' }, alertEmail: OPS, name: 'notice-runner', log: () => {} });

let sent: { to: string; subject: string; html: string; text: string }[] = [];
const mailsTo = (to: string) => sent.filter((m) => m.to === to);

describe.skipIf(!url)('lifecycle e-mails of the runner', () => {
  let tenantId = '';

  beforeAll(async () => {
    await migrateControlPlane({ ownerUrl: url! });
    await saas!.deleteFrom('tenant').where('slug', '=', SLUG).execute();
    ({ id: tenantId } = await saas!.insertInto('tenant').values({ slug: SLUG, label: 'Notice tenant', schema_name: 't_zz_notice_alpha', status: 'active' } as any)
      .returning('id').executeTakeFirstOrThrow());
    await saas!.insertInto('tenant_host').values({ host: `${SLUG}.example.org`, tenant_id: tenantId } as any).execute();
    await saas!.insertInto('member').values([{ tenant_id: tenantId, email: OWNER, role: 'owner' }, { tenant_id: tenantId, email: ADMIN, role: 'admin' }] as any).execute();
  });
  afterAll(async () => {
    await saas?.deleteFrom('tenant').where('slug', '=', SLUG).execute();
    await saas?.destroy();
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const run = async (type: string, createdBy: string | null, handler: JobHandler, params: Record<string, unknown> = {}) => {
    sent = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init: any) => { sent.push(JSON.parse(init.body)); return new Response('{}'); }));
    await enqueueJob(saas!, { tenantId, type: type as any, params, createdBy });
    return runJobsOnce(saas!, env(), { [type]: handler });
  };

  it('tells the owners of a failed scheduled build, once per series; ops on the second failure', async () => {
    expect((await run('etl.build', 'scheduler', fail)).failed).toBe(1);
    expect(mailsTo(OWNER)).toHaveLength(1);
    expect(mailsTo(OWNER)[0].subject).toContain('Échec : la construction des tableaux de bord');
    expect(mailsTo(OWNER)[0].html).toContain('api_key=***');
    expect(mailsTo(OWNER)[0].html).not.toContain('SECRET42');
    expect(mailsTo(OWNER)[0].text).toContain(`https://${SLUG}.example.org/?page=UNIFIED_ALIGN`);
    expect(mailsTo(ADMIN)).toHaveLength(0);
    expect(mailsTo(OPS)).toHaveLength(0);

    await run('etl.build', 'scheduler', fail);
    expect(mailsTo(OWNER)).toHaveLength(0);
    expect(mailsTo(OPS)).toHaveLength(1);
    expect(mailsTo(OPS)[0].subject).toBe(`[Druid SaaS] ${SLUG}: etl.build failed twice`);

    // A success ends the series: the next failure is told again.
    await run('etl.build', 'scheduler', succeed);
    await run('etl.build', 'scheduler', fail);
    expect(mailsTo(OWNER)).toHaveLength(1);
  });

  it('tells the member who started the job, nobody when the console did', async () => {
    await run('people.align', ADMIN, fail, { source: 'orcid' });
    expect(sent.map((m) => m.to)).toEqual([ADMIN]);
    expect(sent[0].subject).toContain("l'alignement des chercheurs (ORCID)");

    await run('structures.align', 'console-person@example.org', fail);
    expect(sent).toEqual([]);
    await run('structures.align', null, fail);
    expect(mailsTo(OPS)).toHaveLength(1);
    expect(mailsTo(OWNER)).toHaveLength(0);
  });

  it('alerts ops at the first failure of a platform job, tells nobody else', async () => {
    await run('tenant.provision', OWNER, fail);
    expect(sent.map((m) => m.to)).toEqual([OPS]);
    expect(sent[0].subject).toBe(`[Druid SaaS] ${SLUG}: tenant.provision failed`);
  });

  it('tells the owners of an inactive tenant once per inactive spell, in office hours', async () => {
    const now = new Date('2026-11-10T09:00:00Z');
    await saas!.updateTable('tenant').set({ created_at: new Date(now.getTime() - 200 * DAY).toISOString(), inactivity_notified_at: null } as any).where('id', '=', tenantId).execute();
    await saas!.updateTable('member').set({ last_login_at: new Date(now.getTime() - 100 * DAY).toISOString() }).where('tenant_id', '=', tenantId).where('email', '=', OWNER).execute();
    const tick = async (at: Date) => {
      sent = [];
      vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init: any) => { sent.push(JSON.parse(init.body)); return new Response('{}'); }));
      return scheduleLifecycle(saas!, { ...env(), assets: null }, at);
    };

    expect((await tick(new Date('2026-11-10T03:00:00Z'))).inactive).not.toContain(SLUG);
    expect(mailsTo(OWNER)).toHaveLength(0);

    expect((await tick(now)).inactive).toContain(SLUG);
    expect(mailsTo(OWNER)).toHaveLength(1);
    expect(mailsTo(OWNER)[0].subject).toBe('Votre Druid vous attend · Your Druid is waiting for you (Notice tenant)');
    expect(mailsTo(ADMIN)).toHaveLength(0);

    expect((await tick(new Date(now.getTime() + 3600_000))).inactive).not.toContain(SLUG);

    // Signs in the next day, inactive for 90 days again: told again.
    await saas!.updateTable('member').set({ last_login_at: new Date(now.getTime() + DAY).toISOString() }).where('tenant_id', '=', tenantId).where('email', '=', ADMIN).execute();
    expect((await tick(new Date(now.getTime() + 60 * DAY))).inactive).not.toContain(SLUG);
    expect((await tick(new Date(now.getTime() + 92 * DAY))).inactive).toContain(SLUG);
  });
});
