#!/usr/bin/env node
// Validates the instance registry (docs/plan-architecture-multi-instances.md, lot 5):
// every <dir>/<slug>/instance.json, against scripts/instances/instanceConfig.cjs.
//  - instances/ of this repository is PUBLIC: its instance.json files also follow the public rules
//    (read-only, public access, public doc, no admins);
//  - the private repository guillaumegodet/druid-instances is checked when its clone is given with
//    INSTANCES_DIR (or --private <dir>).
// A folder without instance.json is only reported (transition: the build keeps its current
// behaviour for it). Exit 1 on the first invalid file, after listing them all.
//
// Usage:
//   docker run --rm -v "$PWD":/app -w /app node:20-slim node scripts/instances/validate.cjs
//   with the private instances: add -v /opt/crisalid/work/druid-instances:/instances:ro -e INSTANCES_DIR=/instances
const fs = require('fs');
const path = require('path');
const { parseInstanceConfig, publicRepoErrors } = require('./instanceConfig.cjs');

const args = process.argv.slice(2);
const privateArg = args.indexOf('--private');
const privateDir = privateArg >= 0 ? args[privateArg + 1] : process.env.INSTANCES_DIR;
// Folders of druid-instances that are not instances.
const NOT_INSTANCES = new Set(['publication']);
const roots = [{ dir: path.join(__dirname, '..', '..', 'instances'), isPublic: true }];
if (privateDir) roots.push({ dir: path.resolve(privateDir), isPublic: false });

/** Validates every instance folder of one root; returns the number of invalid files. */
const validateRoot = ({ dir, isPublic }) => {
  if (!fs.existsSync(dir)) {
    console.error(`KO  ${dir}: folder not found`);
    return 1;
  }
  let invalid = 0;
  const folders = fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^[a-z0-9-]+$/.test(d.name) && !NOT_INSTANCES.has(d.name))
    .map((d) => d.name)
    .sort();
  for (const folder of folders) {
    const file = path.join(dir, folder, 'instance.json');
    if (!fs.existsSync(file)) {
      console.log(`--  ${folder}: no instance.json`);
      continue;
    }
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      console.error(`KO  ${folder}: invalid JSON (${err.message})`);
      invalid++;
      continue;
    }
    const result = parseInstanceConfig(raw, { folder });
    const errors = result.ok ? [] : result.errors;
    if (isPublic) errors.push(...publicRepoErrors(raw));
    if (errors.length) {
      console.error(`KO  ${folder}${isPublic ? ' (public repository)' : ''}:\n${errors.map((e) => `      - ${e}`).join('\n')}`);
      invalid++;
    } else {
      console.log(`ok  ${folder} (${result.config.target}, ${result.config.access}${result.config.readOnly ? ', read-only' : ''})`);
    }
  }
  return invalid;
};

let invalid = 0;
for (const root of roots) {
  console.log(`${root.dir}${root.isPublic ? ' (public)' : ' (private)'}`);
  invalid += validateRoot(root);
}
if (!privateDir) console.log('Private instances not checked (set INSTANCES_DIR to the druid-instances clone).');
process.exit(invalid ? 1 : 0);
