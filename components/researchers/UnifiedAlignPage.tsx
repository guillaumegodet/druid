import React, { useMemo, useState, useEffect } from 'react';
import { useCompactHeader } from '../../hooks/useCompactHeader';
import {
  RefreshCw, RotateCw, Check, Link2, Users, GraduationCap, Briefcase, Save, CheckSquare, Square,
  ChevronDown, ChevronRight, Sparkles, AlertTriangle, Zap, ArrowRight, GitCompare, Shuffle, ExternalLink, CircleStop,
  CircleDashed, CircleHelp, SearchX, UsersRound,
} from 'lucide-react';
import {
  ALIGN_SOURCE_META, buildUnifiedUpdates, unifiedAmbigKey, unifiedCandidateId, unifiedFillKey,
} from '../../lib/gristService';
import type {
  AlignCandidate, AlignGroup, AlignMode, IdrefCandidate, PersonAlignCell, PersonAlignRow,
  PersonAlignUpdate, ReviewMixedItem, UnifiedAlignDiff, UnifiedAlignSource, UnifiedArbitrateDecision,
} from '../../lib/gristService';
import type { UnifiedRunProgress } from '../../lib/unifiedAlignRuns';
import { AlignLaunchModal, type AlignLaunchChoice } from './AlignLaunchModal';
import { numberLocale } from '../../lib/i18n';
import { Trans, Plural, useLingui } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import { HelpButton } from '../HelpButton';
import { VIEW_HELP } from '../../lib/helpLinks';
import { ViewState } from '../../types';
import {
  StatCard, ProposalRow, PixelBtn, MatchedBadge, MixedBtn, RejectBtn, MixedSection, ArbitrageCard,
  IdrefCandidateLine, AlignCandidateLine, ExistingPill,
} from './alignAtoms';

/**
 * Unified alignment view (docs/plan-alignement-unifie.md): one row per Annuaire record with
 * something to do, one badge per authority source (IdRef/ORCID/HAL/OpenAlex), detail drawer
 * on click. Consumes `computeUnifiedAlignDiff` and only aggregates/displays what the per-source pages
 * already produce — the candidate rendering, the name-mismatch arbitration card and the
 * « identités mêlées » section are those of these pages (exported components), not copies.
 *
 * Deliberate simplifications (see plan §4):
 * - Arbitrating an ambiguous case only writes the source's target column (no secondary field
 * such as IdHAL_i on an arbitrated HAL on the AlignPage side) — see buildUnifiedUpdates.
 * - No card-by-card « triage » view (IdrefAlignPage): the per-person list stands in for it.
 * - No push to Grist review: validation happens here, the Alignement_<SOURCE> tables
 * now only serve as a blacklist (decision of 2026-09-21).
 */

const SOURCE_LABEL: Record<UnifiedAlignSource, string> = { idref: 'IdRef', orcid: 'ORCID', hal: 'HAL', openalex: 'OpenAlex', scopus: 'Scopus' };
/** Column headers of the narrow table (pictogram badges, index.css .unified-table). */
const SOURCE_SHORT: Record<UnifiedAlignSource, string> = { idref: 'IdRef', orcid: 'ORCID', hal: 'HAL', openalex: 'OA', scopus: 'Sco.' };
const SOURCE_ORDER: UnifiedAlignSource[] = ['idref', 'orcid', 'hal', 'openalex', 'scopus'];
const MODE_LABEL: Record<AlignMode, MessageDescriptor> = { search: msg`Find missing`, verify: msg`Check existing ones` };

type Candidate = AlignCandidate | IdrefCandidate;
type RowRef = { id: string; uid: string; displayName: string; labo?: string };
type Redirection = NonNullable<PersonAlignCell['redirection']>;

const candidateUrl = (src: UnifiedAlignSource, c: Candidate): string =>
  (src === 'idref' ? `https://www.idref.fr/${(c as IdrefCandidate).ppn}` : (c as AlignCandidate).url);

/** Same rendering as IdrefAlignPage / AlignPage depending on the source. */
const CandidateView: React.FC<{ src: UnifiedAlignSource; c: Candidate }> = ({ src, c }) =>
  (src === 'idref' ? <IdrefCandidateLine c={c as IdrefCandidate} /> : <AlignCandidateLine c={c as AlignCandidate} />);

