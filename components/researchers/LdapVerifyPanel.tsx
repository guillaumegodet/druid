import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight, RefreshCw, AlertTriangle, UserMinus, Save, CheckSquare, Square, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { LdapDiff } from '../../lib/gristService';
import { numberLocale } from '../../lib/i18n';
import { Trans, Plural, useLingui } from '@lingui/react/macro';

/**
 * « Vérifier les existants » tab of the LDAP alignment (docs/archive/plan-reorganisation-sync-ldap.md,
 * lot 2): « À mettre à jour » sections (LDAP-authoritative fields that differ on existing
 * records, guard for validated records) and « Orphelins » (uid gone from LDAP), extracted from
 * the former « Revue de synchronisation LDAP » modal — same selection and write logic
 * (applyLdapUpdates). uid_dyna duplicates have their own page (DuplicatesPage, lot 3).
 */

export interface LdapRunProgress { running: boolean; total?: number; done?: number; error?: string }

interface Props {
  diff: LdapDiff | null;
  progress?: LdapRunProgress | null;
  applying?: boolean;
  onApply: (ids: string[]) => void;
}

const SectionTitle: React.FC<{ icon: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <div className="flex items-center gap-2 pb-2 mb-3 border-b border-ink/5 dark:border-white/5 text-muted-lighter dark:text-[#8f897c]">
    {icon}
    <h3 className="font-disp text-base font-bold tracking-tight text-ink dark:text-[#f5f2ea]">{children}</h3>
  </div>
);

