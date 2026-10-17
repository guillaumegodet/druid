// Text of a call added by hand (druid-internal docs/plan-funding-calls.md, lot 6): the page or PDF at a URL given by a
// person of the research office, or a PDF they upload, then the fields proposed by the language model of the instance
// (ILaaS, lib/calls/manual.ts EXTRACTION_SYSTEM). Server side only.
//
// The URL comes from a user: every hop (redirects included) must be http(s) on a host whose addresses are all public, so
// that the route cannot reach the services of the server or of the internal network. The request goes through the
// outgoing proxy of the instance (HTTPS_PROXY, NO_PROXY: the FortiGate of Nantes intercepts the TLS of a direct request),
// tunnelled by hand as in scripts/lib/align_common.cjs since `fetch` ignores these variables.
import dns from 'node:dns';
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import type { Duplex } from 'node:stream';
import tls from 'node:tls';
import { htmlToText } from './ftPortal';
import { EXTRACTION_SYSTEM, extractionPrompt, pageText, pageTitle, parseExtraction, type ExtractedCall } from './manual';
import { pdfToText } from './pdfText';
import type { TranslatorSettings } from './translate';

export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
const TIMEOUT_MS = 20000;
const MAX_REDIRECTS = 5;

export class CallDocumentError extends Error {
  constructor(message: string, readonly status = 422) { super(message); }
}

export interface CallDocument {
  kind: 'html' | 'pdf' | 'text';
  /** Readable text handed to the model. */
  text: string;
  /** Title of the page (HTML), a fallback for the draft. */
  title: string;
  /** URL after the redirects. */
  url: string;
}

const v4 = (ip: string): number[] => ip.split('.').map(Number);
/** Whether an address is loopback, private, link-local, shared or reserved (IPv4, IPv6, IPv4-mapped IPv6). */
export const isPrivateAddress = (ip: string): boolean => {
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped) return isPrivateAddress(mapped[1]);
  if (isIP(ip) === 4) {
    const [a, b] = v4(ip);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  const s = ip.toLowerCase();
  return s === '::' || s === '::1' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith('ff');
};

/** Refuses a URL that is not http(s) or whose host resolves to a non-public address. */
export const checkPublicUrl = async (raw: string, resolve: (host: string) => Promise<string[]> = defaultResolve): Promise<URL> => {
  let u: URL;
  try { u = new URL(raw); } catch { throw new CallDocumentError('Invalid URL', 400); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new CallDocumentError('Only http and https addresses are read', 400);
  if (u.username || u.password) throw new CallDocumentError('Invalid URL', 400);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [host] : await resolve(host).catch(() => []);
  if (!addresses.length) throw new CallDocumentError(`Unknown host: ${host}`);
  if (addresses.some(isPrivateAddress)) throw new CallDocumentError('This address is not a public website', 403);
  return u;
};
const defaultResolve = async (host: string) => (await lookup(host, { all: true })).map((a) => a.address);

const proxyFor = (hostname: string, env: NodeJS.ProcessEnv = process.env): URL | null => {
  const raw = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
  if (!raw) return null;
  const h = hostname.toLowerCase();
  const noProxy = String(env.NO_PROXY || env.no_proxy || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (noProxy.some((n) => n === '*' || h === n || h.endsWith(n.startsWith('.') ? n : `.${n}`))) return null;
  try { return new URL(raw); } catch { return null; }
};

class ConnectProxyAgent extends https.Agent {
  constructor(private readonly proxy: URL) { super({ keepAlive: false }); }
  createConnection(options: http.ClientRequestArgs, cb?: (err: Error | null, stream: Duplex) => void): undefined {
    const target = `${options.host}:${options.port || 443}`;
    const req = http.request({ host: this.proxy.hostname, port: this.proxy.port || 3128, method: 'CONNECT', path: target, headers: { Host: target } });
    req.once('connect', (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); cb?.(new Error(`Proxy CONNECT ${res.statusCode}`), socket); return; }
      cb?.(null, tls.connect({ socket, servername: options.host ?? undefined }));
    });
    req.once('error', (e) => cb?.(e, req.socket as Duplex));
    req.end();
    return undefined;
  }
}

/** DNS lookup of a direct request that refuses the non-public addresses again (an answer changed since the check). */
const publicLookup = ((hostname: string, options: dns.LookupOptions, cb: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void) => {
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) return cb(err, address, family);
    const list = Array.isArray(address) ? address.map((a) => a.address) : [address];
    if (list.some(isPrivateAddress)) return cb(Object.assign(new Error('This address is not a public website'), { code: 'EPRIVATE' }), address, family);
    cb(null, address, family);
  });
}) as unknown as typeof dns.lookup;

interface RawResponse { status: number; location?: string; contentType: string; body: Buffer }

