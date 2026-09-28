'use strict';
// Archived report PDFs on disk (docs/plan-mes-rapports.md, lot 9) — the `blobs` of
// createReportsStore on the Nantes server. Separate from reports_store.cjs, which must stay free of
// Node modules (it is also bundled for Cloudflare, where an R2 bucket plays this role).
// The directory must be a volume of the container (docker/druid/druid.yaml), or every rebuild
// would lose the archive.

const fs = require('fs');
const path = require('path');

/** Keys written by reports_store.cjs: `reports/<report id>/<generation id>.pdf`. */
const KEY_RE = /^reports\/\d+\/\d+\.pdf$/;

function fsBlobs(dir) {
  const fileOf = (key) => {
    if (!KEY_RE.test(key)) throw new Error(`Invalid archive key: ${key}`);
    return path.join(dir, key);
  };
  return {
    async put(key, bytes) {
      const file = fileOf(key);
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      // Written aside then renamed: a cut upload never leaves a truncated PDF behind.
      await fs.promises.writeFile(`${file}.part`, bytes);
      await fs.promises.rename(`${file}.part`, file);
    },
    async get(key) {
      try {
        return new Uint8Array(await fs.promises.readFile(fileOf(key)));
      } catch (e) {
        if (e && e.code === 'ENOENT') return null;
        throw e;
      }
    },
    async remove(key) {
      await fs.promises.rm(fileOf(key), { force: true });
    },
  };
}

module.exports = { fsBlobs, KEY_RE };
