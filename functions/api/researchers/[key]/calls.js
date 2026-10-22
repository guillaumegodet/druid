// Cloudflare Pages Function — « Calls for proposals » card of a record (druid-internal docs/plan-funding-calls.md, lot
// 7 a): `GET /api/researchers/:key/calls` of server.cjs — the matches of the person, the calls they point to, the
// programmes, and (institution right) the calls the person is eligible to by career stage. PostgreSQL instances only.
import { createEligibilityStore } from '../../../../lib/calls/eligibilityStore.ts';
import { createCallsStore } from '../../../../lib/calls/pg.ts';
import { json } from '../../../_lib/saas.js';
import { readerScope } from '../../../_lib/scope.js';
import { storageOf } from '../../../_lib/storage.js';

const KEY_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export async function onRequestGet(context) {
  const key = String(context.params.key || '');
  if (!KEY_RE.test(key)) return json(400, { error: 'Invalid record key' });
  const { instance, store, missing, release } = storageOf(context);
  try {
    if (missing) return json(500, { error: missing });
    if (store.kind !== 'postgres') return json(501, { error: 'The calls for proposals need the PostgreSQL storage' });
    const reader = await readerScope(context, instance, store);
    if (reader.refusal) return reader.refusal;
    const calls = createCallsStore(store.db);
    // `g<row>`: a record without uid, found by its directory row; it has no match (the engines name a uid).
    const byRow = /^g(\d+)$/.exec(key);
    const hidden = !!byRow || (reader.uids && !reader.uids.includes(key));
    const matches = hidden ? [] : await calls.matches({ uids: [key], viewer: reader.viewer });
    const eligibility = reader.all ? await createEligibilityStore(store.db).ofPerson(byRow ? { rowId: Number(byRow[1]) } : { uid: key }) : null;
    const callIds = new Set(matches.map((m) => m.callId));
    return json(200, {
      calls: callIds.size ? (await calls.calls()).filter((c) => callIds.has(c.callId)) : [],
      programmes: await calls.programmes(),
      matches,
      eligibility,
    });
  } catch (e) {
    console.error('[calls]', e.message);
    return json(500, { error: e.message });
  } finally {
    await release();
  }
}
