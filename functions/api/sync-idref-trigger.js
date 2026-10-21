// IdRef run of a tenant (the Qualinka engine, `mode=align` of the unified page): queues a `people.align` job of source
// idref — druid-internal docs/plan-druid-saas.md, lot 3 a. Same query string as server.cjs.
import { peopleAlignParamsOfQuery } from '../../lib/saas/jobs.ts';
import { startJob } from '../_lib/jobs.js';

export async function onRequestGet(context) {
  return startJob(context, 'people.align', peopleAlignParamsOfQuery('idref', new URL(context.request.url).searchParams));
}
