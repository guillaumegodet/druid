// Progress of the newest IdRef run of a tenant (lib/unifiedAlignRuns.ts polls it) — lot 3 a.
import { jobProgress } from '../_lib/jobs.js';

export async function onRequestGet(context) {
  return jobProgress(context, 'people.align', { source: 'idref' });
}
