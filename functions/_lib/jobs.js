// Jobs of a tenant from the Functions (druid-internal docs/plan-druid-saas.md, lot 3 a): the rights (owner and admin
// start and stop runs; every member reads the progress), the enqueue with the existing live job as a 409, the progress
// in the shape of the progress files of server.cjs. The runner (lib/saas/runner.ts) does the work; the Functions only
// write rows of saas.job.
import { enqueueUserJob, isUserJobType, jobKeyOf, latestJobOfKey, legacyProgressOf, listJobs, parseJobParams, requestCancel } from '../../lib/saas/jobs.ts';
import { findJob, publicJobInfo } from '../../lib/saas/controlPlane.ts';
import { instanceOf } from './instance.js';
import { identityOf, memberOf } from './identity.js';
import { json, withSaasDb } from './saas.js';

/** Tenant and member of the request, or the refusal: 404 outside a tenant, 401 without session, 403 without membership. */
export const tenantMember = (context) => {
  const instance = instanceOf(context);
  if (!instance?.tenant) return { refusal: json(404, { error: 'Not found' }) };
  const identity = identityOf(context);
  const member = memberOf(context);
  if (!identity || !member) return { refusal: json(identity ? 403 : 401, { error: identity ? 'This account is not a member of this Druid' : 'Authentication required' }) };
  return { instance, identity, member };
};

/** May this member start or stop a run: the establishment roles, on an active tenant. */
export const mayRun = (instance, member) => !instance.readOnly && (member.role === 'owner' || member.role === 'admin');

const ALREADY = { 'people.align': (p) => `Alignment already running: ${String(p.source || '').toUpperCase()}`, 'structures.align': () => 'Structure alignment already running', 'etl.build': () => 'Dashboard build already running' };

/** Queues a job for the tenant of the request: 202 with the job, 409 with the live one, 400 on bad params. */
export const startJob = async (context, type, rawParams) => {
  const t = tenantMember(context);
  if (t.refusal) return t.refusal;
  if (!mayRun(t.instance, t.member)) return json(403, { error: t.instance.readOnly ? 'Read-only instance: writes are disabled' : 'Institution right required' });
  if (!isUserJobType(type)) return json(400, { error: `Unknown job type: ${type}` });
  const parsed = parseJobParams(type, rawParams);
  if (!parsed.ok) return json(400, { error: 'Invalid request', issues: parsed.issues });
  return withSaasDb(context.env, async (db) => {
    const { job, created } = await enqueueUserJob(db, { tenantId: t.instance.tenant.id, type, params: parsed.params, createdBy: t.identity });
    if (!created) return json(409, { error: (ALREADY[type] || (() => 'Job already running'))(parsed.params), progress: legacyProgressOf(job), job: publicJobInfo(job) });
    return json(202, { started: true, queued: true, ...parsed.params, job: publicJobInfo(job) });
  });
};

/** Progress of the newest job of a key (the shape the alignment pages poll). */
export const jobProgress = async (context, type, params) => {
  const t = tenantMember(context);
  if (t.refusal) return t.refusal;
  return withSaasDb(context.env, async (db) => json(200, legacyProgressOf(await latestJobOfKey(db, t.instance.tenant.id, jobKeyOf(type, params)))));
};

/** « Stop » of the live job of a key: 404 when none runs. */
export const stopJob = async (context, type, params) => {
  const t = tenantMember(context);
  if (t.refusal) return t.refusal;
  if (!mayRun(t.instance, t.member)) return json(403, { error: 'Institution right required' });
  return withSaasDb(context.env, async (db) => {
    const live = await latestJobOfKey(db, t.instance.tenant.id, jobKeyOf(type, params));
    if (!live || (live.status !== 'queued' && live.status !== 'running')) return json(404, { error: 'No alignment running' });
    const outcome = await requestCancel(db, live.id, t.instance.tenant.id);
    return json(200, { stopping: true, outcome, job: publicJobInfo((await findJob(db, live.id)) || live) });
  });
};

export const jobsOfTenant = async (context, limit) => {
  const t = tenantMember(context);
  if (t.refusal) return t.refusal;
  return withSaasDb(context.env, async (db) => json(200, { jobs: (await listJobs(db, t.instance.tenant.id, limit)).map(publicJobInfo) }));
};

export const oneJob = async (context, id) => {
  const t = tenantMember(context);
  if (t.refusal) return t.refusal;
  return withSaasDb(context.env, async (db) => {
    const job = await findJob(db, id);
    if (!job || job.tenant_id !== t.instance.tenant.id) return json(404, { error: 'Not found' });
    return json(200, { job: publicJobInfo(job), progress: legacyProgressOf(job) });
  });
};

export const cancelOneJob = async (context, id) => {
  const t = tenantMember(context);
  if (t.refusal) return t.refusal;
  if (!mayRun(t.instance, t.member)) return json(403, { error: 'Institution right required' });
  return withSaasDb(context.env, async (db) => {
    const job = await findJob(db, id);
    if (!job || job.tenant_id !== t.instance.tenant.id) return json(404, { error: 'Not found' });
    const outcome = await requestCancel(db, job.id, t.instance.tenant.id);
    if (!outcome) return json(409, { error: 'Job already finished', job: publicJobInfo(job) });
    return json(200, { outcome, job: publicJobInfo((await findJob(db, job.id)) || job) });
  });
};

export const readJsonBody = async (request) => {
  try { return (await request.json()) || {}; } catch { return null; }
};
