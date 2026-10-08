// Contract of the LDAP review and alignment commands (druid-internal docs/plan-migration-postgresql.md, lot 6 d): the
// same commands, run on the Grist implementation (in-memory Grist) and on the PostgreSQL one (the same fixture
// imported), with the same LDAP and alignment caches, compute the same diffs, write the same cells and the same reviews,
// and refuse the same things. Needs DATABASE_URL (druid_owner: the import empties tables); run by the « database » CI
// job and `npm run test:db`. Rolled back: nothing is left in the database.
import { afterAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'kysely';
import { createDb } from '../db/client';
import type { CommandContext } from '../directory/commands';
import { createGristDirectoryCommands } from '../directory/commands';
import { createGristDirectoryRepository, type DirectoryRepository, type DirectoryScope } from '../directory/repository';
import { createGristLdapCommands, type LdapCommands, type LdapSource } from '../directory/ldapCommands';
import { createGristAlignCommands, type AlignCacheSource, type AlignCommands } from '../directory/alignCommands';
import { tokenAlignTexts } from '../directory/alignTexts';
import { UNIFIED_ALIGN_SOURCES, unifiedAmbigKey, unifiedCandidateId, unifiedFillKey, type UnifiedAlignDiff, type UnifiedAlignSource } from '../directory/alignments';
import { createPgDirectoryRepository } from '../directory/pg/repository';
import { createPgLdapCommands } from '../directory/pg/ldapCommands';
import { createPgAlignCommands } from '../directory/pg/alignCommands';
import { REVIEW_ID_COLUMN, readReviewRecords } from '../directory/pg/review';
import { transformDirectory } from '../migration/gristToPg';
import { transformWork } from '../migration/gristToPgWork';
import { loadDirectory, loadWork } from '../migration/loadPg';
import { gristDirectoryFixture, row } from './fixtures/gristDirectory';
import { gristWorkFixture } from './fixtures/gristWork';
import { memoryGrist } from './fixtures/memoryGrist';

const url = process.env.DATABASE_URL;
const db = url ? createDb({ connectionString: url, max: 1 }) : null;
afterAll(async () => { await db?.destroy(); });
vi.setConfig({ testTimeout: 60000 });
class Rollback extends Error {}

/** Paths where two JSON values differ, to read a failed contract. */
const differences = (a: unknown, b: unknown, path = ''): string[] => {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const keys = [...new Set([...Object.keys(a as object), ...Object.keys(b as object)])];
    return keys.flatMap((k) => differences((a as any)[k], (b as any)[k], `${path}${Array.isArray(a) ? `[${k}]` : `.${k}`}`));
  }
  return [`${path}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`];
};

const ALL: DirectoryScope = { all: true, labAnchors: [] };
const ctxOf = (scope: DirectoryScope = ALL): CommandContext => ({ scope, actor: 'contract', audit: () => {} });
const TODAY = () => '2026-10-09';
const REVIEW_TABLES: Record<UnifiedAlignSource, string> = {
  idref: 'Alignement_IdRef', orcid: 'Alignement_ORCID', hal: 'Alignement_HAL', openalex: 'Alignement_OpenAlex', scopus: 'Alignement_Scopus',
};

