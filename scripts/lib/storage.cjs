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
 * Tables of the directory, configured from the environment: the Grist client of the document, or with
 * DRUID_STORAGE=postgres the migrated tables seen as that document (lot 6 f) — records(table, filter?), tableIds(),
 * columns(table), addRecords, updateRecords, deleteRecords, addColumns, updateColumns, addTables, sql. Built on each
 * call (the PostgreSQL pool is shared by the process; the global fetch is read at that moment).
 */
const grist = (userAgent) => load().tablesFromEnv(process.env, userAgent);
/** Storage of the directory: 'grist' or 'postgres'. */
const kind = () => load().storageKindFromEnv(process.env);
/** Closes the PostgreSQL pool (end of a job). */
const close = () => load().closeDatabases();

/** Client, repository and domain commands (lib/directory/jobStorage.ts), with the command context of a job. */
const jobStorage = (userAgent) => load().jobStorageFromEnv(process.env, userAgent);
const jobContext = (onWrite) => load().jobContext(onWrite);

module.exports = { grist, kind, close, jobStorage, jobContext };
