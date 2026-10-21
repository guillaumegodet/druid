// Pure rules of the jobs of a tenant (druid-internal docs/plan-druid-saas.md, lot 3): parameters and keys, legacy
// progress, the estimate of a people run, the ETL configuration, the secrets, the S3 signature, the night window.
import { describe, expect, it } from 'vitest';
import { StructureLevel, StructureStatus, type Structure } from '../../types';
import { estimateAlignment, alignGroupOf, alignTargetOf } from '../saas/alignEstimate';
import { dashboardIndexOf, etlLabsOf, labSlugOf, yamlOf } from '../saas/etlConfig';
import { jobKeyOf, legacyProgressOf, parseJobParams, peopleAlignParamsOfQuery, structuresAlignParamsOfQuery } from '../saas/jobs';
import { EMPTY_PAYLOAD_HASH, canonicalUri, memoryAssetStore, createS3AssetStore, signS3Request } from '../saas/r2';
import { childEnvOf, inNightWindow } from '../saas/runner';
import { decryptSecret, encryptSecret, generateSecretsKey } from '../saas/secrets';

describe('job parameters and keys', () => {
  it('people.align: query string → params, defaults, idref search only', () => {
    const q = new URLSearchParams('mode=verify&labo=ls2n&group=doctorants&force=1&limit=50&record=12');
    const parsed = parseJobParams('people.align', peopleAlignParamsOfQuery('orcid', q));
    expect(parsed).toEqual({ ok: true, params: { source: 'orcid', mode: 'verify', labo: 'LS2N', group: 'doctorants', force: true, limit: 50, record: 12 } });
    const idref = parseJobParams('people.align', peopleAlignParamsOfQuery('idref', new URLSearchParams('mode=align')));
    expect(idref.ok && idref.params.mode).toBe('search');
    expect(parseJobParams('people.align', { source: 'idref', mode: 'verify' }).ok).toBe(false);
    expect(parseJobParams('people.align', { source: 'wos' }).ok).toBe(false);
    expect(parseJobParams('nope', {}).ok).toBe(false);
    expect(jobKeyOf('people.align', { source: 'hal' })).toBe('people.align:hal');
    expect(jobKeyOf('etl.build', {})).toBe('etl.build');
  });
  it('structures.align and etl.build', () => {
    const s = parseJobParams('structures.align', structuresAlignParamsOfQuery(new URLSearchParams('mode=verify&types=ror,hal_struct&only=LS2N&limit=5')));
    expect(s).toEqual({ ok: true, params: { mode: 'verify', types: ['ror', 'hal_struct'], only: ['LS2N'], force: false, limit: 5, thenEtl: false } });
    expect(parseJobParams('structures.align', { types: ['DROP TABLE'] }).ok).toBe(false);
    expect(parseJobParams('etl.build', { slugs: ['ls2n'] })).toEqual({ ok: true, params: { slugs: ['ls2n'], redownloadBso: false } });
  });
  it('legacy progress of a job row', () => {
    const base: any = { id: 'j1', status: 'running', progress: { total: 10, done: 4, mode: 'search', step: 'running', pct: 40 }, log: null, started_at: 's', finished_at: null };
    expect(legacyProgressOf(base)).toMatchObject({ running: true, total: 10, done: 4, mode: 'search', step: 'running', jobId: 'j1', queued: false });
    expect(legacyProgressOf({ ...base, status: 'queued' })).toMatchObject({ running: true, queued: true });
    expect(legacyProgressOf({ ...base, status: 'failed', log: 'a\nfailed: boom' })).toMatchObject({ running: false, error: 'failed: boom' });
    expect(legacyProgressOf({ ...base, status: 'cancelled' })).toMatchObject({ running: false, stopped: true });
    expect(legacyProgressOf(null)).toEqual({ running: false, total: 0, done: 0 });
  });
});

