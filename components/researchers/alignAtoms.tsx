import React from 'react';
import { ArrowRight, Link2, Check, Unlink, MinusCircle, Shuffle, ShieldCheck, CircleOff } from 'lucide-react';
import type { IdrefDiff, IdrefCandidate, ReviewMixedItem, AlignCandidate } from '../../lib/gristService';
import { Trans, useLingui } from '@lingui/react/macro';

/**
 * @file alignAtoms.tsx
 * @description Rendering atoms shared by the alignment pages (unified identifier alignment,
 * LDAP alignment, duplicates): stat cards, buttons, candidate lines, arbitration card, mixed
 * identities section. Extracted from the former per-source pages (IdrefAlignPage, AlignPage)
 * when those were removed on 2026-09-23 (docs/plan-alignement-unifie.md, lot 7).
 */

export type Decision = 'confirm' | 'detach' | 'ignore';

export const StatCard: React.FC<{ label: string; value: number; tone?: string }> = ({ label, value, tone = 'bg-white/60 dark:bg-white/5' }) => (
  <div className={`rounded-card border border-white/70 dark:border-white/10 backdrop-blur-xl p-3 shadow-soft ${tone}`}>
    <div className="text-2xl font-disp font-bold text-ink dark:text-[#f5f2ea]">{value}</div>
    <div className="text-[10px] font-bold uppercase tracking-[.09em] text-muted-lighter dark:text-[#8f897c] mt-0.5">{label}</div>
  </div>
);

export const SectionTitle: React.FC<{ icon: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <div className="flex items-center gap-2 pb-2 mb-3 border-b border-ink/5 dark:border-white/5 text-muted-lighter dark:text-[#8f897c]">
    {icon}
    <h3 className="font-disp text-base font-bold tracking-tight text-ink dark:text-[#f5f2ea]">{children}</h3>
  </div>
);

/** Rendering of an IdRef candidate (PPN, name, profession, dates, gender, ORCID/IdHAL, bio note) —
 * exported under the name `IdrefCandidateLine` for the unified view (same rendering, no copy). */
