// Seed of the demo loaded into PostgreSQL (lot 10 b) and read back by the PostgreSQL repository, then its fictitious
// calls for proposals, theses and eligibility (lib/migration/demoExtras.ts) read back by the stores of the routes;
// rolled back at the end. Needs DATABASE_URL (druid_owner: the load empties the tables); run by the « database » CI job
// and `npm run test:db`.
import fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { sql, type Transaction } from 'kysely';
import { createDb, type DB } from '../db/client';
import { createEligibilityStore } from '../calls/eligibilityStore';
import { createCallsStore } from '../calls/pg';
import { createPgDirectoryRepository } from '../directory/pg/repository';
import { demoExtras, type DemoNetwork, type DemoResearcherRow } from '../migration/demoExtras';
import { demoDirectoryInput, emptyWorkInput, type DemoData } from '../migration/demoSeed';
import { transformDirectory } from '../migration/gristToPg';
import { transformWork } from '../migration/gristToPgWork';
import { loadDemoExtras } from '../migration/loadDemoExtras';
import { loadDirectory, loadWork } from '../migration/loadPg';
import { createThesisStore } from '../thesisStore';

const url = process.env.DATABASE_URL;
const db = url ? createDb({ connectionString: url, max: 1 }) : null;
afterAll(async () => { await db?.destroy(); });
vi.setConfig({ testTimeout: 30000 });

class Rollback extends Error {}

describe.skipIf(!url)('demo seed on PostgreSQL', () => {
  it('loads the demo and serves it through the repository', async () => {
    const data = (await import('../../instances/demo/demo-data.mjs')) as DemoData;
    const directory = transformDirectory(demoDirectoryInput(data));
    const work = transformWork(emptyWorkInput(), directory.rows);
    let seen: { people: number; structures: number; institutions: number; withOrcid: number } | null = null;
    await expect(db!.transaction().execute(async (trx: Transaction<DB>) => {
      await sql`SELECT pg_advisory_xact_lock(726104)`.execute(trx);
      const loaded = { ...await loadDirectory(trx, directory.rows, directory.report), ...await loadWork(trx, work.rows) };
      expect(loaded.person).toBe(data.buildResearchers().length);
      const repository = createPgDirectoryRepository({ db: trx as any });
      const [people, structures, institutions] = await Promise.all([
        repository.people({ all: true, labAnchors: [] }), repository.structures(), repository.institutions(),
      ]);
      seen = {
        people: people.items.length, structures: structures.items.length, institutions: institutions.items.length,
        withOrcid: people.items.filter((p) => p.identifiers?.orcid).length,
      };
      throw new Rollback();
    })).rejects.toBeInstanceOf(Rollback);
    expect(seen).toEqual({
      people: data.buildResearchers().length, structures: data.STRUCTURES.length, institutions: data.ETABLISSEMENTS.length,
      withOrcid: data.buildResearchers().filter((r) => r.ORCID).length,
    });
  });

  it('loads the calls, theses and eligibility of the demo and serves them through the stores of the routes', async () => {
    const data = (await import('../../instances/demo/demo-data.mjs')) as DemoData;
    const directory = transformDirectory(demoDirectoryInput(data));
    const work = transformWork(emptyWorkInput(), directory.rows);
    const today = new Date().toISOString().slice(0, 10);
    const network = JSON.parse(fs.readFileSync(new URL('../../instances/demo/dashboard-data/network.json', import.meta.url), 'utf8')) as DemoNetwork;
    const extras = demoExtras(data.buildResearchers() as unknown as DemoResearcherRow[], network, today);
    let seen: Record<string, unknown> | null = null;
    await expect(db!.transaction().execute(async (trx: Transaction<DB>) => {
      await sql`SELECT pg_advisory_xact_lock(726104)`.execute(trx);
      await loadDirectory(trx, directory.rows, directory.report);
      await loadWork(trx, work.rows);
      const loaded = await loadDemoExtras(trx, extras);
      const calls = createCallsStore(trx as any);
      const eligibility = createEligibilityStore(trx as any);
      const theses = createThesisStore(trx as any);
      const overview = await calls.overview();
      const matches = await calls.matches({ viewer: 'demo-gestionnaire' });
      const strong = extras.matches.find((m) => m.overall === 'strong')!;
      const rules = await eligibility.rules();
      const candidates = await eligibility.candidates(rules.find((r) => r.scheme === 'ERC-StG')!.callId);
      const phd = extras.theses.find((t) => t.status === 'defended')!;
      seen = {
        loaded,
        runs: overview.runs.length, calls: overview.calls, matches: overview.matches,
        programmes: (await calls.programmes()).map((p) => p.programmeId).sort(),
        openCalls: (await calls.calls()).filter((c) => c.status === 'open').length,
        perimeters: await calls.perimeters(),
        mine: matches.find((m) => m.pairId === extras.feedback[0].pairId)?.mine,
        strongMatch: matches.find((m) => m.pairId === strong.pairId)?.publications.length,
        rules: rules.map((r) => r.scheme).sort(),
        eligible: candidates.filter((c) => c.verdict === 'eligible').length,
        ofPerson: (await eligibility.ofPerson({ uid: candidates[0].uid })).length,
        thesis: (await theses.thesesOfUid(phd.uid))?.theses.map((t) => [t.nnt, t.status, t.defendedOn]),
        check: (await theses.thesesOfUid(phd.uid))?.check?.found,
        coverage: await theses.coverage(),
      };
      throw new Rollback();
    })).rejects.toBeInstanceOf(Rollback);
    const stg = extras.eligibility.find((e) => e.rule.scheme === 'ERC-StG')!;
    const phd = extras.theses.find((t) => t.status === 'defended')!;
    const hasIdref = (uid: string) => !!data.buildResearchers().find((r) => r.uid_dyna === uid)?.IdRef;
    expect(seen).toEqual({
      loaded: {
        funding_call: extras.calls.length, call_match_run: extras.runs.length, call_match: extras.matches.length, call_feedback: extras.feedback.length,
        call_eligibility_rule: 2, call_eligibility: extras.eligibility.reduce((n, e) => n + e.candidates.length, 0),
        person_thesis: extras.theses.length, person_thesis_check: data.buildResearchers().filter((r) => r.IdRef).length,
      },
      runs: extras.runs.length, calls: extras.calls.length, matches: extras.matches.length,
      programmes: ['anr-aapg', 'erc', 'horizon-europe', 'manual-region-udemo-emergence', 'msca'],
      openCalls: extras.calls.filter((c) => c.status === 'open').length,
      perimeters: ['Université de Démonstration'],
      mine: extras.feedback[0].verdict,
      strongMatch: 3,
      rules: ['ERC-CoG', 'ERC-StG'],
      eligible: stg.candidates.filter((c) => c.verdict === 'eligible').length,
      ofPerson: 1,
      thesis: [[phd.nnt, 'defended', phd.defendedOn]],
      check: hasIdref(phd.uid) ? 1 : undefined,
      coverage: {
        withIdref: data.buildResearchers().filter((r) => r.IdRef).length,
        checked: data.buildResearchers().filter((r) => r.IdRef).length,
        withPhd: extras.theses.filter((t) => t.status === 'defended').length,
      },
    });
  });
});
