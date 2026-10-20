// Opinions of the users on the suggested connections between researchers (druid-internal
// `docs/plan-binomes-chercheurs.md`, lot 4): stable pair keys, ordering of the suggestions, PostgreSQL store.
// The author ids of network.json change at each regeneration, so a pair is keyed by its researchers' Druid record ids
// (`u:<id>`), or their names when the directory join found nobody (`n:<name>`).
import { sql, type Kysely } from 'kysely';
import type { DB } from '../db/schema.gen';

export type PairVerdict = 'relevant' | 'already_in_contact' | 'not_relevant';
export const PAIR_VERDICTS: readonly PairVerdict[] = ['relevant', 'already_in_contact', 'not_relevant'];

/** Stable key of one researcher of a pair. */
export const pairAuthorKey = (a: { uid?: string | null; label: string }): string =>
  a.uid ? `u:${a.uid}` : `n:${a.label.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()}`;

/** Stable key of a pair, whatever the order of its researchers. */
export const pairKeyOf = (a: { uid?: string | null; label: string }, b: { uid?: string | null; label: string }): string =>
  [pairAuthorKey(a), pairAuthorKey(b)].sort().join('|');

/** Opinions given on a pair: counts per verdict, and the viewer's own. */
export interface PairFeedback {
  counts: Partial<Record<PairVerdict, number>>;
  mine: PairVerdict | null;
}

/**
 * Suggestions with their opinions, those the viewer set aside (« already in contact », « not relevant ») moved after
 * the others, the order being kept otherwise.
 */
export function withFeedback<T extends { key: string }>(items: T[], feedback: Map<string, PairFeedback>): (T & { feedback: PairFeedback })[] {
  const out = items.map((s) => ({ ...s, feedback: feedback.get(s.key) ?? { counts: {}, mine: null } }));
  const aside = (s: { feedback: PairFeedback }) => s.feedback.mine === 'already_in_contact' || s.feedback.mine === 'not_relevant';
  return [...out.filter((s) => !aside(s)), ...out.filter(aside)];
}

export interface PairFeedbackInput {
  pairKey: string;
  slug: string;
  a: { label: string; labs: string[] };
  b: { label: string; labs: string[] };
  verdict: PairVerdict;
  comment: string;
  author: string;
}

export function createPairFeedbackStore(db: Kysely<DB>) {
  /** Records (or replaces) the opinion of `author` on a pair. */
  const save = async (input: PairFeedbackInput): Promise<void> => {
    const values = {
      pair_key: input.pairKey, slug: input.slug,
      a_label: input.a.label, a_labs: input.a.labs.join(', '), b_label: input.b.label, b_labs: input.b.labs.join(', '),
      verdict: input.verdict, comment: input.comment, author: input.author,
    };
    await db.insertInto('collab_pair_feedback').values(values)
      .onConflict((oc) => oc.columns(['pair_key', 'author']).doUpdateSet({
        slug: values.slug, a_label: values.a_label, a_labs: values.a_labs, b_label: values.b_label, b_labs: values.b_labs,
        verdict: values.verdict, comment: values.comment, created_at: sql`now()`,
      }))
      .execute();
  };

  /** Withdraws the opinion of `author` on a pair. */
  const remove = async (pairKey: string, author: string): Promise<void> => {
    await db.deleteFrom('collab_pair_feedback').where('pair_key', '=', pairKey).where('author', '=', author).execute();
  };

  /** Opinions on the given pairs: counts per verdict and the viewer's own. */
  const forPairs = async (pairKeys: string[], viewer: string): Promise<Map<string, PairFeedback>> => {
    const out = new Map<string, PairFeedback>();
    if (!pairKeys.length) return out;
    const rows = await db.selectFrom('collab_pair_feedback').select(['pair_key', 'verdict', 'author'])
      .where('pair_key', 'in', pairKeys).execute();
    for (const r of rows) {
      const f = out.get(r.pair_key) ?? { counts: {}, mine: null };
      const verdict = r.verdict as PairVerdict;
      f.counts[verdict] = (f.counts[verdict] ?? 0) + 1;
      if (r.author === viewer) f.mine = verdict;
      out.set(r.pair_key, f);
    }
    return out;
  };

  /** Every opinion, for the evaluation of the suggestions (CSV export). */
  const rows = async () =>
    (await db.selectFrom('collab_pair_feedback')
      .select(['pair_key', 'slug', 'a_label', 'a_labs', 'b_label', 'b_labs', 'verdict', 'comment', 'author', 'created_at'])
      .orderBy('created_at').execute())
      .map((r) => ({ ...r, created_at: new Date(r.created_at as unknown as string).toISOString() }));

  /** Suggestions with their stable key and opinions, those the viewer set aside last (withFeedback). */
  const annotate = async <T extends { a: { uid?: string | null; label: string }; b: { uid?: string | null; label: string } }>(
    items: T[],
    viewer: string,
  ) => {
    const keyed = items.map((s) => ({ ...s, key: pairKeyOf(s.a, s.b) }));
    return withFeedback(keyed, await forPairs(keyed.map((s) => s.key), viewer));
  };

  return { save, remove, forPairs, annotate, rows, pairKeyOf };
}
export type PairFeedbackStore = ReturnType<typeof createPairFeedbackStore>;