export const LdapVerifyPanel: React.FC<Props> = ({ diff, progress, applying = false, onApply }) => {
  const { t } = useLingui();
  const aMettreAJour = diff?.aMettreAJour ?? [];
  const orphelins = diff?.orphelins ?? [];
  // On load, records in validation conflict are NOT checked: data made reliable
  // by hand must not be overwritten by LDAP without arbitration. « Tout cocher », on the other
  // hand, covers ALL records, validated ones included (user request 2026-09-09). Same for a record
  // holding another HR staff number than LDAP (two people mixed up, or a wrong uid).
  const defaultSelectable = aMettreAJour.filter((r) => !r.validationConflict && !r.hrIdConflict).map((r) => r.id);
  const allIds = aMettreAJour.map((r) => r.id);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(defaultSelectable));
  // `diff` can be replaced without unmounting (e.g. after a duplicate qualification): the rows
  // already known keep the user's choice, only the new ones receive the default.
  const knownIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of allIds) if (!knownIdsRef.current.has(id) && defaultSelectable.includes(id)) next.add(id);
      for (const id of next) if (!allIds.includes(id)) next.delete(id);
      return next;
    });
    knownIdsRef.current = new Set(allIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diff]);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));
  const conflictCount = aMettreAJour.filter((r) => r.validationConflict).length;
  const hrIdConflictCount = aMettreAJour.filter((r) => r.hrIdConflict).length;
  const toggle = (id: string) => setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(allIds));
  const running = !!progress?.running;
  const generatedAt = diff ? new Date(diff.generatedAt).toLocaleString(numberLocale()) : '';

  if (!diff) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-muted-faint gap-3">
        <RefreshCw className="w-8 h-8 animate-spin" />
        <p className="text-[13px] font-semibold text-muted dark:text-[#8f897c]">{running ? t`LDAP sync in progress… ${progress?.done ?? 0}/${progress?.total ?? '?'}` : t`Loading the LDAP comparison…`}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto px-4 md:px-7 py-4 space-y-8" data-page-scroll>
        <div className="flex items-center gap-3 px-4 py-3 rounded-card bg-accent/20 dark:bg-accent/10 border border-accent-strong/40 dark:border-accent/20 text-[13px] font-semibold text-ink dark:text-[#f0c266]">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <Trans>Only the checked records under “To update” will be written to Grist. No record is created (update only).</Trans>
        </div>
        {conflictCount > 0 && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-card bg-[rgba(224,158,42,.18)] dark:bg-[rgba(224,158,42,.14)] border border-[rgba(224,158,42,.45)] text-[13px] font-semibold text-[#9a6a12] dark:text-[#f0c266]">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <Plural value={conflictCount} one="# record has a manually validated status that LDAP contradicts — unchecked by default. Decide before overwriting." other="# records have a manually validated status that LDAP contradicts — unchecked by default. Decide before overwriting." />
          </div>
        )}
        {hrIdConflictCount > 0 && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-card bg-[rgba(224,158,42,.18)] dark:bg-[rgba(224,158,42,.14)] border border-[rgba(224,158,42,.45)] text-[13px] font-semibold text-[#9a6a12] dark:text-[#f0c266]">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <Plural value={hrIdConflictCount} one="# record holds another HR staff number than LDAP (two people mixed up, or a wrong uid?) — unchecked by default." other="# records hold another HR staff number than LDAP (two people mixed up, or a wrong uid?) — unchecked by default." />
          </div>
        )}

        <section>
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-ink/5 dark:border-white/5">
            <div className="flex items-center gap-2 text-muted-lighter dark:text-[#8f897c]">
              <RefreshCw className="w-4 h-4" />
              <h3 className="font-disp text-base font-bold tracking-tight text-ink dark:text-[#f5f2ea]"><Trans>To update ({aMettreAJour.length})</Trans></h3>
            </div>
            {aMettreAJour.length > 0 && (
              <button onClick={toggleAll} className="flex items-center gap-1.5 text-[12px] font-semibold text-muted dark:text-[#8f897c] hover:text-ink dark:hover:text-[#f5f2ea] transition-colors">
                {allSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                {allSelected ? t`Uncheck all` : t`Check all`} ({selected.size}/{aMettreAJour.length})
              </button>
            )}
          </div>
          {aMettreAJour.length === 0 ? (
            <p className="text-[13px] text-muted-faint"><Trans>No record to update.</Trans></p>
          ) : (
            <div className="space-y-3 max-w-5xl">
              {aMettreAJour.map((r) => (
                <div key={r.id} className={`rounded-card p-4 transition-colors ${
                  r.validationConflict || r.hrIdConflict
                    ? 'bg-[rgba(224,158,42,.18)] dark:bg-[rgba(224,158,42,.1)] border border-[rgba(224,158,42,.45)]'
                    : selected.has(r.id)
                      ? 'bg-white/70 dark:bg-white/10 backdrop-blur-xl border border-white/70 dark:border-white/10 shadow-soft'
                      : 'bg-white/30 dark:bg-white/[.03] border border-ink/5 dark:border-white/5 opacity-60'
                }`}>
                  <div className="flex items-baseline gap-2 mb-2">
                    <button onClick={() => toggle(r.id)} className="self-center text-muted dark:text-[#8f897c] hover:text-ink dark:hover:text-[#f5f2ea]" title={t`Include / exclude`}>
                      {selected.has(r.id) ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                    </button>
                    <span className="font-disp text-[15px] font-semibold text-ink dark:text-[#f5f2ea]">{r.displayName || '—'}</span>
                    {r.labo !== undefined && (
                      <span title={t`Person present on several directory rows: row for this lab`} className="px-2 py-0.5 rounded-full bg-white/60 dark:bg-white/5 border border-ink/10 dark:border-white/10 text-[11px] font-semibold text-muted dark:text-[#8f897c]">{r.labo || '∅'}</span>
                    )}
                    <span className="text-[11px] font-mono text-muted-faint">{r.uid} · {r.id}</span>
                    {r.validationConflict ? (
                      <span title={t`Manually validated status — LDAP contradicts it. Unchecked by default: decide before overwriting.`} className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[rgba(224,158,42,.25)] text-[#9a6a12] dark:bg-[rgba(224,158,42,.22)] dark:text-[#f0c266] text-[11px] font-semibold">
                        <ShieldAlert className="w-3 h-3" /> <Trans>Validated — conflict</Trans>
                      </span>
                    ) : r.hrIdConflict ? (
                      <span title={t`The record holds another HR staff number than LDAP. Unchecked by default: check that the uid is the right person before overwriting.`} className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[rgba(224,158,42,.25)] text-[#9a6a12] dark:bg-[rgba(224,158,42,.22)] dark:text-[#f0c266] text-[11px] font-semibold">
                        <ShieldAlert className="w-3 h-3" /> <Trans>Different staff number</Trans>
                      </span>
                    ) : r.validated ? (
                      <span title={t`Manually validated record`} className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[rgba(46,160,102,.16)] text-[#1f7a4d] dark:bg-[rgba(46,160,102,.22)] dark:text-[#5fd39a] text-[11px] font-semibold">
                        <ShieldCheck className="w-3 h-3" /> <Trans>Validated</Trans>
                      </span>
                    ) : null}
                  </div>
                  <div className="space-y-1">
                    {r.changes.map((c, i) => (
                      <div key={i} className="flex flex-wrap items-center gap-2 text-[12px]">
                        <span className="text-[10.5px] font-bold uppercase tracking-[.06em] text-muted-lighter dark:text-[#8f897c] w-32 shrink-0">{c.label}</span>
                        <span className="px-2 py-0.5 rounded-full bg-[rgba(214,69,69,.12)] text-[#b23b3b] dark:bg-[rgba(214,69,69,.2)] dark:text-[#f08c8c] line-through">{c.before || '∅'}</span>
                        <ArrowRight className="w-3 h-3 text-muted-faint" />
                        <span className="px-2 py-0.5 rounded-full bg-[rgba(46,160,102,.16)] text-[#1f7a4d] dark:bg-[rgba(46,160,102,.22)] dark:text-[#5fd39a] font-semibold">{c.after}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <SectionTitle icon={<UserMinus className="w-4 h-4" />}><Trans>Orphans — record without LDAP uid ({orphelins.length})</Trans></SectionTitle>
          <p className="text-[12.5px] text-muted-light dark:text-[#8f897c] mb-2"><Trans>The uid of these records no longer exists in LDAP: probable departure, to check on the record (status, end of employment).</Trans></p>
          {orphelins.length === 0 ? (
            <p className="text-[13px] text-muted-faint"><Trans>No orphan.</Trans></p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {orphelins.map((o) => (
                <span key={o.id} className="px-3 py-1 rounded-full bg-white/60 dark:bg-white/5 border border-ink/5 dark:border-white/10 text-[12px] font-semibold text-ink dark:text-[#e7e2d6]">
                  {o.displayName || '—'} <span className="font-mono font-normal text-muted-faint">({o.uid})</span>
                </span>
              ))}
            </div>
          )}
        </section>
      </div>

      <footer className="px-4 md:px-7 py-4 border-t border-ink/5 dark:border-white/5 bg-white/60 dark:bg-white/5 backdrop-blur-xl flex flex-wrap items-center justify-between gap-3">
        <span className="text-[12px] text-muted-faint">{t`Generated on ${generatedAt}`}</span>
        <button onClick={() => onApply(Array.from(selected))} disabled={applying || running || selected.size === 0}
          className="inline-flex items-center justify-center gap-2 h-10 px-6 rounded-full font-disp font-semibold text-[13px] bg-ink text-white hover:bg-black dark:bg-accent dark:text-ink dark:hover:bg-accent-strong shadow-soft transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
          {applying ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {applying ? t`Writing…` : t`Apply (${selected.size})`}
        </button>
      </footer>
    </div>
  );
};
