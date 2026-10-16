// PostgreSQL store of the eligibility engine (druid-internal docs/plan-funding-calls.md, lot 5): calls whose text may
// state a rule, people with a defended PhD, result of a computation, candidates of a call. Server side only.
import { sql, type Kysely } from 'kysely';
import type { DB } from '../db/schema.gen';
import { phdOf } from '../thesis';
import type { EligibilityReason, EligibilityRule, EligibilityVerdict } from './eligibility';

export interface CallForEligibility {
  callId: string;
  programmeId: string;
  scheme: string;
  title: string;
  objectives: string;
  scope: string;
  deadlines: string[];
}

export interface EligibilityPerson {
  personId: string;
  uid: string;
  name: string;
  units: string[];
  /** Corps_grade of the record (MCF, CRCN, IR, POST-DOC…), '' when unknown. */
  grade: string;
  /** Current memberships (directory row ids): the record of a person without uid is found by them. */
  rowIds: number[];
  /** Fuzzy date of the PhD (first defended thesis). */
  phdOn: string;
}

export interface Candidate {
  callId: string;
  uid: string;
  personName: string;
  units: string[];
  grade: string;
  rowIds: number[];
  verdict: EligibilityVerdict;
  reasons: EligibilityReason[];
  phdOn: string | null;
}

export interface EligibilityRuleView extends EligibilityRule {
  title: string;
  programmeId: string;
  deadlines: string[];
  eligible: number;
  toCheck: number;
  computedAt: string;
}

const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v ?? ''));

