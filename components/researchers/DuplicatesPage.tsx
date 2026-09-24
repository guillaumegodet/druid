import React, { useState } from 'react';
import { useCompactHeader } from '../../hooks/useCompactHeader';
import { Copy, RefreshCw, RotateCw, ShieldCheck, ExternalLink, GitMerge, Users, ChevronDown, ChevronRight } from 'lucide-react';
import { MergeLogPanel } from './MergeLogPanel';
import { DuplicateQualifyPanel, QualifyMode } from './DuplicateQualifyPanel';
import type { DuplicatesDiff, LdapDuplicateKind } from '../../lib/gristService';
import { numberLocale } from '../../lib/i18n';
import { Trans, Plural, useLingui } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import { StatCard, PixelBtn } from './alignAtoms';

/**
 * « Doublons » page (docs/archive/plan-reorganisation-sync-ldap.md, lot 3): Annuaire records sharing the
 * same uid_dyna — to merge (merge assistant), to qualify (concurrent / successive multi-affiliation,
 * or « à revoir »), already qualified multi-affiliations, merge log. Takes over the
 * « Doublons » sections of the former « Revue de synchronisation LDAP » modal; the computation
 * (computeDuplicatesDiff) no longer depends on LDAP, the pill of the Personnel header carries its counter.
 */

interface Props {
  diff: DuplicatesDiff | null;
  loading?: boolean;
  onRefresh: () => void;
  /** Opens the Druid record of an Annuaire row (Grist row number). */
  onOpenResearcher?: (gristRowId: number) => void;
  /** Opens the merge assistant on two Annuaire rows. */
  onMerge?: (rowIds: [number, number]) => void;
  /** After a restore from the merge log. */
  onRestored?: (restoredRowId: number) => void;
  /** Qualifies a group (concurrent/successive multi-affiliation, or « à revoir »). */
  onQualify?: (args: { rowIds: number[]; principalRowId?: number; mode: QualifyMode; endDate?: string }) => Promise<void>;
  /** Removes the qualification of a group (it becomes a pending duplicate again). */
  onUnqualify?: (rowIds: number[]) => Promise<void>;
  /** Incremented by the parent after a merge to reload the log. */
  mergesRefreshKey?: number;
  /** Rendered inside the « À traiter » section (TodoPage): no banner of its own, the
   * refresh button sits in a slim bar. */
  embedded?: boolean;
}

const SectionTitle: React.FC<{ icon: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <div className="flex items-center gap-2 pb-2 mb-3 border-b border-ink/5 dark:border-white/5 text-muted-lighter dark:text-[#8f897c]">
    {icon}
    <h3 className="font-disp text-base font-bold tracking-tight text-ink dark:text-[#f5f2ea]">{children}</h3>
  </div>
);

/** Display order of the duplicate classes: the safest to process first. */
const DUPLICATE_KINDS: LdapDuplicateKind[] = ['same_labo', 'parking', 'multi_labo'];

/** Local memory of the duplicate uids seen at the last visit (per browser): flags the
 * groups that appeared since, without depending on a Grist column. */
const SEEN_DOUBLONS_KEY = 'druid.ldapReview.seenDoublons';
function readSeenDoublons(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_DOUBLONS_KEY) || '[]')); } catch { return new Set(); }
}
function writeSeenDoublons(uids: string[]): void {
  try { localStorage.setItem(SEEN_DOUBLONS_KEY, JSON.stringify(uids)); } catch { /* stockage indisponible : on ignore */ }
}

type DuplicateRow = DuplicatesDiff['doublonsUid'][number]['rows'][number];

/** Pairs (i<j) of a group: one for a simple duplicate, three for a triplet. */
function pairsOf(rows: DuplicateRow[]): [DuplicateRow, DuplicateRow][] {
  const out: [DuplicateRow, DuplicateRow][] = [];
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) out.push([rows[i], rows[j]]);
  return out;
}

