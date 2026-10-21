/**
 * @file r2.ts
 * @description Private files of the tenants (the dashboards of druid-biblio; druid-internal docs/plan-druid-saas.md,
 * lot 3 c and decision D5): the runner writes them to an R2 bucket through its S3 API (Signature V4, Node crypto — no
 * SDK), the Functions read them through the R2 binding of the Worker (functions/_lib/instanceAssets.js). Keys are
 * `<tenant slug>/dashboard-data/<lab slug>/dashboard.json.gz` and `<tenant slug>/dashboard-data/index.json`.
 */
import { createHash, createHmac } from 'node:crypto';

export interface AssetStore {
  put(key: string, body: Uint8Array, contentType?: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** In-memory store (tests, dry runs). */
export const memoryAssetStore = (): AssetStore & { objects: Map<string, { body: Uint8Array; contentType: string }> } => {
  const objects = new Map<string, { body: Uint8Array; contentType: string }>();
  return {
    objects,
    put: async (key, body, contentType = 'application/octet-stream') => { objects.set(key, { body, contentType }); },
    delete: async (key) => { objects.delete(key); },
  };
};

const sha256Hex = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string): Buffer => createHmac('sha256', key).update(data).digest();
export const EMPTY_PAYLOAD_HASH = sha256Hex('');

/** RFC 3986 encoding of one path segment (S3 wants `/` kept and nothing double-encoded). */
const encodeSegment = (s: string): string => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
export const canonicalUri = (pathname: string): string => pathname.split('/').map((seg) => encodeSegment(decodeURIComponent(seg))).join('/') || '/';

export interface SignInput {
  method: string;
  url: URL;
  /** Headers to sign, `host` added when missing; names are lower-cased. */
  headers: Record<string, string>;
  payloadHash: string;
  /** `YYYYMMDDTHHMMSSZ`. */
  amzDate: string;
  region: string;
  service?: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** AWS Signature V4 of a request: the headers to send (the given ones + `x-amz-date`, `authorization`). */
export const signS3Request = ({ method, url, headers, payloadHash, amzDate, region, service = 's3', accessKeyId, secretAccessKey }: SignInput): Record<string, string> => {
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = String(v).trim().replace(/\s+/g, ' ');
  h.host = h.host || url.host;
  h['x-amz-date'] = amzDate;
  h['x-amz-content-sha256'] = payloadHash;
  const names = Object.keys(h).sort();
  const canonicalHeaders = names.map((n) => `${n}:${h[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const query = [...url.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeSegment(k)}=${encodeSegment(v)}`).join('&');
  const canonicalRequest = [method.toUpperCase(), canonicalUri(url.pathname), query, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), service), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  h.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return h;
};

export interface S3StoreOptions {
  /** `https://<account id>.r2.cloudflarestorage.com` (R2) or any S3 endpoint; path-style URLs. */
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

const amzDateOf = (d: Date): string => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

/** S3-compatible store (R2): PUT and DELETE of one object, path-style, signed per request. */
export const createS3AssetStore = ({ endpoint, bucket, accessKeyId, secretAccessKey, region = 'auto', fetchImpl = fetch, now = () => new Date() }: S3StoreOptions): AssetStore => {
  const base = endpoint.replace(/\/+$/, '');
  const urlOf = (key: string) => new URL(`${base}/${bucket}/${key.split('/').map(encodeSegment).join('/')}`);
  const send = async (method: 'PUT' | 'DELETE', key: string, body?: Uint8Array, contentType?: string) => {
    const url = urlOf(key);
    const headers: Record<string, string> = {};
    if (contentType) headers['content-type'] = contentType;
    if (body) headers['content-length'] = String(body.byteLength);
    const signed = signS3Request({ method, url, headers, payloadHash: body ? sha256Hex(body) : EMPTY_PAYLOAD_HASH, amzDate: amzDateOf(now()), region, accessKeyId, secretAccessKey });
    const res = await fetchImpl(url, { method, headers: signed, body: body as BodyInit | undefined });
    if (!res.ok && !(method === 'DELETE' && res.status === 404)) throw new Error(`S3 ${method} ${key}: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  };
  return {
    put: (key, body, contentType = 'application/octet-stream') => send('PUT', key, body, contentType),
    delete: (key) => send('DELETE', key),
  };
};

/** The store of the environment (SAAS_R2_ENDPOINT, SAAS_R2_BUCKET, SAAS_R2_ACCESS_KEY_ID, SAAS_R2_SECRET_ACCESS_KEY), or null. */
export const assetStoreFromEnv = (env: Record<string, string | undefined>): AssetStore | null => {
  const { SAAS_R2_ENDPOINT: endpoint, SAAS_R2_BUCKET: bucket, SAAS_R2_ACCESS_KEY_ID: accessKeyId, SAAS_R2_SECRET_ACCESS_KEY: secretAccessKey } = env;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return createS3AssetStore({ endpoint, bucket, accessKeyId, secretAccessKey, region: env.SAAS_R2_REGION || 'auto' });
};
