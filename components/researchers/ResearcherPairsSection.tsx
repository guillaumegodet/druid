import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Handshake, Heart, HeartHandshake, Minus, Sparkles, Undo2, X } from 'lucide-react';
import { Trans, Plural, useLingui } from '@lingui/react/macro';
import type { Researcher } from '../../types';
import { hasCapability, getUserInfo } from '../../lib/auth';
import { apiErrorText } from '../../lib/apiErrors';
import { helpUrl } from '../../lib/helpLinks';
import {
  fetchResearcherPairs,
  sendPairFeedback,
  type PairAuthor,
  type PairSuggestion,
  type PairTrend,
  type PairVerdict,
  type ResearcherPair,
  type ResearcherPairsResponse,
} from '../dashboard/pairsApi';

// « Pairs » block of the researcher record (druid-internal `docs/archive/plan-binomes-chercheurs.md`): the researcher's most
// frequent co-authors as photo cards, and the suggested connections of the last five years as a deck of cards to
// judge one by one (the opinions of lot 4: « Relevant » on the right, « Not relevant » on the left, by button or by
// dragging the card). Served by /api/researchers/:key/pairs from the university-wide network; hidden when the
// researcher is absent from it or has neither pair nor suggestion.

type CoauthorFilter = 'all' | 'otherLab' | 'otherPole';