const DUPLICATE_KIND_META: Record<LdapDuplicateKind, { label: MessageDescriptor; hint: MessageDescriptor; badge: string; card: string }> = {
  same_labo: {
    label: msg`Same lab`,
    hint: msg`Probable duplicates (LDAP row + row created from the lab website): to be merged.`,
    badge: 'bg-[rgba(231,111,154,.2)] text-[#b23b3b] dark:text-[#f08c8c]',
    card: 'border-[rgba(231,111,154,.35)] bg-[rgba(231,111,154,.08)] dark:bg-[rgba(231,111,154,.1)]',
  },
  parking: {
    label: msg`Holding area`,
    hint: msg`One row is outside any lab (LABO “zzz” or empty): to be absorbed into the lab row.`,
    badge: 'bg-[rgba(224,158,42,.25)] text-[#9a6a12] dark:text-[#f0c266]',
    card: 'border-[rgba(224,158,42,.45)] bg-[rgba(224,158,42,.1)] dark:bg-[rgba(224,158,42,.08)]',
  },
  multi_labo: {
    label: msg`Several labs`,
    hint: msg`Multiple affiliation (concurrent or successive): to be qualified, not necessarily merged.`,
    badge: 'bg-white/70 dark:bg-white/10 text-ink dark:text-[#f5f2ea] border border-ink/10 dark:border-white/10',
    card: 'border-ink/10 dark:border-white/10 bg-white/40 dark:bg-white/[.04]',
  },
};

