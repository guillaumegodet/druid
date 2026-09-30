// Instance registry (docs/plan-architecture-multi-instances.md, lot 5): every instance is described
// by instances/<slug>/instance.json — never a secret, only the NAMES of the secrets it needs.
// The folder lives in this repository for instances without personal data (demo), in the private
// repository guillaumegodet/druid-instances otherwise (Centrale, Nantes).
//
// CommonJS so that scripts/prepare-cloudflare-assets.cjs (build) and the CLI validator
// (scripts/instances/validate.cjs) can require it; the Functions receive the registry already validated
// by the build (functions/_generated/registry.js, lots 5 b and 6 b), they do not import this module.
const { z } = require('zod');

// Capabilities an instance may set itself. The others are structural: fixed to false on
// Cloudflare (functions/api/me.js::CAPABILITIES), derived from the config present in server.cjs.
const TUNABLE_CAPABILITIES = ['HAS_STATUS_VALIDATION'];
// Every capability exposed by /api/me: a `docker` instance lists the ones it EXPECTS, compared to
// /api/me by the drift check (lot 5 e).
const ALL_CAPABILITIES = [
  'HAS_LDAP', 'HAS_KEYCLOAK_ADMIN', 'HAS_ETL_API', 'HAS_PIPELINES_CHAT', 'HAS_HELP_CHAT',
  'HAS_SOVISU_EXPORT', 'HAS_SERVER_JOBS', 'HAS_BENCHMARK', 'HAS_QUALINKA', 'HAS_STATUS_VALIDATION',
  'HAS_TASKS', 'HAS_NETWORK_API',
];

const SLUG_RE = /^[a-z0-9-]+$/;
const GRIST_DOC_RE = /^[A-Za-z0-9]{10,}$/;
const HOST_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]*$/;
// Name of a shared deployment = its Cloudflare Pages project name (lowercase, digits, dashes, ≤ 58).
const DEPLOYMENT_RE = /^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/;
const DEFAULT_GRIST_API_BASE = 'https://grist.numerique.gouv.fr/api';

const capabilitiesSchema = z.strictObject(Object.fromEntries(ALL_CAPABILITIES.map((k) => [k, z.boolean().optional()])));

// Career path (docs/plan-parcours-affiliations.md, decision D2): which organizations count as the
// instance itself. Identifiers by type (openalex I…, ror, hal docid, scopus afid, ringgold, rnsr, grid)
// and names; the Structures table of the instance is always added by the job.
const ORG_ID_TYPES = ['openalex', 'ror', 'hal', 'scopus', 'ringgold', 'rnsr', 'grid'];
const orgSetSchema = z.strictObject({
  ids: z.partialRecord(z.enum(ORG_ID_TYPES), z.array(z.string().trim().min(1))).default({}),
  names: z.array(z.string().trim().min(1)).default([]),
}).default({ ids: {}, names: [] });
const affiliationHistorySchema = z.strictObject({
  local: orgSetSchema,      // the establishment and its former names
  site: orgSetSchema,       // other establishments counted as local (hospital, schools of the site…)
  neutral: orgSetSchema,    // added to the national organisms of the job (CNRS, Inserm…)
  area: z.strictObject({ cities: z.array(z.string().trim().min(1)).default([]) }).default({ cities: [] }),
  thresholds: z.partialRecord(z.enum(['lag', 'minAfter', 'minYears', 'dominantWindow', 'dominantMin', 'dominantRatio', 'confirmGap', 'suspectMinPubs', 'stillLocalGap']), z.number()).default({}),
});

const instanceSchema = z.strictObject({
  slug: z.string().regex(SLUG_RE, 'expected [a-z0-9-]+'),
  label: z.string().trim().min(1),
  target: z.enum(['cloudflare', 'docker']),
  domains: z.array(z.string().regex(HOST_RE, 'expected a lowercase host name')).min(1),
  access: z.enum(['public', 'cloudflare-access', 'keycloak']),
  readOnly: z.boolean(),
  grist: z.strictObject({
    docId: z.string().regex(GRIST_DOC_RE, 'expected a Grist doc id'),
    apiBase: z.url().default(DEFAULT_GRIST_API_BASE),
    // The doc is shared publicly as viewer: the browser reads it directly, without a key.
    publicRead: z.boolean().default(false),
    extraDocIds: z.array(z.string().regex(GRIST_DOC_RE, 'expected a Grist doc id')).default([]),
  }),
  capabilities: capabilitiesSchema.default({}),
  features: z.strictObject({
    // /api/news/* and /api/newsletter/* hold the structures and staff filters of the instance.
    news: z.boolean().default(false),
    newsletter: z.boolean().default(false),
  }).default({ news: false, newsletter: false }),
  // Administrators by e-mail (Cloudflare Access identity). Keycloak instances manage them in Keycloak.
  admins: z.array(z.email()).default([]),
  // OpenAlex polite-pool contact; null = the default address of the code.
  openalexMailto: z.email().nullable().default(null),
  secrets: z.array(z.string().regex(SECRET_NAME_RE, 'expected an environment variable name')).default([]),
  // Shared deployment that serves this instance (lot 7 a, F3): the build of the Pages project whose
  // DRUID_DEPLOYMENT has this value takes every instance that declares it. null = none. A dedicated
  // project (DRUID_INSTANCE) ignores the field, so one instance can be on both.
  deployment: z.string().regex(DEPLOYMENT_RE, 'expected a Pages project name').nullable().default(null),
  // Career-path job (scripts/sync_affiliation_history.cjs); null = not configured.
  affiliationHistory: affiliationHistorySchema.nullable().default(null),
});

