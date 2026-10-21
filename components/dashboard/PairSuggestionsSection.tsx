import React, { useEffect, useMemo, useState } from 'react';
import { Check, Download, ExternalLink, Handshake, Loader2, Quote, ThumbsDown, ThumbsUp } from 'lucide-react';
import { Trans, Plural, useLingui } from '@lingui/react/macro';
import { YearRange } from './overviewAggregates';
import { LARGE_COLLAB_MAX_AUTHORS } from './interLabNetwork';
import { AuthorCell } from './PairsSection';
import {
  PairRelation,
  PairSuggestion,
  PairVerdict,
  SuggestionSignal,
  SuggestionsParams,
  SuggestionsResponse,
  ThemeLevel,
  fetchSuggestions,
  sendPairFeedback,
} from './pairsApi';
import { getUserInfo } from '../../lib/auth';
import { apiErrorText } from '../../lib/apiErrors';
import { numberLocale } from '../../lib/i18n';
import { toCsv } from '../../lib/chartExport';
import { downloadBlob } from './chartFileExport';
import { helpUrl } from '../../lib/helpLinks';
import { WorkTitle, fetchWorkTitle, openAlexWorkUrl } from '../../lib/pairs/openalexTitles';

const PAGE = 50;

/**
 * Shared references of a pair (cited works, lot 3 of druid-internal `docs/plan-binomes-citations.md`): the count,
 * and on demand the rarest ones with their title fetched from OpenAlex, each linked to openalex.org.
 */