// Fictitious people of this test, single-row (the multi-row group of the fixture is one person in PostgreSQL —
// documented, compared by the duplicates contract).
const PEOPLE = [
  row(120, { ANNEE_HDR: '', uid_dyna: 'lemoine-e', Nom: 'Lemoine', Prenom: 'Emma', Civilite: 'M', LABO: 'LAB1', Employeur: 1, Email: 'e.lemoine@example.org',
    IdRef: '000000035', Corps_grade: 'MCF', statut_dyna: 'NORMAL', Data_source: 'LAB', Commentaires: '' }),
  row(121, { ANNEE_HDR: '', uid_dyna: 'roux-f', Nom: 'Roux', Prenom: 'Fabien', LABO: 'LAB2', Employeur: 1, statut_dyna: 'NORMAL', employment_end_date: '' }),
  row(122, { ANNEE_HDR: '', uid_dyna: 'faure-g', Nom: 'Faure', Prenom: 'Gaël', LABO: 'LAB1', Employeur: 2, OpenAlex_ids: 'A10', IdRef: '000000078', IdHAL: 'gael-faure' }),
  row(123, { ANNEE_HDR: '', uid_dyna: '', Nom: 'Sans', Prenom: 'Uid', LABO: 'LAB2', Email: 'sans.uid@example.org' }),
];
const LDAP_STATUS: Record<string, any> = {
  'lemoine-e': { etat: 'N', categorie: 'TITULAIRE', empCorps: '300', civilite: 'Mme', birthDate: '1985-02-03', eppn: 'lemoine-e@example.org', dateFin: '', empId: '111' },
  'roux-f': { etat: 'D', categorie: 'CONTRACTUEL', empCorps: 'CDD', civilite: 'M.', birthDate: '', eppn: 'roux-f@example.org', dateFin: '2026-08-31', empId: '' },
  'faure-g': { etat: 'N', categorie: 'TITULAIRE', empCorps: '301', civilite: 'M.', birthDate: '', eppn: 'faure-g@example.org', dateFin: '', empId: '222' },
  'petit-d': { etat: 'N', categorie: 'DOCTORANT', empCorps: 'CN322', civilite: 'M.', birthDate: '', eppn: 'petit-d@example.org', dateFin: '2028-08-31', empId: '' },
  'leroy-z': { etat: 'N', categorie: 'TITULAIRE', empCorps: '300', civilite: 'Mme', birthDate: '', eppn: 'leroy-z@example.org', dateFin: '', empId: '' },
};
const LDAP_CANDIDATES = {
  proposals: [{ gristRowId: 123, nom: 'Sans', prenom: 'Uid', email: 'sans.uid@example.org', labo: 'LAB2', matchedBy: 'email',
    ldap: { uid: 'sans-u', displayName: 'Uid Sans', sn: 'Sans', givenName: 'Uid', etat: 'N', categorie: 'TITULAIRE', civilite: 'M.' } }],
  ambiguous: [{ gristRowId: 103, email: 'bob@example.org', candidates: [{ uid: 'martin-b', displayName: 'Bob Martin', civilite: 'M.' }, { uid: 'martin-b2', displayName: 'Bob Martin' }] }],
};
const LDAP_STRUCTURES = {
  lab1: { code: 'U-LAB1', type: 'UMR', ou: 'Laboratoire Un LAB1', ouLeaf: 'Laboratoire Un LAB1', parent: '' },
  lab2: { code: 'U-LAB2', type: 'UMR', ou: 'Laboratoire Deux LAB2', ouLeaf: 'Laboratoire Deux LAB2', parent: '' },
  team: { code: 'U-TEAM1', type: 'ER', ou: 'Equipe A TEAMA', ouLeaf: 'Equipe A TEAMA', parent: 'U-LAB1' },
  new: { code: 'U-NEW', type: 'ER', ou: 'Equipe NOUVELLE', ouLeaf: 'Equipe NOUVELLE', parent: 'U-LAB1' },
};
// ORCIDs with a wrong check digit (fictitious).
const cand = (over: Record<string, any>) => ({ forms: [], evidence: [], matchedIds: [], nameMatch: 'exact', suspect: [], ...over });
const ALIGN_CACHES: Record<string, any> = {
  idref_align_cache: {
    'lemoine-e': { mode: 'verify', queryName: 'Emma Lemoine', ppn: '000000035', status: 'redirected', newPpn: '000000043', nameMismatch: false,
      candidates: [{ ppn: '000000043', fullName: 'Lemoine, Emma', orcid: '', idhal: '', externalIds: {}, affiliations: [], notes: [] }], checkedAt: '2026-10-01' },
    'faure-g': { mode: 'verify', queryName: 'Gaël Faure', ppn: '000000078', status: 'checked', nameMismatch: true,
      candidates: [{ ppn: '000000078', fullName: 'Fort, Gilles', orcid: '0000-0002-0000-0001', idhal: '', externalIds: {}, affiliations: [], notes: [] }], checkedAt: '2026-10-01' },
    'roux-f': { mode: 'search', queryName: 'Fabien Roux', status: 'found',
      candidates: [{ ppn: '000000051', fullName: 'Roux, Fabien', orcid: '', idhal: 'fabien-roux', externalIds: {}, affiliations: [], notes: [] }], checkedAt: '2026-10-01' },
  },
  orcid_align_cache: {
    'lemoine-e': { mode: 'search', queryName: 'Emma LEMOINE', status: 'found', best: '0000-0002-0000-0007', derivedFrom: [], fallback: false,
      candidates: [cand({ orcid: '0000-0002-0000-0007', fullName: 'Emma Lemoine', score: 'fort', evidence: ['email'] })], checkedAt: '2026-10-01' },
    'roux-f': { mode: 'search', queryName: 'Fabien ROUX', status: 'ambiguous', best: '', derivedFrom: [], fallback: false,
      candidates: [cand({ orcid: '0000-0002-0000-0015', fullName: 'Fabien Roux', score: 'moyen' }), cand({ orcid: '0000-0002-0000-0023', fullName: 'F. Roux', score: 'moyen' })], checkedAt: '2026-10-01' },
    g123: { mode: 'search', queryName: 'Uid SANS', status: 'ambiguous', best: '', derivedFrom: [], fallback: false,
      candidates: [cand({ orcid: '0000-0002-0000-0031', fullName: 'Uid Sans', score: 'moyen' }), cand({ orcid: '0000-0002-0000-0040', fullName: 'U. Sans', score: 'faible' })], checkedAt: '2026-10-01' },
  },
  hal_align_cache: {
    'roux-f': { mode: 'search', queryName: 'Fabien Roux', status: 'found', best: 'fabien-roux', derivedFrom: [],
      candidates: [cand({ idhal: 'fabien-roux', idhalI: '123456', fullName: 'Fabien Roux', score: 'fort', labs: ['LAB2'], nbDocs: 12, evidence: ['labo'] })], checkedAt: '2026-10-01' },
    'faure-g': { mode: 'verify', queryName: 'Gaël Faure', status: 'checked', candidates: [], checkedAt: '2026-10-01' },
  },
  openalex_align_cache: {
    'faure-g': { mode: 'search', queryName: 'Gaël Faure', status: 'found', best: ['A11'], direct: ['A11'], derivedFrom: [],
      candidates: [cand({ id: 'A11', fullName: 'Gaël Faure', worksCount: 20, score: 'fort', evidence: ['ikg'] })], checkedAt: '2026-10-01' },
    'roux-f': { mode: 'search', queryName: 'Fabien Roux', status: 'ambiguous', best: [], derivedFrom: [],
      candidates: [cand({ id: 'A20', fullName: 'Fabien Roux', worksCount: 5, score: 'moyen' }), cand({ id: 'A21', fullName: 'F. Roux', worksCount: 2, score: 'moyen' })], checkedAt: '2026-10-01' },
  },
  scopus_align_cache: {
    'lemoine-e': { mode: 'search', queryName: 'Emma Lemoine', status: 'found', best: '57000000001', derivedFrom: [], fallback: false,
      candidates: [cand({ id: '57000000001', fullName: 'Lemoine, Emma', docCount: 8, affiliation: 'Nantes Université', score: 'fort', evidence: ['affiliation'] })], checkedAt: '2026-10-01' },
  },
};