/** Rules spanning several fields. Returns a list of messages (empty = consistent). */
const crossFieldErrors = (c) => {
  const errors = [];
  if (c.access === 'public' && !c.readOnly) errors.push('access "public" requires readOnly: true (no authentication, no writes)');
  if (c.grist.publicRead && !c.readOnly) errors.push('grist.publicRead requires readOnly: true (the browser reads the doc without the proxy)');
  if (c.readOnly && c.admins.length) errors.push('a readOnly instance has no administrator: admins must be empty');
  if (c.admins.length && c.access !== 'cloudflare-access') errors.push('admins only apply to access "cloudflare-access" (Keycloak holds its own roles)');
  if (c.target === 'cloudflare' && c.access === 'keycloak') errors.push('access "keycloak" is not available on target "cloudflare"');
  if (c.target === 'cloudflare') {
    const fixed = Object.keys(c.capabilities).filter((k) => !TUNABLE_CAPABILITIES.includes(k));
    if (fixed.length) errors.push(`capabilities not settable on target "cloudflare": ${fixed.join(', ')}`);
    if (c.grist.extraDocIds.length) errors.push('grist.extraDocIds is not supported on target "cloudflare" (the proxy serves one doc)');
  }
  if (!c.grist.publicRead && !c.secrets.includes('GRIST_API_KEY')) errors.push('a doc without publicRead needs the GRIST_API_KEY secret');
  if ((c.features.news || c.features.newsletter) && c.target !== 'cloudflare') errors.push('features news/newsletter only exist on target "cloudflare"');
  if (c.deployment && c.target !== 'cloudflare') errors.push('deployment only exists on target "cloudflare"');
  return errors;
};

/**
 * Parses and validates one instance.json content.
 * @param {unknown} raw parsed JSON
 * @param {{ folder?: string }} [opts] name of the folder holding the file: must equal the slug
 * @returns {{ ok: true, config: object } | { ok: false, errors: string[] }}
 */
const parseInstanceConfig = (raw, opts = {}) => {
  const parsed = instanceSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
  }
  const errors = crossFieldErrors(parsed.data);
  if (opts.folder !== undefined && opts.folder !== parsed.data.slug) {
    errors.push(`slug "${parsed.data.slug}" differs from its folder "${opts.folder}"`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, config: parsed.data };
};

/**
 * Extra rules for an instance.json stored in the PUBLIC repository: nothing that identifies a real
 * person or a private doc may be published (docs/plan-instance-demo-cloudflare.md, lot B2).
 */
const publicRepoErrors = (raw) => {
  const errors = [];
  if (!raw || typeof raw !== 'object') return ['not a JSON object'];
  if (raw.readOnly !== true) errors.push('an instance of the public repository must be readOnly');
  if (raw.access !== 'public') errors.push('an instance of the public repository must have access "public"');
  if (Array.isArray(raw.admins) && raw.admins.length) errors.push('an instance of the public repository has no admins');
  if (!raw.grist || raw.grist.publicRead !== true) errors.push('an instance of the public repository must read a public doc (grist.publicRead)');
  return errors;
};

/**
 * Build variables Vite reads from .env.production.local, derived from the registry (lot 5 b).
 * Real environment variables keep priority over .env files in Vite: a Pages variable still wins.
 * @returns {Record<string, string>}
 */
const viteEnvFromConfig = (c) => ({
  VITE_GRIST_DOC_ID: c.grist.docId,
  ...(c.grist.publicRead ? { VITE_GRIST_PUBLIC_BASE_URL: c.grist.apiBase } : {}),
});

const isTrue = (v) => String(v || '').toLowerCase() === 'true';
const emailSet = (list) => [...new Set(list.map((e) => e.trim().toLowerCase()).filter(Boolean))].sort().join(',');

