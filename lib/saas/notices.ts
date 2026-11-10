/**
 * @file notices.ts
 * @description Lifecycle e-mails of the runner (druid-internal docs/plan-druid-saas.md, lot 6 d). The jobs already tell
 * the establishment when its Druid is ready, its export available or its deletion done, and the Functions send the
 * invitations and the access requests. These rules add:
 *  - a failed job, told to the member who started it (to the owners when the scheduler did), once per series:
 *    the next failures of the same key stay silent until a run succeeds. The ops address keeps its own alert (lot 3 e);
 *  - a tenant nobody signed in to for `INACTIVITY_DAYS` days, told to its owners once per inactive spell.
 */
import { normalizeEmail, type Job, type SaasDb, type Tenant } from './controlPlane';
import { redactSecrets } from './redact';

export const INACTIVITY_DAYS = 90;
const DAY_MS = 86_400_000;

/** Jobs started by the establishment (or the scheduler on its behalf): their failures concern it. */
export const OWNER_NOTIFIED_TYPES: readonly string[] = ['etl.build', 'people.align', 'structures.align', 'tenant.export'];

const SOURCE_NAMES: Record<string, string> = { idref: 'IdRef', orcid: 'ORCID', hal: 'HAL', openalex: 'OpenAlex', scopus: 'Scopus' };

/** What failed, in French and English, as the subject of a sentence (« La construction … a échoué »). */
export const jobLabelOf = (job: Pick<Job, 'type' | 'params'>): [string, string] => {
  const source = SOURCE_NAMES[String((job.params as Record<string, unknown>)?.source || '')] || '';
  switch (job.type) {
    case 'etl.build': return ['La construction des tableaux de bord', 'The build of the dashboards'];
    case 'people.align': return [`L'alignement des chercheurs${source ? ` (${source})` : ''}`, `The alignment of the researchers${source ? ` (${source})` : ''}`];
    case 'structures.align': return ["L'alignement des structures", 'The alignment of the structures'];
    case 'tenant.export': return ["L'export des données", 'The data export'];
    default: return [`La tâche ${job.type}`, `The task ${job.type}`];
  }
};

/** Page of the app where the job is seen and started again. */
export const jobPagePath = (type: string): string => (type === 'tenant.export' ? '/?page=ADMIN&tab=establishment' : '/?page=UNIFIED_ALIGN');

/** Reason given in the e-mail: the last line of the error, secrets masked, 300 characters at most. */
export const failureReason = (message: string): string =>
  redactSecrets(String(message || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(-1)[0] || '').slice(0, 300);

/** The run of the same key just before this job (null for the first one). */
export const previousRunOf = async (saas: SaasDb, job: Pick<Job, 'id' | 'tenant_id' | 'key' | 'created_at'>): Promise<{ status: Job['status'] } | null> =>
  (await saas.selectFrom('job').select('status').where('tenant_id', '=', job.tenant_id).where('key', '=', job.key)
    .where('id', '<>', job.id).where('created_at', '<', job.created_at).orderBy('created_at', 'desc').executeTakeFirst()) || null;

export const ownerEmailsOf = async (saas: SaasDb, tenantId: string): Promise<string[]> =>
  (await saas.selectFrom('member').select('email').where('tenant_id', '=', tenantId).where('role', '=', 'owner').orderBy('created_at').execute()).map((m) => m.email);

/**
 * Who hears of this failure: nobody for the jobs of the platform (provision, deletion: the ops alert covers them),
 * for a tenant being built or deleted, or when the previous run of the key failed already; else the member who
 * started the job, or the owners when it was the scheduler (a job relaunched by the console concerns the console).
 */
export const failureRecipients = async (saas: SaasDb, job: Job, tenant: Pick<Tenant, 'id' | 'status'>): Promise<string[]> => {
  if (!OWNER_NOTIFIED_TYPES.includes(job.type)) return [];
  if (tenant.status !== 'active' && tenant.status !== 'suspended') return [];
  if ((await previousRunOf(saas, job))?.status === 'failed') return [];
  const by = normalizeEmail(job.created_by || '');
  if (by === 'scheduler') return ownerEmailsOf(saas, tenant.id);
  if (!by.includes('@')) return [];
  const member = await saas.selectFrom('member').select('email').where('tenant_id', '=', tenant.id).where('email', '=', by).executeTakeFirst();
  return member ? [member.email] : [];
};

// ── Inactivity ────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface InactiveTenant { id: string; slug: string; label: string; lastActivity: string }

/** Last sign-in of a member, or the creation of the tenant when nobody ever signed in (impersonations do not count). */
export const lastActivityOf = (t: { created_at: string | Date; last_login: string | Date | null }): Date => {
  const created = new Date(t.created_at);
  const login = t.last_login ? new Date(t.last_login) : null;
  return login && login > created ? login : created;
};

/** Is this tenant to be told now? Inactive for `INACTIVITY_DAYS` days, and not told since its last activity. */
export const isInactivityDue = (t: { created_at: string | Date; last_login: string | Date | null; inactivity_notified_at: string | Date | null }, now = new Date()): boolean => {
  const last = lastActivityOf(t);
  if (now.getTime() - last.getTime() < INACTIVITY_DAYS * DAY_MS) return false;
  return !t.inactivity_notified_at || new Date(t.inactivity_notified_at).getTime() < last.getTime();
};

/** Active tenants to tell of their inactivity (a suspended one, or one whose deletion is planned, already knows). */
export const inactiveTenants = async (saas: SaasDb, now = new Date()): Promise<InactiveTenant[]> => {
  const rows = await saas.selectFrom('tenant')
    .select(['tenant.id', 'tenant.slug', 'tenant.label', 'tenant.created_at', 'tenant.inactivity_notified_at'])
    .select((eb) => eb.selectFrom('member').select((sub) => sub.fn.max('member.last_login_at').as('m')).whereRef('member.tenant_id', '=', 'tenant.id').as('last_login'))
    .where('tenant.status', '=', 'active').where('tenant.created_at', '<', new Date(now.getTime() - INACTIVITY_DAYS * DAY_MS).toISOString())
    .orderBy('tenant.created_at').execute();
  return rows.filter((r) => isInactivityDue(r as any, now))
    .map((r) => ({ id: r.id, slug: r.slug, label: r.label, lastActivity: lastActivityOf(r as any).toISOString() }));
};

export const markInactivityNotified = async (saas: SaasDb, tenantId: string, now = new Date()): Promise<void> => {
  await saas.updateTable('tenant').set({ inactivity_notified_at: now.toISOString() }).where('id', '=', tenantId).execute();
};

/** Hours (UTC) in which the inactivity e-mails leave: office hours in Europe, not the middle of the night. */
export const NOTICE_HOURS: [number, number] = [7, 17];
export const inNoticeHours = (now: Date): boolean => now.getUTCHours() >= NOTICE_HOURS[0] && now.getUTCHours() < NOTICE_HOURS[1];
