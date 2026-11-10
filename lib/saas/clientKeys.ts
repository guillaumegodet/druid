/**
 * @file clientKeys.ts
 * @description API keys of the establishment (druid-internal docs/plan-druid-saas.md, decision D7 and lot 6 a-2): its
 * language model (any OpenAI-compatible service: base URL, model, key) and its Elsevier keys (Scopus alignment), entered
 * in « My institution », tested at entry, encrypted in tenant_secret (lib/saas/secrets.ts). The Functions of the tenant
 * (AI texts, thematic search) and the runner (alignments, ETL) read them; the host never lends its own.
 *
 * Two groups, each written and tested as a whole. The outcome of the last test is kept in tenant_key_check with a
 * code the page translates (the message of the provider is kept as a detail, never a key).
 */
import type { SaasDb } from './controlPlane';
import { TENANT_PUBLIC_SETTINGS, decryptSecret, writeTenantSecret, type TenantSecretName } from './secrets.ts';

export const KEY_GROUPS = {
  llm: ['ILAAS_API_BASE', 'ILAAS_MODEL', 'ILAAS_API_KEY'],
  scopus: ['SCOPUS_API_KEY', 'SCOPUS_INST_TOKEN', 'SCOPUS_API_KEY_2', 'SCOPUS_INST_TOKEN_2'],
} as const satisfies Record<string, readonly TenantSecretName[]>;
export type KeyGroup = keyof typeof KEY_GROUPS;
export const isKeyGroup = (v: unknown): v is KeyGroup => typeof v === 'string' && Object.prototype.hasOwnProperty.call(KEY_GROUPS, v);

export const DEFAULT_LLM_BASE = 'https://llm.ilaas.fr/v1';
export const DEFAULT_LLM_MODEL = 'mistral-small-4-119b';
const ELSEVIER = 'https://api.elsevier.com/content';
const TIMEOUT_MS = 15_000;

/** Outcome of a test: `code` is what the page translates; `detail` is the provider's own words (truncated). */
export type CheckCode = 'ok' | 'invalid_key' | 'not_entitled' | 'model_not_found' | 'quota' | 'unreachable' | 'http_error';
export interface KeyCheck { ok: boolean; code: CheckCode; detail: string | null }

export class ClientKeyError extends Error {
  // No parameter property: the Functions guards run this file with Node's type stripping.
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

const clean = (v: unknown, max = 500): string => String(v ?? '').trim().slice(0, max);
const short = (s: string | null | undefined, max = 300): string | null => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
};
/** Masks anything that looks like the key in a provider message (some echo it back). */
const masked = (text: string | null, secrets: string[]): string | null => {
  if (!text) return text;
  let out = text;
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join('•••');
  return out;
};

const PRIVATE_HOST = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan)$/i;
const IP_LITERAL = /^(\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:.]+\])$/i;

/**
 * Base URL of an OpenAI-compatible service, normalized (no trailing slash, a pasted `/chat/completions` removed); an
 * address that is not public https is refused — the Worker calls it on behalf of the establishment.
 */
export const normalizeLlmBase = (raw: unknown): string => {
  const text = clean(raw);
  if (!text) return DEFAULT_LLM_BASE;
  let u: URL;
  try { u = new URL(text); } catch { throw new ClientKeyError('Invalid address of the language model'); }
  if (u.protocol !== 'https:' || u.username || u.password || PRIVATE_HOST.test(u.hostname) || IP_LITERAL.test(u.hostname)) {
    throw new ClientKeyError('Invalid address of the language model');
  }
  u.search = ''; u.hash = '';
  return u.toString().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
};

const MODEL_RE = /^[\w.:/@+-]{1,120}$/;
export const normalizeModel = (raw: unknown): string => {
  const m = clean(raw, 200);
  if (!m) return DEFAULT_LLM_MODEL;
  if (!MODEL_RE.test(m)) throw new ClientKeyError('Invalid model name');
  return m;
};