/** Background of the portraits without photo: a warm gradient chosen from the name, always the same. */
const GRADIENTS = [
  'from-[#e8a87c] to-[#c38d9e]',
  'from-[#85cdca] to-[#41b3a3]',
  'from-[#f6d186] to-[#e8a87c]',
  'from-[#a8d8ea] to-[#aa96da]',
  'from-[#b5d99c] to-[#5ab9a8]',
  'from-[#f4a6a6] to-[#d97b93]',
];
const hashOf = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0);
const initialsOf = (label: string) => label.split(/[\s-]+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

/** Photo of a researcher (lab website URL of their record), the initials on a gradient when missing or broken. */
const Portrait: React.FC<{ label: string; photo?: string; className?: string; textClass?: string }> = ({ label, photo, className = '', textClass = 'text-4xl' }) => {
  const [broken, setBroken] = useState(false);
  if (photo && !broken) {
    return <img src={photo} alt="" loading="lazy" draggable={false} onError={() => setBroken(true)} className={`${className} object-cover`} />;
  }
  return (
    <div className={`${className} bg-gradient-to-br ${GRADIENTS[Math.abs(hashOf(label)) % GRADIENTS.length]} flex items-center justify-center`}>
      <span className={`font-disp font-bold text-white/90 tracking-tight select-none ${textClass}`}>{initialsOf(label) || '?'}</span>
    </div>
  );
};

const TopicChips: React.FC<{ topics: string[]; tone?: 'light' | 'dark' }> = ({ topics, tone = 'light' }) => (
  <div className="flex flex-wrap gap-1">
    {topics.map((x) => (
      <span
        key={x}
        className={`pill px-2 py-0.5 text-[10.5px] leading-snug ${tone === 'dark' ? 'bg-white/20 text-white backdrop-blur-sm' : 'bg-pixel-teal/15 text-ink dark:text-[#f5f2ea]'}`}
      >
        {x}
      </span>
    ))}
  </div>
);

const TrendLine: React.FC<{ trend: PairTrend; first: number; last: number }> = ({ trend, first, last }) => {
  const { t } = useLingui();
  const view: Record<PairTrend, { icon: React.ReactNode; label: string; title: string }> = {
    new: { icon: <Sparkles className="w-3.5 h-3.5 text-pixel-teal" />, label: t`New`, title: t`First joint publication in the last three years` },
    rising: { icon: <ArrowUp className="w-3.5 h-3.5 text-pixel-teal" />, label: t`Rising`, title: t`More joint publications in the last three years than in the three before` },
    steady: { icon: <Minus className="w-3.5 h-3.5 text-muted-light" />, label: t`Steady`, title: t`Joint publications in the last three years, no more than before` },
    dormant: { icon: <ArrowDown className="w-3.5 h-3.5 text-[#b23b3b] dark:text-[#f08c8c]" />, label: t`Dormant`, title: t`No joint publication in the last three years` },
  };
  const v = view[trend];
  return (
    <span className="inline-flex items-center gap-1 text-muted dark:text-[#c3beb0]" title={v.title}>
      {v.icon}{v.label}
      <span className="text-muted-light dark:text-[#8f897c]">· {first === last ? first : `${first}–${last}`}</span>
    </span>
  );
};

interface PeopleLinks {
  photoOf: (a: PairAuthor) => string | undefined;
  /** Opens the record of a researcher listed in the directory of the viewer; null when not reachable. */
  openerOf: (a: PairAuthor) => (() => void) | null;
}

const NameButton: React.FC<{ author: PairAuthor; links: PeopleLinks; className: string }> = ({ author, links, className }) => {
  const open = links.openerOf(author);
  return open ? (
    <button type="button" onClick={open} className={`${className} text-left hover:underline cursor-pointer`}>{author.label}</button>
  ) : (
    <span className={className}>{author.label}</span>
  );
};

/** One frequent co-author: portrait, joint publications, trend and the main topics of their joint work. */
const CoauthorCard: React.FC<{ pair: ResearcherPair; partner: PairAuthor; links: PeopleLinks }> = ({ pair, partner, links }) => (
  <div className="snap-start shrink-0 w-40 sm:w-44 flex flex-col rounded-2xl overflow-hidden bg-white/70 dark:bg-white/5 border border-ink/5 dark:border-white/10 shadow-soft transition-transform hover:-translate-y-0.5">
    <div className="relative aspect-[4/5]">
      <Portrait label={partner.label} photo={links.photoOf(partner)} className="absolute inset-0 w-full h-full" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-transparent" />
      <span className="absolute top-2 left-2 pill bg-white/90 text-ink text-[11px] font-bold px-2 py-0.5 shadow-sm">
        <Plural value={pair.shared} one="# joint pub." other="# joint pubs" />
      </span>
      {pair.crossPole && (
        <span className="absolute top-2 right-2 pill bg-pixel-teal text-white text-[10px] font-semibold px-1.5 py-0.5 shadow-sm">
          <Trans>other pole</Trans>
        </span>
      )}
      <div className="absolute bottom-0 inset-x-0 p-2.5 text-white flex flex-col gap-0.5">
        <NameButton author={partner} links={links} className="font-disp font-bold text-[14px] leading-tight text-white" />
        <span className="text-[11px] text-white/80 leading-tight">{partner.labs.join(', ')}</span>
      </div>
    </div>
    <div className="p-2.5 flex flex-col gap-1.5 text-[11px]">
      <TrendLine trend={pair.trend} first={pair.first} last={pair.last} />
      {(pair.topics?.length ? pair.topics : pair.subfields).length > 0 && (
        <TopicChips topics={(pair.topics?.length ? pair.topics : pair.subfields).slice(0, 2)} />
      )}
    </div>
  </div>
);

const SWIPE = 110; // px of drag that judge a card

/** The top card of the deck: portrait, why it is suggested; draggable when opinions are available. */
const SuggestionCard: React.FC<{
  s: PairSuggestion;
  partner: PairAuthor;
  links: PeopleLinks;
  draggable: boolean;
  leaving: 'left' | 'right' | null;
  onSwipe: (dir: 'left' | 'right') => void;
}> = ({ s, partner, links, draggable, leaving, onSwipe }) => {
  const [dx, setDx] = useState(0);
  const start = useRef<number | null>(null);
  const others = s.common - s.via.length;
  const x = leaving === 'right' ? 600 : leaving === 'left' ? -600 : dx;
  const dragging = start.current != null;
  return (
    <div
      className={`absolute inset-0 flex flex-col rounded-3xl overflow-hidden bg-cream-50 dark:bg-[#26231e] border border-white/60 dark:border-white/10 shadow-soft-lg select-none ${draggable ? 'cursor-grab active:cursor-grabbing touch-pan-y' : ''}`}
      style={{
        transform: `translateX(${x}px) rotate(${x / 18}deg)`,
        transition: dragging ? 'none' : 'transform 320ms ease, opacity 320ms ease',
        opacity: leaving ? 0 : 1,
      }}
      onPointerDown={draggable ? (e) => { start.current = e.clientX; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); } : undefined}
      onPointerMove={draggable ? (e) => { if (start.current != null) setDx(e.clientX - start.current); } : undefined}
      onPointerUp={draggable ? () => {
        const d = dx;
        start.current = null;
        setDx(0);
        if (d > SWIPE) onSwipe('right');
        else if (d < -SWIPE) onSwipe('left');
      } : undefined}
      onPointerCancel={() => { start.current = null; setDx(0); }}
    >
      <div className="relative flex-1 min-h-0">
        <Portrait label={partner.label} photo={links.photoOf(partner)} className="absolute inset-0 w-full h-full" textClass="text-7xl" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
        {/* Stamps while dragging. */}
        <span
          className="absolute top-6 left-5 -rotate-12 rounded-lg border-[3px] border-emerald-400 text-emerald-300 font-disp font-extrabold text-xl px-2 tracking-wider"
          style={{ opacity: Math.max(0, Math.min(1, x / SWIPE)) }}
        >
          <Trans>RELEVANT</Trans>
        </span>
        <span
          className="absolute top-6 right-5 rotate-12 rounded-lg border-[3px] border-rose-400 text-rose-300 font-disp font-extrabold text-xl px-2 tracking-wider"
          style={{ opacity: Math.max(0, Math.min(1, -x / SWIPE)) }}
        >
          <Trans>NOT RELEVANT</Trans>
        </span>
        {s.crossPole && (
          <span className="absolute top-3 left-3 pill bg-pixel-teal text-white text-[11px] font-semibold px-2 py-0.5 shadow-sm" style={{ opacity: dx ? 0 : 1 }}>
            <Trans>Interdisciplinary · other pole</Trans>
          </span>
        )}
        <div className="absolute bottom-0 inset-x-0 p-4 text-white flex flex-col gap-1.5">
          <NameButton author={partner} links={links} className="font-disp font-bold text-2xl leading-tight text-white" />
          <span className="text-[12.5px] text-white/85">
            {partner.labs.join(', ')}{partner.poles.length > 0 && <span className="text-white/65"> · {partner.poles.join(', ')}</span>}
          </span>
          {s.themes.length > 0 && <TopicChips topics={s.themes} tone="dark" />}
        </div>
      </div>
      <div className="shrink-0 px-4 py-3 flex flex-col gap-1 text-[12px] text-muted dark:text-[#c3beb0]">
        {s.common > 0 ? (
          <span>
            <span className="font-semibold text-ink dark:text-[#f5f2ea]">
              <Plural value={s.common} one="# common co-author:" other="# common co-authors:" />
            </span>{' '}
            {s.via.map((v) => v.label).join(', ')}
            {others > 0 && <> <Trans>and {others} more</Trans></>}
          </span>
        ) : (
          <span><Trans>No common co-author yet: close by their research topics only.</Trans></span>
        )}
      </div>
    </div>
  );
};

