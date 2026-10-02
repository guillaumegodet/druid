/**
 * Arrivals and departures of staff since a date, for the « Arrivals and departures » tab of the
 * LDAP alignment page (route GET /api/ldap/moves of server.cjs). Live directory searches, like
 * ldap_person.cjs — the full-directory cache (ldap_status_cache.json) is too old for this.
 *
 * Signals, checked on the Nantes directory on 2026-10-02:
 * - arrival = account creation (`createTimestamp`, operational attribute, filtered server-side)
 *   or pre-created account (dynaEtat A, arrival to come). A person coming back with their former
 *   account is not seen.
 * - departure = the {COMPTE} value of `supannRessourceEtatDate` (« {COMPTE}état:sous-état:début:fin »)
 *   entered a grace period (A:SupannSursis), a lock (S:…) or inactivity (I) on or after the date.
 *   Its start date is the date of the state, not of the account: active accounts carry
 *   « A:SupannActif::<fin> » with no start, so this attribute does not date arrivals.
 *
 * Required lazily by server.cjs (ldap_common.cjs exits the process without the LDAP_* variables).
 */
const { BIND_DN, BIND_PW, createLdapClient } = require('./ldap_common.cjs');
const { toPerson, ATTRIBUTES, LDAP_BASE } = require('./ldap_person.cjs');

const STAFF = '(objectClass=supannPerson)(population=PERSONNEL)';
const MOVE_ATTRIBUTES = [...ATTRIBUTES, 'createTimestamp', 'supannRessourceEtatDate'];
const SEARCH_TIMEOUT_MS = 60000;

/** « 2026-09-01 » → « 20260901 » (null when not a valid calendar date). */
function toLdapDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso) return null;
  return `${m[1]}${m[2]}${m[3]}`;
}

/** « 20260831 » / « 20260831000000Z » → « 2026-08-31 » ('' otherwise). */
const isoDay = (s) => {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(String(s || ''));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
};

/** {COMPTE} value of supannRessourceEtatDate → { state, subState, start, end } (null when absent). */
function parseAccountState(values) {
  const raw = (values || []).map(String).find((v) => v.startsWith('{COMPTE}'));
  if (!raw) return null;
  const [state = '', subState = '', start = '', end = ''] = raw.slice('{COMPTE}'.length).split(':');
  return { state, subState, start: isoDay(start), end: isoDay(end) };
}

/** Account state meaning the person left: grace period, lock or inactive — not a pre-created account. */
const isDepartureState = (acc) => !!acc && acc.subState !== 'SupannPrecree'
  && ((acc.state === 'A' && acc.subState === 'SupannSursis') || acc.state === 'S' || acc.state === 'I');

/** Raw LDAP entry → the fields shown in the lists (the creation form re-reads the full entry
 * through /api/ldap/person/:uid) + creation date and account state. */
function toMovePerson(attrs) {
  const multi = {};
  for (const a of attrs) multi[a.type.toLowerCase()] = a.values || [];
  const p = toPerson(attrs);
  return {
    uid: p.uid,
    lastName: p.lastName,
    firstName: p.firstName,
    email: p.email,
    etat: p.etat,
    categorie: p.categorie,
    empCorps: p.empCorps,
    dateFin: p.dateFin,
    affectationCodes: p.affectationCodes,
    affectationPrincipale: p.affectationPrincipale,
    affectationPrincipaleLabel: p.affectationPrincipaleLabel,
    createdAt: isoDay((multi['createtimestamp'] || [])[0]),
    account: parseAccountState(multi['supannressourceetatdate']),
  };
}

/** Paged search over the staff branch; resolves to the converted entries. */
function search(client, filter) {
  return new Promise((resolve, reject) => {
    client.search(LDAP_BASE, { filter, scope: 'sub', paged: true, attributes: MOVE_ATTRIBUTES }, (err, res) => {
      if (err) return reject(err);
      const out = [];
      res.on('searchEntry', (entry) => out.push(toMovePerson(entry.pojo.attributes || [])));
      res.on('error', reject);
      res.on('end', () => resolve(out));
    });
  });
}

/**
 * Arrivals (account created on/after `since`, or pre-created) and departures (account state entered
 * on/after `since`) among the staff. Rejects on an invalid date, bind/search failure or timeout.
 */
async function findLdapMoves(since) {
  const day = toLdapDay(since);
  if (!day) throw new Error('Invalid date');
  const client = createLdapClient();
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('LDAP search timed out')), SEARCH_TIMEOUT_MS); });
  const run = (async () => {
    await new Promise((resolve, reject) => {
      client.on('error', reject);
      client.bind(BIND_DN, BIND_PW, (err) => (err ? reject(err) : resolve()));
    });
    const arrivals = await search(client, `(&${STAFF}(|(createTimestamp>=${day}000000Z)(dynaEtat=A)))`);
    // Substring filters on the state prefix narrow the scan; the date is compared here (no range
    // match on a substring). « { » and « } » need no escaping in an LDAP filter.
    const leaving = await search(client, `(&${STAFF}(|(supannRessourceEtatDate={COMPTE}A:SupannSursis:*)(supannRessourceEtatDate={COMPTE}S:*)(supannRessourceEtatDate={COMPTE}I:*)))`);
    const departures = leaving.filter((p) => isDepartureState(p.account) && p.account.start && p.account.start >= since);
    return { since, arrivals, departures };
  })();
  try {
    return await Promise.race([run, timeout]);
  } finally {
    clearTimeout(timer);
    try { client.unbind(); } catch (e) { /* noop */ }
  }
}

module.exports = { findLdapMoves, parseAccountState, isDepartureState, toLdapDay };
