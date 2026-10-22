// Cloudflare Pages Function — « Calls for proposals » (druid-internal docs/plan-funding-calls.md): the read routes of
// server.cjs on the PostgreSQL database of the instance (lib/calls/pg.ts, lib/calls/eligibilityStore.ts), 501 on a
// Grist instance.
//   GET  /api/calls/overview | programmes | calls | matches[?call=]       every reader (lab right: its records only)
//   POST /api/calls/feedback { pairId, verdict, comment }                 identified reader, not on a read-only instance
//   GET  /api/calls/feedback.csv                                          institution right
//   GET  /api/calls/eligibility | eligibility/:callId[?format=csv]        institution right
// The collectors, the matching batch and the administration of the programmes stay on the Node server (no child process
// here): the calls of a Cloudflare instance are imported with its data (seed of the demo) or by a job of the runner.
import { createEligibilityStore } from '../../../lib/calls/eligibilityStore.ts';
import { createCallsStore } from '../../../lib/calls/pg.ts';
import { identityOf } from '../../_lib/identity.js';
import { json } from '../../_lib/saas.js';
import { csv, readerScope } from '../../_lib/scope.js';
import { storageOf } from '../../_lib/storage.js';

const CALL_ID = /^[A-Za-z0-9._-]{1,120}$/;
const VERDICTS = new Set(['relevant', 'not_relevant', 'already_applying']);

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const action = url.pathname.replace(/^\/api\/calls\/?/, '').replace(/\/$/, '');
  const { instance, store, missing, release } = storageOf(context);
  try {
    if (missing) return json(500, { error: missing });
    if (store.kind !== 'postgres') return json(501, { error: 'The calls for proposals need the PostgreSQL storage' });
    const reader = await readerScope(context, instance, store);
    if (reader.refusal) return reader.refusal;
    const calls = createCallsStore(store.db);
    const eligibility = createEligibilityStore(store.db);

    if (request.method === 'GET') {
      if (action === 'overview') return json(200, await calls.overview());
      if (action === 'programmes') return json(200, { items: await calls.programmes() });
      if (action === 'calls') return json(200, { items: await calls.calls(), perimeters: await calls.perimeters() });
      if (action === 'matches') {
        const callId = url.searchParams.get('call') || undefined;
        if (callId && !CALL_ID.test(callId)) return json(400, { error: 'Invalid call id' });
        return json(200, { items: await calls.matches({ uids: reader.uids, callId, viewer: reader.viewer }) });
      }
      if (action === 'feedback.csv') {
        if (!reader.all) return json(403, { error: 'Forbidden' });
        const head = ['pair_id', 'programme_id', 'engine', 'call_id', 'person_uid', 'overall', 'score', 'verdict', 'comment', 'author', 'created_at'];
        return csv('calls-feedback.csv', head, (await calls.feedbackRows()).map((r) => head.map((k) => r[k])));
      }
      if (action === 'eligibility') {
        if (!reader.all) return json(403, { error: 'Forbidden' });
        return json(200, { rules: await eligibility.rules() });
      }
      const one = /^eligibility\/([^/]+)$/.exec(action);
      if (one) {
        if (!reader.all) return json(403, { error: 'Forbidden' });
        const callId = decodeURIComponent(one[1]);
        if (!CALL_ID.test(callId)) return json(400, { error: 'Invalid call id' });
        const rule = (await eligibility.rules()).find((r) => r.callId === callId);
        if (!rule) return json(404, { error: 'Unknown call' });
        const candidates = await eligibility.candidates(callId);
        if (url.searchParams.get('format') === 'csv') {
          return csv(`candidates-${callId.toLowerCase()}.csv`, ['call_id', 'uid', 'name', 'units', 'grade', 'phd', 'verdict', 'reasons'],
            candidates.map((c) => [c.callId, c.uid, c.personName, c.units.join(' | '), c.grade, c.phdOn, c.verdict, c.reasons.join(' ')]));
        }
        return json(200, { rule, candidates });
      }
    }

    if (request.method === 'POST' && action === 'feedback') {
      if (instance.readOnly) return json(403, { error: 'Read-only instance: writes are disabled' });
      const identity = identityOf(context);
      if (!identity && !(!instance.shared && env.ALLOW_ANONYMOUS_WRITES === 'true')) return json(403, { error: 'Writes require an authenticated user (Cloudflare Access)' });
      let body;
      try { body = (await request.json()) || {}; } catch { return json(400, { error: 'Invalid pair id' }); }
      const { pairId, verdict } = body;
      const comment = typeof body.comment === 'string' ? body.comment.slice(0, 2000) : '';
      if (typeof pairId !== 'string' || !/^[A-Za-z0-9._-]{1,120}\|[^|]{1,200}$/.test(pairId)) return json(400, { error: 'Invalid pair id' });
      if (!VERDICTS.has(verdict)) return json(400, { error: 'Invalid verdict' });
      // The pair must be visible to its author (same rule as the reads).
      const uid = pairId.split('|')[1].replace(/^local-/, '');
      if (reader.uids && !reader.uids.includes(uid)) return json(403, { error: 'Forbidden' });
      const saved = await calls.saveFeedback({ pairId, author: identity || 'anonymous', verdict, comment });
      return saved ? json(200, { ok: true }) : json(404, { error: 'Unknown pair' });
    }

    return json(404, { error: 'Not found' });
  } catch (e) {
    console.error('[calls]', e.message);
    return json(500, { error: e.message });
  } finally {
    await release();
  }
}
