// Cloudflare Pages Function — `GET /api/researchers/by-row/:rowId/theses`: theses of the person of a directory row
// (a record without uid has only its rows), functions/_lib/theses.js.
import { json } from '../../../../_lib/saas.js';
import { sendTheses } from '../../../../_lib/theses.js';

export const onRequestGet = (context) => {
  const rowId = Number(context.params.rowId);
  if (!Number.isInteger(rowId) || rowId <= 0) return json(400, { error: 'Invalid record key' });
  return sendTheses(context, (store) => store.thesesOfRow(rowId));
};