interface Store { repo: DirectoryRepository; ldap: LdapCommands; align: AlignCommands; reviews: (src: UnifiedAlignSource) => Promise<{ fields: Record<string, any> }[]> }
const withoutDate = <T>(x: T): T => (x && typeof x === 'object' ? { ...x, generatedAt: '' } : x);
const attempt = (p: Promise<unknown>) => p.then((x) => withoutDate(x), (e) => `${e.status ?? ''} ${e.message}`);
const lab2 = ctxOf({ all: false, labAnchors: ['lab2'] });

/** One step of the scenario, run on both stores: its result (or error), then what the directory reads. */
type Step = (s: Store) => Promise<unknown>;
const STEPS: [string, Step][] = [
  ['LDAP diff, then apply every proposed update', async (s) => {
    const diff = await s.ldap.diff();
    return [withoutDate(diff), await s.ldap.applyUpdates(diff.aMettreAJour.map((r) => r.id), ctxOf()), withoutDate(await s.ldap.diff())];
  }],
  ['LDAP candidates: diff, apply (a forged uid and an ambiguous choice), refusals', async (s) => [
    await s.ldap.candidatesDiff(),
    await s.ldap.applyCandidates([{ gristRowId: 123, uid: 'sans-u' }, { gristRowId: 123, uid: 'forged' }, { gristRowId: 103, uid: 'martin-b2' }], ctxOf()),
    await attempt(s.ldap.applyCandidates([{ gristRowId: 123, uid: 'sans-u' }], lab2)),
  ]],
  ['mark departed: a single-row record, an unknown uid', async (s) => [
    await s.ldap.markDeparted('faure-g', '2026-09-30', 'compte fermé', ctxOf()),
    await s.ldap.markDeparted('nobody', '2026-09-30', 'compte fermé', ctxOf()),
    await attempt(s.ldap.markDeparted('roux-f', '2026-09-30', '', lab2)),
  ]],
  ['structures: diff, apply updates and creations, diff after', async (s) => {
    const diff = await s.ldap.structuresDiff();
    return [withoutDate(diff), await s.ldap.applyStructures(diff.aMettreAJour.map((r) => r.id), diff.aCreer.map((r) => r.local_id), ctxOf()),
      withoutDate(await s.ldap.structuresDiff())];
  }],
  ['alignment diffs (search, verify) and refusals', async (s) => [
    withoutDate(await s.align.unifiedDiff(UNIFIED_ALIGN_SOURCES, 'search', ctxOf())),
    withoutDate(await s.align.unifiedDiff(UNIFIED_ALIGN_SOURCES, 'verify', ctxOf())),
    await attempt(s.align.unifiedDiff(['orcid'], 'search', lab2)),
    await attempt(s.align.applyRedirection('G-120', '999999999', ctxOf())),
  ]],
  ['reject candidates (ambiguous ones, the strong IdRef one), then change the decision', async (s) => {
    const diff = await s.align.unifiedDiff(UNIFIED_ALIGN_SOURCES, 'search', ctxOf());
    const out: number[] = [];
    for (const r of diff.rows) for (const src of UNIFIED_ALIGN_SOURCES) {
      const cell = r.sources[src];
      // The last candidate of an ambiguous case, and the strong IdRef one (the IdRef reviews are written apart).
      const candidates = cell?.ambiguous?.candidates ?? (src === 'idref' ? cell?.fill?.map((f) => f.candidate) : undefined) ?? [];
      if (!candidates.length) continue;
      const rejection = { source: src, row: { id: r.id, uid: r.uid, displayName: r.displayName, labo: r.labo }, candidate: candidates[candidates.length - 1],
        candidateCount: candidates.length, decision: 'Rejeté' as const, note: `contrat ${src} ` };
      out.push(await s.align.reject(rejection, ctxOf()).then((x) => x.rejected));
      out.push(await s.align.reject({ ...rejection, decision: 'Identité mêlée', note: 'mêlée' }, ctxOf()).then((x) => x.rejected));
    }
    return [out, withoutDate(await s.align.unifiedDiff(UNIFIED_ALIGN_SOURCES, 'search', ctxOf()))];
  }],
  ['apply the selection: every strong candidate, the first ambiguous one', async (s) => {
    const diff = await s.align.unifiedDiff(UNIFIED_ALIGN_SOURCES, 'search', ctxOf());
    const selected: string[] = [];
    const chosen: Record<string, string> = {};
    for (const r of diff.rows) for (const src of UNIFIED_ALIGN_SOURCES) {
      const cell = r.sources[src];
      for (const f of cell?.fill || []) selected.push(unifiedFillKey(r.id, src, unifiedCandidateId(src, f.candidate)));
      if (cell?.ambiguous?.candidates.length) chosen[unifiedAmbigKey(r.id, src)] = unifiedCandidateId(src, cell.ambiguous.candidates[0]);
    }
    return [await s.align.applySelection({ mode: 'search', selected, chosen, decisions: {} }, ctxOf()),
      await attempt(s.align.applySelection({ mode: 'search', selected, chosen, decisions: {} }, lab2)),
      withoutDate(await s.align.unifiedDiff(UNIFIED_ALIGN_SOURCES, 'search', ctxOf()))];
  }],
  ['verify: the replaced IdRef record, the name mismatch confirmed', async (s) => {
    const diff: UnifiedAlignDiff = await s.align.unifiedDiff(UNIFIED_ALIGN_SOURCES, 'verify', ctxOf());
    const redirections = diff.rows.filter((r) => r.sources.idref?.redirection).map((r) => [r.id, r.sources.idref!.redirection!.ppn] as const);
    const decisions = Object.fromEntries(diff.rows.filter((r) => r.sources.idref?.arbitrate).map((r) => [unifiedAmbigKey(r.id, 'idref'), 'confirm' as const]));
    const out: unknown[] = [redirections, Object.keys(decisions)];
    for (const [id, ppn] of redirections) out.push(await s.align.applyRedirection(id, ppn, ctxOf()));
    out.push(await s.align.applySelection({ mode: 'verify', selected: [], chosen: {}, decisions }, ctxOf()));
    out.push(withoutDate(await s.align.unifiedDiff(UNIFIED_ALIGN_SOURCES, 'verify', ctxOf())));
    return out;
  }],
];

