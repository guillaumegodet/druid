// Database part of the fictitious extras of a demo instance (lib/migration/demoExtras.ts): calls for proposals, matching
// runs and matches, eligibility rules and candidates, theses, opinions — written in the transaction of the seed
// (scripts/seed_demo_pg.ts), after the directory, as the database owner. The tables are emptied first: the seed replays
// at each deployment. The funders and programmes of the calls are inserted when missing (the built-in ones already come
// from the migrations) and never otherwise changed.
import { sql, type Transaction } from 'kysely';
import type { DB } from '../db/schema.gen';
import type { DemoExtras } from './demoExtras';

const EXTRA_TABLES = ['call_match_run', 'funding_call', 'call_feedback', 'call_eligibility_rule', 'person_thesis', 'person_thesis_check'] as const;

export const loadDemoExtras = async (trx: Transaction<DB>, data: DemoExtras): Promise<Record<string, number>> => {
  // CASCADE: call_match, call_passage and call_eligibility follow their run, call and rule.
  await sql`TRUNCATE ${sql.join(EXTRA_TABLES.map((t) => sql.table(t)))} CASCADE`.execute(trx);

  for (const f of data.funders) {
    await trx.insertInto('funder').values({ funder_id: f.funderId, name: f.name, country: f.country, category: f.category, url: f.url })
      .onConflict((oc) => oc.column('funder_id').doNothing()).execute();
  }
  for (const p of data.programmes) {
    await trx.insertInto('funding_programme').values({
      programme_id: p.programmeId, funder_id: p.funderId, name: p.name, kind: p.kind, url: p.url, source: p.source, refresh: p.refresh,
      subset_label: p.subsetLabel, active: p.active,
    }).onConflict((oc) => oc.column('programme_id').doNothing()).execute();
  }
  for (const c of data.calls) {
    await trx.insertInto('funding_call').values({
      call_id: c.callId, programme_id: c.programmeId, subset: c.subset, scheme: c.scheme, title: c.title, title_fr: c.titleFr,
      summary: c.summary, summary_fr: c.summaryFr, objectives: c.objectives, scope: c.scope, taxonomy: JSON.stringify(c.taxonomy),
      opening_date: c.openingDate, deadlines: c.deadlines, url: c.url, status: c.status,
      // A call of a programme added by hand went through the validation of the administrator.
      review_status: c.programmeId.startsWith('manual-') ? 'validated' : 'imported',
      added_by: c.programmeId.startsWith('manual-') ? 'demo-gestionnaire' : '',
    }).execute();
  }
  for (const r of data.runs) {
    await trx.insertInto('call_match_run').values({
      run_id: r.runId, programme_id: r.programmeId, subset: r.subset, engine: r.engine, perimeter: r.perimeter, started_at: new Date(r.startedAt),
      model: r.model, settings: JSON.stringify(r.settings), calls: r.calls, failed_calls: r.failedCalls, imported_by: 'seed:demo',
    }).execute();
  }
  for (const m of data.matches) {
    await trx.insertInto('call_match').values({
      pair_id: m.pairId, run_id: m.runId, call_id: m.callId, person_uid: m.personUid, uid: m.uid, person_name: m.personName, units: m.units,
      score: m.score, raw_score: m.rawScore, overall: m.overall, justification: m.justification, justification_fr: m.justificationFr,
      publications: JSON.stringify(m.publications),
    }).execute();
  }
  for (const f of data.feedback) {
    await trx.insertInto('call_feedback').values({ pair_id: f.pairId, author: f.author, verdict: f.verdict, comment: f.comment }).execute();
  }

  // People of the directory just loaded: ids by uid, current memberships (rows) and their labs, primary IdRef.
  const people = await trx.selectFrom('person').select(['id', 'uid', 'first_name', 'last_name', 'corps_grade']).where('uid', 'is not', null).execute();
  const byUid = new Map(people.map((p) => [String(p.uid).toLowerCase(), p]));
  const memberships = await trx.selectFrom('membership as m').leftJoin('structure as s', 's.id', 'm.structure_id')
    .select(['m.id', 'm.person_id', 'm.lab_label', 's.acronym']).execute();
  const rowsOf = new Map<string, { ids: string[]; units: Set<string> }>();
  for (const m of memberships) {
    const e = rowsOf.get(m.person_id) ?? { ids: [], units: new Set<string>() };
    e.ids.push(String(m.id));
    const unit = m.acronym || m.lab_label;
    if (unit) e.units.add(unit);
    rowsOf.set(m.person_id, e);
  }
  const idrefs = new Map((await trx.selectFrom('person_identifier').select(['person_id', 'value'])
    .where('scheme', '=', 'idref').where('is_primary', '=', true).execute()).map((i) => [i.person_id, i.value]));

  let theses = 0;
  for (const t of data.theses) {
    const person = byUid.get(t.uid.toLowerCase());
    if (!person) continue;
    await trx.insertInto('person_thesis').values({
      person_id: person.id, nnt: t.nnt, title: t.title, defended_on: t.defendedOn || null, status: t.status, institution: t.institution,
      discipline: t.discipline, source: 'theses.fr',
    }).execute();
    theses += 1;
  }
  // Every person with an IdRef was checked against theses.fr (the check dates the record).
  const found = new Map<string, number>();
  for (const t of data.theses) { const p = byUid.get(t.uid.toLowerCase()); if (p) found.set(p.id, (found.get(p.id) ?? 0) + 1); }
  for (const [personId, idref] of idrefs) {
    await trx.insertInto('person_thesis_check').values({ person_id: personId, idref, found: found.get(personId) ?? 0 }).execute();
  }

  let candidates = 0;
  for (const e of data.eligibility) {
    await trx.insertInto('call_eligibility_rule').values({
      call_id: e.rule.callId, scheme: e.rule.scheme, phd_from: e.rule.phdFrom, phd_to: e.rule.phdTo, extension_years: e.rule.extensionYears, source_text: e.rule.sourceText,
    }).execute();
    for (const c of e.candidates) {
      const person = byUid.get(c.uid.toLowerCase());
      if (!person) continue;
      const rows = rowsOf.get(person.id);
      await trx.insertInto('call_eligibility').values({
        call_id: e.rule.callId, person_id: person.id, uid: c.uid, person_name: [person.first_name, person.last_name].filter(Boolean).join(' '),
        units: [...(rows?.units ?? [])].sort(), grade: person.corps_grade ?? '', row_ids: rows?.ids ?? [], verdict: c.verdict, reasons: c.reasons, phd_on: c.phdOn,
      }).execute();
      candidates += 1;
    }
  }
  return {
    funding_call: data.calls.length, call_match_run: data.runs.length, call_match: data.matches.length, call_feedback: data.feedback.length,
    call_eligibility_rule: data.eligibility.length, call_eligibility: candidates, person_thesis: theses, person_thesis_check: idrefs.size,
  };
};
