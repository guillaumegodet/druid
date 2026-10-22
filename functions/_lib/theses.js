// Doctoral theses of a record (druid-internal docs/plan-funding-calls.md, lot 5), read from the PostgreSQL database of
// the instance (lib/thesisStore.ts) by functions/api/researchers/[key]/theses.js and by-row/[rowId]/theses.js — the
// `sendTheses` routes of server.cjs. Every reader of the record reads them; 501 on a Grist instance. No route.
import { createThesisStore } from '../../lib/thesisStore.ts';
import { json } from './saas.js';
import { readerScope } from './scope.js';
import { storageOf } from './storage.js';

export const sendTheses = async (context, lookup) => {
  const { instance, store, missing, release } = storageOf(context);
  try {
    if (missing) return json(500, { error: missing });
    if (store.kind !== 'postgres') return json(501, { error: 'The theses need the PostgreSQL storage' });
    const reader = await readerScope(context, instance, store);
    if (reader.refusal) return reader.refusal;
    const found = await lookup(createThesisStore(store.db));
    if (found instanceof Response) return found;
    if (!found) return json(404, { error: 'No person with this uid' });
    return json(200, found);
  } catch (e) {
    console.error('[theses]', e.message);
    return json(500, { error: e.message });
  } finally {
    await release();
  }
};
