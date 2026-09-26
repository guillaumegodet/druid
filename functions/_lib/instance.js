// Instance settings of the Cloudflare Functions (docs/plan-architecture-multi-instances.md, lot 5 c).
//
// Source: the instance registry instances/<slug>/instance.json, validated by the build
// (scripts/prepare-cloudflare-assets.cjs) and written to functions/_generated/instance.js
// (`null` when the instance has no instance.json yet). Pages variables still override it during
// the transition, field by field, when they are present and non-empty (lot 5 f removes them):
//   DRUID_INSTANCE, INSTANCE_LABEL, READ_ONLY, SHOW_STATUS_VALIDATION, ADMIN_EMAILS,
//   OPENALEX_MAILTO, GRIST_DOC_ID / VITE_GRIST_DOC_ID, GRIST_API_BASE.
// Without registry nor variable, the defaults are the historical ones (Centrale).
//
// No route: this module exports no onRequest handler, so Pages does not serve it.
import registry from '../_generated/instance.js';

export const DEFAULT_SLUG = 'centrale';
export const DEFAULT_GRIST_API_BASE = 'https://grist.numerique.gouv.fr/api';

const isSet = (v) => v !== undefined && v !== null && String(v).trim() !== '';
const isTrue = (v) => String(v || '').trim().toLowerCase() === 'true';

export const parseAdminEmails = (raw) =>
  String(raw || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

/**
 * Pure resolution: registry (or null) + environment → runtime settings.
 * @param {Record<string, string>} env Pages environment
 * @param {object|null} reg validated instance.json, or null
 */
export const resolveInstance = (env = {}, reg = null) => {
  const slug = (isSet(env.DRUID_INSTANCE) ? String(env.DRUID_INSTANCE).trim() : reg?.slug) || DEFAULT_SLUG;
  const envBool = (name, fallback) => (isSet(env[name]) ? isTrue(env[name]) : fallback);
  const docId = [env.GRIST_DOC_ID, env.VITE_GRIST_DOC_ID, reg?.grist?.docId].find(isSet) || '';
  const apiBase = [env.GRIST_API_BASE, reg?.grist?.apiBase].find(isSet) || DEFAULT_GRIST_API_BASE;
  return {
    slug,
    label: String([env.INSTANCE_LABEL, reg?.label].find(isSet) || 'Centrale Nantes'),
    readOnly: envBool('READ_ONLY', !!reg?.readOnly),
    statusValidation: envBool('SHOW_STATUS_VALIDATION', !!reg?.capabilities?.HAS_STATUS_VALIDATION),
    grist: { docId: String(docId).trim(), apiBase: String(apiBase).trim().replace(/\/$/, '') },
    // Without registry, news and newsletter keep their historical rule: Centrale only.
    features: {
      news: reg ? !!reg.features?.news : slug === DEFAULT_SLUG,
      newsletter: reg ? !!reg.features?.newsletter : slug === DEFAULT_SLUG,
    },
    admins: isSet(env.ADMIN_EMAILS) ? parseAdminEmails(env.ADMIN_EMAILS) : (reg?.admins || []).map((e) => e.toLowerCase()),
    openalexMailto: [env.OPENALEX_MAILTO, reg?.openalexMailto].find(isSet) || null,
    fromRegistry: !!reg,
  };
};

/** Settings of the running instance: generated registry + Pages environment. */
export const instanceConfig = (env = {}) => resolveInstance(env, registry);
