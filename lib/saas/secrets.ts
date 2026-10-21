/**
 * @file secrets.ts
 * @description API keys of a tenant (table saas.tenant_secret; druid-internal docs/plan-druid-saas.md, decision D7 and
 * lot 6 a): AES-256-GCM with a key the runtime holds (`SAAS_SECRETS_KEY`, 32 bytes base64), never the database. WebCrypto
 * only, so that the Functions (writes of the settings page) and the runner (reads, handed to the scripts as environment
 * variables) share the code. The names are a closed list: what the scripts of Druid read.
 */
import type { SaasDb } from './controlPlane';

export const TENANT_SECRET_NAMES = ['SCOPUS_API_KEY', 'SCOPUS_API_KEY_2', 'OPENALEX_API_KEY', 'ILAAS_API_KEY'] as const;
export type TenantSecretName = typeof TENANT_SECRET_NAMES[number];
export const isTenantSecretName = (v: unknown): v is TenantSecretName => TENANT_SECRET_NAMES.includes(v as TenantSecretName);

const b64encode = (bytes: Uint8Array): string => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const b64decode = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const importKey = async (keyB64: string): Promise<CryptoKey> => {
  let raw: Uint8Array;
  try { raw = b64decode(keyB64); } catch { raw = new Uint8Array(0); }
  if (raw.length !== 32) throw new Error('SAAS_SECRETS_KEY must be 32 bytes (base64)');
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
};

/** A fresh random key, base64 (what `SAAS_SECRETS_KEY` is set to once). */
export const generateSecretsKey = (): string => b64encode(crypto.getRandomValues(new Uint8Array(32)));

export const encryptSecret = async (keyB64: string, plaintext: string): Promise<{ ciphertext: string; iv: string }> => {
  const key = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return { ciphertext: b64encode(new Uint8Array(ct)), iv: b64encode(iv) };
};

export const decryptSecret = async (keyB64: string, { ciphertext, iv }: { ciphertext: string; iv: string }): Promise<string> => {
  const key = await importKey(keyB64);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64decode(iv) }, key, b64decode(ciphertext));
  return new TextDecoder().decode(pt);
};

/** Stores (or removes, `value` null) one secret of a tenant. */
export const writeTenantSecret = async (db: SaasDb, tenantId: string, name: TenantSecretName, value: string | null, keyB64: string): Promise<void> => {
  if (value === null || value === '') {
    await db.deleteFrom('tenant_secret').where('tenant_id', '=', tenantId).where('name', '=', name).execute();
    return;
  }
  const { ciphertext, iv } = await encryptSecret(keyB64, value);
  await db.insertInto('tenant_secret').values({ tenant_id: tenantId, name, ciphertext, iv })
    .onConflict((oc) => oc.columns(['tenant_id', 'name']).doUpdateSet({ ciphertext, iv, updated_at: new Date().toISOString() })).execute();
};

/** Names of the secrets a tenant holds (never the values: the settings page shows « set »). */
export const listTenantSecretNames = async (db: SaasDb, tenantId: string): Promise<string[]> =>
  (await db.selectFrom('tenant_secret').select('name').where('tenant_id', '=', tenantId).orderBy('name').execute()).map((r) => r.name);

/** The secrets of a tenant in clear, by name — the runner hands them to the scripts; undecryptable rows are skipped. */
export const readTenantSecrets = async (db: SaasDb, tenantId: string, keyB64: string | null | undefined, log?: (line: string) => void): Promise<Record<string, string>> => {
  const out: Record<string, string> = {};
  const rows = await db.selectFrom('tenant_secret').select(['name', 'ciphertext', 'iv']).where('tenant_id', '=', tenantId).execute();
  if (!rows.length) return out;
  if (!keyB64) { log?.(`${rows.length} tenant secret(s) ignored: SAAS_SECRETS_KEY is not set`); return out; }
  for (const r of rows) {
    if (!isTenantSecretName(r.name)) continue;
    try { out[r.name] = await decryptSecret(keyB64, r); } catch (err) { log?.(`secret ${r.name}: ${err instanceof Error ? err.message : String(err)}`); }
  }
  return out;
};
