import React, { useEffect, useState } from 'react';
import { Loader2, Search, X, BookOpen } from 'lucide-react';
import { Researcher } from '../../types';
import { GristService } from '../../lib/gristService';
import { AuthorCandidate, GroupDashboardApi } from './groupDashboardApi';
import { Trans, Plural, useLingui } from '@lingui/react/macro';
import { apiErrorText } from '../../lib/apiErrors';

/**
 * @component AuthorResolveModal
 * @description Resolution of the OpenAlex author id of a researcher WITHOUT
 * ORCID: name search scoped to their home lab (two homonyms in
 * the same lab are extremely rare), mandatory human confirmation, then
 * persistence in the Grist column `openalex_author_id`.
 */
export const AuthorResolveModal: React.FC<{
  researcher: Researcher;
  onClose: () => void;
  /** Called after the Grist write with the updated record. */
  onResolved: (updated: Researcher) => void;
}> = ({ researcher, onClose, onResolved }) => {
  const { t } = useLingui();
  const labo = researcher.affiliations[0]?.structureName || '';
  const [query, setQuery] = useState(`${researcher.firstName} ${researcher.lastName}`.trim());
  const [candidates, setCandidates] = useState<AuthorCandidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = async (name: string) => {
    setLoading(true);
    setError(null);
    try {
      setCandidates(await GroupDashboardApi.searchAuthors(name, labo || undefined));
    } catch (e) {
      setError(e instanceof Error ? apiErrorText(e) : t`Search error`);
      setCandidates(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void search(query);
    // Initial search only — retries go through the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = async (candidate: AuthorCandidate) => {
    if (!researcher.gristRowId) {
      setError(t`Record without a Grist row id — cannot save.`);
      return;
    }
    setSavingId(candidate.id);
    setError(null);
    try {
      await GristService.updateResearcherOpenalexId(researcher.gristRowId, candidate.id);
      onResolved({
        ...researcher,
        identifiers: { ...researcher.identifiers, openalexId: candidate.id },
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? apiErrorText(e) : t`Save error`);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="rounded-hero bg-cream-100 dark:bg-[#201e1a] shadow-soft-lg border border-white/50 dark:border-white/10 p-7 w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-start justify-between mb-1">
          <h3 className="font-disp text-xl font-bold tracking-tight text-ink dark:text-[#f5f2ea]">
            <Trans>Identify the OpenAlex author</Trans>
          </h3>
          <button onClick={onClose}><X className="w-5 h-5 text-muted-faint" /></button>
        </div>
        <p className="text-[13px] text-muted dark:text-[#8f897c] mb-4">
          <Trans>{researcher.displayName} has no ORCID — choose their OpenAlex author profile.</Trans>{' '}
          {labo ? <Trans>Search limited to <strong>{labo}</strong>;</Trans> : <Trans>Search without lab restriction;</Trans>}{' '}
          <Trans>if in doubt, check the number of publications and the name variants.</Trans>
        </p>

        <div className="flex items-center gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-lighter" />
            <input
              className="input-soft !pl-9"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void search(query)}
            />
          </div>
          <button className="btn-pill-dark" onClick={() => void search(query)} disabled={loading}>
            <Trans>Search</Trans>
          </button>
        </div>

        {error && <p className="text-[13px] text-[#d64545] mb-3">{error}</p>}

        <div className="flex-1 overflow-y-auto space-y-2">
          {loading && (
            <p className="flex items-center gap-2 text-[13px] text-muted-light dark:text-[#8f897c] py-4">
              <Loader2 className="w-4 h-4 animate-spin" /> <Trans>Searching OpenAlex…</Trans>
            </p>
          )}
          {!loading && candidates?.length === 0 && (
            <p className="text-[13px] text-muted-light dark:text-[#8f897c] italic py-4">
              <Trans>No candidate — try a name variant (without first name, birth name…).</Trans>
            </p>
          )}
          {!loading && candidates?.map((c) => (
            <div
              key={c.id}
              className="rounded-card bg-white/80 dark:bg-white/5 border border-ink/5 dark:border-white/10 shadow-soft p-4 flex items-center justify-between gap-4"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea]">
                    {c.display_name}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs text-muted-light dark:text-[#8f897c]">
                    <BookOpen className="w-3 h-3" /> <Plural value={c.works_count} one="# publication" other="# publications" />
                  </span>
                  <a
                    href={`https://openalex.org/${c.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-mono text-muted-light dark:text-[#8f897c] hover:underline"
                  >
                    {c.id}
                  </a>
                </div>
                <p className="text-xs text-muted dark:text-[#c3beb0] truncate mt-0.5">
                  {c.last_known_institutions.join(', ') || t`Unknown institution`}
                </p>
                {c.alternatives.length > 0 && (
                  <p className="text-xs text-muted-light dark:text-[#8f897c] truncate mt-0.5">
                    <Trans>Variants: {c.alternatives.slice(0, 5).join(' · ')}</Trans>
                  </p>
                )}
              </div>
              <button
                className="btn-pill-dark shrink-0"
                onClick={() => void choose(c)}
                disabled={savingId !== null}
              >
                {savingId === c.id ? <Loader2 className="w-4 h-4 animate-spin" /> : t`Choose`}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
