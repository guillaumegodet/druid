/**
 * @file registryClient.ts
 * @description HTTP side of the registries of research structures (druid-internal docs/plan-druid-saas.md, § 4.2):
 * one `Registry` the alignment engine queries, built on `fetch` (injectable: the tests give it fixtures). Every call
 * is memoized for the run, retried once on a 429 / 5xx, and paced so that the open APIs are not hammered. The OpenAlex
 * key or mailto of the deployment goes on its calls (OPENALEX_API_KEY / OPENALEX_MAILTO).
 */
import {
  HAL_SEARCH_API, IDREF_SOLR, OPENALEX_API, OPENALEX_FIELDS, RNSR_API, ROR_API, WIKIDATA_API, halCollectionFacet, halDocCount, halStructureQuery,
  halStructureRecord, idrefPpnQuery, idrefRecord, idrefSearchQuery, odsLiteral, openalexRecord, rnsrRecord, rorRecord, solrPhrase, wikidataRecord,
  type RegistryRecord,
} from './registries';
import type { StructureIdType } from './identifiers';

export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<any>; text(): Promise<string> }>;

export interface RegistrySearch {
  /** Official name. */
  name: string;
  acronym?: string | null;
  city?: string | null;
  /** Restrict to a country (ROR, OpenAlex). */
  countryCode?: string | null;
}

export interface RegistryLookup {
  get(id: string): Promise<RegistryRecord | null>;
  search(q: RegistrySearch): Promise<RegistryRecord[]>;
}

export interface HalRegistry extends RegistryLookup {
  /** HAL structure records carrying `value` as `type` (`rnsr`, `ror`, `idref`). */
  byLink(type: 'rnsr' | 'ror' | 'idref', value: string): Promise<RegistryRecord[]>;
  /** Collection codes of the documents of a structure record, with the document counts and the total. */
  collections(docid: string): Promise<{ total: number; codes: { code: string; count: number }[] }>;
  /** Documents of a collection code (0 when the collection is unknown). */
  collectionSize(code: string): Promise<number>;
}

export interface Registry {
  rnsr: RegistryLookup;
  ror: RegistryLookup;
  hal: HalRegistry;
  openalex: RegistryLookup & { byRor(ror: string): Promise<RegistryRecord[]> };
  idref: RegistryLookup;
  wikidata: RegistryLookup & { byLink(type: StructureIdType, value: string): Promise<RegistryRecord[]> };
}