export const createEligibilityStore = (db: Kysely<DB>) => {
  /** Open and forthcoming calls with a text (the ones a rule can be read from). */
  const openCalls = async (): Promise<CallForEligibility[]> =>
    (await db.selectFrom('funding_call').select(['call_id', 'programme_id', 'scheme', 'subset', 'title', 'objectives', 'scope', 'deadlines'])
      .where('status', 'in', ['open', 'forthcoming']).where((eb) => eb.or([eb('objectives', '<>', ''), eb('scope', '<>', '')])).execute())
      .map((c) => ({ callId: c.call_id, programmeId: c.programme_id, scheme: c.scheme || c.subset, title: c.title, objectives: c.objectives, scope: c.scope, deadlines: c.deadlines }));

  /**
   * People who may be candidates: not gone (presence), with a current membership (no end, or an end not past), and a
   * defended thesis; their labs are those of the current memberships.
   */
  const people = async (today: string): Promise<EligibilityPerson[]> => {
    const rows = await db.selectFrom('person as p')
      .innerJoin('membership as m', 'm.person_id', 'p.id')
      .innerJoin('person_thesis as t', 't.person_id', 'p.id')
      .leftJoin('structure as s', 's.id', 'm.structure_id')
      .select(['p.id', 'p.uid', 'p.first_name', 'p.last_name', 'p.corps_grade', 'm.id as membership_id', 'm.lab_label', 's.acronym', 't.status', 't.defended_on'])
      .where((eb) => eb.or([eb('p.presence_status', 'is', null), eb('p.presence_status', '<>', 'PARTI')]))
      .where((eb) => eb.or([eb('m.end_upper', 'is', null), eb('m.end_upper', '>=', today)]))
      .where('t.status', '=', 'defended')
      .execute();
    const byPerson = new Map<string, { row: (typeof rows)[number]; units: Set<string>; rowIds: Set<number>; theses: { status: 'defended'; defendedOn: string | null }[] }>();
    for (const r of rows) {
      const e = byPerson.get(r.id) ?? { row: r, units: new Set<string>(), rowIds: new Set<number>(), theses: [] };
      e.rowIds.add(Number(r.membership_id));
      // The lab of a membership is its structure; the label typed in the record when it has none.
      const unit = r.acronym || r.lab_label;
      if (unit) e.units.add(unit);
      e.theses.push({ status: 'defended', defendedOn: r.defended_on });
      byPerson.set(r.id, e);
    }
    const out: EligibilityPerson[] = [];
    for (const [personId, e] of byPerson) {
      const phd = phdOf(e.theses);
      if (!phd?.defendedOn) continue;
      out.push({
        personId, uid: e.row.uid ?? '', name: [e.row.first_name, e.row.last_name].filter(Boolean).join(' '), units: [...e.units].sort(),
        grade: e.row.corps_grade ?? '', rowIds: [...e.rowIds].sort((a, b) => a - b), phdOn: phd.defendedOn,
      });
    }
    return out;
  };

  /** Replaces the rule of a call and its candidates (eligible and to check; the ineligible are not kept). */
  const saveCall = async (rule: EligibilityRule, rows: { person: EligibilityPerson; verdict: EligibilityVerdict; reasons: EligibilityReason[] }[]): Promise<void> =>
    db.transaction().execute(async (trx) => {
      const fields = { scheme: rule.scheme, phd_from: rule.phdFrom, phd_to: rule.phdTo, extension_years: rule.extensionYears, source_text: rule.sourceText, computed_at: sql<Date>`now()` };
      await trx.insertInto('call_eligibility_rule').values({ call_id: rule.callId, ...fields })
        .onConflict((oc) => oc.column('call_id').doUpdateSet(fields)).execute();
      await trx.deleteFrom('call_eligibility').where('call_id', '=', rule.callId).execute();
      for (let i = 0; i < rows.length; i += 500) {
        await trx.insertInto('call_eligibility').values(rows.slice(i, i + 500).map((r) => ({
          call_id: rule.callId, person_id: r.person.personId, uid: r.person.uid, person_name: r.person.name, units: r.person.units, grade: r.person.grade,
          row_ids: r.person.rowIds.map(String),
          verdict: r.verdict, reasons: r.reasons, phd_on: r.person.phdOn,
        }))).execute();
      }
    });

  /** Drops the rules (and candidates) of the calls that no longer state one or are closed. */
  const dropRulesExcept = async (callIds: string[]): Promise<number> => {
    let q = db.deleteFrom('call_eligibility_rule');
    if (callIds.length) q = q.where('call_id', 'not in', callIds);
    return Number((await q.executeTakeFirst()).numDeletedRows);
  };

  /** Rules with their counts, deadline first. */
  const rules = async (): Promise<EligibilityRuleView[]> => {
    const rows = await db.selectFrom('call_eligibility_rule as r').innerJoin('funding_call as c', 'c.call_id', 'r.call_id')
      .select(['r.call_id', 'r.scheme', 'r.phd_from', 'r.phd_to', 'r.extension_years', 'r.source_text', 'r.computed_at', 'c.title', 'c.programme_id', 'c.deadlines'])
      .select((eb) => [
        eb.selectFrom('call_eligibility as e').select(sql<string>`count(*)`.as('n')).whereRef('e.call_id', '=', 'r.call_id').where('e.verdict', '=', 'eligible').as('eligible'),
        eb.selectFrom('call_eligibility as e').select(sql<string>`count(*)`.as('n')).whereRef('e.call_id', '=', 'r.call_id').where('e.verdict', '=', 'check').as('to_check'),
      ])
      .execute();
    return rows.map((r) => ({
      callId: r.call_id, scheme: r.scheme, phdFrom: r.phd_from, phdTo: r.phd_to, extensionYears: r.extension_years, sourceText: r.source_text,
      title: r.title, programmeId: r.programme_id, deadlines: r.deadlines, eligible: Number(r.eligible ?? 0), toCheck: Number(r.to_check ?? 0),
      computedAt: iso(r.computed_at),
    })).sort((a, b) => (a.deadlines[0] ?? '9999').localeCompare(b.deadlines[0] ?? '9999'));
  };

  /** Candidates of a call, eligible first, then by lab (without lab last) and name. */
  const candidates = async (callId: string): Promise<Candidate[]> =>
    (await db.selectFrom('call_eligibility').selectAll().where('call_id', '=', callId).execute())
      .map((r) => ({
        callId: r.call_id, uid: r.uid, personName: r.person_name, units: r.units, grade: r.grade, rowIds: r.row_ids.map(Number),
        verdict: r.verdict as EligibilityVerdict,
        reasons: r.reasons as EligibilityReason[], phdOn: r.phd_on,
      }))
      .sort((a, b) => (a.verdict === b.verdict ? 0 : a.verdict === 'eligible' ? -1 : 1)
        || (a.units.length ? 0 : 1) - (b.units.length ? 0 : 1)
        || (a.units[0] ?? '').localeCompare(b.units[0] ?? '') || a.personName.localeCompare(b.personName));

  return { openCalls, people, saveCall, dropRulesExcept, rules, candidates };
};

export type EligibilityStore = ReturnType<typeof createEligibilityStore>;