export const IdrefCandidateLine: React.FC<{ c: IdrefCandidate }> = ({ c }) => (
  <div className="text-[12.5px] text-muted dark:text-[#8f897c]">
    <div className="flex flex-wrap items-center gap-2">
      <a href={`https://www.idref.fr/${c.ppn}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-cream-50 dark:bg-white/10 border border-ink/10 dark:border-white/15 font-mono text-[11.5px] font-bold text-ink dark:text-[#e7e2d6] hover:border-accent-strong hover:underline">
        <Link2 className="w-3 h-3" /> {c.ppn}
      </a>
      <span className="font-semibold text-ink dark:text-[#f5f2ea]">{c.fullName || '—'}</span>
      {c.job && <span className="text-muted-light dark:text-[#8f897c]">· {c.job}</span>}
      {(c.birth || c.death) && <span className="text-muted-faint">({c.birth || '?'}{c.death ? `–${c.death}` : ''})</span>}
      {c.gender && <span className="text-muted-faint">{c.gender}</span>}
      {c.orcid && <span className="px-2 py-0.5 rounded-full bg-orcid/25 text-[11px] font-semibold text-ink dark:text-[#e7e2d6]">ORCID {c.orcid}</span>}
      {c.idhal && <span className="px-2 py-0.5 rounded-full bg-cream-300/70 dark:bg-white/10 text-[11px] font-semibold text-ink dark:text-[#e7e2d6]">IdHAL {c.idhal}</span>}
    </div>
    {c.description && <div className="mt-1 text-muted-light dark:text-[#8f897c] line-clamp-2">{c.description}</div>}
  </div>
);

/** Proposed write (∅ → value). */
export const ProposalRow: React.FC<{ label: string; after: string }> = ({ label, after }) => (
  <div className="flex flex-wrap items-center gap-2 text-[12px]">
    <span className="text-[10.5px] font-bold uppercase tracking-[.06em] text-muted-lighter dark:text-[#8f897c] w-16 shrink-0">{label}</span>
    <span className="px-2 py-0.5 rounded-full bg-[rgba(214,69,69,.12)] text-[#b23b3b] dark:bg-[rgba(214,69,69,.2)] dark:text-[#f08c8c] line-through">∅</span>
    <ArrowRight className="w-3 h-3 text-muted-faint" />
    <span className="px-2 py-0.5 rounded-full bg-[rgba(46,160,102,.16)] text-[#1f7a4d] dark:bg-[rgba(46,160,102,.22)] dark:text-[#5fd39a] font-semibold">{after}</span>
  </div>
);

export const PixelBtn: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: string }> = ({ tone = 'bg-white/75 dark:bg-white/10 border border-white/80 dark:border-white/15 text-ink dark:text-[#f5f2ea] hover:bg-white dark:hover:bg-white/15', className = '', children, ...rest }) => (
  <button {...rest} className={`inline-flex items-center justify-center gap-2 h-10 px-5 rounded-full font-disp font-semibold text-[13px] shadow-soft transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${tone} ${className}`}>
    {children}
  </button>
);

/** « identifier already shared by record/candidate » badge (e.g. same ORCID) — strong evidence. */
export const MatchedBadge: React.FC<{ ids?: string[] }> = ({ ids }) => {
  const { t } = useLingui();
  return (
  <>
    {(ids || []).map((m) => (
      <span key={m} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[rgba(46,160,102,.16)] text-[#1f7a4d] dark:bg-[rgba(46,160,102,.22)] dark:text-[#5fd39a] text-[11px] font-semibold" title={t`The Grist record and the candidate already share the same ${m} — near-certain match`}>
        <Link2 className="w-3 h-3" /> <Trans>shared {m}</Trans>
      </span>
    ))}
  </>
  );
};

/** « Identité mêlée » button: the profile mixes several people → ticket in the review table (neither validated nor rejected). */
export const MixedBtn: React.FC<{ onClick: () => void; compact?: boolean }> = ({ onClick, compact }) => {
  const { t } = useLingui();
  return (
  <button onClick={onClick}
    title={t`Mixed identity: this profile merges several people — neither validated nor rejected, a ticket to untangle at the source (Grist review table)`}
    className={`inline-flex items-center gap-1 rounded-full font-disp font-semibold text-muted-light dark:text-[#8f897c] border border-transparent hover:text-[#6b3fbf] dark:hover:text-[#b9a1f0] hover:border-[rgba(112,72,232,.35)] hover:bg-[rgba(112,72,232,.08)] transition-colors ${compact ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1 text-[12px]'}`}>
    <Shuffle className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} /> <Trans>Mixed identity</Trans>
  </button>
  );
};