export interface RegistryClientOptions {
  fetch?: FetchLike;
  openalexApiKey?: string | null;
  openalexMailto?: string | null;
  /** Pause between two calls to the same host (ms). */
  pauseMs?: number;
  timeoutMs?: number;
  userAgent?: string;
  log?: (line: string) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const notNull = <T>(x: T | null | undefined): x is T => x !== null && x !== undefined;

/** Thin HTTP layer: memo per URL, retry once, one call at a time per host with a pause. */
export const createRegistryClient = (options: RegistryClientOptions = {}): Registry => {
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init as any) as any);
  const pauseMs = options.pauseMs ?? 150;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const userAgent = options.userAgent ?? 'Druid (structure identifiers alignment; https://github.com/guillaumegodet/druid)';
  const log = options.log ?? (() => {});
  const memo = new Map<string, Promise<any>>();
  const lastCall = new Map<string, number>();
  const hostQueue = new Map<string, Promise<void>>();

  const getJson = (url: string): Promise<any> => {
    if (!memo.has(url)) memo.set(url, (async () => {
      const host = new URL(url).host;
      // One request at a time per host, spaced by `pauseMs`.
      const prev = hostQueue.get(host) ?? Promise.resolve();
      let release!: () => void;
      hostQueue.set(host, new Promise<void>((r) => { release = r; }));
      await prev;
      try {
        const wait = (lastCall.get(host) ?? 0) + pauseMs - Date.now();
        if (wait > 0) await sleep(wait);
        // A 429 (OpenAlex shares its quota between every caller behind the same proxy) or a 5xx: up to three more
        // tries, 2 s / 5 s / 12 s apart or what Retry-After says; a network failure: one more try.
        const BACKOFF = [2000, 5000, 12000];
        for (let attempt = 0; ; attempt++) {
          lastCall.set(host, Date.now());
          const controller = typeof AbortController === 'function' ? new AbortController() : null;
          const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
          try {
            const res = await doFetch(url, { headers: { Accept: 'application/json', 'User-Agent': userAgent }, signal: controller?.signal });
            if (res.ok) return await res.json();
            if (res.status === 404) return null;
            if (attempt < BACKOFF.length && (res.status === 429 || res.status >= 500)) {
              const retryAfter = Number((res as any).headers?.get?.('retry-after')) * 1000;
              await sleep(retryAfter > 0 && retryAfter < 60_000 ? retryAfter : BACKOFF[attempt]);
              continue;
            }
            throw new Error(`HTTP ${res.status} ${host}`);
          } catch (err) {
            if (attempt === 0 && !(err instanceof Error && /^HTTP /.test(err.message))) { await sleep(1500); continue; }
            throw err;
          } finally {
            if (timer) clearTimeout(timer);
          }
        }
      } finally {
        release();
      }
    })().catch((err) => { memo.delete(url); log(`${url}: ${err instanceof Error ? err.message : err}`); throw err; }));
    return memo.get(url)!;
  };

  const oaAuth = options.openalexApiKey ? `&api_key=${encodeURIComponent(options.openalexApiKey)}` : options.openalexMailto ? `&mailto=${encodeURIComponent(options.openalexMailto)}` : '';
  const terms = (q: RegistrySearch): string[] => [q.acronym, q.name].map((s) => String(s || '').trim()).filter((s, i, a) => s.length >= 2 && a.indexOf(s) === i);

  const rnsr: RegistryLookup = {
    get: async (id) => rnsrRecord((await getJson(`${RNSR_API}?where=${encodeURIComponent(`numero_national_de_structure=${odsLiteral(id)}`)}&limit=1`))?.results?.[0]),
    search: async (q) => {
      const clauses = terms(q).map((t) => `search(libelle, ${odsLiteral(t)}) OR search(sigle, ${odsLiteral(t)})`);
      if (!clauses.length) return [];
      const data = await getJson(`${RNSR_API}?where=${encodeURIComponent(clauses.join(' OR '))}&limit=20`);
      return (data?.results || []).map(rnsrRecord).filter(notNull);
    },
  };

  const ror: RegistryLookup = {
    get: async (id) => rorRecord(await getJson(`${ROR_API}/${id}`)),
    search: async (q) => {
      const out: RegistryRecord[] = [];
      for (const t of terms(q)) {
        const country = q.countryCode ? `&filter=${encodeURIComponent(`country.country_code:${q.countryCode.toUpperCase()}`)}` : '';
        const data = await getJson(`${ROR_API}?query=${encodeURIComponent(t)}${country}`);
        out.push(...(data?.items || []).map(rorRecord).filter(notNull));
      }
      return out;
    },
  };

  const halList = async (q: string, rows = 10): Promise<RegistryRecord[]> => ((await getJson(halStructureQuery(q, rows)))?.response?.docs || []).map(halStructureRecord).filter(notNull);
  const hal: HalRegistry = {
    get: async (docid) => (await halList(`docid:${docid}`, 1))[0] ?? null,
    byLink: (type, value) => halList(`${type}_s:${solrPhrase(type === 'ror' ? `https://ror.org/${value}` : value)}`, 10),
    search: async (q) => {
      const out: RegistryRecord[] = [];
      for (const t of terms(q)) out.push(...await halList(`text:${solrPhrase(t)}`, 15));
      return out;
    },
    collections: async (docid) => {
      const data = await getJson(`${HAL_SEARCH_API}?q=${encodeURIComponent(`structId_i:${docid}`)}&rows=0&facet=true&facet.field=collCode_s&facet.limit=30&facet.mincount=1&wt=json`);
      return { total: halDocCount(data), codes: halCollectionFacet(data) };
    },
    collectionSize: async (code) => halDocCount(await getJson(`${HAL_SEARCH_API}?q=${encodeURIComponent(`collCode_s:${solrPhrase(code)}`)}&rows=0&wt=json`)),
  };

  const openalex: Registry['openalex'] = {
    get: async (id) => openalexRecord(await getJson(`${OPENALEX_API}/${id}?select=${OPENALEX_FIELDS}${oaAuth}`)),
    byRor: async (r) => ((await getJson(`${OPENALEX_API}?filter=${encodeURIComponent(`ror:https://ror.org/${r}`)}&select=${OPENALEX_FIELDS}${oaAuth}`))?.results || []).map(openalexRecord).filter(notNull),
    search: async (q) => {
      const out: RegistryRecord[] = [];
      for (const t of terms(q)) {
        const country = q.countryCode ? `&filter=${encodeURIComponent(`country_code:${q.countryCode.toUpperCase()}`)}` : '';
        const data = await getJson(`${OPENALEX_API}?search=${encodeURIComponent(t)}${country}&per-page=10&select=${OPENALEX_FIELDS}${oaAuth}`);
        out.push(...(data?.results || []).map(openalexRecord).filter(notNull));
      }
      return out;
    },
  };

  const idref: RegistryLookup = {
    get: async (ppn) => idrefRecord((await getJson(idrefPpnQuery(ppn)))?.response?.docs?.[0]),
    search: async (q) => {
      const out: RegistryRecord[] = [];
      for (const t of terms(q)) out.push(...((await getJson(idrefSearchQuery(`${t}${q.city ? ` ${q.city}` : ''}`, 10)))?.response?.docs || []).map(idrefRecord).filter(notNull));
      return out;
    },
  };

  const wdEntities = async (ids: string[]): Promise<RegistryRecord[]> => {
    if (!ids.length) return [];
    const data = await getJson(`${WIKIDATA_API}?action=wbgetentities&ids=${ids.slice(0, 20).join('|')}&props=labels|aliases|claims&languages=fr|en&format=json`);
    return Object.values(data?.entities || {}).map(wikidataRecord).filter(notNull);
  };
  const WD_PROP_OF: Partial<Record<StructureIdType, string>> = { ror: 'P6782', grid: 'P2427', isni: 'P213', idref: 'P269', openalex: 'P10283' };
  const wikidata: Registry['wikidata'] = {
    get: async (id) => (await wdEntities([id]))[0] ?? null,
    byLink: async (type, value) => {
      const prop = WD_PROP_OF[type];
      if (!prop) return [];
      const data = await getJson(`${WIKIDATA_API}?action=query&list=search&srsearch=${encodeURIComponent(`haswbstatement:${prop}=${value}`)}&srlimit=5&format=json`);
      return wdEntities((data?.query?.search || []).map((s: any) => String(s.title)).filter((t: string) => /^Q\d+$/.test(t)));
    },
    search: async (q) => {
      const found: string[] = [];
      for (const t of terms(q)) {
        const data = await getJson(`${WIKIDATA_API}?action=wbsearchentities&search=${encodeURIComponent(t)}&language=fr&uselang=fr&type=item&limit=7&format=json`);
        found.push(...(data?.search || []).map((s: any) => String(s.id)).filter((id: string) => /^Q\d+$/.test(id)));
      }
      return wdEntities([...new Set(found)]);
    },
  };

  return { rnsr, ror, hal, openalex, idref, wikidata };
};
