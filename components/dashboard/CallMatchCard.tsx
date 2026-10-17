// Pieces of the « Calls for proposals » shared by the dashboard tab (CallsTab) and the block of the researcher record
// (CallsSection, druid-internal docs/plan-funding-calls.md, lot 7): a match of a researcher to a call (strength, opinion
// buttons, publications of the batch) and the meta line of a call.
import React, { useState } from 'react';
import { Check, ExternalLink, ThumbsDown, ThumbsUp, Briefcase } from 'lucide-react';
import { Trans, Plural, useLingui } from '@lingui/react/macro';
import { i18n } from '@lingui/core';
import type { Researcher } from '../../types';
import type { DashboardPublication } from './types';
import { normTitle } from '../../lib/normalize';
import { doiUrl } from '../../lib/doi';
import type { Call, CallMatch, FeedbackVerdict, ProgrammeView } from '../../lib/calls/aggregate';
import type { MatchOverall } from '../../lib/calls/trm';

const OPENALEX_SEARCH = 'https://openalex.org/works?filter=default.search:';

/** Link of a publication named by the batch (graph uid, title, year): its DOI when the dashboard knows the publication
 * by its title, else a search on OpenAlex. The batch does not carry the DOI. */
export type PublicationLinks = Map<string, string>;
export const publicationLinksOf = (pubs: DashboardPublication[] | undefined): PublicationLinks => {
  const map: PublicationLinks = new Map();
  for (const p of pubs ?? []) {
    const key = normTitle(p.title);
    const url = doiUrl(p.doi);
    if (key && url && !map.has(key)) map.set(key, url);
  }
  return map;
};
const linkOf = (links: PublicationLinks, title: string): string =>
  links.get(normTitle(title)) ?? `${OPENALEX_SEARCH}${encodeURIComponent(title)}`;

export const today = () => new Date().toISOString().slice(0, 10);
/** The French rendering when the interface is French and the text was translated, else the English original. */
export const localized = (en: string, fr?: string): string => (i18n.locale === 'fr' && fr ? fr : en);
export const fmtDate = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00`).toLocaleDateString(i18n.locale) : d);

const OVERALL_STYLE: Record<MatchOverall, string> = {
  strong: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  plausible: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  weak: 'bg-stone-200 text-stone-700 dark:bg-white/10 dark:text-[#c3beb0]',
  none: 'bg-stone-200 text-stone-700 dark:bg-white/10 dark:text-[#c3beb0]',
};

/** Strength assessed by the model (the badge), and beside it the relative score within the call as a thin bar: the
 * best candidate of a call always scores 1, whatever the model thinks of it, so the number alone misled. */
const OverallBadge: React.FC<{ overall: MatchOverall; score: number }> = ({ overall, score }) => {
  const { t } = useLingui();
  const label: Record<MatchOverall, string> = { strong: t`strong match`, plausible: t`plausible match`, weak: t`weak match`, none: t`unrated` };
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${OVERALL_STYLE[overall]}`} title={t`Strength of the match as assessed by the language model from the publications`}>
        {label[overall]}
      </span>
      <span className="inline-block w-12 h-1.5 rounded-full bg-ink/10 dark:bg-white/10 overflow-hidden" title={t`Relative score within the call: the best candidate of the call is at 100 %, the others in proportion`} aria-label={t`Relative score ${Math.round(score * 100)} %`}>
        <span className="block h-full bg-ink/50 dark:bg-[#f5f2ea]/60" style={{ width: `${Math.round(score * 100)}%` }} />
      </span>
    </span>
  );
};