describe.skipIf(!url)('LdapCommands and AlignCommands contract: Grist = PostgreSQL', () => {
  it('the same commands compute the same diffs and leave the same directory and reviews', async () => {
    const dir = gristDirectoryFixture();
    dir.Annuaire!.push(...PEOPLE);
    // The structures the import leaves out (a duplicated local_id, no local_id) are left out of both stores here.
    dir.Structures = dir.Structures!.filter((x) => ![13, 14].includes(x.id));
    const work = gristWorkFixture();
    work.Alignement_Scopus = [];
    const gristClient = memoryGrist({
      Annuaire: dir.Annuaire!, Etablissements: dir.Etablissements!, Structures: dir.Structures!, Fusions_log: work.Fusions_log!,
      ...Object.fromEntries(UNIFIED_ALIGN_SOURCES.map((src) => [REVIEW_TABLES[src], (work as any)[REVIEW_TABLES[src]] || []])),
    });
    const ldap: LdapSource = {
      status: async () => ({ data: LDAP_STATUS, version: '1' }), candidates: async () => LDAP_CANDIDATES as any, structures: async () => LDAP_STRUCTURES,
    };
    const caches: AlignCacheSource = { read: async (name) => ALIGN_CACHES[name] ?? null };
    const loadLdapCache = async () => ({ data: LDAP_STATUS, version: '1' });
    const gristRepo = createGristDirectoryRepository({ grist: gristClient, loadLdapCache });
    const { annuaireColumns } = createGristDirectoryCommands({ grist: gristClient, repository: gristRepo, today: TODAY });
    const grist: Store = {
      repo: gristRepo,
      ldap: createGristLdapCommands({ grist: gristClient, repository: gristRepo, ldap, annuaireColumns, today: TODAY }),
      align: createGristAlignCommands({ grist: gristClient, repository: gristRepo, caches, texts: tokenAlignTexts, hasQualinka: false, annuaireColumns, today: TODAY }),
      reviews: (src) => gristClient.records(REVIEW_TABLES[src]),
    };
    // The 101 / 102 group of the fixture has personal fields that diverge on purpose (one person in PostgreSQL).
    const read = async (s: Store) => ({
      people: (await s.repo.people(ALL)).items.filter((p) => p.uid !== 'dupont-a').map((p) => ({ ...p, lastSync: '' })),
      structures: (await s.repo.structures()).items,
      reviews: await reviews(s),
    });
    /**
     * Reviews: the person, the candidate, the decision — once per key (the import keeps one review of a duplicated
     * key, and none of a person absent from the directory). A review names a record without uid as `g<record id>`;
     * once the record gets a uid, the PostgreSQL review follows the person (it is linked to it) while the Grist row
     * keeps the old name: named here by the record's current uid on both stores (documented difference).
     */
    const reviews = async (s: Store) => {
      const uidOf = new Map((await s.repo.people(ALL)).items.map((p) => [`g${p.gristRowId}`, p.uid || `g${p.gristRowId}`]));
      return Object.fromEntries(await Promise.all(UNIFIED_ALIGN_SOURCES.map(async (src) => [src, [...new Set((await s.reviews(src))
        .filter((r) => r.fields.uid_dyna !== 'nobody')
        .map((r) => JSON.stringify([uidOf.get(String(r.fields.uid_dyna)) ?? String(r.fields.uid_dyna).toLowerCase(), r.fields[REVIEW_ID_COLUMN[src]],
          r.fields.Decision, r.fields.Note || '', !!r.fields.Applique])))].sort()])));
    };
    // Rows of the dupont-a group in the diffs: one person in PostgreSQL (see above).
    const outsideGroup = (x: unknown) => JSON.parse(JSON.stringify(x ?? null), (_k, v) => (Array.isArray(v)
      ? v.filter((e) => !(e && typeof e === 'object' && (e.uid === 'dupont-a' || e.id === 'G-102' || e.gristRowId === 102)))
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('dupont-a::'))) : v));
    const directory = transformDirectory(dir);
    const results: { step: string; grist: unknown; pg: unknown; differences: string[] }[] = [];
    await expect(db!.transaction().execute(async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(726104)`.execute(trx);
      await loadDirectory(trx, directory.rows, directory.report);
      await loadWork(trx, transformWork(work, directory.rows).rows);
      const pgRepo = createPgDirectoryRepository({ db: trx, loadLdapCache });
      // Given the test transaction, each command runs in a savepoint of it.
      const pg: Store = {
        repo: pgRepo,
        ldap: createPgLdapCommands({ db: trx, repository: pgRepo, ldap, today: TODAY }),
        align: createPgAlignCommands({ db: trx, repository: pgRepo, caches, texts: tokenAlignTexts, hasQualinka: false, today: TODAY }),
        reviews: (src) => readReviewRecords(trx, src),
      };
      for (const [name, step] of STEPS) {
        const run = (s: Store) => step(s).catch((e) => `${e.status ?? ''} ${e.message}`);
        const [g, p] = [outsideGroup(await run(grist)), outsideGroup(await run(pg))];
        results.push({ step: name, grist: g, pg: p, differences: differences(await read(grist), await read(pg)) });
      }
      throw new Rollback();
    })).rejects.toBeInstanceOf(Rollback);

    if (process.env.CONTRACT_DEBUG) for (const r of results) console.log(JSON.stringify({ step: r.step, result: differences(r.grist, r.pg), differences: r.differences }));
    for (const r of results) expect({ step: r.step, result: r.pg, differences: r.differences }).toEqual({ step: r.step, result: r.grist, differences: [] });
  });
});