export const SharedReferences: React.FC<{ s: PairSuggestion; className?: string }> = ({ s, className = '' }) => {
  const { i18n } = useLingui();
  const [open, setOpen] = useState(false);
  const [titles, setTitles] = useState<Record<string, WorkTitle | null>>({});
  const ids = s.sharedRefs ?? [];
  const idsKey = ids.join('|');
  useEffect(() => {
    if (!open) return;
    let alive = true;
    idsKey.split('|').filter(Boolean).forEach((id) => {
      fetchWorkTitle(id).then((w) => { if (alive) setTitles((cur) => ({ ...cur, [id]: w })); });
    });
    return () => { alive = false; };
  }, [open, idsKey]);
  if (!s.references) return null;
  return (
    <span className={className}>
      <span className="font-semibold text-ink dark:text-[#f5f2ea]">
        <Plural value={s.references} one="# shared reference" other="# shared references" />
      </span>
      {s.coupling != null && s.coupling > 0 && (
        <> · <Trans>closeness {s.coupling.toLocaleString(i18n.locale, { minimumFractionDigits: 2 })}</Trans></>
      )}
      {ids.length > 0 && !open && (
        <>
          {' '}
          <button type="button" onClick={() => setOpen(true)} className="underline hover:text-ink dark:hover:text-[#f5f2ea] cursor-pointer">
            <Plural value={ids.length} one="show the rarest one" other="show the # rarest" />
          </button>
        </>
      )}
      {open && (
        <ul className="mt-0.5 flex flex-col gap-0.5">
          {ids.map((id) => {
            const w = titles[id];
            return (
              <li key={id} className="flex items-start gap-1">
                <Quote className="w-3 h-3 mt-0.5 shrink-0 opacity-60" />
                <a href={openAlexWorkUrl(id)} target="_blank" rel="noreferrer" className="hover:underline inline-flex items-start gap-1">
                  <span>
                    {w === undefined ? <Loader2 className="w-3 h-3 animate-spin inline" /> : w?.title ? w.title : id}
                    {w?.year ? ` (${w.year})` : ''}
                  </span>
                  <ExternalLink className="w-3 h-3 mt-0.5 shrink-0 opacity-60" />
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </span>
  );
};

/** Direct citations of a pair: « A already cites n publications of B », in each direction. */
export const DirectCitations: React.FC<{ s: PairSuggestion; className?: string }> = ({ s, className = '' }) => {
  if (!s.cites || (!s.cites.ab && !s.cites.ba)) return null;
  const Line: React.FC<{ from: string; n: number; to: string }> = ({ from, n, to }) => (
    <span className="font-semibold text-ink dark:text-[#f5f2ea]">
      {n === 1
        ? <Trans>{from} already cites one publication of {to}</Trans>
        : <Trans>{from} already cites {n} publications of {to}</Trans>}
    </span>
  );
  return (
    <span className={`flex flex-col gap-0.5 ${className}`}>
      {s.cites.ab > 0 && <Line from={s.a.label} n={s.cites.ab} to={s.b.label} />}
      {s.cites.ba > 0 && <Line from={s.b.label} n={s.cites.ba} to={s.a.label} />}
    </span>
  );
};

/** Why a pair is suggested: its common co-authors, its shared themes (topics or subfields), then its references. */
const ReasonCell: React.FC<{ s: PairSuggestion; level: ThemeLevel }> = ({ s, level }) => {
  const { i18n } = useLingui();
  const others = s.common - s.via.length;
  return (
    <div className="flex flex-col gap-1 text-xs text-muted dark:text-[#c3beb0]">
      <DirectCitations s={s} />
      {s.common > 0 && (
        <span>
          <span className="font-semibold text-ink dark:text-[#f5f2ea]">
            <Plural value={s.common} one="# common co-author:" other="# common co-authors:" />
          </span>
          {' '}
          {s.via.map((v) => `${v.label}${v.labs.length ? ` (${v.labs.join(', ')})` : ''}`).join(', ')}
          {others > 0 && <> <Trans>and {others} more</Trans></>}
        </span>
      )}
      {s.themes.length > 0 && (
        <span>
          <span className="font-semibold text-ink dark:text-[#f5f2ea]">
            {level === 'topic' ? <Trans>Shared research topics:</Trans> : <Trans>Shared subfields:</Trans>}
          </span>
          {' '}
          {s.themes.join(', ')}
          {' · '}
          <Trans>closeness {s.similarity.toLocaleString(i18n.locale, { minimumFractionDigits: 2 })}</Trans>
        </span>
      )}
      <SharedReferences s={s} />
    </div>
  );
};

/** Opinions set aside by the viewer: hidden from the list unless asked for. */
const ASIDE: ReadonlySet<PairVerdict> = new Set(['already_in_contact', 'not_relevant']);

/** Opinion buttons of a suggestion (lot 4): one per person, the last one wins, a second click withdraws it. */
const FeedbackButtons: React.FC<{ s: PairSuggestion; busy: boolean; onFeedback: (s: PairSuggestion, v: PairVerdict | null) => void }> = ({
  s, busy, onFeedback,
}) => {
  const { t } = useLingui();
  const options: { verdict: PairVerdict; label: string; icon: React.ReactNode }[] = [
    { verdict: 'relevant', label: t`Relevant`, icon: <ThumbsUp className="w-3.5 h-3.5" /> },
    { verdict: 'already_in_contact', label: t`Already in contact`, icon: <Handshake className="w-3.5 h-3.5" /> },
    { verdict: 'not_relevant', label: t`Not relevant`, icon: <ThumbsDown className="w-3.5 h-3.5" /> },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1">
      {options.map((o) => {
        const mine = s.feedback?.mine === o.verdict;
        const count = s.feedback?.counts[o.verdict] ?? 0;
        return (
          <button
            key={o.verdict}
            type="button"
            disabled={busy}
            onClick={() => onFeedback(s, mine ? null : o.verdict)}
            title={t`Your opinion on this suggestion (one per person, the last one wins; click again to withdraw it)`}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap transition-colors disabled:opacity-50 ${
              mine
                ? 'bg-ink text-white border-ink dark:bg-[#f5f2ea] dark:text-[#1c1a14] dark:border-[#f5f2ea]'
                : 'bg-white/70 dark:bg-white/10 border-white/80 dark:border-white/15 text-muted dark:text-[#c3beb0] hover:text-ink dark:hover:text-[#f5f2ea]'
            }`}
          >
            {mine ? <Check className="w-3.5 h-3.5" /> : o.icon}
            {o.label}
            {count > 0 && <span className="tabular-nums opacity-70">{count}</span>}
          </button>
        );
      })}
    </div>
  );
};

/**
 * « Suggested connections » of the Researcher pairs sub-tab (druid-internal `docs/archive/plan-binomes-chercheurs.md`,
 * lot 3): researchers of different labs who never co-signed, ranked by their common co-authors and their OpenAlex
 * topics (subfields for a network without topics) over the period, each row saying why.
 */
export const PairSuggestionsSection: React.FC<{ slug: string; range: YearRange }> = ({ slug, range }) => {
  const { t, i18n } = useLingui();
  const [relation, setRelation] = useState<PairRelation>('lab');
  const [scope, setScope] = useState<SuggestionsParams['scope']>('all');
  const [membership, setMembership] = useState<SuggestionsParams['membership']>('all');
  const [includePhd, setIncludePhd] = useState(false);
  const [excludeLarge, setExcludeLarge] = useState(true);
  const [signal, setSignal] = useState<SuggestionSignal>('combined');
  const [quota, setQuota] = useState(5);
  const [shown, setShown] = useState(PAGE);

  const [data, setData] = useState<SuggestionsResponse | 'none' | 'error' | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAside, setShowAside] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const params = useMemo<SuggestionsParams>(
    () => ({ range, relation, scope, membership, includePhd, excludeLarge, signal, quota }),
    [range, relation, scope, membership, includePhd, excludeLarge, signal, quota],
  );
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    fetchSuggestions(slug, params, ctrl.signal)
      .then((r) => { setData(r ?? 'none'); setLoading(false); })
      .catch(() => { if (!ctrl.signal.aborted) { setData('error'); setLoading(false); } });
    return () => ctrl.abort();
  }, [slug, params]);
  useEffect(() => { setShown(PAGE); }, [params]);

  const loaded = data && typeof data === 'object' ? data : null;

  const onFeedback = async (sug: PairSuggestion, verdict: PairVerdict | null) => {
    if (!sug.key) return;
    setBusyKey(sug.key);
    setFeedbackError(null);
    try {
      await sendPairFeedback(slug, sug.a.id, sug.b.id, verdict);
      // Updated in place (no reload: the row stays where it is until the next load, or leaves the list when set aside).
      setData((cur) => {
        if (!cur || typeof cur !== 'object') return cur;
        return {
          ...cur,
          suggestions: cur.suggestions.map((x) => {
            if (x.key !== sug.key) return x;
            const counts = { ...(x.feedback?.counts ?? {}) };
            const before = x.feedback?.mine ?? null;
            if (before) counts[before] = Math.max(0, (counts[before] ?? 1) - 1);
            if (verdict) counts[verdict] = (counts[verdict] ?? 0) + 1;
            return { ...x, feedback: { counts, mine: verdict } };
          }),
        };
      });
    } catch (e) {
      setFeedbackError(apiErrorText(e));
    } finally {
      setBusyKey(null);
    }
  };

  const poleCouples = useMemo(() => {
    const poles = loaded?.poles ?? [];
    const out: { value: PairRelation; label: string }[] = [];
    poles.forEach((p, i) => poles.slice(i).forEach((q) => {
      out.push({ value: `${p.acronym}|${q.acronym}`, label: `${p.acronym} × ${q.acronym}` });
    }));
    return out;
  }, [loaded?.poles]);

  if (data === 'none') {
    return (
      <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
        <Trans>This structure is not part of the university co-authorship network.</Trans>
      </div>
    );
  }

  const fmt = (n: number) => n.toLocaleString(numberLocale());
  const select = 'input-soft !w-auto py-1 pr-7 text-xs cursor-pointer';
  const check = 'inline-flex items-center gap-1.5 cursor-pointer';
  const all = loaded?.suggestions ?? [];
  const isAside = (x: PairSuggestion) => !!x.feedback?.mine && ASIDE.has(x.feedback.mine);
  const asideCount = all.filter(isAside).length;
  const rows = showAside ? all : all.filter((x) => !isAside(x));
  const canExportFeedback = !!loaded?.feedback && getUserInfo().access.allowedSlugs === 'all';
  const level: ThemeLevel = loaded?.level ?? 'subfield';

  const downloadCsv = () => {
    const csv = toCsv({
      name: 'rapprochements',
      columns: [
        'researcher_1', 'labs_1', 'poles_1', 'researcher_2', 'labs_2', 'poles_2',
        'score', 'common_coauthors', 'named_coauthors', 'closeness', level === 'topic' ? 'shared_topics' : 'shared_subfields',
        'shared_references', 'references_closeness', 'rarest_references', 'cites_1_to_2', 'cites_2_to_1', 'my_opinion',
      ],
      rows: rows.map((s) => [
        s.a.label, s.a.labs.join('|'), s.a.poles.join('|'), s.b.label, s.b.labs.join('|'), s.b.poles.join('|'),
        s.score, s.common, s.via.map((v) => v.label).join('|'), s.similarity, s.themes.join('|'),
        s.references ?? 0, s.coupling ?? 0, (s.sharedRefs ?? []).join('|'), s.cites?.ab ?? 0, s.cites?.ba ?? 0, s.feedback?.mine ?? '',
      ]),
    });
    downloadBlob(new Blob([`﻿${csv}\r\n`], { type: 'text/csv;charset=utf-8' }),
      `rapprochements-${slug}-${range.start}-${range.end}.csv`);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="glass-card p-4 flex flex-col gap-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <select className={select} value={relation} onChange={(e) => setRelation(e.target.value as PairRelation)} title={t`Which pairs`}>
            <option value="lab">{t`Researchers of different labs`}</option>
            {poleCouples.length > 0 && <option value="pole">{t`Researchers of different poles`}</option>}
            {poleCouples.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
          {loaded?.structureLabs && (
            <select className={select} value={scope} onChange={(e) => setScope(e.target.value as SuggestionsParams['scope'])} title={t`Scope`}>
              <option value="all">{t`At least one researcher of the structure`}</option>
              <option value="structure">{t`Both researchers in the structure`}</option>
            </select>
          )}
          <select className={select} value={membership} onChange={(e) => setMembership(e.target.value as SuggestionsParams['membership'])} title={t`Lab membership of the researchers`}>
            <option value="all">{t`Every lab attribution`}</option>
            <option value="associates">{t`Labs of the directory (members and associates)`}</option>
            <option value="members">{t`Labs of the directory (members only)`}</option>
          </select>
          <select className={select} value={signal} onChange={(e) => setSignal(e.target.value as SuggestionSignal)} title={t`Ranking`}>
            <option value="combined">{level === 'topic' ? t`Common co-authors and research topics` : t`Common co-authors and subfields`}</option>
            <option value="triadic">{t`Common co-authors only`}</option>
            <option value="topics">{level === 'topic' ? t`Shared research topics only` : t`Shared subfields only`}</option>
            {loaded?.references && <option value="coupling">{t`Shared references only`}</option>}
            {loaded?.references && <option value="cites">{t`Direct citations only`}</option>}
          </select>
          <select className={select} value={quota} onChange={(e) => setQuota(Number(e.target.value))} title={t`Suggestions per researcher at most`}>
            {[1, 3, 5, 10].map((n) => (
              <option key={n} value={n}>{t`≤ ${n} per researcher`}</option>
            ))}
          </select>
          {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-light" aria-label={t`Loading`} />}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-muted dark:text-[#c3beb0]">
          <label className={check}>
            <input type="checkbox" checked={includePhd} onChange={(e) => setIncludePhd(e.target.checked)} className="accent-[#7048e8]" />
            <Trans>Suggest PhD students</Trans>
          </label>
          <label className={check}>
            <input type="checkbox" checked={excludeLarge} onChange={(e) => setExcludeLarge(e.target.checked)} className="accent-[#7048e8]" />
            <Trans>Exclude large collaborations (more than {LARGE_COLLAB_MAX_AUTHORS} authors)</Trans>
          </label>
        </div>
      </div>

      {data === 'error' && (
        <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
          <Trans>The suggested connections could not be loaded.</Trans>
        </div>
      )}
      {data === null && (
        <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
          <Trans>Loading the university network…</Trans>
        </div>
      )}

      {loaded && (
        <>
          <div className="flex flex-wrap items-center gap-2 px-1">
            <p className="text-sm text-muted dark:text-[#c3beb0]">
              <Plural value={loaded.total} one="# suggested connection" other="# suggested connections" />
            </p>
            {asideCount > 0 && (
              <label className={`${check} text-xs text-muted dark:text-[#c3beb0]`}>
                <input type="checkbox" checked={showAside} onChange={(e) => setShowAside(e.target.checked)} className="accent-[#7048e8]" />
                <Plural value={asideCount} one="Show the # suggestion you set aside" other="Show the # suggestions you set aside" />
              </label>
            )}
            {canExportFeedback && (
              <a
                href="/api/network/suggestions/feedback.csv"
                className="ml-auto inline-flex items-center gap-1 text-xs text-muted dark:text-[#c3beb0] hover:underline"
              >
                <Download className="w-3.5 h-3.5" /> <Trans>Every opinion (CSV)</Trans>
              </a>
            )}
            {rows.length > 0 && (
              <button
                type="button"
                onClick={downloadCsv}
                className={`${canExportFeedback ? '' : 'ml-auto '}inline-flex items-center gap-1 text-xs text-muted dark:text-[#c3beb0] hover:underline cursor-pointer`}
              >
                <Download className="w-3.5 h-3.5" /> <Trans>Suggestions (CSV)</Trans>
              </button>
            )}
          </div>

          {feedbackError && (
            <p className="text-xs text-[#b23b3b] dark:text-[#f08c8c] px-1">{feedbackError}</p>
          )}
          {rows.length === 0 ? (
            <div className="glass-card p-6 text-sm text-muted-light dark:text-[#8f897c]">
              <Trans>No suggested connection matches these filters over the period.</Trans>
            </div>
          ) : (
            <div className="glass-card overflow-x-auto px-2 pb-2">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted-light dark:text-[#8f897c]">
                    <th className="px-3 py-2"><Trans>Researcher</Trans></th>
                    <th className="px-3 py-2"><Trans>Researcher</Trans></th>
                    <th className="px-3 py-2"><Trans>Why</Trans></th>
                    <th
                      className="px-3 py-2 text-right"
                      title={loaded.references
                        ? (level === 'topic' ? t`2 × common co-authors (Adamic-Adar) + closeness of the research topics + ½ closeness of the references + direct citations` : t`2 × common co-authors (Adamic-Adar) + closeness of the subfields + ½ closeness of the references + direct citations`)
                        : (level === 'topic' ? t`2 × common co-authors (Adamic-Adar) + closeness of the research topics` : t`2 × common co-authors (Adamic-Adar) + closeness of the subfields`)}
                    ><Trans>Score</Trans></th>
                    {loaded.feedback && <th className="px-3 py-2"><Trans>Your opinion</Trans></th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, shown).map((s) => (
                    <tr key={`${s.a.id}-${s.b.id}`} className={`border-t border-ink/5 dark:border-white/5 align-top ${isAside(s) ? 'opacity-50' : ''}`}>
                      <td className="px-3 py-2"><AuthorCell author={s.a} /></td>
                      <td className="px-3 py-2"><AuthorCell author={s.b} /></td>
                      <td className="px-3 py-2"><ReasonCell s={s} level={level} /></td>
                      <td className="px-3 py-2 text-right text-muted dark:text-[#c3beb0]">{s.score.toFixed(2)}</td>
                      {loaded.feedback && (
                        <td className="px-3 py-2"><FeedbackButtons s={s} busy={busyKey === s.key} onFeedback={onFeedback} /></td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > shown && (
                <div className="flex justify-center py-2">
                  <button type="button" onClick={() => setShown(shown + PAGE)} className="text-xs text-muted dark:text-[#c3beb0] hover:underline cursor-pointer">
                    <Trans>Show more ({fmt(rows.length - shown)} remaining)</Trans>
                  </button>
                </div>
              )}
            </div>
          )}

          <p className="text-xs text-muted-light dark:text-[#8f897c] leading-relaxed px-1">
            <Trans>
              Researchers of different labs who have not co-signed any publication, ranked by their common co-authors
              and the closeness of their OpenAlex research topics over the period (subfields when the network has no
              topics). These are leads, not predictions: tested on 2020-2022, about one in seven of the 100 first
              suggestions led to a joint publication in 2023-2026 (one in ten between poles). A researcher who left is
              still suggested until the network is regenerated.
            </Trans>
            {loaded.references && (
              <> <Trans>
                The references they share (same works cited, OpenAlex) and the publications of one already cited by the
                other also count, with a low weight: they describe a common reading more than a future co-signature,
                and OpenAlex knows the references of about half of the publications (journal articles mostly).
              </Trans></>
            )}
            {loaded.restricted && (
              <> <Trans>Only the suggestions involving a researcher of your lab are shown.</Trans></>
            )}{' '}
            <a href={helpUrl('/guides/tableau-de-bord/binomes/', i18n.locale)} target="_blank" rel="noreferrer" className="underline hover:text-ink dark:hover:text-[#f5f2ea]">
              <Trans>How to read this view</Trans>
            </a>
          </p>
        </>
      )}
    </div>
  );
};