const FeedbackButtons: React.FC<{ match: CallMatch; onFeedback: (pairId: string, verdict: FeedbackVerdict) => void; busy: boolean }> = ({ match, onFeedback, busy }) => {
  const { t } = useLingui();
  const options: { verdict: FeedbackVerdict; label: string; icon: React.ReactNode }[] = [
    { verdict: 'relevant', label: t`Relevant`, icon: <ThumbsUp className="w-3.5 h-3.5" /> },
    { verdict: 'not_relevant', label: t`Not relevant`, icon: <ThumbsDown className="w-3.5 h-3.5" /> },
    { verdict: 'already_applying', label: t`Already applying`, icon: <Briefcase className="w-3.5 h-3.5" /> },
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {options.map((o) => {
        const count = match.feedback[o.verdict] ?? 0;
        const mine = match.mine === o.verdict;
        return (
          <button
            key={o.verdict}
            type="button"
            disabled={busy}
            onClick={() => onFeedback(match.pairId, o.verdict)}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold border transition-colors ${
              mine
                ? 'bg-ink text-white border-ink dark:bg-[#f5f2ea] dark:text-[#1c1a14] dark:border-[#f5f2ea]'
                : 'bg-white/70 dark:bg-white/10 border-white/80 dark:border-white/15 text-muted dark:text-[#c3beb0] hover:text-ink dark:hover:text-[#f5f2ea]'
            }`}
            title={t`Your opinion on this match (one per person, the last one wins)`}
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

export const MatchCard: React.FC<{
  match: CallMatch; researcher?: Researcher | null; onOpenResearcher?: (r: Researcher) => void;
  onFeedback: (pairId: string, verdict: FeedbackVerdict) => void; busy: boolean; showName?: boolean; links: PublicationLinks;
}> = ({ match, researcher, onOpenResearcher, onFeedback, busy, showName = true, links }) => {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const relevant = match.publications.filter((p) => p.relevant);
  const shown = open ? relevant : relevant.slice(0, 3);
  return (
    <div className="rounded-2xl bg-white/60 dark:bg-white/5 border border-white/80 dark:border-white/10 p-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {showName && (researcher && onOpenResearcher ? (
            <button type="button" onClick={() => onOpenResearcher(researcher)} className="font-semibold text-[14px] text-ink dark:text-[#f5f2ea] hover:underline truncate">
              {researcher.displayName || match.personName}
            </button>
          ) : (
            <span className="font-semibold text-[14px] text-ink dark:text-[#f5f2ea] truncate">{match.personName}</span>
          ))}
          <OverallBadge overall={match.overall} score={match.score} />
        </div>
        <FeedbackButtons match={match} onFeedback={onFeedback} busy={busy} />
      </div>
      {match.justification && <p className="text-[13px] text-muted dark:text-[#c3beb0] leading-relaxed">{localized(match.justification, match.justificationFr)}</p>}
      {relevant.length > 0 && (
        <ul className="text-[12.5px] space-y-1">
          {shown.map((p) => (
            <li key={p.uid} className="flex gap-2">
              <span className="shrink-0 text-muted-lighter dark:text-[#8f897c] tabular-nums">{p.year ?? '—'}</span>
              <a
                href={linkOf(links, p.title)}
                target="_blank"
                rel="noreferrer"
                className="text-ink dark:text-[#f5f2ea] hover:underline inline-flex items-start gap-1"
                title={links.has(normTitle(p.title)) ? t`Open the publication (DOI)` : t`Search this title on OpenAlex (DOI unknown)`}
              >
                <span>{p.title}</span>
                <ExternalLink className="w-3 h-3 mt-1 shrink-0 opacity-60" />
              </a>
            </li>
          ))}
          {relevant.length > 3 && (
            <li>
              <button type="button" onClick={() => setOpen(!open)} className="text-[12px] font-semibold text-muted hover:text-ink dark:text-[#c3beb0] dark:hover:text-[#f5f2ea]">
                {open ? <Trans>Fewer publications</Trans> : <Plural value={relevant.length - 3} one="# more publication" other="# more publications" />}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
};

/** Second line of a call: identifier, programme (when several are shown) and the classification of the source. */
export const CallMeta: React.FC<{ call: Call; programme?: ProgrammeView; showProgramme: boolean }> = ({ call, programme, showProgramme }) => (
  <span className="block text-[12px] text-muted dark:text-[#c3beb0] mt-0.5">
    {call.callId}
    {showProgramme && programme && <> · {programme.name}</>}
    {call.scheme && <> · {call.scheme}</>}
    {call.taxonomy.destination && <> · {call.taxonomy.destination}</>}
  </span>
);
