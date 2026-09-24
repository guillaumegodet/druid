/**
 * LDAP bootstrap shared by sync_ldap.cjs, sync_ldap_candidates.cjs and sync_structures_ldap.cjs
 * (same LDAPS host, LDAP_URL): URL, DN/password of the service account,
 * TLS client. Centralized after a drift was found in review (`rejectUnauthorized` missing in
 * two of the three scripts — review lot 4, finding 8 — then the triplication itself flagged in
 * review lot 5 as the cause of that drift).
 */
const fs = require('fs');
const ldap = require('ldapjs');

// Directory host and service account: only through the environment (druid.yaml / stack .env).
const LDAP_URL = process.env.LDAP_URL;
// The .env may prefix the DN with « dn: » (LDIF style) → strip it, otherwise bind fails with « Invalid Dn Syntax ».
const BIND_DN = String(process.env.LDAP_BIND_DN || '').replace(/^\s*dn:\s*/i, '').trim();
if (!LDAP_URL || !BIND_DN) {
  console.error('LDAP_URL / LDAP_BIND_DN missing: set them in the stack .env file (see .env.sample).');
  process.exit(1);
}
// Service account password: only through the environment (LDAP_BIND_PASSWORD,
// .env of the docker stack → druid.yaml, see README) — never hard-coded in the repo.
const BIND_PW = process.env.LDAP_BIND_PASSWORD;
if (!BIND_PW) {
  console.error('LDAP_BIND_PASSWORD missing: set the variable in the stack .env file (see .env.sample).');
  process.exit(1);
}

/** rejectUnauthorized:false: the FortiGate certificate chain is absent from Node's default store
 * (see docker/CLAUDE.md) — same workaround for the three LDAP scripts. */
function createLdapClient() {
  return ldap.createClient({ url: LDAP_URL, tlsOptions: { rejectUnauthorized: false } });
}

/** --key=value CLI argument (same convention as scripts/lib/align_common.cjs::getArg). */
function getArg(name, fallback) {
  const pref = `--${name}=`;
  const hit = process.argv.slice(2).find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : fallback;
}

/** Progress file for the background-job pattern of server.cjs
 * (startBackgroundRun/runningProgress/settleProgress) — sync_ldap.cjs and
 * sync_structures_ldap.cjs have no incremental progress (a single LDAP
 * search, no per-record iteration): just running:true at start,
 * running:false (+ possible error) at the end. Path overridable with
 * --progress= (same tests possible with a temporary file). */
function writeProgress(progressPath, data) {
  try { fs.writeFileSync(progressPath, JSON.stringify(data)); } catch (e) { /* noop */ }
}

module.exports = { LDAP_URL, BIND_DN, BIND_PW, createLdapClient, getArg, writeProgress };
