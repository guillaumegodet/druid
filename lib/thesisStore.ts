// PostgreSQL store of the doctoral theses of the researchers (druid-internal docs/plan-funding-calls.md, lot 5):
// people due for a check against theses.fr, result of a check, theses of a person. Server side only.
import { sql, type Kysely } from 'kysely';
import type { DB } from './db/schema.gen';
import type { Thesis, ThesisStatus } from './thesis';

export interface ThesisCheckTarget {
  personId: string;
  uid: string | null;
  name: string;
  idref: string;
}

export interface StoredThesis extends Thesis {
  source: 'theses.fr' | 'manual';
  updatedAt: string;
}

export interface ThesisCheckInfo {
  checkedAt: string;
  found: number;
  error: string;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v ?? ''));

export const createThesisStore = (db: Kysely<DB>) => {
  /**
   * People with a primary IdRef never checked, checked under another IdRef, or checked more than `maxAgeDays` ago;
   * the never-checked first, then the oldest checks. `uids` restricts to these records (and ignores the age).
   */
  const due = async (options: { limit: number; maxAgeDays: number; uids?: string[] }): Promise<ThesisCheckTarget[]> => {
    let q = db.selectFrom('person as p')
      .innerJoin('person_identifier as i', (j) => j.onRef('i.person_id', '=', 'p.id').on('i.scheme', '=', 'idref').on('i.is_primary', '=', true))
      .leftJoin('person_thesis_check as c', 'c.person_id', 'p.id')
      .select(['p.id', 'p.uid', 'p.last_name', 'p.first_name', 'i.value as idref']);
    if (options.uids?.length) q = q.where('p.uid', 'in', options.uids);
    else {
      q = q.where((eb) => eb.or([
        eb('c.person_id', 'is', null),
        eb('c.idref', '<>', eb.ref('i.value')),
        eb('c.checked_at', '<', sql<Date>`now() - make_interval(days => ${options.maxAgeDays})`),
      ]));
    }
    const rows = await q.orderBy(sql`c.checked_at NULLS FIRST`).orderBy('p.last_name').limit(options.limit).execute();
    return rows.map((r) => ({ personId: r.id, uid: r.uid, name: [r.first_name, r.last_name].filter(Boolean).join(' '), idref: r.idref }));
  };

  /**
   * Result of a check: the theses found replace those theses.fr had given (a thesis typed by hand stays); `null` = the
   * person is unknown to theses.fr; an error keeps the stored theses and is recorded on the check.
   */
  const saveCheck = async (target: Pick<ThesisCheckTarget, 'personId' | 'idref'>, theses: Thesis[] | null, error = ''): Promise<void> =>
    db.transaction().execute(async (trx) => {
      if (!error) {
        const keep = (theses ?? []).map((t) => t.nnt);
        let del = trx.deleteFrom('person_thesis').where('person_id', '=', target.personId).where('source', '=', 'theses.fr');
        if (keep.length) del = del.where('nnt', 'not in', keep);
        await del.execute();
        for (const t of theses ?? []) {
          const fields = { title: t.title, defended_on: t.defendedOn, status: t.status, institution: t.institution, discipline: t.discipline };
          await trx.insertInto('person_thesis').values({ person_id: target.personId, nnt: t.nnt, source: 'theses.fr', ...fields })
            .onConflict((oc) => oc.columns(['person_id', 'nnt']).doUpdateSet({ ...fields, updated_at: sql`now()` }).where('person_thesis.source', '=', 'theses.fr'))
            .execute();
        }
      }
      const check = { idref: target.idref, checked_at: sql<Date>`now()`, found: error ? 0 : (theses ?? []).length, error: error.slice(0, 1000) };
      await trx.insertInto('person_thesis_check').values({ person_id: target.personId, ...check })
        .onConflict((oc) => oc.column('person_id').doUpdateSet(check)).execute();
    });

  /** Theses of the person of a directory uid, and its last check; null when no person has this uid. */
  const thesesOfUid = async (uid: string): Promise<{ theses: StoredThesis[]; check: ThesisCheckInfo | null } | null> => {
    const person = await db.selectFrom('person').select('id').where('uid', '=', uid.toLowerCase()).executeTakeFirst();
    if (!person) return null;
    const rows = await db.selectFrom('person_thesis').selectAll().where('person_id', '=', person.id).orderBy('defended_on').execute();
    const check = await db.selectFrom('person_thesis_check').selectAll().where('person_id', '=', person.id).executeTakeFirst();
    return {
      theses: rows.map((r) => ({
        nnt: r.nnt, title: r.title, defendedOn: r.defended_on, status: r.status as ThesisStatus, institution: r.institution,
        discipline: r.discipline, source: r.source as StoredThesis['source'], updatedAt: iso(r.updated_at),
      })),
      check: check ? { checkedAt: iso(check.checked_at), found: check.found, error: check.error } : null,
    };
  };

  /** Coverage of the checks: people with an IdRef, checked, with a defended thesis. */
  const coverage = async (): Promise<{ withIdref: number; checked: number; withPhd: number }> => {
    const r = await sql<{ with_idref: string; checked: string; with_phd: string }>`
      SELECT
        (SELECT count(DISTINCT person_id) FROM person_identifier WHERE scheme = 'idref' AND is_primary) AS with_idref,
        (SELECT count(*) FROM person_thesis_check) AS checked,
        (SELECT count(DISTINCT person_id) FROM person_thesis WHERE status = 'defended') AS with_phd`.execute(db);
    const row = r.rows[0];
    return { withIdref: Number(row?.with_idref ?? 0), checked: Number(row?.checked ?? 0), withPhd: Number(row?.with_phd ?? 0) };
  };

  return { due, saveCheck, thesesOfUid, coverage };
};

export type ThesisStore = ReturnType<typeof createThesisStore>;
