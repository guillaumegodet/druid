// LDAP values of the fields merged by source (druid-internal `docs/plan-maj-chercheurs.md`, lot 2 a): after each LDAP
// sync (server.cjs, end of scripts/sync_ldap.cjs), the birth date and the grade of every record with an LDAP account are
// stored as the `ldap` source in person_field_value, and the `person` columns recomputed. This replaces the display
// overlay of lib/directory/people.ts on PostgreSQL: a manual correction now wins over the LDAP, and an LDAP value that
// changes after it is a conflict to review instead of a silent override.
import { sql, type Transaction } from 'kysely';
import { withActor, type DB, type Db } from '../../db/client';
import { isExternalEmployer } from '../../validation';
import { FieldValueError } from '../fieldMerge';
import { ldapGradeTarget } from '../ldap';
import { observeFieldValue, readSourceRanks, reprojectField } from './fieldValues';

export const LDAP_SOURCE = 'ldap';
export const LDAP_OBSERVE_ACTOR = 'job:ldap_observe';

export interface LdapObserveSummary {
  /** Records with an LDAP entry in the cache. */
  persons: number;
  /** Values stored for the first time or changed since the last sync. */
  changed: number;
  /** LDAP grades dropped because the employer is external (hosted account: its corps is not the job). */
  removed: number;
  /** Values the LDAP gives that cannot be read (left aside). */
  invalid: number;
}

/**
 * Stores the LDAP values of the records found in `cache` (ldap_status_cache.json: uid → entry). A record whose uid is
 * missing from the cache is left alone: an absent account is not an account without a value (D5). A grade is only
 * observed for the employer of the institution: for an external one, the hosted account's corps and category describe
 * the account, not the job (rule of 2026-09-15), and a former LDAP grade is removed.
 */
export const observeLdapFields = async (db: Db, cache: Record<string, any>, chunk = 200): Promise<LdapObserveSummary> => {
  const persons = await db.selectFrom('person as p').leftJoin('establishment as e', 'e.id', 'p.employer_id')
    .select(['p.id', 'p.uid', 'p.corps_grade', 'p.employment_type', 'p.employment_type_label', 'p.extra', 'e.name as employer_name', 'e.uai as employer_uai'])
    .where('p.uid', 'is not', null).orderBy('p.id').execute();
  const withEntry = persons.filter((p) => p.uid && !p.uid.startsWith('ext_') && cache[p.uid] && typeof cache[p.uid] === 'object');
  const summary: LdapObserveSummary = { persons: withEntry.length, changed: 0, removed: 0, invalid: 0 };
  const ranks = await readSourceRanks(db);

  // A chunk per transaction; given a transaction (tests, a job chaining steps), everything runs in it.
  const inTransaction = async (fn: (trx: Transaction<DB>) => Promise<void>) => {
    if (!(db as any).isTransaction) return withActor(db, LDAP_OBSERVE_ACTOR, fn);
    await sql`SELECT set_config('druid.actor', ${LDAP_OBSERVE_ACTOR}, true)`.execute(db);
    return fn(db as unknown as Transaction<DB>);
  };
  for (let i = 0; i < withEntry.length; i += chunk) {
    await inTransaction(async (trx) => {
      for (const p of withEntry.slice(i, i + chunk)) {
        const entry = cache[p.uid!];
        const typedEmployer = typeof (p.extra as any)?.Employeur === 'string' ? (p.extra as any).Employeur : '';
        const external = isExternalEmployer(p.employer_name ?? typedEmployer, p.employer_uai ?? '');
        const observeOne = async (field: string, value: unknown) => {
          try {
            const r = await observeFieldValue(trx, { personId: p.id, field, source: LDAP_SOURCE, value, ranks: ranks.get(field) });
            if (r.changed) summary.changed++;
          } catch (e) {
            if (!(e instanceof FieldValueError)) throw e;
            summary.invalid++;
          }
        };
        await observeOne('birth_date', entry.birthDate ?? '');
        if (external) {
          const dropped = await trx.deleteFrom('person_field_value')
            .where('person_id', '=', p.id).where('field', '=', 'corps_grade').where('source', '=', LDAP_SOURCE).executeTakeFirst();
          if (Number(dropped.numDeletedRows) > 0) {
            summary.removed++;
            await reprojectField(trx, p.id, 'corps_grade', ranks.get('corps_grade'));
          }
        } else {
          await observeOne('corps_grade', ldapGradeTarget(entry, {
            Corps_grade: p.corps_grade ?? '', TYPE_EMPLOI: p.employment_type ?? '', LIB_TYPE_EMPLOI: p.employment_type_label ?? '',
          }));
        }
      }
    });
  }
  return summary;
};