export const DuplicatesPage: React.FC<Props> = ({ diff, loading = false, onRefresh, onOpenResearcher, onMerge, onRestored, mergesRefreshKey = 0, onQualify, onUnqualify, embedded = false }) => {
  const { t, i18n } = useLingui();
  const [seenDoublons] = useState<Set<string>>(() => readSeenDoublons());
  const [qualifyOpen, setQualifyOpen] = useState<string | null>(null);
  const [qualifyBusy, setQualifyBusy] = useState<string | null>(null);
  const [showQualified, setShowQualified] = useState(false);
  const groups = diff?.doublonsUid ?? [];
  const pending = groups.filter((d) => !d.qualified);
  const qualifiedGroups = groups.filter((d) => d.qualified);
  const runQualify = async (uid: string, rowIds: number[], args: { mode: QualifyMode; principalRowId?: number; endDate?: string }) => {
    if (!onQualify) return;
    try { setQualifyBusy(uid); await onQualify({ rowIds, ...args }); setQualifyOpen(null); } finally { setQualifyBusy(null); }
  };
  const newDuplicates = groups.filter((d) => !seenDoublons.has(d.uid)).length;
  const markSeen = () => writeSeenDoublons(groups.map((d) => d.uid));
  const generatedAt = diff ? new Date(diff.generatedAt).toLocaleString(numberLocale()) : '';

  const { compact, onScrollCapture } = useCompactHeader();
  return (
    <div className="flex flex-col h-full" onScrollCapture={embedded ? undefined : onScrollCapture}>
      {embedded ? (
        <div className="px-4 md:px-7 pt-2 pb-3 flex justify-end">
          <PixelBtn onClick={() => { markSeen(); onRefresh(); }} disabled={loading} title={t`Recomputes the groups from the Directory (no LDAP run)`}>
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />} <Trans>Refresh</Trans>
          </PixelBtn>
        </div>
      ) : (
        <header className="page-header px-4 md:px-7 pt-6 pb-4 flex flex-wrap items-end justify-between gap-4" data-compact={compact || undefined}>
          <div className="flex items-center gap-3">
            <Copy className="page-header-icon w-7 h-7 text-[#b23b3b] dark:text-[#f08c8c]" />
            <div>
              <h1 className="font-disp text-3xl md:text-[38px] font-bold tracking-tight text-ink dark:text-[#f5f2ea] leading-none"><Trans>Duplicates</Trans></h1>
              <p className="page-header-sub text-[15px] text-muted dark:text-[#8f897c] mt-1.5"><Trans>Records sharing the same uid_dyna — merge, or qualify a legitimate multi-affiliation</Trans></p>
            </div>
          </div>
          <PixelBtn onClick={() => { markSeen(); onRefresh(); }} disabled={loading} title={t`Recomputes the groups from the Directory (no LDAP run)`}>
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />} <Trans>Refresh</Trans>
          </PixelBtn>
        </header>
      )}

      <div className="flex-1 overflow-auto px-4 md:px-7 py-4 space-y-8" data-page-scroll>
        {!diff ? (
          <div className="flex flex-col items-center justify-center py-24 text-muted-faint gap-3">
            <RefreshCw className="w-8 h-8 animate-spin" />
            <p className="text-[13px] font-semibold text-muted dark:text-[#8f897c]">{t`Looking for duplicates…`}</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <StatCard label={t`Directory`} value={diff.stats.gristTotal} />
              <StatCard label={t`To process`} value={diff.stats.pending} tone="bg-[rgba(231,111,154,.15)] dark:bg-[rgba(231,111,154,.12)]" />
              <StatCard label={i18n._(DUPLICATE_KIND_META.same_labo.label)} value={diff.stats.parKind.same_labo} tone="bg-[rgba(231,111,154,.10)] dark:bg-[rgba(231,111,154,.08)]" />
              <StatCard label={i18n._(DUPLICATE_KIND_META.parking.label)} value={diff.stats.parKind.parking} tone="bg-[rgba(224,158,42,.18)] dark:bg-[rgba(224,158,42,.12)]" />
              <StatCard label={t`Qualified multi-affiliations`} value={diff.stats.qualified} />
            </div>

            <section className="max-w-5xl">
              <SectionTitle icon={<Copy className="w-4 h-4" />}><Trans>uid_dyna duplicates to handle ({pending.length})</Trans></SectionTitle>
              {pending.length === 0 ? (
                <p className="text-[13px] text-muted-faint"><Trans>No duplicate detected.</Trans></p>
              ) : (
                <div className="space-y-4">
                  {newDuplicates > 0 && seenDoublons.size > 0 && (
                    <p className="text-[12.5px] font-semibold text-[#9a6a12] dark:text-[#f0c266]">
                      <Plural value={newDuplicates} one="# duplicate group has appeared since your last review." other="# duplicate groups have appeared since your last review." />
                    </p>
                  )}
                  <p className="text-[12.5px] text-muted-light dark:text-[#8f897c]">
                    <Trans>Open the records to decide, or click “Merge”: the assistant compares both rows field by field, logs the operation and keeps it restorable. Legitimate multiple affiliations should not be merged.</Trans>
                  </p>
                  {DUPLICATE_KINDS.map((kind) => {
                    const kindGroups = pending.filter((d) => d.kind === kind);
                    if (kindGroups.length === 0) return null;
                    const meta = DUPLICATE_KIND_META[kind];
                    return (
                      <div key={kind}>
                        <div className="flex items-baseline gap-2 mb-1.5">
                          <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${meta.badge}`}>{i18n._(meta.label)} · {kindGroups.length}</span>
                          <span className="text-[12px] text-muted-faint">{i18n._(meta.hint)}</span>
                        </div>
                        <div className="space-y-1.5">
                          {kindGroups.map((d) => (
                            <div key={d.uid} className={`rounded-card border px-4 py-2.5 text-[12.5px] flex flex-wrap items-center gap-x-3 gap-y-1 ${meta.card}`}>
                              <span className="font-mono font-bold text-ink dark:text-[#f5f2ea]">{d.uid}</span>
                              {seenDoublons.size > 0 && !seenDoublons.has(d.uid) && (
                                <span className="px-2 py-0.5 rounded-full bg-[rgba(224,158,42,.25)] text-[#9a6a12] dark:text-[#f0c266] text-[10px] font-bold uppercase tracking-wide"><Trans>new</Trans></span>
                              )}
                              {d.rows.map((row) => (
                                <button
                                  key={row.id}
                                  type="button"
                                  onClick={() => onOpenResearcher?.(row.gristRowId)}
                                  disabled={!onOpenResearcher}
                                  title={t`Open the record (Grist row ${row.gristRowId}) — source: ${row.dataSource || '—'}`}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/10 text-[12px] font-semibold text-ink dark:text-[#e7e2d6] hover:bg-white dark:hover:bg-white/15 transition-colors disabled:cursor-default"
                                >
                                  <span>{row.name || '—'}</span>
                                  <span className="font-mono font-normal text-muted dark:text-[#8f897c]">{row.labo || '∅'}</span>
                                  {row.validated && <ShieldCheck className="w-3 h-3 text-[#1f7a4d] dark:text-[#5fd39a]" aria-label={t`Manually validated record`} />}
                                  {onOpenResearcher && <ExternalLink className="w-3 h-3 text-muted-faint" />}
                                </button>
                              ))}
                              {(onMerge || onQualify) && (
                                <span className="ml-auto flex flex-wrap gap-1.5">
                                  {onQualify && d.kind !== 'same_labo' && (
                                    <button type="button" onClick={() => setQualifyOpen(qualifyOpen === d.uid ? null : d.uid)}
                                      title={t`Declare a multiple affiliation (concurrent or successive) or mark “to review” — without merging`}
                                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/75 dark:bg-white/10 border border-white/80 dark:border-white/15 text-[12px] font-semibold text-ink dark:text-[#f5f2ea] hover:bg-white dark:hover:bg-white/15 transition-colors">
                                      <Users className="w-3.5 h-3.5" /> <Trans>Qualify</Trans>
                                    </button>
                                  )}
                                  {onMerge && pairsOf(d.rows).map(([a, b]) => (
                                    <button
                                      key={`${a.id}-${b.id}`}
                                      type="button"
                                      onClick={() => onMerge([a.gristRowId, b.gristRowId])}
                                      title={d.rows.length > 2 ? t`Merge ${a.name} (${a.labo || '∅'}) and ${b.name} (${b.labo || '∅'})` : t`Open the merge assistant`}
                                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-ink text-white dark:bg-accent dark:text-ink text-[12px] font-semibold hover:bg-black dark:hover:bg-accent-strong transition-colors"
                                    >
                                      <GitMerge className="w-3.5 h-3.5" />
                                      {d.rows.length > 2 ? `${a.labo || '∅'} + ${b.labo || '∅'}` : t`Merge`}
                                    </button>
                                  ))}
                                </span>
                              )}
                              {qualifyOpen === d.uid && (
                                <DuplicateQualifyPanel rows={d.rows} busy={qualifyBusy === d.uid}
                                  onQualify={(args) => runQualify(d.uid, d.rows.map((r) => r.gristRowId), args)} />
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {qualifiedGroups.length > 0 && (
              <section className="max-w-5xl">
                <button type="button" onClick={() => setShowQualified((v) => !v)} className="flex items-center gap-2 pb-2 mb-2 w-full border-b border-ink/5 dark:border-white/5 text-muted-lighter dark:text-[#8f897c]">
                  {showQualified ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  <Users className="w-4 h-4" />
                  <h3 className="font-disp text-base font-bold tracking-tight text-ink dark:text-[#f5f2ea]"><Trans>Qualified multiple affiliations ({qualifiedGroups.length})</Trans></h3>
                </button>
                {showQualified && (
                  <div className="space-y-1.5">
                    {qualifiedGroups.map((d) => (
                      <div key={d.uid} className="rounded-card border border-ink/5 dark:border-white/10 bg-white/30 dark:bg-white/[.03] px-4 py-2 text-[12.5px] flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-mono font-bold text-ink dark:text-[#f5f2ea]">{d.uid}</span>
                        {d.rows.map((row) => (
                          <button key={row.id} type="button" onClick={() => onOpenResearcher?.(row.gristRowId)} disabled={!onOpenResearcher}
                            className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/60 dark:bg-white/5 border border-ink/5 dark:border-white/10 text-[12px] text-ink dark:text-[#e7e2d6] hover:bg-white dark:hover:bg-white/10 disabled:cursor-default">
                            <span>{row.name || '—'}</span>
                            <span className="font-mono text-muted dark:text-[#8f897c]">{row.labo || '∅'}</span>
                            {row.role && <span className={`text-[10px] font-bold uppercase tracking-wide ${row.role === 'PRINCIPAL' ? 'text-[#1f7a4d] dark:text-[#5fd39a]' : row.role === 'HISTORIQUE' ? 'text-muted-faint' : 'text-[#9a6a12] dark:text-[#f0c266]'}`}>{row.role}{row.role === 'HISTORIQUE' && row.endDate ? ` → ${row.endDate}` : ''}</span>}
                          </button>
                        ))}
                        <span className="text-[11px] text-muted-faint" title={d.decision}>{d.decision.split(' ')[0]}</span>
                        {onUnqualify && (
                          <button type="button" onClick={() => onUnqualify(d.rows.map((r) => r.gristRowId))}
                            className="ml-auto inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold text-muted dark:text-[#8f897c] hover:text-ink dark:hover:text-[#f5f2ea] border border-ink/10 dark:border-white/15">
                            <Trans>Requalify</Trans>
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            <div className="max-w-5xl"><MergeLogPanel onRestored={onRestored} refreshKey={mergesRefreshKey} /></div>
          </>
        )}
      </div>

      <footer className="px-4 md:px-7 py-3 border-t border-ink/5 dark:border-white/5 bg-white/60 dark:bg-white/5 backdrop-blur-xl text-[12px] text-muted-faint">
        {diff ? t`Generated on ${generatedAt}` : ''}
      </footer>
    </div>
  );
};
