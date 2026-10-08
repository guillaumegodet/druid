// Cloudflare Pages Function — former Grist proxy of the browser, closed (druid-internal
// docs/plan-migration-postgresql.md, lot 2 g): every read and write goes through the domain API
// (functions/api/v1). An explicit answer, so that a stale client never gets the SPA page instead.
export async function onRequest() {
  return new Response(JSON.stringify({ error: 'Grist proxy removed: use /api/v1' }), {
    status: 410,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