const getOnce = (u: URL): Promise<RawResponse> => new Promise((resolve, reject) => {
  const proxy = proxyFor(u.hostname);
  const headers = { 'User-Agent': 'Druid (appels à projets)', Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.5' };
  const onResponse = (res: http.IncomingMessage) => {
    const chunks: Buffer[] = [];
    let size = 0;
    res.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_DOCUMENT_BYTES) { res.destroy(); reject(new CallDocumentError('The document is larger than 15 MB', 413)); return; }
      chunks.push(c);
    });
    res.on('end', () => resolve({ status: res.statusCode ?? 0, location: res.headers.location, contentType: String(res.headers['content-type'] ?? ''), body: Buffer.concat(chunks) }));
    res.on('error', reject);
  };
  let req: http.ClientRequest;
  if (u.protocol === 'https:') {
    req = https.request(u, { method: 'GET', headers, ...(proxy ? { agent: new ConnectProxyAgent(proxy) } : { lookup: publicLookup }) }, onResponse);
  } else if (proxy) {
    // Plain http through the proxy: absolute URI to the proxy.
    req = http.request({ host: proxy.hostname, port: proxy.port || 3128, method: 'GET', path: u.href, headers: { ...headers, Host: u.host } }, onResponse);
  } else {
    req = http.request(u, { method: 'GET', headers, lookup: publicLookup }, onResponse);
  }
  req.setTimeout(TIMEOUT_MS, () => req.destroy(new CallDocumentError('The website did not answer in time', 504)));
  req.on('error', (e) => reject(e instanceof CallDocumentError ? e : new CallDocumentError(`The website could not be read: ${e.message}`, 502)));
  req.end();
});

const charsetOf = (contentType: string, body: Buffer): BufferEncoding => {
  const declared = contentType.match(/charset=([^;]+)/i)?.[1] ?? body.subarray(0, 2048).toString('latin1').match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ?? '';
  return /^(iso-8859-1|latin1|windows-1252)$/i.test(declared.trim()) ? 'latin1' : 'utf8';
};

/** Text of a PDF given as bytes (upload or download). */
export const pdfDocument = async (data: Uint8Array, url = ''): Promise<CallDocument> => {
  let raw: string;
  try {
    raw = await pdfToText(data);
  } catch {
    throw new CallDocumentError('The PDF could not be read');
  }
  const text = raw.replace(/\f/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length < 200) throw new CallDocumentError('The PDF has no text layer (scanned document?)');
  return { kind: 'pdf', text, title: '', url };
};

/** Reads the page or PDF at a public URL. */
export async function fetchCallDocument(rawUrl: string, options: { resolve?: (host: string) => Promise<string[]>; get?: (u: URL) => Promise<RawResponse> } = {}): Promise<CallDocument> {
  const get = options.get ?? getOnce;
  let u = await checkPublicUrl(rawUrl, options.resolve);
  for (let hop = 0; ; hop++) {
    const res = await get(u);
    if ([301, 302, 303, 307, 308].includes(res.status) && res.location) {
      if (hop >= MAX_REDIRECTS) throw new CallDocumentError('Too many redirects', 502);
      u = await checkPublicUrl(new URL(res.location, u).href, options.resolve);
      continue;
    }
    if (res.status === 404 || res.status === 410) throw new CallDocumentError('The page does not exist (404)', 404);
    if (res.status < 200 || res.status >= 300) throw new CallDocumentError(`The website answered with an error: HTTP ${res.status}`, 502);
    const isPdf = /application\/pdf/i.test(res.contentType) || res.body.subarray(0, 5).toString('latin1') === '%PDF-';
    if (isPdf) return pdfDocument(new Uint8Array(res.body), u.href);
    if (res.contentType && !/html|xml|text\/plain/i.test(res.contentType)) throw new CallDocumentError(`Unsupported document: ${res.contentType.split(';')[0]}`, 415);
    const html = res.body.toString(charsetOf(res.contentType, res.body));
    return /text\/plain/i.test(res.contentType) ? textDocument(html, u.href) : htmlDocument(html, u.href);
  }
}

/** Text of an HTML page (downloaded, or saved by the person from a website the server cannot reach, e.g. an intranet). */
export const htmlDocument = (html: string, url = ''): CallDocument => {
  const text = pageText(html, htmlToText);
  if (text.length < 200) throw new CallDocumentError('The page has almost no text (built by JavaScript?): upload the PDF of the call instead');
  return { kind: 'html', text, title: htmlToText(pageTitle(html)), url };
};

/** A text pasted by the person. */
export const textDocument = (raw: string, url = ''): CallDocument => {
  const text = raw.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (text.length < 200) throw new CallDocumentError('The text is too short to describe a call');
  return { kind: 'text', text, title: '', url };
};

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) =>
  Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** Fields proposed by the model; null when it gave no usable answer after the retries. */
export async function extractCallFields(document: CallDocument, settings: TranslatorSettings, fetchImpl: Fetch = fetch as unknown as Fetch, retries = 2): Promise<ExtractedCall | null> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetchImpl(`${settings.apiBase}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
        body: JSON.stringify({
          model: settings.model, temperature: 0, max_tokens: 6000, response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: EXTRACTION_SYSTEM }, { role: 'user', content: extractionPrompt(document.text, document.url) }],
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { choices?: { message?: { content?: string } }[] };
      const parsed = parseExtraction(body.choices?.[0]?.message?.content ?? '');
      if (parsed) return parsed;
    } catch {
      // retried below
    }
    if (attempt < retries - 1) await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}