// Pages variables that duplicate a registry field during the transition (lot 5 f removes them).
// `personal`: the value is never printed (build logs).
const ENV_OVERRIDES = [
  { name: 'VITE_GRIST_DOC_ID', expected: (c) => c.grist.docId },
  { name: 'GRIST_DOC_ID', expected: (c) => c.grist.docId },
  { name: 'VITE_GRIST_PUBLIC_BASE_URL', expected: (c) => (c.grist.publicRead ? c.grist.apiBase : '') },
  { name: 'GRIST_API_BASE', expected: (c) => c.grist.apiBase },
  { name: 'INSTANCE_LABEL', expected: (c) => c.label },
  { name: 'READ_ONLY', expected: (c) => c.readOnly, normalize: isTrue },
  { name: 'SHOW_STATUS_VALIDATION', expected: (c) => !!c.capabilities.HAS_STATUS_VALIDATION, normalize: isTrue },
  { name: 'ADMIN_EMAILS', expected: (c) => emailSet(c.admins), normalize: (v) => emailSet(String(v).split(',')), personal: true },
  { name: 'OPENALEX_MAILTO', expected: (c) => c.openalexMailto || '', personal: true },
];

/**
 * Compares the Pages variables present in `env` with the registry. Variables that are absent are
 * skipped; the others are either `same` (redundant, removable) or `differs` (they override the
 * registry until lot 5 f).
 * @returns {{ name: string, status: 'same' | 'differs', detail: string }[]}
 */
const compareEnvWithConfig = (c, env) => ENV_OVERRIDES
  .filter(({ name }) => env[name] !== undefined && env[name] !== '')
  .map(({ name, expected, normalize = (v) => String(v).trim(), personal }) => {
    const want = expected(c);
    const got = normalize(env[name]);
    const same = got === want;
    const detail = personal || same ? '' : ` (environment ${JSON.stringify(got)}, instance.json ${JSON.stringify(want)})`;
    return { name, status: same ? 'same' : 'differs', detail };
  });

/**
 * Registry of the Functions (functions/_generated/registry.js, lot 6 b), from validated configs.
 *  - mode "single": one Pages project = one instance (DRUID_INSTANCE), served on every host;
 *  - mode "multi": one deployment for several instances (DRUID_DEPLOYMENT or DRUID_INSTANCES), chosen by
 *    request host.
 * A host declared by two instances is an error: it would serve one instance's data under the other.
 * @param {object[]} configs validated instance.json contents
 * @param {{ mode: 'single' | 'multi' }} opts
 * @returns {{ ok: true, registry: object } | { ok: false, errors: string[] }}
 */
const buildRegistry = (configs, { mode }) => {
  const errors = [];
  if (!['single', 'multi'].includes(mode)) errors.push(`unknown mode "${mode}"`);
  if (!configs.length) errors.push('no instance');
  if (mode === 'single' && configs.length > 1) errors.push('mode "single" takes exactly one instance');
  const instances = {};
  const byHost = {};
  for (const c of configs) {
    if (instances[c.slug]) { errors.push(`instance "${c.slug}" listed twice`); continue; }
    if (c.target !== 'cloudflare') errors.push(`instance "${c.slug}" has target "${c.target}", not "cloudflare"`);
    instances[c.slug] = c;
    for (const host of c.domains) {
      const h = host.toLowerCase();
      if (byHost[h] && byHost[h] !== c.slug) errors.push(`domain ${h} claimed by both "${byHost[h]}" and "${c.slug}"`);
      else byHost[h] = c.slug;
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, registry: { mode, defaultSlug: mode === 'single' ? configs[0].slug : null, instances, byHost } };
};

/**
 * Instances of a shared deployment (lot 7 a, F3): the folders whose instance.json declares
 * `deployment`. Only that field is read here; the build then validates the selected files in full.
 * A folder present in two sources (this repository and a private one) is refused when either copy
 * claims the deployment: which one would be built would depend on lookup order.
 * @param {{ folder: string, source: string, raw: unknown }[]} candidates parsed instance.json per folder
 * @param {string} deployment value of DRUID_DEPLOYMENT
 * @returns {{ ok: true, slugs: string[] } | { ok: false, errors: string[] }}
 */
const selectDeploymentInstances = (candidates, deployment) => {
  const errors = [];
  if (!DEPLOYMENT_RE.test(deployment || '')) return { ok: false, errors: [`invalid deployment name "${deployment}"`] };
  const claims = (raw) => !!raw && typeof raw === 'object' && raw.deployment === deployment;
  const sources = {};
  for (const { folder, source, raw } of candidates) {
    (sources[folder] ||= []).push({ source, claimed: claims(raw) });
  }
  const slugs = [];
  for (const folder of Object.keys(sources).sort()) {
    const found = sources[folder];
    if (!found.some((f) => f.claimed)) continue;
    if (found.length > 1) errors.push(`instance "${folder}" exists in several sources (${found.map((f) => f.source).join(', ')})`);
    else slugs.push(folder);
  }
  if (!errors.length && !slugs.length) errors.push(`no instance declares deployment "${deployment}"`);
  return errors.length ? { ok: false, errors } : { ok: true, slugs };
};

module.exports = {
  affiliationHistorySchema,
  ALL_CAPABILITIES,
  DEFAULT_GRIST_API_BASE,
  TUNABLE_CAPABILITIES,
  buildRegistry,
  compareEnvWithConfig,
  parseInstanceConfig,
  publicRepoErrors,
  selectDeploymentInstances,
  viteEnvFromConfig,
};
