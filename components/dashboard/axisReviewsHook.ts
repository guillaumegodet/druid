// Axis reviews of a structure in the Axes tab (druid-internal docs/plan-axes-embeddings.md, lot 3): loaded through the
// domain API (/api/v1/axis-reviews, PostgreSQL instances), kept in a key index, written with an optimistic update.
import { useCallback, useEffect, useState } from 'react';
import { DirectoryApi } from '../../lib/directoryApi';
import { apiErrorText } from '../../lib/apiErrors';
import { workKeyOf, type AxisReview, type AxisReviewDecision } from '../../lib/publications/axisReviews';
import { indexReviews, reviewOf as reviewOfIndex, type ReviewablePublication, type ReviewIndex } from '../../lib/publications/axisReviewStats';

export interface AxisReviewsState {
  /** null until the first answer; false on an instance without PostgreSQL (404). */
  supported: boolean | null;
  loaded: boolean;
  error: string | null;
  index: ReviewIndex;
}

export interface ReviewDraft {
  decision: AxisReviewDecision;
  axes?: string[];
  note?: string;
}

export function useAxisReviews(slug: string, enabled: boolean) {
  const [state, setState] = useState<AxisReviewsState>({ supported: null, loaded: false, error: null, index: new Map() });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setState({ supported: null, loaded: false, error: null, index: new Map() });
    DirectoryApi.axisReviews(slug)
      .then((items) => {
        if (cancelled) return;
        setState({ supported: items !== null, loaded: true, error: null, index: indexReviews(items ?? []) });
      })
      .catch((e: Error) => {
        if (!cancelled) setState({ supported: true, loaded: true, error: apiErrorText(e), index: new Map() });
      });
    return () => { cancelled = true; };
  }, [slug, enabled]);

  const reviewOf = useCallback((p: ReviewablePublication): AxisReview | undefined => reviewOfIndex(state.index, p), [state.index]);

  /** Saves the decision of the current user on a publication; the automatic axis and its confidence are recorded with it. */
  const save = useCallback(async (p: ReviewablePublication, draft: ReviewDraft, autoAxis: string): Promise<string | null> => {
    const workKey = workKeyOf(p);
    if (!workKey) return 'no key';
    try {
      const saved = await DirectoryApi.saveAxisReview(slug, {
        workKey, doi: p.doi ?? '', title: p.title ?? '', decision: draft.decision, axes: draft.axes ?? [],
        autoAxis, autoConfidence: p.axeConfidence ?? null, note: draft.note ?? '',
      });
      setState((s) => ({ ...s, index: new Map(s.index).set(workKey, saved) }));
      return null;
    } catch (e) {
      return apiErrorText(e) || String(e);
    }
  }, [slug]);

  const remove = useCallback(async (p: ReviewablePublication): Promise<string | null> => {
    const workKey = workKeyOf(p);
    if (!workKey) return 'no key';
    try {
      await DirectoryApi.deleteAxisReview(slug, workKey);
      setState((s) => { const index = new Map(s.index); index.delete(workKey); return { ...s, index }; });
      return null;
    } catch (e) {
      return apiErrorText(e) || String(e);
    }
  }, [slug]);

  return { ...state, reviewOf, save, remove };
}

export type AxisReviews = ReturnType<typeof useAxisReviews>;
