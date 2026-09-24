import React, { useState } from 'react';
import { X, ArrowRight, RefreshCw, AlertTriangle, UserMinus, Building, Save, CheckSquare, Square, Plus } from 'lucide-react';
import { StructuresLdapDiff } from '../../lib/gristService';
import { Trans, useLingui } from '@lingui/react/macro';

interface Props {
  diff: StructuresLdapDiff;
  applying?: boolean;
  onApply?: (updateIds: string[], createKeys: string[]) => void;
  onClose: () => void;
}

const StatCard: React.FC<{ label: string; value: number; tone?: string }> = ({ label, value, tone = 'bg-white/60 dark:bg-white/5' }) => (
  <div className={`rounded-card border border-white/70 dark:border-white/10 backdrop-blur-xl p-3 shadow-soft ${tone}`}>
    <div className="text-2xl font-disp font-bold text-ink dark:text-[#f5f2ea]">{value}</div>
    <div className="text-[10px] font-bold uppercase tracking-[.09em] text-muted-lighter dark:text-[#8f897c] mt-0.5">{label}</div>
  </div>
);

/**
 * Review page of the LDAP import of structures (supannEntite) into the Grist table Structures.
 * Nothing is written until the user clicks « Appliquer ».
 */
export const StructuresLdapReview: React.FC<Props> = ({ diff, applying = false, onApply, onClose }) => {
  const { t, i18n } = useLingui();
  const [selUpd, setSelUpd] = useState<Set<string>>(() => new Set(diff.aMettreAJour.map((r) => r.id)));
  const [selCre, setSelCre] = useState<Set<string>>(() => new Set(diff.aCreer.map((r) => r.local_id)));

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    setter(next);
  };
  const allUpd = diff.aMettreAJour.length > 0 && selUpd.size === diff.aMettreAJour.length;
  const allCre = diff.aCreer.length > 0 && selCre.size === diff.aCreer.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-4xl max-h-[88vh] flex flex-col rounded-hero bg-cream-100 dark:bg-[#201e1a] shadow-soft-lg border border-white/50 dark:border-white/10 overflow-hidden">
        <header className="flex items-center justify-between px-6 py-4 border-b border-ink/5 dark:border-white/5">
          <div className="flex items-center gap-3">
            <Building className="w-5 h-5 text-ink dark:text-accent" />
            <h2 className="font-disp text-xl font-bold tracking-tight text-ink dark:text-[#f5f2ea]"><Trans>LDAP import of structures</Trans></h2>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/15 flex items-center justify-center text-ink dark:text-[#f5f2ea] hover:bg-white dark:hover:bg-white/15 transition-colors"><X className="w-4 h-4" /></button>
        </header>

        <div className="p-6 overflow-auto space-y-8">
          <div className="flex items-center gap-3 px-4 py-3 rounded-card bg-accent/20 dark:bg-accent/10 border border-accent-strong/40 dark:border-accent/20 text-[13px] font-semibold text-ink dark:text-[#f0c266]">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <Trans>Limited LDAP data (type, name, codes). Checked records will be written to Grist. Rich data (ror/scopus/hal…) is still handled by the bridge.</Trans>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="LDAP" value={diff.stats.ldapTotal} />
            <StatCard label={t`To update`} value={diff.stats.aMettreAJour} tone="bg-accent/25 dark:bg-accent/10" />
            <StatCard label={t`To create`} value={diff.stats.aCreer} tone="bg-[rgba(46,160,102,.16)] dark:bg-[rgba(46,160,102,.14)]" />
            <StatCard label={t`Orphans`} value={diff.stats.orphelins} tone="bg-[rgba(224,158,42,.18)] dark:bg-[rgba(224,158,42,.12)]" />
          </div>

          {/* To update */}
          <section>
            <div className="flex items-center justify-between pb-2 mb-3 border-b border-ink/5 dark:border-white/5">
              <div className="flex items-center gap-2 text-muted-lighter dark:text-[#8f897c]"><RefreshCw className="w-4 h-4" /><h3 className="font-disp text-base font-bold tracking-tight text-ink dark:text-[#f5f2ea]"><Trans>To update ({diff.aMettreAJour.length})</Trans></h3></div>
              {diff.aMettreAJour.length > 0 && (
                <button onClick={() => setSelUpd(allUpd ? new Set() : new Set(diff.aMettreAJour.map((r) => r.id)))} className="flex items-center gap-1.5 text-[12px] font-semibold text-muted dark:text-[#8f897c] hover:text-ink dark:hover:text-[#f5f2ea] transition-colors">
                  {allUpd ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}{allUpd ? t`Uncheck all` : t`Check all`} ({selUpd.size}/{diff.aMettreAJour.length})
                </button>
              )}
            </div>
            {diff.aMettreAJour.length === 0 ? <p className="text-[13px] text-muted-faint"><Trans>None.</Trans></p> : (
              <div className="space-y-3">
                {diff.aMettreAJour.map((r) => (
                  <div key={r.id} className={`rounded-card p-4 transition-colors ${selUpd.has(r.id) ? 'bg-white/70 dark:bg-white/10 backdrop-blur-xl border border-white/70 dark:border-white/10 shadow-soft' : 'bg-white/30 dark:bg-white/[.03] border border-ink/5 dark:border-white/5 opacity-60'}`}>
                    <div className="flex items-baseline gap-2 mb-2">
                      <button onClick={() => toggle(selUpd, setSelUpd, r.id)} className="self-center text-muted dark:text-[#8f897c] hover:text-ink dark:hover:text-[#f5f2ea]">{selUpd.has(r.id) ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}</button>
                      <span className="font-disp text-[15px] font-semibold text-ink dark:text-[#f5f2ea]">{r.displayName || '—'}</span>
                      {r.rattachement && <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-cream-50 dark:bg-white/10 border border-ink/5 dark:border-white/10 text-[11px] font-semibold text-ink dark:text-[#e7e2d6]"><span className="w-1.5 h-1.5 rounded-full bg-[#20a4a4]" />{r.rattachement}</span>}
                      <span className="text-[11px] font-mono text-muted-faint">{r.local_id} · {r.id}</span>
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

          {/* To create */}
          <section>
            <div className="flex items-center justify-between pb-2 mb-3 border-b border-ink/5 dark:border-white/5">
              <div className="flex items-center gap-2 text-muted-lighter dark:text-[#8f897c]"><Plus className="w-4 h-4" /><h3 className="font-disp text-base font-bold tracking-tight text-ink dark:text-[#f5f2ea]"><Trans>To create ({diff.aCreer.length})</Trans></h3></div>
              {diff.aCreer.length > 0 && (
                <button onClick={() => setSelCre(allCre ? new Set() : new Set(diff.aCreer.map((r) => r.local_id)))} className="flex items-center gap-1.5 text-[12px] font-semibold text-muted dark:text-[#8f897c] hover:text-ink dark:hover:text-[#f5f2ea] transition-colors">
                  {allCre ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}{allCre ? t`Uncheck all` : t`Check all`} ({selCre.size}/{diff.aCreer.length})
                </button>
              )}
            </div>
            {diff.aCreer.length === 0 ? <p className="text-[13px] text-muted-faint"><Trans>None.</Trans></p> : (
              <div className="flex flex-wrap gap-2">
                {diff.aCreer.map((r) => (
                  <button key={r.local_id} onClick={() => toggle(selCre, setSelCre, r.local_id)} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] transition-colors ${selCre.has(r.local_id) ? 'bg-[rgba(46,160,102,.16)] dark:bg-[rgba(46,160,102,.2)] border border-[rgba(46,160,102,.4)] text-ink dark:text-[#f5f2ea]' : 'bg-white/40 dark:bg-white/5 border border-ink/5 dark:border-white/10 opacity-50'}`}>
                    {selCre.has(r.local_id) ? <CheckSquare className="w-3 h-3" /> : <Square className="w-3 h-3" />}
                    <span className="font-semibold">{r.displayName}</span><span className="text-muted-faint font-mono text-[11px]">{r.type} · {r.local_id}</span>{r.rattachement && <span className="text-[#20a4a4] font-semibold">↳ {r.rattachement}</span>}
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Orphans */}
          <section>
            <div className="flex items-center gap-2 pb-2 mb-3 border-b border-ink/5 dark:border-white/5 text-muted-lighter dark:text-[#8f897c]"><UserMinus className="w-4 h-4" /><h3 className="font-disp text-base font-bold tracking-tight text-ink dark:text-[#f5f2ea]"><Trans>Grist structures outside the LDAP scope ({diff.orphelins.length})</Trans></h3></div>
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-auto">
              {diff.orphelins.map((o) => <span key={o.id} className="px-2.5 py-0.5 rounded-full bg-white/40 dark:bg-white/5 border border-ink/5 dark:border-white/10 text-[11px] text-muted-light dark:text-[#8f897c]">{o.displayName} <span className="font-mono">({o.local_id})</span></span>)}
            </div>
          </section>
        </div>

        <footer className="px-6 py-4 border-t border-ink/5 dark:border-white/5 bg-white/50 dark:bg-white/[.03] flex items-center justify-between gap-3">
          <span className="text-[12px] text-muted-faint"><Trans>Generated on {new Date(diff.generatedAt).toLocaleString(i18n.locale)}</Trans></span>
          <div className="flex items-center gap-3">
            <button onClick={onClose} disabled={applying} className="inline-flex items-center justify-center gap-2 h-10 px-5 rounded-full font-disp font-semibold text-[13px] bg-white/75 dark:bg-white/10 border border-white/80 dark:border-white/15 text-ink dark:text-[#f5f2ea] hover:bg-white dark:hover:bg-white/15 shadow-soft transition-colors disabled:opacity-50"><Trans>Cancel</Trans></button>
            <button onClick={() => onApply?.(Array.from(selUpd), Array.from(selCre))} disabled={applying || (selUpd.size === 0 && selCre.size === 0)} className="inline-flex items-center justify-center gap-2 h-10 px-6 rounded-full font-disp font-semibold text-[13px] bg-ink text-white hover:bg-black dark:bg-accent dark:text-ink dark:hover:bg-accent-strong shadow-soft transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              {applying ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {applying ? t`Writing…` : t`Apply (${selUpd.size} updates + ${selCre.size} new)`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};
