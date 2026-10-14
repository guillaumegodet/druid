// Seed of a fictitious instance (druid-internal docs/plan-migration-postgresql.md, lot 10 b): the rows of
// instances/<slug>/demo-data.mjs shaped as the Grist records that instances/demo/build_demo_grist.mjs writes into the
// demo document, so that the Grist → PostgreSQL import (gristToPg, loadPg) loads the same directory from the data
// files alone — no document, no key. Pure: the script scripts/seed_demo_pg.ts does the database part.
import type { GristRecord } from '../directory/gristMapping';
import type { GristDirectoryInput } from './gristToPg';
import { WORK_TABLES, type GristWorkInput } from './gristToPgWork';

/** What a demo-data.mjs module exports (instances/demo/demo-data.mjs, instances/demo-2/demo-data.mjs). */
export interface DemoData {
  /** Etablissements rows; `key` is the handle Annuaire rows use (`employerKey`), not a column. */
  ETABLISSEMENTS: Array<{ key: string } & Record<string, unknown>>;
  STRUCTURES: Array<Record<string, unknown>>;
  /** Annuaire rows before the Employeur reference is resolved (`employerKey`). */
  buildResearchers(): Array<Record<string, unknown>>;
}

/** 'YYYY-MM-DD' → epoch seconds (what a Grist Date column holds); anything else → null. */
export const toGristEpoch = (ymd: unknown): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd ?? ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 1000 : null;
};

const records = (rows: Array<Record<string, unknown>>): GristRecord[] => rows.map((fields, i) => ({ id: i + 1, fields }));

/**
 * Directory tables of the instance as Grist records (row ids 1…n in file order, like a freshly built document).
 * Throws on a duplicate `uid_dyna` or an unknown `employerKey`: the data file is wrong, not the import.
 */
export const demoDirectoryInput = (data: DemoData): GristDirectoryInput => {
  const establishments = records(data.ETABLISSEMENTS.map(({ key, ...fields }) => fields));
  const employerRow = new Map(data.ETABLISSEMENTS.map((e, i) => [e.key, i + 1]));
  const uids = new Set<string>();
  const annuaire = data.buildResearchers().map(({ employerKey, DATE_DE_NAISSANCE_JJ_MM_AAAA, ...fields }) => {
    const uid = String(fields.uid_dyna ?? '');
    if (uids.has(uid)) throw new Error(`Duplicate uid_dyna in demo-data: ${uid}`);
    uids.add(uid);
    if (employerKey !== undefined && !employerRow.has(String(employerKey))) throw new Error(`Unknown employerKey in demo-data: ${String(employerKey)}`);
    return {
      ...fields,
      DATE_DE_NAISSANCE_JJ_MM_AAAA: toGristEpoch(DATE_DE_NAISSANCE_JJ_MM_AAAA),
      Employeur: employerKey === undefined ? 0 : employerRow.get(String(employerKey))!,
    };
  });
  return {
    Etablissements: establishments,
    Structures: records(data.STRUCTURES),
    Annuaire: records(annuaire),
    // The demo documents have no Corps_Categorie table: the import notes it and keeps the codes of the rows.
    Corps_Categorie: null,
  };
};

/** No work table at all: tasks, reviews, reports and arbitrations start empty on a fictitious instance. */
export const emptyWorkInput = (): GristWorkInput =>
  ({ ...Object.fromEntries(WORK_TABLES.map((t) => [t, null])), arbitrations: {} }) as unknown as GristWorkInput;
