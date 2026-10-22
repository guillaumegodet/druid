// Cloudflare Pages Function — `GET /api/researchers/:key/theses`: theses of the person of a directory uid
// (functions/_lib/theses.js).
import { json } from '../../../_lib/saas.js';
import { sendTheses } from '../../../_lib/theses.js';

export const onRequestGet = (context) => {
  const key = String(context.params.key || '');
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(key)) return json(400, { error: 'Invalid record key' });
  return sendTheses(context, (store) => store.thesesOfUid(key));
};
