// « Stop » of the IdRef run of a tenant — lot 3 a.
import { stopJob } from '../_lib/jobs.js';

export async function onRequestPost(context) {
  return stopJob(context, 'people.align', { source: 'idref' });
}