const CandidateLink: React.FC<{ src: UnifiedAlignSource; c: Candidate }> = ({ src, c }) => (
  <a href={candidateUrl(src, c)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/70 dark:bg-white/10 border border-ink/10 dark:border-white/15 font-mono text-[11px] font-bold text-ink dark:text-[#e7e2d6] hover:underline">
    <Link2 className="w-3 h-3" /> {unifiedCandidateId(src, c)}
  </a>
);

const isStrongScore = (f: NonNullable<PersonAlignCell['fill']>[number]) => !!(f.matchedIds?.length || f.score === 'fort');
const isActionableCell = (c?: PersonAlignCell) =>
  !!c && (c.status === 'strong' || c.status === 'ambiguous' || c.status === 'arbitrate' || c.status === 'redirect' || c.status === 'conflict');

/** Kind of work a cell holds — the stat cards double as filters on it (request of 2026-09-23). */
type CellKind = 'strong' | 'ambiguous' | 'arbitrate' | 'conflict';
const cellHasKind = (c: PersonAlignCell | undefined, kind: CellKind | ''): boolean => {
  if (!c) return false;
  if (!kind) return isActionableCell(c);
  if (kind === 'strong') return !!c.fill?.length;
  if (kind === 'ambiguous') return !!c.ambiguous;
  if (kind === 'arbitrate') return !!(c.arbitrate || c.redirection);
  return !!c.conflicts?.length;
};

/** Compact badge in the row — click = opens/closes the drawer; direct checkbox for the
 * simple « 1 strong candidate » case (the bulk of the volume, see plan §2). */
const SourcePastille: React.FC<{
  src: UnifiedAlignSource;
  cell?: PersonAlignCell;
  rowId: string;
  isOpen: boolean;
  onToggleOpen: () => void;
  selected: ReadonlySet<string>;
  onToggleSelect: (key: string) => void;
}> = ({ src, cell, rowId, isOpen, onToggleOpen, selected, onToggleSelect }) => {
  const { t } = useLingui();
  const label = SOURCE_LABEL[src];
  // Full-width badge in its source column (the sticky column header names the source), so the
  // eye scans one column per identifier; the wording is the state, not the source. Two renderings,
  // switched by the width of the table (index.css, .unified-table container): `ua-text` (wording)
  // when wide, `ua-icon` (pictogram + count) when narrow — the title/aria-label carries the meaning.
  const base = `inline-flex w-full min-h-[32px] items-center justify-center gap-1.5 px-1.5 py-1 rounded-full text-[12.5px] font-semibold transition-colors ${isOpen ? 'ring-2 ring-accent-strong' : ''}`;
  const nbConflicts = cell?.conflicts?.length ?? 0;
  const warn = nbConflicts > 0 ? <AlertTriangle className="w-3.5 h-3.5 shrink-0" /> : null;
  const both = (text: React.ReactNode, icon: React.ReactNode) => (
    <><span className="ua-text">{text}</span><span className="ua-icon items-center gap-0.5">{icon}</span></>
  );
  const count = (n: number) => <span className="font-mono text-[11.5px]">{n}</span>;

  if (!cell) return <span className="block w-full text-center text-muted-faint text-[12px]">—</span>;
  if (cell.status === 'strong') {
    const fill = cell.fill || [];
    const strong = fill.some(isStrongScore);
    const tone = strong
      ? 'bg-[rgba(46,160,102,.14)] text-[#1f7a4d] dark:bg-[rgba(46,160,102,.18)] dark:text-[#5fd39a] border border-transparent'
      : 'bg-white/70 dark:bg-white/10 border border-ink/10 dark:border-white/15';
    if (fill.length === 1) {
      const key = unifiedFillKey(rowId, src, unifiedCandidateId(src, fill[0].candidate));
      const title = t`${label}: one candidate to check — tick to fill in, click to see it`;
      return (
        <span className={`${base} ${tone} cursor-pointer hover:border-accent-strong ${selected.has(key) ? '!bg-accent/25 !border-accent-strong' : ''}`}>
          <input type="checkbox" checked={selected.has(key)} onChange={() => onToggleSelect(key)} className="accent-[#1c1b19] dark:accent-[#f4d24a]" onClick={(e) => e.stopPropagation()} aria-label={title} />
          <span onClick={onToggleOpen} className="flex-1 inline-flex items-center justify-center gap-1" title={title}>
            {both(strong ? t`strong candidate` : t`candidate`, strong ? <Sparkles className="w-3.5 h-3.5" /> : <CircleDashed className="w-3.5 h-3.5" />)}{warn}
          </span>
        </span>
      );
    }
    const title = t`${label}: candidates to check`;
    return <button onClick={onToggleOpen} className={`${base} ${tone}`} title={title} aria-label={title}>{both(<Plural value={fill.length} one="# candidate" other="# candidates" />, <><UsersRound className="w-3.5 h-3.5" />{count(fill.length)}</>)}{warn}</button>;
  }
  if (cell.status === 'ambiguous') {
    const n = cell.ambiguous?.candidates.length ?? 0;
    const title = t`${label}: ambiguous — pick a candidate or ignore`;
    return <button onClick={onToggleOpen} title={title} aria-label={title} className={`${base} bg-[rgba(231,111,154,.15)] text-[#a3436a] dark:bg-[rgba(231,111,154,.2)] dark:text-[#e88fb0]`}>{both(<Plural value={n} one="# candidate ?" other="# candidates ?" />, <><CircleHelp className="w-3.5 h-3.5" />{count(n)}</>)}{warn}</button>;
  }
  if (cell.status === 'arbitrate') {
    const title = t`Name mismatch between the record and its IdRef entry — confirm or detach`;
    return <button onClick={onToggleOpen} title={title} aria-label={title} className={`${base} ${cell.arbitrate?.suspect ? 'bg-[rgba(214,69,69,.14)] text-[#b23b3b] dark:text-[#f08c8c]' : 'bg-[rgba(231,111,154,.15)] text-[#a3436a] dark:bg-[rgba(231,111,154,.2)] dark:text-[#e88fb0]'}`}><GitCompare className="w-3.5 h-3.5 shrink-0" /><span className="ua-text">{t`name mismatch`}</span>{warn}</button>;
  }
  if (cell.status === 'redirect') {
    const title = t`IdRef entry merged/replaced by ABES — update the PPN`;
    return <button onClick={onToggleOpen} title={title} aria-label={title} className={`${base} bg-[rgba(112,72,232,.14)] text-[#6b3fbf] dark:bg-[rgba(112,72,232,.22)] dark:text-[#b9a1f0]`}><Shuffle className="w-3.5 h-3.5 shrink-0" /><span className="ua-text">{t`replaced entry`}</span></button>;
  }
  if (cell.status === 'conflict') {
    const title = t`${label}: conflict to review`;
    return <button onClick={onToggleOpen} title={title} aria-label={title} className={`${base} bg-[rgba(224,158,42,.18)] text-[#8a6113] dark:bg-[rgba(224,158,42,.16)] dark:text-[#f0c266]`}><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{both(<Plural value={nbConflicts} one="conflict" other="# conflicts" />, count(nbConflicts))}</button>;
  }
  if (cell.status === 'present') {
    const title = t`Already filled in: ${(cell.existing || []).join(', ')}`;
    return (
      <button onClick={onToggleOpen} title={title} aria-label={title}
        className={`${base} bg-[rgba(46,160,102,.10)] text-[#1f7a4d]/80 dark:text-[#5fd39a]/80`}>
        <Check className="w-3.5 h-3.5 shrink-0" /><span className="ua-text">{t`filled in`}</span>
      </button>
    );
  }
  if (cell.status === 'not_found') {
    const title = t`No candidate found during the last ${label} run.`;
    return <span className="flex w-full items-center justify-center text-muted-faint text-[12px]" title={title} aria-label={title}>{both(t`not found`, <SearchX className="w-3.5 h-3.5" />)}</span>;
  }
  return <span className="block w-full text-center text-muted-faint text-[12px]" title={t`Never searched on this source`}>·</span>;
};

/** Merged/replaced IdRef record — same card as IdrefAlignPage (« Notices IdRef remplacées » section). */
const RedirectionCard: React.FC<{ r: Redirection; applying: boolean; onUpdatePpn?: (r: Redirection) => void }> = ({ r, applying, onUpdatePpn }) => {
  const { t } = useLingui();
  return (
    <div className={`rounded-card border px-4 py-3 text-[12.5px] ${r.nameMismatch ? 'border-[rgba(224,158,42,.4)] bg-[rgba(224,158,42,.12)] dark:bg-[rgba(224,158,42,.1)]' : 'border-ink/10 dark:border-white/15 bg-white/70 dark:bg-white/5'}`}>
      <p className="text-muted dark:text-[#8f897c] mb-2"><Trans>The directory's IdRef points to a record merged or removed by ABES: IdRef redirects to the record replacing it. “Update” replaces the old PPN with the new one.</Trans></p>
      <div className="flex flex-wrap items-center gap-2">
        <a href={`https://www.idref.fr/${r.ppn}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/70 dark:bg-white/10 border border-ink/10 dark:border-white/15 font-mono text-[11px] font-bold text-muted dark:text-[#8f897c] line-through hover:underline">
          <Link2 className="w-3 h-3" /> {r.ppn}
        </a>
        <ArrowRight className="w-3.5 h-3.5 text-muted-light dark:text-[#8f897c]" />
        <a href={`https://www.idref.fr/${r.newPpn}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/70 dark:bg-white/10 border border-ink/10 dark:border-white/15 font-mono text-[11px] font-bold text-ink dark:text-[#e7e2d6] hover:underline">
          <Link2 className="w-3 h-3" /> {r.newPpn}
        </a>
        <div className="flex-1" />
        {onUpdatePpn && (
          <PixelBtn onClick={() => onUpdatePpn(r)} disabled={applying} tone="bg-ink text-white hover:bg-black dark:bg-accent dark:text-ink dark:hover:bg-accent-strong"
            title={r.nameMismatch ? t`The replacement record's name differs from the directory — check before updating` : t`Replaces ${r.ppn} with ${r.newPpn} in the IdRef column`}>
            <Save className="w-4 h-4" /> {t`Update`}
          </PixelBtn>
        )}
      </div>
      {r.candidate && <div className="mt-2 pl-1"><IdrefCandidateLine c={r.candidate} /></div>}
      {r.nameMismatch && (
        <div className="mt-1 flex items-center gap-1.5 text-[12px] font-semibold text-[#8a5a00] dark:text-[#f0c266]">
          <AlertTriangle className="w-3.5 h-3.5" /> <Trans>Name mismatch: the replacement record does not carry the directory name — check that it is the same person.</Trans>
        </div>
      )}
      {!r.candidate && <div className="mt-1 text-[12px] text-muted dark:text-[#8f897c]"><Trans>Replacement record unreadable during the run — check on IdRef before updating.</Trans></div>}
    </div>
  );
};

interface DrawerProps {
  src: UnifiedAlignSource;
  row: PersonAlignRow;
  cell: PersonAlignCell;
  selected: ReadonlySet<string>;
  onToggleSelect: (key: string) => void;
  chosen: Record<string, string>;
  onChoose: (key: string, candId: string, multi: boolean) => void;
  onClearChoice: (key: string) => void;
  decision?: UnifiedArbitrateDecision;
  onDecide: (dec: UnifiedArbitrateDecision) => void;
  applying: boolean;
  onUpdatePpn?: (r: Redirection) => void;
  onReject?: (c: Candidate, nb: number) => void;
  onMixed?: (c: Candidate, nb: number) => void;
  mode: AlignMode;
  /** « Search this record »: runs this source on this record only (lot 3); absent = not offered. */
  onSearchRecord?: () => void;
  /** A run of this source is in progress (the server would refuse a second one). */
  sourceBusy?: boolean;
}

const SourceDrawer: React.FC<DrawerProps> = ({ src, row, cell, selected, onToggleSelect, chosen, onChoose, onClearChoice, decision, onDecide, applying, onUpdatePpn, onReject, onMixed, mode, onSearchRecord, sourceBusy = false }) => {
  const { t } = useLingui();
  const isMulti = !!(src !== 'idref' && ALIGN_SOURCE_META[src].multi);
  const fill = cell.fill || [];
  const ambKey = unifiedAmbigKey(row.id, src);
  const chosenIds = (chosen[ambKey] || '').split('|').filter(Boolean);
  const actions = (c: Candidate, nb: number) => (onReject || onMixed) && (
    <span className="self-center flex items-center gap-1 shrink-0">
      {onMixed && <MixedBtn onClick={() => onMixed(c, nb)} compact />}
      {onReject && <RejectBtn onClick={() => onReject(c, nb)} compact />}
    </span>
  );

  return (
    <div className="space-y-4">
      {!!cell.existing?.length && !cell.arbitrate && !cell.redirection && (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted dark:text-[#8f897c]">
          <Trans>Already in the Directory:</Trans>
          {isMulti ? <ExistingPill ids={cell.existing} /> : <span className="font-mono text-ink dark:text-[#e7e2d6]">{cell.existing.join(' | ')}</span>}
        </div>
      )}

      {fill.length > 0 && (
        <div className="space-y-2">
          {fill.map((f) => {
            const key = unifiedFillKey(row.id, src, unifiedCandidateId(src, f.candidate));
            return (
              <div key={key} className={`rounded-xl p-2 transition-colors ${selected.has(key) ? 'bg-white/70 dark:bg-white/10' : 'hover:bg-accent/10'}`}>
                <div className="flex items-start gap-2">
                  <label className="flex items-start gap-2 cursor-pointer flex-1 min-w-0">
                    <input type="checkbox" checked={selected.has(key)} onChange={() => onToggleSelect(key)} className="mt-0.5 accent-[#1c1b19] dark:accent-[#f4d24a]" />
                    <div className="flex-1 min-w-0">
                      {src === 'idref' && !!f.matchedIds?.length && <div className="mb-1 flex flex-wrap gap-1"><MatchedBadge ids={f.matchedIds} /></div>}
                      <CandidateView src={src} c={f.candidate} />
                    </div>
                  </label>
                  {actions(f.candidate, 1)}
                </div>
                <div className="pl-6 mt-1 space-y-1">
                  {f.proposals.map((p, j) => <ProposalRow key={j} label={p.label} after={p.after} />)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {cell.ambiguous && (
        <div className="space-y-1">
          <p className="text-[11px] font-bold uppercase tracking-[.09em] text-muted-lighter dark:text-[#8f897c]">
            <Trans>Ambiguous — decide</Trans> · <Plural value={cell.ambiguous.candidates.length} one="# candidate" other="# candidates" />
          </p>
          {cell.ambiguous.candidates.map((c) => {
            const candId = unifiedCandidateId(src, c);
            const isChosen = chosenIds.includes(candId);
            return (
              <div key={candId} className="flex items-start gap-2 p-2 rounded-xl hover:bg-accent/10 transition-colors">
                <label className="flex items-start gap-2 cursor-pointer flex-1 min-w-0">
                  {isMulti
                    ? <input type="checkbox" checked={isChosen} onChange={() => onChoose(ambKey, candId, true)} className="mt-0.5 accent-[#1c1b19] dark:accent-[#f4d24a]" />
                    : <input type="radio" name={`amb-${ambKey}`} checked={isChosen} onChange={() => onChoose(ambKey, candId, false)} className="mt-0.5 accent-[#1c1b19] dark:accent-[#f4d24a]" />}
                  <CandidateView src={src} c={c} />
                </label>
                {actions(c, cell.ambiguous!.candidates.length)}
              </div>
            );
          })}
          {!isMulti && (
            <label className="flex items-center gap-2 cursor-pointer p-2 rounded-xl text-[12px] font-semibold text-muted-light dark:text-[#8f897c] hover:bg-accent/10 transition-colors">
              <input type="radio" name={`amb-${ambKey}`} checked={!chosenIds.length} onChange={() => onClearChoice(ambKey)} className="accent-[#1c1b19] dark:accent-[#f4d24a]" />
              <Trans>Ignore (write nothing)</Trans>
            </label>
          )}
        </div>
      )}

      {cell.arbitrate && (
        <ArbitrageCard a={cell.arbitrate} dec={decision} setDecision={(_id, dec) => onDecide(dec)} />
      )}

      {cell.redirection && <RedirectionCard r={cell.redirection} applying={applying} onUpdatePpn={onUpdatePpn} />}

      {!!cell.conflicts?.length && (
        <div className="space-y-2">
          {cell.conflicts.map((c, i) => (
            <div key={i} className="rounded-card border border-[rgba(224,158,42,.4)] bg-[rgba(224,158,42,.12)] dark:bg-[rgba(224,158,42,.1)] px-3 py-2 text-[12.5px]">
              <div className="flex flex-wrap items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-[#8a6113] dark:text-[#f0c266]" />
                <span className="font-semibold text-ink dark:text-[#f5f2ea]">{c.reason}</span>
                {c.candidate && <CandidateLink src={src} c={c.candidate} />}
              </div>
              <div className="text-muted dark:text-[#8f897c]">{c.detail}</div>
            </div>
          ))}
        </div>
      )}

      {cell.status === 'not_found' && <p className="text-[12.5px] text-muted-faint">{t`No candidate found during the last ${SOURCE_LABEL[src]} run.`}</p>}
      {cell.status === 'none' && <p className="text-[12.5px] text-muted-faint"><Trans>Never searched on this source for this record.</Trans></p>}
      {onSearchRecord && (
        <div className="flex items-center gap-2">
          <button type="button" onClick={onSearchRecord} disabled={sourceBusy}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-ink/15 dark:border-white/15 text-[12px] font-semibold hover:bg-white/70 dark:hover:bg-white/10 disabled:opacity-50"
            title={sourceBusy ? t`A ${SOURCE_LABEL[src]} search is already running — wait for it to finish` : t`Runs ${SOURCE_LABEL[src]} on this record only, even if it was already searched (after a name correction, for instance)`}>
            <RotateCw className="w-3.5 h-3.5" />
            {mode === 'verify' ? t`Check this record again on ${SOURCE_LABEL[src]}` : cell.status === 'none' ? t`Search this record on ${SOURCE_LABEL[src]}` : t`Search this record again on ${SOURCE_LABEL[src]}`}
          </button>
        </div>
      )}
    </div>
  );
};

interface UnifiedAlignPageProps {
  diff: UnifiedAlignDiff | null;
  mode: AlignMode;
  onModeChange: (m: AlignMode) => void;
  /** Progress of the last « Rechercher partout » — one entry per source in progress/finished. */
  progress?: Partial<Record<UnifiedAlignSource, UnifiedRunProgress>> | null;
  applying?: boolean;
  /** Scoped to the filtered lab/group; `choice` = sources, full rerun and caps picked in the launch
   * window (docs/plan-recherche-alignement-maitrisee.md, lot 2). */
  onRerunAll: (mode: AlignMode, labo?: string, group?: AlignGroup, choice?: AlignLaunchChoice) => void;
  /** « Stop » of one source's run: records in progress finish, what was found is kept. */
  onStop?: (src: UnifiedAlignSource) => Promise<void>;
  /** Receives the updates already grouped per record (buildUnifiedUpdates) — written by GristService.applyUnifiedUpdates. */
  /** Absent on a read-only instance (READ_ONLY): the Apply and Update buttons are hidden. */
  onApply?: (updates: PersonAlignUpdate[]) => Promise<number | void>;
  /** « Mauvais candidat »: blacklist of the source's review table → never proposed again. */
  onRejectCandidate?: (src: UnifiedAlignSource, row: RowRef, candidate: Candidate, candidateCount?: number) => Promise<boolean>;
  /** « Identité mêlée »: ticket in the source's review table (neither validated nor rejected). */
  onMixedCandidate?: (src: UnifiedAlignSource, row: RowRef, candidate: Candidate, candidateCount?: number) => Promise<boolean>;
}

export const UnifiedAlignPage: React.FC<UnifiedAlignPageProps> = ({ diff, mode, onModeChange, progress, applying = false, onRerunAll, onStop, onApply, onRejectCandidate, onMixedCandidate }) => {
  const { t } = useLingui();
  const [toast, setToast] = useState<string | null>(null);
  const [labo, setLabo] = useState('');
  const [group, setGroup] = useState<AlignGroup>('personnel');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [decisions, setDecisions] = useState<Record<string, UnifiedArbitrateDecision>>({});
  // Filters on what to disambiguate: one source (IdRef, ORCID…) and/or one kind of work.
  const [srcFilter, setSrcFilter] = useState<UnifiedAlignSource | ''>('');
  // Sources whose « Stop » was clicked, until their run closes its progress.
  const [stopping, setStopping] = useState<Set<UnifiedAlignSource>>(new Set());
  const [launchOpen, setLaunchOpen] = useState(false);
  useEffect(() => {
    if (!progress) setStopping(new Set());
  }, [progress]);
  const stopSource = async (src: UnifiedAlignSource) => {
    if (!onStop) return;
    setStopping((prev) => new Set(prev).add(src));
    try { await onStop(src); } catch (e) {
      setStopping((prev) => { const n = new Set(prev); n.delete(src); return n; });
      setToast(e instanceof Error ? e.message : String(e));
    }
  };
  const [kindFilter, setKindFilter] = useState<CellKind | ''>('');

  const sources = useMemo(() => SOURCE_ORDER.filter((s) => diff?.sources.includes(s)), [diff]);
  const laboOptions = diff?.labos || [];
  // Same "<rowId>::<source>" shape as the arbitration keys (unifiedAmbigKey) — reused here
  // as identifier of the (row, source) pair for the drawer open state and the decisions.
  const rowSourceKey = unifiedAmbigKey;

  const matchLabo = (r: PersonAlignRow) => !labo || (r.labo || '').trim().toUpperCase() === labo.toUpperCase();
  // Only records with something to do are listed (acceptance-test feedback of 2026-09-21):
  // candidate to check, ambiguous case or name mismatch to arbitrate, replaced record, conflict. A record whose
  // authority sources are all already filled, without candidate or never processed has nothing to show.
  const filterSources = srcFilter ? [srcFilter] : sources;
  const isActionable = (r: PersonAlignRow) => filterSources.some((s) => cellHasKind(r.sources[s], kindFilter));
  // Sort: strong candidates (cross identifier / strong score) first — quick validation, like the
  // « Score fort » group of the per-source pages — then other candidates, then arbitrations, then conflicts.
  const rank = (r: PersonAlignRow) => {
    let best = 4;
    for (const s of sources) {
      const c = r.sources[s];
      if (!c) continue;
      if (c.fill?.some(isStrongScore)) return 0;
      if (c.status === 'strong') best = Math.min(best, 1);
      else if (c.status === 'ambiguous' || c.status === 'arbitrate') best = Math.min(best, 2);
      else if (c.status === 'redirect') best = Math.min(best, 3);
    }
    return best;
  };

  const groupCounts = useMemo(() => {
    const counts: Record<AlignGroup, number> = { personnel: 0, doctorants: 0, hors_recherche: 0 };
    for (const r of diff?.rows || []) if (matchLabo(r) && isActionable(r)) counts[r.group || 'personnel']++;
    return counts;
  }, [diff, labo, sources, srcFilter, kindFilter]);
  // Per-source count of records to process in the current lab/group (and kind), for the source chips.
  const sourceCounts = useMemo(() => {
    const counts = {} as Record<UnifiedAlignSource, number>;
    for (const s of sources) counts[s] = 0;
    for (const r of diff?.rows || []) {
      if (!matchLabo(r) || (r.group || 'personnel') !== group) continue;
      for (const s of sources) if (cellHasKind(r.sources[s], kindFilter)) counts[s]++;
    }
    return counts;
  }, [diff, labo, group, sources, kindFilter]);

  const filteredRows = useMemo(
    () => (diff ? diff.rows.filter((r) => matchLabo(r) && (r.group || 'personnel') === group && isActionable(r)).map((r, i) => ({ r, i, k: rank(r) })).sort((a, b) => a.k - b.k || a.i - b.i).map((x) => x.r) : []),
    [diff, labo, group, sources, srcFilter, kindFilter],
  );
  const counts = useMemo(() => {
    let strong = 0, ambiguous = 0, arbitrate = 0, conflicts = 0;
    for (const r of filteredRows) for (const s of filterSources) {
      const c = r.sources[s];
      if (!c) continue;
      if (c.fill?.length) strong++;
      if (c.ambiguous) ambiguous++;
      if (c.arbitrate || c.redirection) arbitrate++;
      if (c.conflicts?.length) conflicts += c.conflicts.length;
    }
    return { strong, ambiguous, arbitrate, conflicts };
  }, [filteredRows, filterSources]);

  // New queue (new generatedAt, e.g. after « Rechercher partout »): unapplied selections/arbitrations
  // no longer make sense (same precaution as AlignPage/IdrefAlignPage).
  useEffect(() => { setSelected(new Set()); setChosen({}); setDecisions({}); setOpenKey(null); }, [diff?.generatedAt]);
  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(h);
  }, [toast]);

  const toggleSelect = (key: string) => setSelected((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const onChoose = (key: string, candId: string, multi: boolean) => setChosen((p) => {
    if (!multi) return { ...p, [key]: candId };
    const ids = (p[key] || '').split('|').filter(Boolean);
    const next = ids.includes(candId) ? ids.filter((x) => x !== candId) : [...ids, candId];
    const n = { ...p };
    if (next.length) n[key] = next.join('|'); else delete n[key];
    return n;
  });
  const onClearChoice = (key: string) => setChosen((p) => { const n = { ...p }; delete n[key]; return n; });

  const strongKeys = useMemo(() => {
    const keys: string[] = [];
    for (const r of filteredRows) for (const s of sources) {
      for (const f of r.sources[s]?.fill || []) keys.push(unifiedFillKey(r.id, s, unifiedCandidateId(s, f.candidate)));
    }
    return keys;
  }, [filteredRows, sources]);
  const allStrongSelected = strongKeys.length > 0 && strongKeys.every((k) => selected.has(k));
  const toggleAllStrong = () => setSelected((prev) => {
    const n = new Set(prev);
    for (const k of strongKeys) allStrongSelected ? n.delete(k) : n.add(k);
    return n;
  });

  const updates = useMemo(() => buildUnifiedUpdates(diff, selected, chosen, decisions), [diff, selected, chosen, decisions]);
  const hasUnsaved = selected.size > 0 || Object.keys(chosen).length > 0 || Object.keys(decisions).length > 0;

  const handleApply = async () => {
    if (!onApply || !updates.length) return;
    const n = await onApply(updates);
    const count = typeof n === 'number' ? n : updates.length;
    setToast(t`${count} record(s) written to Grist.`);
    setSelected(new Set());
    setChosen({});
    setDecisions({});
  };
  // Replaced IdRef record: writes the new PPN (and carries over the name-mismatch validation if it
  // concerned the old PPN and the name still matches) — same write path as Apply.
  const updatePpn = async (row: PersonAlignRow, r: Redirection) => {
    if (!onApply) return;
    const fields: Record<string, string> = { IdRef: r.newPpn };
    if (r.confirmedOld && !r.nameMismatch) fields.IdRef_nom_valide = r.newPpn;
    const n = await onApply([{ id: row.id, uid: row.uid, displayName: row.displayName, fields, fieldsBySource: { idref: fields }, sources: ['idref'] }]);
    if (n) setToast(t`IdRef updated in Grist: ${r.ppn} → ${r.newPpn}.`);
  };
  const confirmRerun = () => {
    if (hasUnsaved && !window.confirm(t`Some selections or decisions are not applied yet — rerunning will clear them. Continue?`)) return;
    setLaunchOpen(true);
  };
  const launch = (choice: AlignLaunchChoice) => {
    setLaunchOpen(false);
    onRerunAll(mode, labo || undefined, group, choice);
  };
  // « Search this record » (lot 3): one source, one record (Grist row of `G-<n>`), even if already searched.
  const searchRecord = (row: PersonAlignRow, src: UnifiedAlignSource) => {
    const rec = parseInt(row.id.replace(/^G-/, ''), 10);
    if (!rec) return;
    if (hasUnsaved && !window.confirm(t`Some selections or decisions are not applied yet — rerunning will clear them. Continue?`)) return;
    onRerunAll(mode, undefined, undefined, { sources: [src], force: false, limits: {}, record: rec });
  };
  // After a rejection / a mixed identity: the selection of the discarded candidate no longer makes sense.
  const forgetCandidate = (row: PersonAlignRow, src: UnifiedAlignSource, cand: Candidate) => {
    const candId = unifiedCandidateId(src, cand);
    const key = unifiedFillKey(row.id, src, candId);
    setSelected((p) => { if (!p.has(key)) return p; const n = new Set(p); n.delete(key); return n; });
    setChosen((p) => {
      const k = unifiedAmbigKey(row.id, src);
      const rest = (p[k] || '').split('|').filter((x) => x && x !== candId);
      if ((p[k] || '') === rest.join('|')) return p;
      const n = { ...p };
      if (rest.length) n[k] = rest.join('|'); else delete n[k];
      return n;
    });
  };
  const rejectCand = async (row: PersonAlignRow, src: UnifiedAlignSource, cand: Candidate, nb: number) => {
    if (!onRejectCandidate || !(await onRejectCandidate(src, row, cand, nb))) return;
    forgetCandidate(row, src, cand);
    setToast(t`Candidate ${unifiedCandidateId(src, cand)} dismissed for ${row.displayName || row.uid} — it will not be suggested again.`);
  };
  const mixedCand = async (row: PersonAlignRow, src: UnifiedAlignSource, cand: Candidate, nb: number) => {
    if (!onMixedCandidate || !(await onMixedCandidate(src, row, cand, nb))) return;
    forgetCandidate(row, src, cand);
    setToast(t`Profile ${unifiedCandidateId(src, cand)} flagged as “Mixed identity” — ticket opened in the review table.`);
  };

  const anyRunning = sources.some((s) => !!progress?.[s]?.running);
  const generatedAt = diff ? new Date(diff.generatedAt).toLocaleString(numberLocale()) : '';
  const melees = useMemo<ReviewMixedItem[]>(() => sources.flatMap((s) => diff?.melees?.[s] || []), [diff, sources]);
  const groupBtn = (g: AlignGroup, icon: React.ReactNode, label: React.ReactNode, title?: string) => (
    <button onClick={() => setGroup(g)} title={title} className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full font-disp text-[13px] font-semibold transition-colors ${group === g ? 'bg-ink text-white dark:bg-accent dark:text-ink shadow-nav-active' : 'text-muted dark:text-[#8f897c] hover:text-ink dark:hover:text-[#f5f2ea]'}`}>
      {icon} {label}
    </button>
  );

  const { compact, onScrollCapture } = useCompactHeader();
  return (
    // Phones (< md): the whole page scrolls — the banner, filters and buttons go up with the table
    // instead of keeping two thirds of the screen; the footer (Apply) stays stuck at the bottom.
    <div className="flex flex-col h-full max-md:overflow-y-auto" onScrollCapture={onScrollCapture}>
      <header className="page-header px-4 md:px-7 pt-6 pb-4" data-compact={compact || undefined}>
        <div className="page-header-top flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <Sparkles className="page-header-icon w-7 h-7 text-[#7048e8] dark:text-[#9a7bff]" />
            <div>
              <h1 className="font-disp text-3xl md:text-[38px] font-bold tracking-tight text-ink dark:text-[#f5f2ea] leading-none"><Trans>Researcher identifier alignment</Trans></h1>
              <p className="page-header-sub text-[15px] text-muted dark:text-[#8f897c] mt-1.5"><Trans>IdRef · ORCID · HAL · OpenAlex · Scopus — one row per person, one column per identifier</Trans></p>
            </div>
            <HelpButton path={VIEW_HELP[ViewState.UNIFIED_ALIGN]} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(['search', 'verify'] as AlignMode[]).map((m) => (
            <button key={m} onClick={() => onModeChange(m)} disabled={anyRunning}
              className={`inline-flex items-center h-10 px-4 rounded-full font-disp text-[13px] font-semibold transition-colors disabled:opacity-50 ${mode === m ? 'bg-accent border border-accent-strong text-ink' : 'bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/15 text-muted dark:text-[#8f897c] hover:bg-white dark:hover:bg-white/15'}`}>
              {t(MODE_LABEL[m])}
            </button>
          ))}
          {laboOptions.length > 0 && (
            <select value={labo} onChange={(e) => setLabo(e.target.value)} disabled={anyRunning}
              title={t`Restricts both the display AND the run to one structure`}
              className="input-soft !w-auto h-10 py-1.5 pr-7 text-[13px] font-semibold cursor-pointer disabled:opacity-50">
              <option value="">{t`All structures`}</option>
              {laboOptions.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          )}
          <div className="flex flex-wrap items-center gap-1 rounded-3xl bg-white/70 dark:bg-white/10 backdrop-blur-xl border border-white/70 dark:border-white/15 p-1 shadow-soft">
            {groupBtn('personnel', <Users className="w-3.5 h-3.5" />, <Trans>Staff ({groupCounts.personnel})</Trans>)}
            {groupBtn('doctorants', <GraduationCap className="w-3.5 h-3.5" />, <Trans>PhD students ({groupCounts.doctorants})</Trans>)}
            {groupBtn('hors_recherche', <Briefcase className="w-3.5 h-3.5" />, <Trans>No research duty ({groupCounts.hors_recherche})</Trans>,
              t`Permanent or non-permanent staff with no statutory research duty (LIB_TYPE_EMPLOI) — may hold researcher identifiers, but aligning them is a low priority, as for PhD students`)}
          </div>
          <div className="flex-1" />
          <PixelBtn onClick={confirmRerun} disabled={anyRunning} tone="bg-ink text-white hover:bg-black dark:bg-accent dark:text-ink dark:hover:bg-accent-strong"
            title={t`Choose the sources, see the number of records and the cost, then start the search on the filtered lab and group`}>
            {anyRunning ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />}
            {anyRunning ? t`Search running…` : t`Search everywhere…`}
          </PixelBtn>
        </div>
        {progress && (
          <div className="flex flex-wrap gap-3 mt-2 text-[11px] font-semibold text-muted dark:text-[#8f897c]">
            {sources.map((s) => {
              const p = progress[s];
              if (!p) return null;
              // Scopus: remaining weekly quota of the Author Search API and key in use (key 1 is
              // shared with the SoVisu+ harvester, which keeps its share).
              const q = p.quota?.search;
              return (
                <span key={s} className={`inline-flex items-center gap-1.5 ${p.error ? 'text-[#b3441f] dark:text-[#e08a6a]' : ''}`}>
                  {SOURCE_LABEL[s]} {p.running ? `${p.done ?? 0}/${p.total ?? '?'}` : p.error ? t`error` : p.stopped ? t`stopped at ${p.done ?? 0}/${p.total ?? '?'}` : t`done`}
                  {q && (
                    <span className="font-normal" title={t`Remaining weekly quota of the Elsevier Author Search API (reset ${q.reset})`}>
                      · {q.key ? t`key ${q.key}: ${q.remaining.toLocaleString(numberLocale())} searches left` : t`${q.remaining.toLocaleString(numberLocale())} searches left`}
                    </span>
                  )}
                  {p.running && onStop && (
                    <button type="button" onClick={() => stopSource(s)} disabled={stopping.has(s)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-ink/15 dark:border-white/15 hover:bg-white/70 dark:hover:bg-white/10 disabled:opacity-60"
                      title={t`Stops this source: the records in progress finish, what was found is kept; the next run resumes with the records not searched yet`}>
                      <CircleStop className="w-3 h-3" /> {stopping.has(s) ? t`Stopping…` : t`Stop`}
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        )}
      </header>
      {launchOpen && (
        <AlignLaunchModal mode={mode} labo={labo || undefined} group={group} sources={sources} sourceLabel={SOURCE_LABEL}
          onClose={() => setLaunchOpen(false)} onLaunch={launch} />
      )}

      <div className="flex-1 md:overflow-auto px-4 md:px-7 py-4" data-page-scroll>
        {!diff ? (
          <div className="flex flex-col items-center justify-center py-24 text-muted-faint gap-3">
            <RefreshCw className="w-8 h-8 animate-spin" />
            <p className="text-[13px] font-semibold text-muted dark:text-[#8f897c]">{t`Loading the unified view…`}</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
              <StatCard label={t`Records to process`} value={filteredRows.length} />
              {([
                ['strong', t`Candidates to check`, counts.strong, 'bg-[rgba(46,160,102,.16)] dark:bg-[rgba(46,160,102,.14)]'],
                ['ambiguous', t`Ambiguous`, counts.ambiguous, 'bg-[rgba(231,111,154,.15)] dark:bg-[rgba(231,111,154,.12)]'],
                ['arbitrate', t`Name mismatches / replaced entries`, counts.arbitrate, 'bg-[rgba(112,72,232,.14)] dark:bg-[rgba(112,72,232,.12)]'],
                ['conflict', t`Conflicts`, counts.conflicts, 'bg-[rgba(224,158,42,.18)] dark:bg-[rgba(224,158,42,.12)]'],
              ] as [CellKind, string, number, string][]).map(([kind, label, value, tone]) => (
                <button key={kind} type="button" onClick={() => setKindFilter((k) => (k === kind ? '' : kind))}
                  title={kindFilter === kind ? t`Remove this filter` : t`Show only this kind of work`}
                  className={`text-left rounded-card transition-shadow ${kindFilter === kind ? 'ring-2 ring-ink dark:ring-accent' : 'hover:ring-2 hover:ring-ink/30 dark:hover:ring-white/30'}`}>
                  <StatCard label={label} value={value} tone={tone} />
                </button>
              ))}
            </div>
            {(srcFilter || kindFilter) && (
              <p className="text-[12px] font-semibold text-muted dark:text-[#8f897c] -mt-3 mb-4">
                <Trans>Filtered view</Trans>{srcFilter ? ` · ${SOURCE_LABEL[srcFilter]}` : ''}{kindFilter ? ` · ${{ strong: t`candidates to check`, ambiguous: t`ambiguous`, arbitrate: t`name mismatches / replaced entries`, conflict: t`conflicts` }[kindFilter]}` : ''}
                {' '}<button type="button" onClick={() => { setSrcFilter(''); setKindFilter(''); }} className="underline hover:text-ink dark:hover:text-[#f5f2ea]"><Trans>Reset</Trans></button>
              </p>
            )}

            <div className="w-full space-y-4">
              <div className="flex items-center gap-3 px-4 py-3 rounded-card bg-accent/20 dark:bg-accent/10 border border-accent-strong/40 dark:border-accent/20 text-[13px] font-semibold text-ink dark:text-[#f0c266]">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <Trans>Only empty cells are filled in; no existing value is overwritten (OpenAlex: checked profiles are added to the list, nothing is removed). Conflicts are listed for manual review.</Trans>
              </div>

              {strongKeys.length > 0 && (
                <button onClick={toggleAllStrong} className="flex items-center gap-1.5 text-[12px] font-semibold text-[#1f7a4d] dark:text-[#5fd39a] hover:underline transition-colors">
                  {allStrongSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                  {allStrongSelected ? t`Uncheck all strong candidates` : t`Check all strong candidates`} ({strongKeys.filter((k) => selected.has(k)).length}/{strongKeys.length})
                </button>
              )}

              {filteredRows.length === 0 ? (
                <p className="text-[13px] text-muted-faint py-8"><Trans>No records to show for this filter.</Trans></p>
              ) : (
                <div className="unified-table rounded-card border border-ink/8 dark:border-white/8 bg-white/40 dark:bg-white/[.03]">
                  {/* One column per source: the header names the source, the badges say the state. No
                      overflow wrapper here: it would break the sticky header (own scroll context). */}
                  <div>
                  <div className="grid unified-grid sticky -top-4 max-md:top-0 z-10 rounded-t-card items-center px-3 py-2 bg-[#f3efe4] dark:bg-[#24231f] border-b border-ink/8 dark:border-white/10 text-[10.5px] font-bold uppercase tracking-[.09em] text-muted-lighter dark:text-[#8f897c]"
                    style={{ '--src-count': sources.length } as React.CSSProperties}>
                    <span />
                    <span><Trans>Person</Trans></span>
                    {sources.map((s) => (
                      <button key={s} type="button" onClick={() => setSrcFilter((f) => (f === s ? '' : s))} title={srcFilter === s ? t`Remove the source filter` : t`Only records with something to do on ${SOURCE_LABEL[s]}`}
                        className={`text-center rounded-full py-0.5 transition-colors ${srcFilter === s ? 'bg-ink text-white dark:bg-accent dark:text-ink' : srcFilter ? 'opacity-40 hover:opacity-100' : 'hover:text-ink dark:hover:text-[#f5f2ea]'}`}>
                        <span className="ua-text">{SOURCE_LABEL[s]}</span><span className="ua-icon justify-center">{SOURCE_SHORT[s]}</span> <span className={`ua-text font-mono normal-case tracking-normal ${srcFilter === s ? 'opacity-80' : 'text-muted-faint'}`}>{sourceCounts[s]}</span>
                      </button>
                    ))}
                  </div>
                  {filteredRows.map((row, rowIndex) => {
                    const rowOpenSrc = openKey && openKey.startsWith(`${row.id}::`) ? openKey.slice(row.id.length + 2) as UnifiedAlignSource : null;
                    const openCell = rowOpenSrc ? row.sources[rowOpenSrc] : undefined;
                    const quick = sources.some((s) => row.sources[s]?.fill?.some(isStrongScore));
                    const rowTone = rowOpenSrc ? 'bg-accent/15 dark:bg-accent/10' : rowIndex % 2 ? 'bg-white/30 dark:bg-white/[.02]' : 'bg-transparent';
                    return (
                      <div key={row.id} className={`border-b border-ink/5 dark:border-white/5 last:border-b-0 ${rowTone}`}>
                        <div className="grid unified-grid items-center px-3 py-2 hover:bg-white/70 dark:hover:bg-white/[.06] transition-colors"
                          style={{ '--src-count': sources.length } as React.CSSProperties}>
                          <button type="button" onClick={() => setOpenKey((k) => (k && k.startsWith(`${row.id}::`) ? null : rowSourceKey(row.id, sources.find((s) => isActionableCell(row.sources[s])) || sources[0])))}
                            title={rowOpenSrc ? t`Close` : t`Open the detail`} className="flex items-center justify-center w-7 h-7 rounded-full text-muted-faint hover:bg-ink/5 dark:hover:bg-white/10">
                            {rowOpenSrc ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </button>
                          <div className="min-w-0 pr-3">
                            <div className="flex items-center gap-2 min-w-0">
                              {quick && <span className="inline-flex shrink-0" title={t`Identifier already shared by the record and the profile — near certainty`}><Zap className="w-4 h-4 text-[#1f7a4d] dark:text-[#5fd39a]" /></span>}
                              {/* Opens the researcher record in a new tab (membership dates, identifiers…) while
                                  the candidates stay on screen. ?id=G-<row> is the deep link App.tsx resolves. */}
                              <a href={`${window.location.pathname}?page=RESEARCHER_DETAIL&id=${encodeURIComponent(row.id)}`} target="_blank" rel="noreferrer"
                                title={t`Open the researcher record in a new tab`}
                                className="group/name inline-flex items-center gap-1 min-w-0 font-disp text-[15px] font-semibold text-ink dark:text-[#f5f2ea] hover:underline">
                                <span className="truncate">{row.displayName || '—'}</span>
                                <ExternalLink className="w-3.5 h-3.5 shrink-0 text-muted-faint opacity-0 group-hover/name:opacity-100 transition-opacity" />
                              </a>
                              {row.labo && <span className="inline-flex shrink-0 items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-cream-50 dark:bg-white/10 border border-ink/5 dark:border-white/10 text-[11px] font-semibold text-ink dark:text-[#e7e2d6]"><span className="w-1.5 h-1.5 rounded-full bg-[#7048e8] dark:bg-[#9a7bff]" />{row.labo}</span>}
                            </div>
                            <div className="text-[11px] font-mono text-muted-faint mt-0.5 truncate">{row.uid} · {row.id}</div>
                          </div>
                          {sources.map((s) => (
                            <div key={s} className={`px-1 ${srcFilter && srcFilter !== s ? 'opacity-40' : ''}`}>
                              <SourcePastille src={s} cell={row.sources[s]} rowId={row.id}
                                isOpen={rowOpenSrc === s} onToggleOpen={() => setOpenKey((k) => (k === rowSourceKey(row.id, s) ? null : rowSourceKey(row.id, s)))}
                                selected={selected} onToggleSelect={toggleSelect} />
                            </div>
                          ))}
                        </div>
                        {rowOpenSrc && openCell && (
                          <div className="px-3 sm:px-5 pb-4 sm:pl-12 pt-3 border-t border-ink/5 dark:border-white/5 bg-white/50 dark:bg-white/[.03]">
                            <div className="text-[10.5px] font-bold uppercase tracking-[.09em] text-muted-lighter dark:text-[#8f897c] mb-2">{SOURCE_LABEL[rowOpenSrc]} — {row.displayName}</div>
                            <SourceDrawer src={rowOpenSrc} row={row} cell={openCell} selected={selected} onToggleSelect={toggleSelect}
                              chosen={chosen} onChoose={onChoose} onClearChoice={onClearChoice}
                              decision={decisions[rowSourceKey(row.id, rowOpenSrc)]}
                              onDecide={(dec) => setDecisions((p) => ({ ...p, [rowSourceKey(row.id, rowOpenSrc)]: dec }))}
                              applying={applying} onUpdatePpn={onApply ? (r) => updatePpn(row, r) : undefined}
                              onReject={onRejectCandidate ? (c, nb) => rejectCand(row, rowOpenSrc, c, nb) : undefined}
                              onMixed={onMixedCandidate ? (c, nb) => mixedCand(row, rowOpenSrc, c, nb) : undefined}
                              mode={mode} sourceBusy={!!progress?.[rowOpenSrc]?.running}
                              onSearchRecord={rowOpenSrc === 'idref' && mode === 'verify' ? undefined : () => searchRecord(row, rowOpenSrc)} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                  </div>
                </div>
              )}

              {melees.length > 0 && <MixedSection items={melees} />}
            </div>
          </>
        )}
      </div>

      <footer className="max-md:sticky max-md:bottom-0 max-md:z-20 px-4 md:px-7 py-4 border-t border-ink/5 dark:border-white/5 bg-white/60 dark:bg-white/5 backdrop-blur-xl flex flex-wrap items-center justify-between gap-3">
        <span className="text-[12px] text-muted-faint">{diff ? t`Generated on ${generatedAt}` : ''}</span>
        {onApply && (
          <PixelBtn onClick={handleApply} disabled={applying || updates.length === 0} tone="bg-ink text-white hover:bg-black dark:bg-accent dark:text-ink dark:hover:bg-accent-strong">
            {applying ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {applying ? t`Writing…` : t`Apply (${updates.length})`}
          </PixelBtn>
        )}
      </footer>

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 px-5 py-3 rounded-full bg-white/80 dark:bg-white/10 backdrop-blur-xl border border-white/80 dark:border-white/15 shadow-soft text-[13px] font-semibold text-ink dark:text-[#f5f2ea]">
          <Check className="w-4 h-4 text-[#2ea066] dark:text-[#5fd39a]" /> {toast}
        </div>
      )}
    </div>
  );
};
