// Seed of the fictitious instances (lot 10 b): the data files go through the Grist → PostgreSQL transformation
// without any issue but the tables the files do not have, and every researcher of the file becomes a person.
import { describe, expect, it } from 'vitest';
import { demoDirectoryInput, emptyWorkInput, toGristEpoch, type DemoData } from '../migration/demoSeed';
import { transformDirectory } from '../migration/gristToPg';
import { transformWork } from '../migration/gristToPgWork';

const load = (slug: string) => import(`../../instances/${slug}/demo-data.mjs`) as Promise<DemoData>;

describe('demo seed', () => {
  it('Grist Date cells are epoch seconds', () => {
    expect([toGristEpoch('1980-02-03'), toGristEpoch(''), toGristEpoch(undefined), toGristEpoch('03-02-1980')]).toEqual([318384000, null, null, null]);
  });

  it.each(['demo', 'demo-2'])('%s: the data file imports cleanly', async (slug) => {
    const data = await load(slug);
    const input = demoDirectoryInput(data);
    expect(input.Annuaire!.length).toBe(data.buildResearchers().length);
    expect(input.Etablissements!.map((r) => r.id)).toEqual(data.ETABLISSEMENTS.map((_, i) => i + 1));
    // Every employer reference points to an establishment row.
    expect(input.Annuaire!.every((r) => r.fields.Employeur >= 1 && r.fields.Employeur <= data.ETABLISSEMENTS.length)).toBe(true);
    const directory = transformDirectory(input);
    const work = transformWork(emptyWorkInput(), directory.rows);
    const issues = [...directory.report.issues, ...work.issues].filter((i) => i.code !== 'table_missing');
    expect(issues).toEqual([]);
    expect(directory.rows.person.length).toBe(input.Annuaire!.length);
    expect(directory.rows.membership.length).toBe(input.Annuaire!.length);
    expect(directory.rows.structure.length).toBe(data.STRUCTURES.length);
    expect(directory.rows.establishment.length).toBe(data.ETABLISSEMENTS.length);
    expect(Object.values(work.rows).every((rows) => rows.length === 0)).toBe(true);
  });

  it('refuses a duplicate uid or an unknown employer', async () => {
    const data = await load('demo');
    const twice = { ...data, buildResearchers: () => { const r = data.buildResearchers(); return [r[0], r[0]]; } };
    expect(() => demoDirectoryInput(twice)).toThrow(/Duplicate uid_dyna/);
    const orphan = { ...data, buildResearchers: () => [{ ...data.buildResearchers()[0], employerKey: 'NOPE' }] };
    expect(() => demoDirectoryInput(orphan)).toThrow(/Unknown employerKey/);
  });
});