const KEY_RE = /^[\x21-\x7e]{8,512}$/;
/** A key or token as typed: printable ASCII without spaces; empty ⇒ null. */
export const normalizeKey = (raw: unknown, label = 'key'): string | null => {
  const k = clean(raw, 600);
  if (!k) return null;
  if (!KEY_RE.test(k)) throw new ClientKeyError(label === 'token' ? 'Invalid institution token' : 'Invalid API key');
  return k;
};

const errorText = (body: string): string | null => {
  try {
    const d = JSON.parse(body);
    const e = d?.error ?? d?.['service-error']?.status ?? d?.detail ?? d?.message;
    if (typeof e === 'string') return e;
    if (e && typeof e === 'object') return [e.statusCode, e.statusText, e.message, e.code].filter(Boolean).join(' — ') || null;
  } catch { /* not JSON */ }
  return short(body);
};

/** Language model: one tiny chat completion — checks the address, the key and the model at once. */
export const checkLlm = async (settings: { apiBase: string; model: string; apiKey: string }, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<KeyCheck> => {
  let r;
  try {
    r = await fetchImpl(`${settings.apiBase}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: settings.model, messages: [{ role: 'user', content: 'Reply with the single word OK.' }], max_tokens: 5, temperature: 0 }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, code: 'unreachable', detail: short(err instanceof Error ? err.message : String(err)) };
  }
  const body = await r.text().catch(() => '');
  const detail = masked(short(errorText(body)), [settings.apiKey]);
  if (r.ok) {
    try {
      const d = JSON.parse(body);
      if (Array.isArray(d?.choices)) return { ok: true, code: 'ok', detail: null };
    } catch { /* below */ }
    return { ok: false, code: 'http_error', detail: 'The answer is not an OpenAI-compatible chat completion' };
  }
  if (r.status === 401 || r.status === 403) return { ok: false, code: 'invalid_key', detail };
  if (r.status === 429) return { ok: false, code: 'quota', detail };
  // 404: wrong address; 400/404 naming the model: unknown model.
  if (r.status === 404 || (r.status === 400 && /model/i.test(detail || ''))) return { ok: false, code: /model/i.test(detail || '') ? 'model_not_found' : 'unreachable', detail: detail || `HTTP ${r.status}` };
  return { ok: false, code: 'http_error', detail: detail || `HTTP ${r.status}` };
};

/**
 * Elsevier: one Author Search — what the Scopus alignment calls. From outside the subscribing institution's network, a
 * valid key gets « not authorized » without its institution token: the runner calls from outside as well, so the test
 * says what the alignment will meet.
 */
export const checkScopus = async (keys: { apiKey: string; instToken?: string | null }, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<KeyCheck> => {
  const headers: Record<string, string> = { Accept: 'application/json', 'X-ELS-APIKey': keys.apiKey };
  if (keys.instToken) headers['X-ELS-Insttoken'] = keys.instToken;
  let r;
  try {
    r = await fetchImpl(`${ELSEVIER}/search/author?query=${encodeURIComponent('AUTHLASTNAME(curie)')}&count=1`, { method: 'GET', headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    return { ok: false, code: 'unreachable', detail: short(err instanceof Error ? err.message : String(err)) };
  }
  const body = await r.text().catch(() => '');
  const detail = masked(short(errorText(body)), [keys.apiKey, keys.instToken || '']);
  if (r.ok) return { ok: true, code: 'ok', detail: null };
  if (r.status === 429) return { ok: false, code: 'quota', detail };
  if (r.status === 401 || r.status === 403) {
    // AUTHENTICATION_ERROR = unknown key; AUTHORIZATION_ERROR = known key without the entitlement from this address.
    return { ok: false, code: /AUTHORIZATION|not authorized|entitle/i.test(detail || '') && !/AUTHENTICATION|invalid api key/i.test(detail || '') ? 'not_entitled' : 'invalid_key', detail };
  }
  return { ok: false, code: 'http_error', detail: detail || `HTTP ${r.status}` };
};

// ── Storage ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The stored values of one group, in clear (null when absent or undecryptable). */
const readGroup = async (db: SaasDb, tenantId: string, group: KeyGroup, keyB64: string): Promise<Partial<Record<TenantSecretName, string>>> => {
  const names = KEY_GROUPS[group] as readonly string[];
  const rows = await db.selectFrom('tenant_secret').select(['name', 'ciphertext', 'iv']).where('tenant_id', '=', tenantId).where('name', 'in', names as string[]).execute();
  const out: Partial<Record<TenantSecretName, string>> = {};
  for (const r of rows) {
    try { out[r.name as TenantSecretName] = await decryptSecret(keyB64, r); } catch { /* treated as absent */ }
  }
  return out;
};

const recordCheck = async (db: SaasDb, tenantId: string, group: KeyGroup, check: KeyCheck, by: string | null): Promise<void> => {
  const values = { ok: check.ok, code: check.code, message: check.detail, checked_by: by, checked_at: new Date().toISOString() };
  await db.insertInto('tenant_key_check').values({ tenant_id: tenantId, key_group: group, ...values })
    .onConflict((oc) => oc.columns(['tenant_id', 'key_group']).doUpdateSet(values)).execute();
};

export interface KeyGroupView {
  /** Which names are stored (never a key's value). */
  set: Record<string, boolean>;
  /** Values that are not secrets (address and model of the language model). */
  values: Record<string, string>;
  check: { ok: boolean; code: string; detail: string | null; checkedAt: string; checkedBy: string | null } | null;
}

/** What « My institution » shows: per group, which keys are set, the public settings, the last test. */
export const describeClientKeys = async (db: SaasDb, tenantId: string, keyB64: string | null | undefined): Promise<Record<KeyGroup, KeyGroupView>> => {
  const rows = await db.selectFrom('tenant_secret').select(['name', 'ciphertext', 'iv']).where('tenant_id', '=', tenantId).execute();
  const checks = await db.selectFrom('tenant_key_check').selectAll().where('tenant_id', '=', tenantId).execute();
  const out = {} as Record<KeyGroup, KeyGroupView>;
  for (const group of Object.keys(KEY_GROUPS) as KeyGroup[]) {
    const view: KeyGroupView = { set: {}, values: {}, check: null };
    for (const name of KEY_GROUPS[group]) {
      const row = rows.find((r) => r.name === name);
      view.set[name] = !!row;
      if (row && keyB64 && TENANT_PUBLIC_SETTINGS.includes(name)) {
        try { view.values[name] = await decryptSecret(keyB64, row); } catch { /* not shown */ }
      }
    }
    const c = checks.find((k) => k.key_group === group);
    if (c) view.check = { ok: c.ok, code: c.code, detail: c.message, checkedAt: new Date(c.checked_at).toISOString(), checkedBy: c.checked_by };
    out[group] = view;
  }
  return out;
};

export interface SaveOptions { by: string | null; force?: boolean; fetchImpl?: FetchLike }

/** Input of a group → the values to store (a key left empty keeps the stored one), validated. */
const valuesOf = (group: KeyGroup, input: Record<string, unknown>, stored: Partial<Record<TenantSecretName, string>>): Partial<Record<TenantSecretName, string | null>> => {
  if (group === 'llm') {
    const apiKey = normalizeKey(input.apiKey) ?? stored.ILAAS_API_KEY ?? null;
    if (!apiKey) throw new ClientKeyError('The API key is required');
    return { ILAAS_API_BASE: normalizeLlmBase(input.apiBase), ILAAS_MODEL: normalizeModel(input.model), ILAAS_API_KEY: apiKey };
  }
  const apiKey = normalizeKey(input.apiKey) ?? stored.SCOPUS_API_KEY ?? null;
  if (!apiKey) throw new ClientKeyError('The API key is required');
  // The tokens and the backup key: empty in the form ⇒ removed unless `keep*` says the stored one stays.
  const keepOr = (field: string, keep: string, name: TenantSecretName, label: 'key' | 'token') =>
    normalizeKey(input[field], label) ?? (input[keep] ? stored[name] ?? null : null);
  const apiKey2 = keepOr('apiKey2', 'keepApiKey2', 'SCOPUS_API_KEY_2', 'key');
  return {
    SCOPUS_API_KEY: apiKey,
    SCOPUS_INST_TOKEN: keepOr('instToken', 'keepInstToken', 'SCOPUS_INST_TOKEN', 'token'),
    SCOPUS_API_KEY_2: apiKey2,
    SCOPUS_INST_TOKEN_2: apiKey2 ? keepOr('instToken2', 'keepInstToken2', 'SCOPUS_INST_TOKEN_2', 'token') : null,
  };
};

const testValues = async (group: KeyGroup, v: Partial<Record<TenantSecretName, string | null>>, fetchImpl?: FetchLike): Promise<KeyCheck> => {
  if (group === 'llm') return checkLlm({ apiBase: v.ILAAS_API_BASE || DEFAULT_LLM_BASE, model: v.ILAAS_MODEL || DEFAULT_LLM_MODEL, apiKey: v.ILAAS_API_KEY || '' }, fetchImpl);
  const first = await checkScopus({ apiKey: v.SCOPUS_API_KEY || '', instToken: v.SCOPUS_INST_TOKEN }, fetchImpl);
  if (!first.ok || !v.SCOPUS_API_KEY_2) return first;
  const second = await checkScopus({ apiKey: v.SCOPUS_API_KEY_2, instToken: v.SCOPUS_INST_TOKEN_2 }, fetchImpl);
  return second.ok ? first : { ...second, detail: `backup key: ${second.detail || second.code}` };
};

/**
 * Tests then stores a group. A failed test stores nothing (409 with the outcome) unless `force` — an Elsevier key
 * may only work from the institution's network, or a service may be down for an hour: the owner decides.
 */
export const saveClientKeys = async (db: SaasDb, tenantId: string, group: KeyGroup, input: Record<string, unknown>, keyB64: string, opts: SaveOptions): Promise<KeyCheck> => {
  const stored = await readGroup(db, tenantId, group, keyB64);
  const values = valuesOf(group, input || {}, stored);
  const check = await testValues(group, values, opts.fetchImpl);
  // Nothing stored: the last test shown stays the one of the keys in place.
  if (!check.ok && !opts.force) return check;
  for (const [name, value] of Object.entries(values)) await writeTenantSecret(db, tenantId, name as TenantSecretName, value ?? null, keyB64);
  await recordCheck(db, tenantId, group, check, opts.by);
  return check;
};

/** Tests the stored keys of a group again (button « Test »). */
export const retestClientKeys = async (db: SaasDb, tenantId: string, group: KeyGroup, keyB64: string, opts: SaveOptions): Promise<KeyCheck> => {
  const stored = await readGroup(db, tenantId, group, keyB64);
  const main = group === 'llm' ? stored.ILAAS_API_KEY : stored.SCOPUS_API_KEY;
  if (!main) throw new ClientKeyError('No key is stored', 404);
  const check = await testValues(group, stored, opts.fetchImpl);
  await recordCheck(db, tenantId, group, check, opts.by);
  return check;
};

/** Removes every key of a group and its last test. */
export const removeClientKeys = async (db: SaasDb, tenantId: string, group: KeyGroup): Promise<void> => {
  await db.deleteFrom('tenant_secret').where('tenant_id', '=', tenantId).where('name', 'in', [...KEY_GROUPS[group]] as string[]).execute();
  await db.deleteFrom('tenant_key_check').where('tenant_id', '=', tenantId).where('key_group', '=', group).execute();
};

/**
 * Environment of a handler of the tenant: its own language model when it set one (address and model defaulting to
 * ILaaS, never to the deployment's), else the deployment's per-instance key (instanceEnv, D7: the host's own link).
 */
export const llmEnvOf = (secrets: Record<string, string>): Record<string, string> =>
  secrets.ILAAS_API_KEY
    ? { ILAAS_API_KEY: secrets.ILAAS_API_KEY, ILAAS_API_BASE: secrets.ILAAS_API_BASE || DEFAULT_LLM_BASE, ILAAS_MODEL: secrets.ILAAS_MODEL || DEFAULT_LLM_MODEL }
    : {};