/** « Identités mêlées » section: open tickets in the review table, to untangle at the source (read only). */
export const MixedSection: React.FC<{ items: ReviewMixedItem[] }> = ({ items }) => {
  const { t } = useLingui();
  const n = items.length;
  return (
    <section>
      <SectionTitle icon={<Shuffle className="w-4 h-4" />}>{t`Mixed identities — to untangle at the source (${n})`}</SectionTitle>
      {n === 0 ? (
        <p className="text-[13px] text-muted-faint"><Trans>No mixed profile reported.</Trans></p>
      ) : (
        <div className="space-y-2">
          <p className="text-[12px] text-muted dark:text-[#8f897c]"><Trans>These profiles merge several people: they are neither validated nor rejected, and are never exported. The fix happens at the source (IdRef by the library, HAL by the author, OpenAlex via support) — record the request in the review table (Note, Signale_le).</Trans></p>
          {items.map((m) => (
            <div key={`${m.uid}-${m.candidateId}`} className="rounded-card border border-[rgba(112,72,232,.35)] bg-[rgba(112,72,232,.08)] dark:bg-[rgba(112,72,232,.12)] px-4 py-3 text-[12.5px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-disp font-semibold text-ink dark:text-[#f5f2ea]">{m.displayName || m.uid}</span>
                {m.labo && <span className="text-muted-light dark:text-[#8f897c]">· {m.labo}</span>}
                <a href={m.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/70 dark:bg-white/10 border border-ink/10 dark:border-white/15 font-mono text-[11px] font-bold text-ink dark:text-[#e7e2d6] hover:underline">
                  <Link2 className="w-3 h-3" /> {m.candidateId}
                </a>
                {m.fullName && <span className="text-muted dark:text-[#8f897c]">{m.fullName}</span>}
                {m.signaleLe && <span className="ml-auto text-[11px] text-muted-faint">{t`reported on ${m.signaleLe}`}</span>}
              </div>
              {m.note && <div className="text-muted dark:text-[#8f897c] mt-1">{m.note}</div>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

/** « Mauvais candidat » button (blacklist) — discreet, red on hover. */
export const RejectBtn: React.FC<{ onClick: () => void; compact?: boolean }> = ({ onClick, compact }) => {
  const { t } = useLingui();
  return (
  <button onClick={onClick}
    title={t`Wrong candidate: never suggest it again for this person (Grist blacklist Alignement_IdRef)`}
    className={`inline-flex items-center gap-1 rounded-full font-disp font-semibold text-muted-light dark:text-[#8f897c] border border-transparent hover:text-[#b23b3b] dark:hover:text-[#f08c8c] hover:border-[rgba(214,69,69,.35)] hover:bg-[rgba(214,69,69,.08)] transition-colors ${compact ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1 text-[12px]'}`}>
    <Unlink className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} /> <Trans>Wrong candidate</Trans>
  </button>
  );
};

/** Name mismatch arbitration card (Grist record vs IdRef record) — exported for the unified view. */
export const ArbitrageCard: React.FC<{ a: IdrefDiff['aArbitrer'][number]; dec?: Decision; setDecision: (id: string, dec: Decision) => void; large?: boolean }> = ({ a, dec, setDecision, large }) => {
  const { t } = useLingui();
  const DecBtn: React.FC<{ value: Decision; icon: React.ReactNode; label: string; tone: string }> = ({ value, icon, label, tone }) => (
    <button onClick={() => setDecision(a.id, value)}
      className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full font-disp text-[12px] font-semibold transition-colors ${dec === value ? `${tone} text-white` : 'bg-white/70 dark:bg-white/10 border border-ink/10 dark:border-white/15 text-muted dark:text-[#8f897c] hover:bg-white dark:hover:bg-white/15'}`}>
      {icon} {label}
    </button>
  );
  return (
    <div className={`rounded-card p-4 ${a.suspect ? 'border border-[rgba(231,111,154,.35)] bg-[rgba(231,111,154,.08)] dark:bg-[rgba(231,111,154,.1)]' : 'bg-white/70 dark:bg-white/10 backdrop-blur-xl border border-white/70 dark:border-white/10 shadow-soft'} ${dec === 'ignore' ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-2 mb-2">
        {a.suspect && <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-[rgba(214,69,69,.14)] text-[#b23b3b] dark:bg-[rgba(214,69,69,.22)] dark:text-[#f08c8c] text-[11px] font-semibold"><Trans>Probable error</Trans></span>}
        <span className="font-disp text-[14px] font-semibold text-ink dark:text-[#f5f2ea]">{a.displayName || '—'}</span>
        <span className="text-[11px] font-mono text-muted-faint">{a.uid} · {a.id}</span>
      </div>
      <div className={`grid grid-cols-1 ${large ? 'sm:grid-cols-2' : 'sm:grid-cols-2'} gap-3`}>
        <div className="rounded-xl bg-white/60 dark:bg-white/5 border border-ink/5 dark:border-white/10 p-3">
          <div className="text-[10.5px] font-bold uppercase tracking-[.09em] text-muted-lighter dark:text-[#8f897c] mb-1"><Trans>Grist record</Trans></div>
          <div className="font-disp text-[14px] font-semibold text-ink dark:text-[#f5f2ea]">{a.displayName || '—'}</div>
          <div className="text-[12px] font-mono text-muted-light dark:text-[#8f897c] mt-1"><Trans>ORCID: {a.grist.orcid || '∅'}<br />IdHAL: {a.grist.idhal || '∅'}</Trans></div>
        </div>
        <div className="rounded-xl bg-white/60 dark:bg-white/5 border border-ink/5 dark:border-white/10 p-3">
          <div className="text-[10.5px] font-bold uppercase tracking-[.09em] text-muted-lighter dark:text-[#8f897c] mb-1 flex items-center gap-1">
            <Trans>IdRef record</Trans>
            <a href={`https://www.idref.fr/${a.ppn}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono normal-case tracking-normal text-ink dark:text-[#e7e2d6] hover:underline"><Link2 className="w-3 h-3" />{a.ppn}</a>
          </div>
          <div className="font-disp text-[14px] font-semibold text-ink dark:text-[#f5f2ea]">{a.notice.fullName || '—'}</div>
          <div className="text-[12px] text-muted-light dark:text-[#8f897c] mt-1">
            {a.notice.job && <>{a.notice.job}{(a.notice.birth || a.notice.death) ? ' · ' : ''}</>}
            {(a.notice.birth || a.notice.death) && <>({a.notice.birth || '?'}{a.notice.death ? `–${a.notice.death}` : ''})</>}<br />
            <Trans>ORCID: {a.notice.orcid || '∅'}</Trans>{a.notice.idhal ? <>{' · '}<Trans>IdHAL: {a.notice.idhal}</Trans></> : ''}
          </div>
          {a.notice.description && <div className="text-[12px] text-muted-faint mt-1 line-clamp-3">{a.notice.description}</div>}
        </div>
      </div>
      {dec === 'confirm' && a.proposals.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
          <span className="text-[10.5px] font-bold uppercase tracking-[.06em] text-muted-lighter dark:text-[#8f897c]"><Trans>+ on save:</Trans></span>
          {a.proposals.map((p, i) => <span key={i} className="px-2 py-0.5 rounded-full bg-[rgba(46,160,102,.16)] text-[#1f7a4d] dark:bg-[rgba(46,160,102,.22)] dark:text-[#5fd39a] font-semibold">{p.label} {p.after}</span>)}
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        <DecBtn value="confirm" icon={<Check className="w-3.5 h-3.5" />} label={t`Confirm`} tone="bg-[#2ea066] hover:bg-[#1f7a4d]" />
        <DecBtn value="detach" icon={<Unlink className="w-3.5 h-3.5" />} label={t`Wrong IdRef`} tone="bg-[#d64545] hover:bg-[#b23b3b]" />
        <DecBtn value="ignore" icon={<MinusCircle className="w-3.5 h-3.5" />} label={t`Ignore`} tone="bg-muted hover:bg-ink" />
      </div>
    </div>
  );
};

/** Score badge (strong / medium / weak) — exported for UnifiedAlignPage (lot 2). */
export const ScoreBadge: React.FC<{ score?: AlignCandidate['score'] }> = ({ score }) => {
  const { t } = useLingui();
  if (!score) return null;
  const cls = score === 'fort'
    ? 'bg-[rgba(46,160,102,.16)] text-[#1f7a4d] dark:bg-[rgba(46,160,102,.22)] dark:text-[#5fd39a]'
    : score === 'moyen'
      ? 'bg-accent/30 text-ink dark:bg-accent/20 dark:text-[#f0c266]'
      : 'bg-cream-300/70 text-muted dark:bg-white/10 dark:text-[#8f897c]';
  const label = score === 'fort' ? t`strong` : score === 'moyen' ? t`medium` : t`weak`;
  const title = score === 'fort'
    ? t`Identifier already shared by the record and the profile — near certainty`
    : score === 'moyen' ? t`Nantes affiliation or the record’s lab found on the profile` : t`Namesake with no affiliation evidence`;
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${cls}`} title={title}><ShieldCheck className="w-3 h-3" /> {label}</span>;
};

/** Suspected mixed identity (script signal): purple badge with the reasons in a tooltip. */
const SuspectBadge: React.FC<{ reasons?: string[] }> = ({ reasons }) => {
  const { t } = useLingui();
  if (!reasons || !reasons.length) return null;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[rgba(112,72,232,.14)] text-[#6b3fbf] dark:bg-[rgba(112,72,232,.22)] dark:text-[#b9a1f0]" title={`${t`Suspected mixed identity`} : ${reasons.join(' ; ')}`}>
      <Shuffle className="w-3 h-3" /> <Trans>suspected mixed identity</Trans>
    </span>
  );
};

/** ORCID profile with no public data (orcid.org: « There's no displayable data for this record ») — saves a click. */
const EmptyRecordBadge: React.FC<{ empty?: boolean }> = ({ empty }) => {
  const { t } = useLingui();
  if (!empty) return null;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[rgba(214,120,20,.14)] text-[#9a5a08] dark:bg-[rgba(214,120,20,.22)] dark:text-[#f0b56a]" title={t`This ORCID record has no public data (no works, employments or identifiers) — orcid.org shows “There's no displayable data for this record”`}>
      <CircleOff className="w-3 h-3" /> <Trans>empty record</Trans>
    </span>
  );
};

/** Candidate preview: identifier (link), name, score, evidence, details. */
export const AlignCandidateLine: React.FC<{ c: AlignCandidate }> = ({ c }) => (
  <div className="text-[12.5px] text-muted dark:text-[#8f897c]">
    <div className="flex flex-wrap items-center gap-2">
      <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-cream-50 dark:bg-white/10 border border-ink/10 dark:border-white/15 font-mono text-[11.5px] font-bold text-ink dark:text-[#e7e2d6] hover:border-accent-strong hover:underline">
        <Link2 className="w-3 h-3" /> {c.id}
      </a>
      <span className="font-semibold text-ink dark:text-[#f5f2ea]">{c.fullName || '—'}</span>
      <ScoreBadge score={c.score} />
      <EmptyRecordBadge empty={c.emptyRecord} />
      <SuspectBadge reasons={c.suspect} />
      {(c.evidence || []).filter((e) => !e.startsWith('⚠')).map((e, i) => (
        <span key={i} className="px-2 py-0.5 rounded-full bg-white/60 dark:bg-white/5 border border-ink/5 dark:border-white/10 text-[11px] text-muted dark:text-[#8f897c]">{e}</span>
      ))}
    </div>
    {(c.forms || []).length > 1 && <div className="mt-1 text-[11.5px] text-muted-faint">{c.forms!.join(' · ')}</div>}
    {(c.details || []).length > 0 && <div className="mt-1 text-muted-light dark:text-[#8f897c] line-clamp-2">{c.details!.join(' ; ')}</div>}
  </div>
);

/** Multi-valued target: recalls the identifiers already present in the Annuaire (we add, we do not replace). */
export const ExistingPill: React.FC<{ ids?: string[] }> = ({ ids }) => {
  const { t } = useLingui();
  if (!ids || !ids.length) return null;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[rgba(46,160,102,.12)] dark:bg-[rgba(46,160,102,.18)] border border-[rgba(46,160,102,.3)] text-[11px] font-mono text-[#1f7a4d] dark:text-[#5fd39a]" title={t`Profiles already in the directory — the candidate will be added to this list`}>
      <Check className="w-3 h-3" /> {ids.join(' | ')}
    </span>
  );
};
