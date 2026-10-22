// Reader of a PostgreSQL-only route (calls for proposals, theses): who reads (`viewer`, named after the instance for the
// anonymous reader of a public one), whether they hold the institution right (`all`) and, for a lab right, the directory
// uids they may see (`uids`, undefined = every record). The Cloudflare instances have no lab scope (functions/api/me.js);
// a tenant of the control plane needs a member session and follows the member's role, as server.cjs follows the Keycloak
// groups (callsUidsOf). No route.
import { accessForMember } from '../../lib/saas/controlPlane.ts';
import { identityOf, memberOf } from './identity.js';
import { json } from './saas.js';

export const readerScope = async (context, instance, store) => {
  if (!instance.tenant) return { viewer: identityOf(context) || instance.slug, all: true, uids: undefined };
  const identity = identityOf(context);
  const member = memberOf(context);
  if (!identity || !member) return { refusal: json(identity ? 403 : 401, { error: identity ? 'This account is not a member of this Druid' : 'Authentication required' }) };
  const { scope } = accessForMember(member, instance.readOnly);
  if (scope.all) return { viewer: identity, all: true, uids: undefined };
  if (!scope.labAnchors.length) return { viewer: identity, all: false, uids: [] };
  const { items } = await store.repository.people({ all: false, labAnchors: scope.labAnchors });
  return { viewer: identity, all: false, uids: items.map((r) => r.uid).filter(Boolean) };
};

/** Answer with a UTF-8 CSV file (semicolon separated, BOM for the spreadsheets). */
export const csv = (filename, head, rows) => {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [head.join(';'), ...rows.map((r) => r.map(cell).join(';'))];
  return new Response(`﻿${lines.join('\r\n')}\r\n`, {
    status: 200,
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' },
  });
};
