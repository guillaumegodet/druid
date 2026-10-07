import React, { useMemo, useState } from 'react';
import { ShieldCheck, X, Upload, AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react';
import { Researcher, Presence } from '../../types';
import {
  ValidationScope,
  ValidationDiff,
  parseValidationList,
  computeValidationDiff,
} from '../../lib/validation';
import { PRESENCE_LABELS, VALIDATION_SCOPE_LABELS } from '../../lib/researcherLabels';
import { Trans, Plural, useLingui } from '@lingui/react/macro';

interface ValidationImportReviewProps {
  researchers: Researcher[];
  /** Applies the retained validations (the calling layer persists or simulates). */
  onApply: (
    diff: ValidationDiff,
    opts: { source: string; date: string; scope: ValidationScope[] },
  ) => void;
  onClose: () => void;
  applying?: boolean;
}

const todayIso = () => new Date().toISOString().split('T')[0];

/**
 * Import workshop for a **reliable list** (e.g. researchers of Centrale, of the LPPL).
 * Flow propose → review → apply, modeled on the other sync reviews:
 * 1. paste/load the list + enter source, date, scope, default status
 * 2. match (uid → email → name) and preview (validated / homonyms / not found)
 * 3. apply: sets the validation layer (takes precedence over the LDAP-derived status).
 */
export const ValidationImportReview: React.FC<ValidationImportReviewProps> = ({
  researchers, onApply, onClose, applying = false,
}) => {
  const { t } = useLingui();
  const [raw, setRaw] = useState('');
  const [source, setSource] = useState('');
  const [date, setDate] = useState(todayIso());
  const [scope, setScope] = useState<ValidationScope[]>(['statut', 'rattachement']);
  const [defaultStatus, setDefaultStatus] = useState<Presence>(Presence.PRESENT);
  const [diff, setDiff] = useState<ValidationDiff | null>(null);

  const rows = useMemo(() => parseValidationList(raw), [raw]);

  const toggleScope = (s: ValidationScope) =>
    setScope((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setRaw(String(reader.result || ''));
    reader.readAsText(file);
  };

  const analyze = () => {
    setDiff(
      computeValidationDiff(
        researchers.map((r) => ({
          id: r.id, uid: r.uid, email: r.email, displayName: r.displayName, presence: r.presence,
        })),
        rows,
        { source: source.trim() || t`Verified list`, date, scope, defaultStatus },
      ),
    );
  };

  const canAnalyze = rows.length > 0 && scope.length > 0;
  const matchedCount = diff?.matched.length ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-hero bg-cream-100 dark:bg-[#201e1a] shadow-soft-lg border border-white/50 dark:border-white/10 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-ink/5 dark:border-white/5">
          <h3 className="flex items-center gap-2 font-disp text-xl font-bold tracking-tight text-ink dark:text-[#f5f2ea]">
            <ShieldCheck className="w-5 h-5 text-[#2ea066] dark:text-[#5fd39a]" /> <Trans>Import a validated list</Trans>
          </h3>
          <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/15 flex items-center justify-center text-ink dark:text-[#f5f2ea] hover:bg-white dark:hover:bg-white/15 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-auto space-y-5">
          {/* Step 1 — input */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="section-label"><Trans>List (paste: name, email, uid, status)</Trans></label>
              <textarea
                value={raw}
                onChange={(e) => { setRaw(e.target.value); setDiff(null); }}
                rows={6}
                placeholder={t`name,email,uid\nDUPONT Jean,jean.dupont@x.fr,jdupont\n…`}
                className="w-full box-border rounded-xl bg-white dark:bg-white/10 border border-ink/10 dark:border-white/15 p-3 text-[12px] font-mono text-ink dark:text-[#f5f2ea] outline-none focus:border-accent-strong focus:ring-2 focus:ring-accent/40 transition-colors"
              />
              <label className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-ink dark:text-accent cursor-pointer hover:underline">
                <Upload className="w-3.5 h-3.5" /> <Trans>…or load a CSV</Trans>
                <input
                  type="file"
                  accept=".csv,.txt,text/csv"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) { handleFile(f); setDiff(null); } }}
                />
              </label>
              <p className="text-[12px] text-muted-faint"><Plural value={rows.length} one="# line detected" other="# lines detected" /></p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="section-label"><Trans>Source (traceability)</Trans></label>
                <input
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder={t`Centrale list 2026-06`}
                  className="input-soft mt-1"
                />
              </div>
              <div>
                <label className="section-label"><Trans>Validation date</Trans></label>
                <input
                  type="date" value={date} onChange={(e) => setDate(e.target.value)}
                  className="input-soft mt-1"
                />
              </div>
              <div>
                <label className="section-label"><Trans>Default presence</Trans></label>
                <select
                  value={defaultStatus}
                  onChange={(e) => setDefaultStatus(e.target.value as Presence)}
                  className="input-soft mt-1"
                >
                  {Object.values(Presence).map((s) => <option key={s} value={s}>{t(PRESENCE_LABELS[s])}</option>)}
                </select>
                <p className="text-[11.5px] text-muted-faint mt-1"><Trans>Used when the line does not specify a status (present, leaving, left; internal and external read as present).</Trans></p>
              </div>
              <div>
                <label className="section-label"><Trans>Validation scope</Trans></label>
                <div className="flex gap-4 mt-1.5">
                  {(['statut', 'rattachement'] as ValidationScope[]).map((s) => (
                    <label key={s} className="flex items-center gap-1.5 text-[13px] font-semibold text-ink dark:text-[#f5f2ea] cursor-pointer">
                      <input type="checkbox" checked={scope.includes(s)} onChange={() => toggleScope(s)} className="accent-[#1c1b19] dark:accent-[#f4d24a]" /> {t(VALIDATION_SCOPE_LABELS[s])}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {!diff && (
            <button
              onClick={analyze}
              disabled={!canAnalyze}
              className="w-full inline-flex items-center justify-center h-11 rounded-full font-disp font-semibold text-sm bg-ink text-white hover:bg-black dark:bg-accent dark:text-ink dark:hover:bg-accent-strong shadow-soft transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Trans>Analyse matching</Trans>
            </button>
          )}

          {/* Step 2 — review */}
          {diff && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2 text-[12px] font-semibold">
                <span className="inline-flex items-center h-7 px-3 rounded-full bg-[rgba(46,160,102,.16)] text-[#1f7a4d] dark:bg-[rgba(46,160,102,.22)] dark:text-[#5fd39a]"><Trans>{diff.matched.length} to validate</Trans></span>
                <span className="inline-flex items-center h-7 px-3 rounded-full bg-[rgba(224,158,42,.18)] text-[#9a6a12] dark:bg-[rgba(224,158,42,.22)] dark:text-[#f0c266]"><Plural value={diff.ambiguous.length} one="# homonym" other="# homonyms" /></span>
                <span className="inline-flex items-center h-7 px-3 rounded-full bg-cream-300/70 dark:bg-white/10 text-muted dark:text-[#8f897c]"><Plural value={diff.unmatched.length} one="# not found" other="# not found" /></span>
              </div>

              {diff.matched.length > 0 && (
                <div className="rounded-card bg-white/60 dark:bg-white/5 backdrop-blur-xl border border-white/70 dark:border-white/10 shadow-soft overflow-hidden">
                  <div className="px-4 py-2 bg-[rgba(46,160,102,.12)] dark:bg-[rgba(46,160,102,.14)] text-[12px] font-semibold text-[#1f7a4d] dark:text-[#5fd39a] flex items-center gap-1.5 border-b border-ink/5 dark:border-white/5">
                    <CheckCircle2 className="w-3.5 h-3.5" /> <Trans>Records that will be validated</Trans>
                  </div>
                  <div className="max-h-48 overflow-auto divide-y divide-ink/5 dark:divide-white/5">
                    {diff.matched.map((m) => (
                      <div key={m.researcherId} className="px-4 py-2 flex items-center justify-between text-[13px] hover:bg-accent/10 transition-colors">
                        <span className="font-disp font-semibold text-ink dark:text-[#f5f2ea]">{m.displayName}</span>
                        <span className="flex items-center gap-2 text-[12px]">
                          <span className="text-muted-faint">{m.matchedBy === 'uid' ? 'uid' : m.matchedBy === 'email' ? t`email` : t`name`}</span>
                          {m.overrides && m.currentStatus
                            ? <span className="font-semibold text-[#9a6a12] dark:text-[#f0c266]">{t(PRESENCE_LABELS[m.currentStatus])} → {t(PRESENCE_LABELS[m.newStatus])}</span>
                            : <span className="font-semibold text-[#1f7a4d] dark:text-[#5fd39a]">{t(PRESENCE_LABELS[m.newStatus])}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {diff.ambiguous.length > 0 && (
                <div className="rounded-card border border-[rgba(224,158,42,.45)] bg-[rgba(224,158,42,.1)] dark:bg-[rgba(224,158,42,.08)] overflow-hidden">
                  <div className="px-4 py-2 bg-[rgba(224,158,42,.18)] dark:bg-[rgba(224,158,42,.14)] text-[12px] font-semibold flex items-center gap-1.5 border-b border-[rgba(224,158,42,.35)] text-[#9a6a12] dark:text-[#f0c266]">
                    <AlertTriangle className="w-3.5 h-3.5" /> <Trans>Homonyms — not applied (to resolve manually)</Trans>
                  </div>
                  <div className="max-h-32 overflow-auto divide-y divide-[rgba(224,158,42,.2)]">
                    {diff.ambiguous.map((a, i) => (
                      <div key={i} className="px-4 py-2 text-[13px] flex justify-between">
                        <span className="font-semibold text-ink dark:text-[#f5f2ea]">{a.row.name || a.row.raw}</span>
                        <span className="text-[12px] text-muted-faint"><Plural value={a.candidateIds.length} one="# candidate" other="# candidates" /></span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {diff.unmatched.length > 0 && (
                <details className="rounded-card bg-white/40 dark:bg-white/5 border border-ink/5 dark:border-white/10 overflow-hidden">
                  <summary className="px-4 py-2 text-[12px] font-semibold text-muted dark:text-[#8f897c] flex items-center gap-1.5 cursor-pointer hover:bg-accent/10 transition-colors">
                    <HelpCircle className="w-3.5 h-3.5" /> <Trans>Not found ({diff.unmatched.length})</Trans>
                  </summary>
                  <div className="max-h-32 overflow-auto px-4 py-2 text-[12px] font-mono text-muted-light dark:text-[#8f897c]">
                    {diff.unmatched.map((u, i) => <div key={i}>{u.name || u.email || u.uid || u.raw}</div>)}
                  </div>
                </details>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => setDiff(null)}
                  className="inline-flex items-center justify-center h-11 px-5 rounded-full font-disp font-semibold text-sm bg-white/75 dark:bg-white/10 border border-white/80 dark:border-white/15 text-ink dark:text-[#f5f2ea] hover:bg-white dark:hover:bg-white/15 shadow-soft transition-colors"
                >
                  <Trans>Edit</Trans>
                </button>
                <button
                  onClick={() => onApply(diff, { source: diff.source, date: diff.date, scope: diff.scope })}
                  disabled={applying || diff.matched.length === 0}
                  className="flex-1 inline-flex items-center justify-center h-11 rounded-full font-disp font-semibold text-sm bg-ink text-white hover:bg-black dark:bg-accent dark:text-ink dark:hover:bg-accent-strong shadow-soft transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {applying ? t`Applying…` : <Plural value={matchedCount} one="Validate # record" other="Validate # records" />}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
