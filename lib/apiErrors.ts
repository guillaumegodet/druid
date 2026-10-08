/**
 * @file apiErrors.ts
 * @description Translation of error messages produced outside the React tree: the `error`
 * field of the API JSON responses (`server.cjs`, `functions/`), the `error` text of the
 * progress files written by the alignment scripts, and native errors (`Failed to fetch`).
 * Those messages are English in the code (docs/plan-langue-source-en.md, chantier C); the
 * French rendering lives in `locales/fr/messages.po` like any UI string.
 *
 * How it works: every server message is declared below as a `msg` descriptor so that
 * `lingui extract` keeps it in the catalogs; at display time `translateApiError()` recomputes
 * the Lingui id of the received text (`generateMessageId`, same function as the macro) and
 * looks it up in the active catalog. Unknown texts are returned unchanged. Messages carrying
 * a variable part use the shape `Fixed head: detail` — only the head is translated.
 *
 * `lib/__tests__/apiErrors.test.ts` checks that every `error: '…'` literal of `server.cjs`,
 * `functions/` and the shared server modules of `scripts/lib/` is declared here.
 */
import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { generateMessageId } from '@lingui/message-utils/generateMessageId';

/** Messages sent by server.cjs and functions/ (fixed texts and heads of `Head: detail`). */
export const API_ERRORS = [
  // auth / guards
  msg`Unauthorized`,
  msg`Forbidden`,
  msg`Administrators only`,
  msg`Cross-site request refused`,
  msg`This instance is reserved to administrators`,
  msg`Grist reads outside the lab scope`,
  msg`Invalid slug`,
  msg`Invalid structure slug`,
  msg`Invalid group slug (expected: groupe-…)`,
  msg`Invalid id`,
  msg`Not found`,
  msg`Unknown structure`,
  msg`Unknown Druid instance for this host`,
  // configuration
  msg`ILAAS_API_KEY not configured (druid service env)`,
  msg`ILAAS_API_KEY not configured on Cloudflare (secret + redeploy)`,
  msg`VITE_GRIST_DOC_ID not configured`,
  msg`VITE_GRIST_DOC_ID / GRIST_API_KEY not configured`,
  msg`GRIST_API_KEY not configured`,
  msg`GRIST_API_KEY not configured on Cloudflare`,
  // directory domain API (/api/v1, lib/directory/api.ts)
  msg`Unknown API route`,
  msg`Directory storage unavailable`,
  msg`API v1 unavailable`,
  msg`Invalid record`,
  msg`Invalid Grist ID (gristRowId missing)`,
  msg`Several affiliations can only be saved for a person with a directory identifier (uid_dyna).`,
  msg`This person has other directory rows not yet qualified: resolve them on the Duplicates page before adding an affiliation.`,
  msg`Error saving the groups — does the « groupes » column exist in the Annuaire? (provisioning: node scripts/add_groups_column.cjs --apply)`,
  msg`Error saving the author ID — does the « openalex_author_id » column exist in the Annuaire? (provisioning: node scripts/add_groups_column.cjs --apply)`,
  msg`No OpenAlex identifier configured for this structure`,
  msg`No dashboard data for this structure`,
  // chat / newsletter / analysis
  msg`messages[] required`,
  msg`Assistant unavailable`,
  msg`Help assistant not configured`,
  msg`The newsletter is only available for structures with an OpenAlex identifier (not groups)`,
  msg`Generation interrupted`,
  msg`Generation failed`,
  msg`Analysis failed`,
  msg`Missing theme`,
  msg`No publication to analyze`,
  msg`OpenAlex unreachable`,
  // reports (« Mes rapports », docs/plan-mes-rapports.md — scripts/lib/reports_store.cjs)
  msg`Report not found`,
  msg`Not allowed on this report`,
  msg`Invalid report definition`,
  msg`Report changed since it was loaded`,
  msg`Invalid report share`,
  msg`Invalid report generation`,
  msg`Read-only instance: reports are kept in the browser`,
  msg`Invalid AI task`,
  msg`PDF archiving is not configured on this instance`,
  msg`Invalid PDF`,
  msg`Generation not found`,
  msg`PDF not archived`,
  // career path of a researcher (docs/plan-parcours-affiliations.md, lot 2)
  msg`Invalid record key`,
  msg`Career path not computed yet for this record`,
  msg`Grist unreachable`,
  msg`No Annuaire record for this key`,
  msg`Refresh outside your scope`,
  msg`Too many refreshes in progress, retry in a minute`,
  msg`Career-path computation failed`,
  msg`No usable identifier for this record`,
  msg`Unknown suggestion`,
  // tasks (« À traiter › Tâches », docs/plan-chantiers-taches.md)
  msg`Task not found`,
  msg`Unknown event action`,
  msg`Empty comment`,
  msg`Nothing to update`,
  msg`Unknown task type`,
  msg`Unknown status`,
  msg`Transition not allowed`,
  msg`Task detection already running`,
  // groups, media
  msg`Name required`,
  msg`Empty list`,
  msg`List of identifiers expected`,
  msg`Invalid mention identifier`,
  msg`Invalid source identifier`,
  msg`researchers and structures arrays required`,
  msg`Keycloak admin API unreachable`,
  msg`ETL API (druid-etl-api) unreachable`,
  // Grist proxy
  msg`Grist path not allowed by the proxy`,
  msg`Writing to the document root is refused`,
  msg`Writing to the table definition is refused`,
  msg`Method not relayed`,
  msg`Method not relayed on /tables`,
  msg`Table creation not allowed`,
  msg`Table not writable through the proxy`,
  msg`Write outside scope`,
  msg`Creation outside scope`,
  msg`Rows outside scope or unknown`,
  msg`Scope check failed`,
  msg`Grist writes require the institution right`,
  msg`Grist writes require an authenticated user (Cloudflare Access)`,
  msg`Read-only instance: writes are disabled`,
  msg`Newsletter not available on this instance`,
  msg`Missing id for PATCH`,
  msg`Invalid Grist identifiers`,
  msg`Body with a records array expected`,
  // server jobs
  msg`An LDAP synchronization is already running`,
  msg`An LDAP structures synchronization is already running`,
  msg`An LDAP search is already running`,
  msg`An IdRef alignment is already running`,
  msg`Alignment already running`,
  msg`Unknown alignment source`,
  msg`No alignment running`,
  msg`No run yet`,
  // single-person LDAP lookup (researcher creation form)
  msg`LDAP not configured on this instance`,
  msg`Invalid uid`,
  msg`No LDAP entry for this uid`,
  msg`LDAP directory unreachable`,
  // LDAP arrivals and departures since a date
  msg`Invalid date`,
  // inter-lab « Réseau » (docs/plan-reseau-inter-labos.md)
  msg`No network data`,
  msg`Unreadable network data`,
  msg`Structure not in the university network`,
  msg`Invalid node ids`,
  // browser / network
  msg`Failed to fetch`,
  msg`NetworkError when attempting to fetch resource.`,
  msg`Load failed`,
];

const lookup = (text: string): string => (i18n.locale ? i18n._({ id: generateMessageId(text), message: text }) : text);

/**
 * Returns the translation of an error text received from the API (or a script progress
 * file) in the active language, or the text itself when it is unknown. `Head: detail`
 * messages get their head translated and keep the detail.
 */
export function translateApiError(text: string): string {
  if (!text) return text;
  const exact = lookup(text);
  if (exact !== text) return exact;
  const sep = text.indexOf(': ');
  if (sep > 0) {
    const head = text.slice(0, sep);
    const tr = lookup(head);
    if (tr !== head) return `${tr}: ${text.slice(sep + 2)}`;
  }
  return text;
}

/** Message of any thrown value, translated when it comes from the API; empty string otherwise. */
export function apiErrorText(err: unknown): string {
  const m = err instanceof Error ? err.message : typeof err === 'string' ? err : (err as { message?: unknown } | null)?.message;
  return m ? translateApiError(String(m)) : '';
}
