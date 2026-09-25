// Instance registry (docs/plan-architecture-multi-instances.md, lot 5): every instance is described
// by instances/<slug>/instance.json — never a secret, only the NAMES of the secrets it needs.
// The folder lives in this repository for instances without personal data (demo), in the private
// repository guillaumegodet/druid-instances otherwise (Centrale, Nantes).
//
// CommonJS so that scripts/prepare-cloudflare-assets.cjs (build) and the CLI validator
// (scripts/instances/validate.cjs) can require it; the Functions will receive the config already
// validated by the build (lot 5 b), they do not import this module.
const { z } = require('zod');

// Capabilities an instance may set itself. The others are structural: fixed to false on
// Cloudflare (functions/api/me.js::CAPABILITIES), derived from the config present in server.cjs.
const TUNABLE_CAPABILITIES = ['HAS_STATUS_VALIDATION'];
// Every capability exposed by /api/me: a `docker` instance lists the ones it EXPECTS, compared to
// /api/me by the drift check (lot 5 e).
const ALL_CAPABILITIES = [
  'HAS_LDAP', 'HAS_KEYCLOAK_ADMIN', 'HAS_ETL_API', 'HAS_PIPELINES_CHAT', 'HAS_HELP_CHAT',
  'HAS_SOVISU_EXPORT', 'HAS_SERVER_JOBS', 'HAS_BENCHMARK', 'HAS_QUALINKA', 'HAS_STATUS_VALIDATION',
  'HAS_TASKS',
];

const SLUG_RE = /^[a-z0-9-]+$/;
const GRIST_DOC_RE = /^[A-Za-z0-9]{10,}$/;
const HOST_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]*$/;
const DEFAULT_GRIST_API_BASE = 'https://grist.numerique.gouv.fr/api';

const capabilitiesSchema = z.strictObject(Object.fromEntries(ALL_CAPABILITIES.map((k) => [k, z.boolean().optional()])));

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

module.exports = {
  ALL_CAPABILITIES,
  DEFAULT_GRIST_API_BASE,
  TUNABLE_CAPABILITIES,
  compareEnvWithConfig,
  parseInstanceConfig,
  publicRepoErrors,
  viteEnvFromConfig,
};