describe('estimate of a people run', () => {
  const rec = (id: number, fields: Record<string, any>) => ({ id, fields: { Nom: `N${id}`, Prenom: 'P', ...fields } });
  const records = [
    rec(1, { uid_dyna: 'u1', LABO: 'LS2N', ORCID: '', IdHAL: '', OpenAlex_ids: '', ID_SCOPUS: 0 }),
    rec(2, { uid_dyna: 'u2', LABO: 'LS2N', ORCID: '0000-0000-0000-0000', IdHAL: 'x', OpenAlex_ids: 'A1234567', ID_SCOPUS: 123456 }),
    rec(3, { LABO: 'GEM', TYPE_EMPLOI: 'DOCTORANT', ORCID: '', IdHAL_i: '42', OpenAlex_ids: '', statut_dyna: 'DEPART' }),
    rec(4, { LABO: 'GEM', LIB_TYPE_EMPLOI: "Personnel n'ayant pas d'obligation statutaire de recherche", ORCID: '', ID_SCOPUS: 'absent' }),
  ];
  it('eligible and pending per source, groups and labs', () => {
    expect(alignGroupOf(alignTargetOf(records[2]))).toBe('doctorants');
    expect(alignGroupOf(alignTargetOf(records[3]))).toBe('hors_recherche');
    const caches = { orcid_align_cache: { u1: { mode: 'search', status: 'ok' }, g4: { mode: 'search', status: 'error' } } };
    const search = estimateAlignment(records, caches, { mode: 'search' });
    expect(search.orcid).toEqual({ eligible: 3, pending: 2, unit: { requests: 3 } });
    expect(search.hal!.eligible).toBe(2);                      // u1 and g4: 3 has an IdHAL_i (verified, not searched)
    expect(search.openalex!.eligible).toBe(2);                 // 3 left (DEPART)
    expect(search.scopus!.eligible).toBe(2);                   // 4 marked absent
    expect(search.idref!.eligible).toBe(4);
    expect(estimateAlignment(records, {}, { mode: 'search', labo: 'ls2n' }).orcid!.eligible).toBe(1);
    expect(estimateAlignment(records, {}, { mode: 'search', group: 'doctorants' }).orcid!.eligible).toBe(1);
    const verify = estimateAlignment(records, {}, { mode: 'verify' }, ['orcid', 'idref', 'scopus']);
    expect(verify.orcid!.eligible).toBe(1);
    expect(verify.idref).toBeUndefined();
    expect(verify.scopus).toEqual({ eligible: 1, pending: 1, unit: { author: 0.04 } });
  });
});

describe('ETL configuration', () => {
  const lab = (over: Partial<Structure>): Structure => ({
    id: '', level: StructureLevel.ENTITE, nature: 'PUBLIC' as any, type: 'UMR', acronym: 'LS2N', officialName: 'Laboratoire des sciences du numérique',
    code: '6004', rnsrId: '201722241F', status: StructureStatus.ACTIVE, historyLinks: [], primaryMission: 'RECHERCHE' as any, scientificDomains: [], ercFields: [],
    director: '', supervisors: [], doctoralSchools: [], address: '', zipCode: '', city: '', country: '', identifiers: { openalexIds: ['I4210100000'] }, ...over,
  } as Structure);
  it('one config per lab with a key, years capped by the plan, YAML druid-biblio reads', () => {
    const now = new Date('2026-10-21T00:00:00Z');
    const report = etlLabsOf([
      lab({}),
      lab({ acronym: 'CRCI²NA', rnsrId: '', identifiers: {}, halCollectionUrl: 'CRCI2NA' }),
      lab({ acronym: 'NOTHING', rnsrId: '', identifiers: {} }),
      lab({ acronym: 'TEAM', level: StructureLevel.EQUIPE }),
      lab({ acronym: 'ls2n' }),
    ], { historyYears: 3, mailto: 'ops@example.org', now });
    expect(report.labs.map((l) => l.slug)).toEqual(['ls2n', 'crci2na']);
    expect(report.skipped).toEqual([{ acronym: 'NOTHING', reason: 'no OpenAlex id, RNSR or HAL collection' }, { acronym: 'ls2n', reason: 'slug ls2n already used' }]);
    const c = report.labs[0].config;
    expect(c).toMatchObject({ acronym: 'LS2N', openalex_id: 'I4210100000', year_from: 2024, year_to: 2026, bso_markers: ['201722241f', 'ls2n'], hal_collection: '', mailto: 'ops@example.org' });
    expect(String(c.bso_url)).toContain('bso-publications-latest_201722241F_enriched.jsonl.gz');
    expect(report.labs[1].config).toMatchObject({ openalex_id: '', bso_url: '', hal_collection: 'CRCI2NA', bso_markers: ['crci2na'] });
    expect(etlLabsOf([lab({})], { historyYears: null, mailto: null, now }).labs[0].config.year_from).toBe(2016);
    const yaml = yamlOf({ ...c, name: 'Lab: with colon', teams: [], team_aliases: {}, bso_markers: ['a', '1'], grist: { labo_acronyme: 'LS2N' }, flag: true, n: 0, empty: '' });
    expect(yaml).toContain("name: 'Lab: with colon'\n");
    expect(yaml).toContain('teams: []\nsous_structures: []');
    expect(yaml).toContain('team_aliases: {}');
    expect(yaml).toContain("bso_markers:\n- a\n- '1'\n");
    expect(yaml).toContain('grist:\n  labo_acronyme: LS2N\n');
    expect(yaml).toContain("flag: true\nn: 0\nempty: ''\n");
    expect(labSlugOf('CRCI²NA')).toBe('crci2na');
    expect(dashboardIndexOf(report.labs)).toEqual({ slugs: ['ls2n', 'crci2na'], groups: [], tabsHidden: { ls2n: ['benchmark'], crci2na: ['benchmark'] } });
  });
});

