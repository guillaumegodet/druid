// Storage client of the Node jobs and scripts (druid-internal docs/plan-migration-postgresql.md, lot 3): the Grist
// client of the domain API (lib/directory/repository.ts), taken from the server bundle (server-api.cjs, built by
// `npm run build:server` and shipped in the image). One door to the directory for the sync scripts, the scheduled jobs
// and the server routes, so that the storage can change behind it (lot 6).
const path = require('path');

let lib = null;
const load = () => {
  if (!lib) {
    try {
      lib = require(path.join(__dirname, '../../server-api.cjs'));
    } catch (err) {
      throw new Error(`server-api.cjs unavailable (run \`npm run build:server\`): ${err.message}`);
    }
  }
  return lib;
};

/**
 * Grist client configured from the environment. Built on each call (no state; the global fetch is read at that
 * moment): records(table, filter?), tableIds(), columns(table), addRecords, updateRecords, deleteRecords,
 * addColumns, updateColumns, addTables, sql.
 */
const grist = (userAgent) => load().gristClientFromEnv(process.env, userAgent);

/** Client, repository and domain commands (lib/directory/jobStorage.ts), with the command context of a job. */
const jobStorage = (userAgent) => load().jobStorageFromEnv(process.env, userAgent);
const jobContext = (onWrite) => load().jobContext(onWrite);

module.exports = { grist, jobStorage, jobContext };
