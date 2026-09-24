// Harvests the structures (entities) from the supann LDAP and produces
// structures_ldap_cache.json (key = supannCodeEntite = Grist local_id).
// Scope: research + components (UMR/UR/ER/UFR/poles). Purely administrative entities are excluded.
const fs = require('fs');
const { BIND_DN, BIND_PW, createLdapClient, getArg, writeProgress } = require('./lib/ldap_common.cjs');
const BASE = 'ou=Structures,dc=univ-nantes,dc=fr';
const PROGRESS_PATH = getArg('progress', 'structures_ldap_progress.json');

// supannTypeEntite ({AGRHUM}…) -> Grist type
const TYPE_MAP = {
  '{AGRHUM}UUMR': 'UMR',
  '{AGRHUM}UUR': 'UR',
  '{AGRHUM}ER': 'ER',
  '{AGRHUM}UUFR': 'UFR',
  '{AGRHUM}UFR': 'UFR',
  '{AGRHUM}UPOLE': 'POLE',
};

const TYPE_FILTER = '(|' + Object.keys(TYPE_MAP).map((t) => `(supannTypeEntite=${t})`).join('') + ')';

const client = createLdapClient();

writeProgress(PROGRESS_PATH, { running: true, startedAt: new Date().toISOString() });
client.bind(BIND_DN, BIND_PW, (err) => {
  if (err) {
    console.error('BIND ERR', err.message);
    writeProgress(PROGRESS_PATH, { running: false, error: err.message, finishedAt: new Date().toISOString() });
    process.exit(1);
  }
  console.log('Bind successful!');
  const opts = {
    filter: `(&(objectClass=supannEntite)${TYPE_FILTER})`,
    scope: 'sub',
    paged: { pageSize: 500, pagePause: false },
    attributes: ['supannCodeEntite', 'ou', 'supannTypeEntite', 'supannCodeEntiteParent'],
  };
  const results = {};
  let n = 0;
  client.search(BASE, opts, (e, res) => {
    if (e) {
      console.error('SEARCH ERR', e.message);
      writeProgress(PROGRESS_PATH, { running: false, error: e.message, finishedAt: new Date().toISOString() });
      process.exit(1);
    }
    res.on('searchEntry', (entry) => {
      const a = {};
      (entry.pojo.attributes || []).forEach((x) => { a[x.type] = x.values; });
      const code = (a['supannCodeEntite'] || [])[0] || '';
      const ou = (a['ou'] || [])[0] || '';
      const ouLeaf = ou.includes('/') ? ou.slice(ou.lastIndexOf('/') + 1).trim() : ou.trim();
      const typeRaw = (a['supannTypeEntite'] || []).find((t) => TYPE_MAP[t]) || '';
      const type = TYPE_MAP[typeRaw] || '';
      const parent = (a['supannCodeEntiteParent'] || [])[0] || '';
      // Key = supannCodeEntite (= Grist local_id). Without a code, no matching is possible.
      if (!code) return;
      results[code] = { code, type, ou, ouLeaf, parent };
      n++;
    });
    res.on('error', (er) => {
      console.error('RES ERR', er.name, er.message, '(harvested:', n, ')');
      const partial = er.name === 'SizeLimitExceededError';
      if (partial) write();
      writeProgress(PROGRESS_PATH, partial
        ? { running: false, total: n, finishedAt: new Date().toISOString() }
        : { running: false, error: `${er.name}: ${er.message}`, finishedAt: new Date().toISOString() });
      client.unbind();
      process.exit(partial ? 0 : 1);
    });
    res.on('end', () => {
      console.log('Total structures:', n);
      write();
      writeProgress(PROGRESS_PATH, { running: false, total: n, finishedAt: new Date().toISOString() });
      client.unbind();
      process.exit(0);
    });
  });
  function write() {
    fs.writeFileSync('structures_ldap_cache.json', JSON.stringify(results, null, 2));
    console.log('File structures_ldap_cache.json generated.');
  }
});