describe('secrets', () => {
  it('AES-GCM round trip, fresh iv, wrong key refused', async () => {
    const key = generateSecretsKey();
    const a = await encryptSecret(key, 'elsevier-key');
    const b = await encryptSecret(key, 'elsevier-key');
    expect(a.iv).not.toBe(b.iv);
    expect(await decryptSecret(key, a)).toBe('elsevier-key');
    await expect(decryptSecret(generateSecretsKey(), a)).rejects.toThrow();
    await expect(encryptSecret('short', 'x')).rejects.toThrow(/32 bytes/);
  });
});

describe('S3 signature (R2)', () => {
  it('matches the GET Object example of the AWS documentation', () => {
    // https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html — examplebucket/test.txt, 2013-05-24.
    const signed = signS3Request({
      method: 'GET', url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      headers: { Range: 'bytes=0-9' }, payloadHash: EMPTY_PAYLOAD_HASH, amzDate: '20130524T000000Z', region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    });
    expect(signed.authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
    expect(canonicalUri('/a b/c%20d/é')).toBe('/a%20b/c%20d/%C3%A9');
  });
  it('the store PUTs path-style with a signed payload and tolerates a 404 on DELETE', async () => {
    const calls: { url: string; method: string; headers: Record<string, string>; body: Uint8Array | undefined }[] = [];
    const fetchImpl = (async (url: any, init: any) => {
      calls.push({ url: String(url), method: init.method, headers: init.headers, body: init.body });
      return new Response(null, { status: init.method === 'DELETE' ? 404 : 200 });
    }) as unknown as typeof fetch;
    const store = createS3AssetStore({ endpoint: 'https://acc.r2.cloudflarestorage.com/', bucket: 'druid-saas', accessKeyId: 'k', secretAccessKey: 's', fetchImpl, now: () => new Date('2026-10-21T10:00:00Z') });
    await store.put('t1/dashboard-data/ls2n/dashboard.json.gz', new Uint8Array([1, 2, 3]), 'application/gzip');
    await store.delete('t1/dashboard-data/index.json');
    expect(calls[0]).toMatchObject({ url: 'https://acc.r2.cloudflarestorage.com/druid-saas/t1/dashboard-data/ls2n/dashboard.json.gz', method: 'PUT' });
    expect(calls[0].headers['x-amz-date']).toBe('20261021T100000Z');
    expect(calls[0].headers['content-type']).toBe('application/gzip');
    expect(calls[0].headers['x-amz-content-sha256']).toBe('039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81');
    expect(calls[0].headers.authorization).toMatch(/SignedHeaders=content-length;content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
    expect(calls[1].method).toBe('DELETE');
    const mem = memoryAssetStore();
    await mem.put('a', new Uint8Array([1]));
    expect(mem.objects.get('a')?.contentType).toBe('application/octet-stream');
  });
});

describe('runner rules', () => {
  it('night window, child environment', () => {
    expect(inNightWindow(new Date('2026-10-21T22:00:00Z'), [20, 6])).toBe(true);
    expect(inNightWindow(new Date('2026-10-21T03:00:00Z'), [20, 6])).toBe(true);
    expect(inNightWindow(new Date('2026-10-21T12:00:00Z'), [20, 6])).toBe(false);
    expect(inNightWindow(new Date('2026-10-21T12:00:00Z'), [8, 18])).toBe(true);
    const env = childEnvOf({ DRUID_DATABASE_SCHEMA: 't_x', EMPTY: '', SCOPUS_API_KEY: 'k' }, { PATH: '/bin', SAAS_SECRETS_KEY: 'no', DATABASE_URL: 'no', RESEND_API_KEY: 'no', HTTPS_PROXY: 'p' });
    expect(env).toEqual({ PATH: '/bin', HTTPS_PROXY: 'p', DRUID_DATABASE_SCHEMA: 't_x', SCOPUS_API_KEY: 'k' });
  });
});
