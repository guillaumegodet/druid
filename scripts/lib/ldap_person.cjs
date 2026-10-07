/**
 * Single-person LDAP lookup by uid, for the « Fill from LDAP » button of the researcher
 * creation form (route GET /api/ldap/person/:uid of server.cjs). Same directory, bind and
 * attribute conventions as sync_ldap.cjs / sync_ldap_candidates.cjs, but one live search
 * instead of a full-directory cache — the person may be too recent for ldap_status_cache.json.
 *
 * Required lazily by server.cjs, only when the LDAP_* variables are set: ldap_common.cjs
 * exits the process when they are missing.
 */
const { BIND_DN, BIND_PW, createLdapClient, extractDateFin } = require('./ldap_common.cjs');

const LDAP_BASE = 'ou=People,dc=univ-nantes,dc=fr';
/** Directory uids (« dupont-j », « durand-p2 »…): anything else is refused
 * before reaching the filter (no LDAP filter injection). */
const UID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const ATTRIBUTES = ['uid', 'sn', 'givenName', 'mail', 'supannCivilite', 'supannOIDCDateDeNaissance',
  'eduPersonPrincipalName', 'dynaEtat', 'dynaCategorie', 'supannEmpCorps', 'supannEmpProfil', 'supannEmpId', 'supannRefId',
  'supannEtablissement', 'population', 'supannEntiteAffectation', 'supannEntiteAffectationPrincipale',
  'entiteAffectationLibelle', 'entiteAffectationPrincipaleLibelle'];

const isValidUid = (uid) => UID_RE.test(String(uid || ''));

/** Raw LDAP entry → plain record (single values, except the affectation lists). */
function toPerson(attrs) {
  const multi = {};
  for (const a of attrs) multi[a.type.toLowerCase()] = a.values || [];
  const first = (k) => String((multi[k] || [])[0] || '').trim();
  return {
    uid: first('uid'),
    lastName: first('sn'),
    firstName: first('givenname'),
    email: first('mail'),
    civilite: first('supanncivilite'),
    birthDate: first('supannoidcdatedenaissance'),
    eppn: first('edupersonprincipalname'),
    etat: first('dynaetat'),
    categorie: first('dynacategorie'),
    empCorps: first('supannempcorps').replace(/^\{[^}]+\}/, ''),
    dateFin: extractDateFin(multi['supannempprofil'] || []),
    empId: first('supannempid'),
    // Hosting tools only (« {TOOL}CNRS255 »): they tell who opened the account (lib/ldapEmployer.ts);
    // the other references (HR, student numbers) are not passed on.
    toolRefs: (multi['supannrefid'] || []).map(String).filter((v) => /^\{TOOL\}/i.test(v)),
    etablissementUai: first('supannetablissement').replace(/^\{[^}]+\}/, ''),
    population: first('population'),
    affectationCodes: (multi['supannentiteaffectation'] || []).map(String),
    affectationPrincipale: first('supannentiteaffectationprincipale'),
    affectationLabels: (multi['entiteaffectationlibelle'] || []).map(String),
    affectationPrincipaleLabel: first('entiteaffectationprincipalelibelle'),
  };
}

/** Resolves to the person, or null when the uid is unknown. Rejects on bind/search failure or timeout. */
function lookupLdapPerson(uid) {
  if (!isValidUid(uid)) return Promise.reject(new Error('Invalid uid'));
  return new Promise((resolve, reject) => {
    const client = createLdapClient();
    let settled = false;
    const done = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { client.unbind(); } catch (e) { /* noop */ }
      if (err) reject(err); else resolve(value);
    };
    const timer = setTimeout(() => done(new Error('LDAP lookup timed out')), 10000);
    client.on('error', (err) => done(err));
    client.bind(BIND_DN, BIND_PW, (err) => {
      if (err) return done(err);
      const opts = { filter: `(&(objectClass=supannPerson)(uid=${uid}))`, scope: 'sub', attributes: ATTRIBUTES, sizeLimit: 2 };
      client.search(LDAP_BASE, opts, (err2, res) => {
        if (err2) return done(err2);
        let person = null;
        res.on('searchEntry', (entry) => { if (!person) person = toPerson(entry.pojo.attributes || []); });
        res.on('error', (err3) => done(err3));
        res.on('end', () => done(null, person));
      });
    });
  });
}

module.exports = { lookupLdapPerson, isValidUid, toPerson, ATTRIBUTES, LDAP_BASE };
