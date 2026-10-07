const fs = require('fs');
const { BIND_DN, BIND_PW, createLdapClient, getArg, writeProgress, extractDateFin } = require('./lib/ldap_common.cjs');

const PROGRESS_PATH = getArg('progress', 'ldap_status_progress.json');
const client = createLdapClient();

async function syncAllStatuses() {
    writeProgress(PROGRESS_PATH, { running: true, startedAt: new Date().toISOString() });
    return new Promise((resolve, reject) => {
        client.bind(BIND_DN, BIND_PW, (err) => {
            if (err) return reject(err);
            console.log('Bind successful!');

            const opts = {
                filter: '(&(objectClass=supannPerson)(population=PERSONNEL))',
                scope: 'sub',
                attributes: ['uid', 'dynaEtat', 'dynaCategorie', 'supannEmpCorps', 'supannCivilite', 'supannOIDCDateDeNaissance', 'eduPersonPrincipalName', 'supannEmpProfil', 'supannEmpId'],
            };

            const results = {};
            const stats = {};

            client.search('ou=People,dc=univ-nantes,dc=fr', opts, (err, res) => {
                if (err) return reject(err);

                res.on('searchEntry', (entry) => {
                    const attrs = entry.pojo.attributes || [];
                    let p = {};
                    const multi = {};
                    attrs.forEach(a => {
                        const type = a.type.toLowerCase();
                        p[type] = a.values[0];
                        multi[type] = a.values;
                    });

                    const uid = p['uid'];
                    const etat = p['dynaetat'];
                    const categorie = p['dynacategorie'];
                    const empCorpsRaw = p['supannempcorps'] || '';
                    const empCorps = empCorpsRaw.replace(/^\{[^}]+\}/, '');
                    const civilite = p['supanncivilite'];
                    const birthDate = p['supannoidcdatedenaissance'];
                    const eppn = p['edupersonprincipalname'] || '';
                    // Employment end: supannEmpProfil (multi-valued, one profile per contract) carries
                    // « [datefin=AAAAMMJJhhmmssZ] ». A single date is kept: the latest one, and
                    // only if ALL profiles have one (otherwise an open-ended contract is ongoing).
                    const dateFin = extractDateFin(multi['supannempprofil'] || []);
                    // HR staff number (Mangue) — the stable key between HR lists and the Annuaire (lib/hrId.ts).
                    const empId = String(p['supannempid'] || '').trim();

                    if (uid) {
                        results[uid] = {
                          etat: etat || 'N/A',
                          categorie: categorie || '',
                          empCorps: empCorps || '',
                          civilite: civilite || '',
                          birthDate: birthDate || '',
                          eppn: eppn,
                          dateFin: dateFin,
                          empId: empId,
                        };
                        stats[etat] = (stats[etat] || 0) + 1;
                    }
                });

                res.on('error', (err) => {
                    console.error('Search error:', err);
                });

                res.on('end', (result) => {
                    console.log('Search end. Total found:', Object.keys(results).length);
                    console.log('Stats by dynaEtat:', stats);
                    fs.writeFileSync('ldap_status_cache.json', JSON.stringify(results, null, 2));
                    console.log(`File ldap_status_cache.json generated.`);
                    writeProgress(PROGRESS_PATH, { running: false, total: Object.keys(results).length, finishedAt: new Date().toISOString() });
                    client.unbind();
                    resolve(results);
                });
            });
        });
    });
}

// Without an explicit exitCode here, a failure (bind/search KO) exited with code 0: execSync on the
// server side (before lot 2) never saw it as an error, and the background job
// (startBackgroundRun) could not distinguish success from silent failure either.
syncAllStatuses().catch((err) => {
    console.error(err);
    writeProgress(PROGRESS_PATH, { running: false, error: err.message, finishedAt: new Date().toISOString() });
    process.exitCode = 1;
});