const VERDICT_ICON: Record<PairVerdict, React.ReactNode> = {
  relevant: <Heart className="w-3 h-3 fill-current" />,
  already_in_contact: <Handshake className="w-3 h-3" />,
  not_relevant: <X className="w-3 h-3" />,
};

export const ResearcherPairsSection: React.FC<{
  researcher: Researcher;
  /** Records readable by the viewer: photos and links of the co-authors. */
  researchers?: Researcher[];
  onOpenResearcher?: (id: string) => void;
}> = ({ researcher, researchers = [], onOpenResearcher }) => {
  const { t, i18n } = useLingui();
  const enabled = hasCapability('HAS_NETWORK_API') && !researcher.id.startsWith('NEW-');
  const [data, setData] = useState<ResearcherPairsResponse | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<CoauthorFilter>('all');
  const [leaving, setLeaving] = useState<{ key: string; dir: 'left' | 'right' } | null>(null);
  const [pos, setPos] = useState(0); // deck position when opinions are unavailable
  const [history, setHistory] = useState<string[]>([]); // judged in this visit, last first (« undo »)

  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    setData(null);
    setPos(0);
    setHistory([]);
    fetchResearcherPairs(researcher.id, ctrl.signal)
      .then((d) => { setData(d); setError(''); })
      .catch((e) => { if (!ctrl.signal.aborted) setError(apiErrorText(e)); });
    return () => ctrl.abort();
  }, [researcher.id, enabled]);

  const byId = useMemo(() => new Map(researchers.map((r) => [r.id, r])), [researchers]);
  const links: PeopleLinks = useMemo(() => ({
    photoOf: (a) => (a.uid ? byId.get(a.uid)?.photoUrl || undefined : undefined),
    openerOf: (a) => (a.uid && onOpenResearcher && byId.has(a.uid) ? () => onOpenResearcher(a.uid!) : null),
  }), [byId, onOpenResearcher]);

  if (!enabled || !data?.found) {
    return error ? <div className="glass-card p-5 text-[12px] text-[#b23b3b] dark:text-[#e57373]">{error}</div> : null;
  }
  const me = data.authorId;
  const partnerOf = (p: { a: PairAuthor; b: PairAuthor }) => (p.a.id === me ? p.b : p.a);
  const selfAuthor = [...data.observed, ...data.suggestions].map((p) => (p.a.id === me ? p.a : p.b))[0];
  const observed = data.observed.filter((p) => {
    if (filter === 'otherPole') return p.crossPole;
    if (filter === 'otherLab') return !partnerOf(p).labs.some((l) => selfAuthor?.labs.includes(l));
    return true;
  });
  if (!data.observed.length && !data.suggestions.length) return null;

  const canJudge = !!data.feedback && !!data.feedbackSlug;
  const keyOf = (s: PairSuggestion) => `${s.a.id}-${s.b.id}`;
  const pending = canJudge ? data.suggestions.filter((s) => !s.feedback?.mine) : data.suggestions.slice(pos);
  const judged = canJudge ? data.suggestions.filter((s) => s.feedback?.mine) : [];
  const self = getUserInfo().preferred_username === researcher.id;

  const judge = async (s: PairSuggestion, verdict: PairVerdict | null, dir?: 'left' | 'right') => {
    const k = keyOf(s);
    const apply = (v: PairVerdict | null) => setData((prev) => prev && ({
      ...prev,
      suggestions: prev.suggestions.map((x) => {
        if (keyOf(x) !== k) return x;
        const counts = { ...(x.feedback?.counts ?? {}) };
        const old = x.feedback?.mine ?? null;
        if (old) counts[old] = Math.max(0, (counts[old] ?? 1) - 1);
        if (v) counts[v] = (counts[v] ?? 0) + 1;
        return { ...x, feedback: { counts, mine: v } };
      }),
    }));
    const previous = s.feedback?.mine ?? null;
    if (dir) {
      setLeaving({ key: k, dir });
      await new Promise((r) => setTimeout(r, 300));
      setLeaving(null);
    }
    apply(verdict);
    setHistory((h) => (verdict ? [k, ...h.filter((x) => x !== k)] : h.filter((x) => x !== k)));
    try {
      await sendPairFeedback(data.feedbackSlug!, s.a.id, s.b.id, verdict);
    } catch (e) {
      apply(previous);
      setError(apiErrorText(e));
    }
  };
  const top = pending[0];
  const swipe = (dir: 'left' | 'right', verdict?: PairVerdict) => {
    if (!top) return;
    if (canJudge) void judge(top, verdict ?? (dir === 'right' ? 'relevant' : 'not_relevant'), dir);
    else setPos((p) => Math.min(p + 1, data.suggestions.length));
  };
  const undo = () => {
    const k = history[0];
    const s = data.suggestions.find((x) => keyOf(x) === k);
    if (s) void judge(s, null);
  };

  const filterBtn = (f: CoauthorFilter, label: string) => (
    <button
      type="button"
      onClick={() => setFilter(f)}
      className={`pill px-2.5 py-1 text-[11px] font-semibold cursor-pointer transition-colors ${filter === f ? 'bg-ink text-white dark:bg-[#f5f2ea] dark:text-ink' : 'bg-white/60 dark:bg-white/10 text-muted dark:text-[#c3beb0] hover:bg-white'}`}
    >
      {label}
    </button>
  );
  const roundBtn = 'w-12 h-12 rounded-full flex items-center justify-center shadow-soft border transition-transform hover:scale-110 active:scale-95 disabled:opacity-40 disabled:hover:scale-100 cursor-pointer';

  return (
    <div className="glass-card p-5 flex flex-col gap-5">
      <div className="flex flex-col gap-0.5">
        <h4 className="font-disp font-semibold text-[14px] text-ink dark:text-[#f5f2ea] flex items-center gap-2">
          <HeartHandshake className="w-4 h-4" /> {self ? <Trans>Your research pairs</Trans> : <Trans>Research pairs</Trans>}
        </h4>
        <p className="text-[11px] text-muted-lighter dark:text-[#8f897c]">
          <Trans>
            From the co-signed publications of the university network (CRISalid, OpenAlex, HAL), large collaborations of
            more than 50 authors left out.
          </Trans>{' '}
          <a href={helpUrl('/guides/tableau-de-bord/binomes/', i18n.locale)} target="_blank" rel="noreferrer" className="underline hover:text-ink dark:hover:text-[#f5f2ea]">
            <Trans>How to read this view</Trans>
          </a>
        </p>
      </div>

      {error && <p className="text-[12px] text-[#b23b3b] dark:text-[#e57373]">{error}</p>}

      {data.observed.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] uppercase tracking-[.06em] text-muted-lighter dark:text-[#8f897c]">
              <Trans>Most frequent co-authors</Trans>
            </span>
            <div className="flex flex-wrap gap-1.5">
              {filterBtn('all', t`All`)}
              {filterBtn('otherLab', t`Other labs`)}
              {filterBtn('otherPole', t`Other poles`)}
            </div>
          </div>
          {observed.length ? (
            <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1">
              {observed.map((p) => <CoauthorCard key={`${p.a.id}-${p.b.id}`} pair={p} partner={partnerOf(p)} links={links} />)}
            </div>
          ) : (
            <p className="text-[12px] text-muted-lighter dark:text-[#8f897c]"><Trans>No pair with at least two joint publications for this filter.</Trans></p>
          )}
        </div>
      )}

      {data.suggestions.length > 0 && (
        <div className="grid gap-5 md:grid-cols-[minmax(0,20rem)_1fr] items-start">
          <div className="flex flex-col items-center gap-4">
            <div className="relative w-full max-w-[20rem] aspect-[3/4.2]">
              {pending.length === 0 ? (
                <div className="absolute inset-0 rounded-3xl border-2 border-dashed border-ink/10 dark:border-white/15 flex flex-col items-center justify-center gap-2 p-6 text-center">
                  <HeartHandshake className="w-10 h-10 text-pixel-teal" />
                  <span className="font-disp font-semibold text-ink dark:text-[#f5f2ea]"><Trans>You have seen every suggestion</Trans></span>
                  {!canJudge && (
                    <button type="button" onClick={() => setPos(0)} className="text-[12px] underline text-muted dark:text-[#c3beb0] cursor-pointer"><Trans>Start again</Trans></button>
                  )}
                </div>
              ) : (
                pending.slice(0, 3).reverse().map((s, i, arr) => {
                  const depth = arr.length - 1 - i; // 0 = top card
                  const k = keyOf(s);
                  return depth === 0 ? (
                    <SuggestionCard
                      key={k}
                      s={s}
                      partner={partnerOf(s)}
                      links={links}
                      draggable
                      leaving={leaving?.key === k ? leaving.dir : null}
                      onSwipe={(dir) => swipe(dir)}
                    />
                  ) : (
                    <div
                      key={k}
                      aria-hidden
                      className="absolute inset-0 rounded-3xl overflow-hidden shadow-soft border border-white/50 dark:border-white/10"
                      style={{ transform: `translateY(${depth * 10}px) scale(${1 - depth * 0.04})`, transition: 'transform 320ms ease' }}
                    >
                      <Portrait label={partnerOf(s).label} photo={links.photoOf(partnerOf(s))} className="absolute inset-0 w-full h-full" textClass="text-7xl" />
                      <div className="absolute inset-0 bg-black/25" />
                    </div>
                  );
                })
              )}
            </div>
            {pending.length > 0 && (
              <div className="flex items-center gap-4">
                {canJudge ? (
                  <>
                    <button type="button" className={`${roundBtn} bg-white dark:bg-[#2b2822] border-rose-200 text-rose-500`} onClick={() => swipe('left')} title={t`Not relevant`} aria-label={t`Not relevant`}>
                      <X className="w-6 h-6" />
                    </button>
                    <button type="button" className={`${roundBtn} w-10 h-10 bg-white dark:bg-[#2b2822] border-sky-200 text-sky-600`} onClick={() => swipe('right', 'already_in_contact')} title={t`Already in contact`} aria-label={t`Already in contact`}>
                      <Handshake className="w-5 h-5" />
                    </button>
                    <button type="button" className={`${roundBtn} bg-white dark:bg-[#2b2822] border-emerald-200 text-emerald-500`} onClick={() => swipe('right')} title={t`Relevant`} aria-label={t`Relevant`}>
                      <Heart className="w-6 h-6 fill-current" />
                    </button>
                    <button type="button" className={`${roundBtn} w-9 h-9 bg-white/70 dark:bg-white/10 border-ink/10 text-muted`} onClick={undo} disabled={!history.length} title={t`Undo the last opinion`} aria-label={t`Undo the last opinion`}>
                      <Undo2 className="w-4 h-4" />
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className={`${roundBtn} bg-white dark:bg-[#2b2822] border-ink/10 text-muted`} onClick={() => setPos((p) => Math.max(0, p - 1))} disabled={pos === 0} aria-label={t`Previous`}>
                      <ChevronLeft className="w-6 h-6" />
                    </button>
                    <button type="button" className={`${roundBtn} bg-white dark:bg-[#2b2822] border-ink/10 text-muted`} onClick={() => swipe('right')} aria-label={t`Next`}>
                      <ChevronRight className="w-6 h-6" />
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 text-[12.5px] text-muted dark:text-[#c3beb0]">
            <div className="flex flex-col gap-1">
              <span className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea]">
                {self ? <Trans>Researchers you could work with</Trans> : <Trans>Researchers to meet</Trans>}
              </span>
              <span>
                <Plural value={data.suggestions.length} one="# suggestion" other="# suggestions" />
                {data.from != null && <> · {data.from}–{data.to}</>}
                {pending.length > 0 && pending.length < data.suggestions.length && <> · <Trans>{pending.length} left</Trans></>}
              </span>
            </div>
            <p className="leading-relaxed">
              <Trans>
                Researchers of other labs who never co-signed with this researcher, ranked by their common co-authors and
                the closeness of their research topics over the last five years. These are leads: tested on past years,
                about one in seven of the first suggestions led to a joint publication.
              </Trans>
            </p>
            {canJudge && (
              <p className="leading-relaxed">
                <Trans>
                  Drag the card to the right (relevant) or to the left (not relevant), or use the buttons. Your opinions,
                  shared with the « Researcher pairs » tab of the dashboard, help judge the suggestions.
                </Trans>
              </p>
            )}
            {judged.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] uppercase tracking-[.06em] text-muted-lighter dark:text-[#8f897c]"><Trans>Your opinions</Trans></span>
                <div className="flex flex-wrap gap-2">
                  {judged.map((s) => {
                    const p = partnerOf(s);
                    const mine = s.feedback!.mine!;
                    return (
                      <button
                        key={keyOf(s)}
                        type="button"
                        onClick={() => void judge(s, null)}
                        title={t`Withdraw the opinion and put the card back in the deck`}
                        className="group inline-flex items-center gap-1.5 pill pl-0.5 pr-2.5 py-0.5 bg-white/70 dark:bg-white/10 border border-ink/5 dark:border-white/10 hover:bg-white cursor-pointer"
                      >
                        <Portrait label={p.label} photo={links.photoOf(p)} className="w-6 h-6 rounded-full overflow-hidden" textClass="text-[9px]" />
                        <span className="text-[12px] text-ink dark:text-[#f5f2ea]">{p.label}</span>
                        <span className={mine === 'relevant' ? 'text-emerald-500' : mine === 'not_relevant' ? 'text-rose-500' : 'text-sky-600'}>{VERDICT_ICON[mine]}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
