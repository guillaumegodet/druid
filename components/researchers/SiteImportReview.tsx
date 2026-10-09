import React, { useMemo, useState } from 'react';
import { Globe, X, Upload, AlertTriangle, UserPlus, PenLine, ShieldCheck, HelpCircle, UserMinus, CheckCircle2 } from 'lucide-react';
import { Trans, Plural, useLingui } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import { DirectoryApi } from '../../lib/directoryApi';
import { apiErrorText } from '../../lib/apiErrors';
import type { SiteField, SiteImportPlan, SiteImportResult, SiteImportSelection } from '../../lib/directory/siteImport';

const FIELD_LABELS: Record<SiteField, MessageDescriptor> = {
  email: msg`Email`, team: msg`Team`, profileUrl: msg`Profile page`, directoryUrl: msg`Directory page`,
  grade: msg`Corps / grade`, photoUrl: msg`Photo`,
};

interface SiteImportReviewProps {
  onClose: () => void;
  /** Called after an application, to read the directory again. */
  onApplied: () => void;
}

const fieldKey = (index: number, field: SiteField) => `${index}:${field}`;
const panel = 'rounded-card bg-white/60 dark:bg-white/5 backdrop-blur-xl border border-white/70 dark:border-white/10 shadow-soft overflow-hidden';
const panelHead = 'px-4 py-2 text-[12px] font-semibold flex items-center gap-1.5 border-b border-ink/5 dark:border-white/5';
const row = 'px-4 py-2 flex items-start gap-2.5 text-[13px] text-ink dark:text-[#f5f2ea]';
const box = 'mt-0.5 accent-[#1c1b19] dark:accent-[#f4d24a]';

/**
 * Import of a lab website directory (druid-internal docs/plan-migration-postgresql.md, lot 8 d): file exported by
 * druid-biblio's sync-annuaire-grist skill (`sync_annuaire.py --export`). Druid computes the plan
 * (lib/directory/siteImport.ts); the user keeps what to write — creations and complements ticked, differences
 * (« the site is right ») and validations not — and the server applies it after computing the plan again.
 */
export const SiteImportReview: React.FC<SiteImportReviewProps> = ({ onClose, onApplied }) => {
  const { t } = useLingui();
  const [document, setDocument] = useState<unknown>(null);
  const [fileName, setFileName] = useState('');
  const [plan, setPlan] = useState<SiteImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SiteImportResult | null>(null);
  const [creations, setCreations] = useState<Set<number>>(new Set());
  const [fields, setFields] = useState<Set<string>>(new Set());
  const [validate, setValidate] = useState<Set<number>>(new Set());
  const [validateNew, setValidateNew] = useState(false);

  const loadFile = async (file: File) => {
    setError(''); setPlan(null); setResult(null); setFileName(file.name);
    let doc: unknown;
    try { doc = JSON.parse(await file.text()); } catch { setError(t`This file is not JSON.`); return; }
    setDocument(doc);
    setBusy(true);
    try {
      const p = await DirectoryApi.siteImportPreview(doc);
      setPlan(p);
      setCreations(new Set(p.creations.map((c) => c.index)));
      setFields(new Set(p.matches.flatMap((m) => m.complements.map((c) => fieldKey(m.index, c.field)))));
      setValidate(new Set());
    } catch (err) {
      setError(apiErrorText(err) || t`The file could not be read.`);
    } finally {
      setBusy(false);
    }
  };

  const toggle = <T,>(set: Set<T>, value: T, apply: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value); else next.add(value);
    apply(next);
  };

  const withComplements = useMemo(() => plan?.matches.filter((m) => m.complements.length) ?? [], [plan]);
  const withDifferences = useMemo(() => plan?.matches.filter((m) => m.differences.length) ?? [], [plan]);
  const toValidate = useMemo(() => plan?.matches.filter((m) => m.toValidate) ?? [], [plan]);
  /** Fields with differences, to tick a whole field at once (« the site is right for the teams »). */
  const differenceFields = useMemo(() => [...new Set(withDifferences.flatMap((m) => m.differences.map((d) => d.field)))], [withDifferences]);
  const keysOfField = (field: SiteField) => withDifferences.filter((m) => m.differences.some((d) => d.field === field)).map((m) => fieldKey(m.index, field));
  const allTicked = (keys: string[]) => keys.length > 0 && keys.every((k) => fields.has(k));
  const setMany = (keys: string[], on: boolean) => {
    const next = new Set(fields);
    keys.forEach((k) => (on ? next.add(k) : next.delete(k)));
    setFields(next);
  };

  const selectedFields = [...fields].map((k) => { const [i, f] = k.split(':'); return { index: Number(i), field: f as SiteField }; });
  const total = creations.size + new Set(selectedFields.map((f) => f.index)).size + validate.size;

  const apply = async () => {
    if (!plan || !document) return;
    const selection: SiteImportSelection = { creations: [...creations], fields: selectedFields, validate: [...validate], validateNew };
    setBusy(true); setError('');
    try {
      setResult(await DirectoryApi.siteImportApply(document, selection));
      onApplied();
    } catch (err) {
      setError(apiErrorText(err) || t`The import could not be applied.`);
    } finally {
      setBusy(false);
    }
  };

  const who = (p: { firstName: string; lastName: string }) => `${p.lastName.toUpperCase()} ${p.firstName}`.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-hero bg-cream-100 dark:bg-[#201e1a] shadow-soft-lg border border-white/50 dark:border-white/10 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-ink/5 dark:border-white/5">
          <h3 className="flex items-center gap-2 font-disp text-xl font-bold tracking-tight text-ink dark:text-[#f5f2ea]">
            <Globe className="w-5 h-5" /> <Trans>Import a lab website directory</Trans>
          </h3>
          <button onClick={onClose} aria-label={t`Close`} className="w-9 h-9 rounded-full bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/15 flex items-center justify-center text-ink dark:text-[#f5f2ea] hover:bg-white dark:hover:bg-white/15 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-auto space-y-5">
          <div className="space-y-2">
            <p className="text-[13px] text-muted dark:text-[#a8a293]">
              <Trans>File produced from the lab's website by the « sync-annuaire-grist » skill of druid-biblio (export mode). Nothing is written before you apply.</Trans>
            </p>
            <label className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-white/80 dark:bg-white/10 border border-ink/10 dark:border-white/15 text-[13px] font-semibold text-ink dark:text-[#f5f2ea] cursor-pointer hover:bg-white dark:hover:bg-white/15">
              <Upload className="w-4 h-4" /> {fileName || <Trans>Choose the file (.json)</Trans>}
              <input type="file" accept=".json,application/json" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadFile(f); e.target.value = ''; }} />
            </label>
            {busy && <p className="text-[12.5px] text-muted"><Trans>Working…</Trans></p>}
            {error && (
              <p className="flex items-center gap-1.5 text-[13px] font-semibold text-[#b23b3b] dark:text-[#f08c8c]"><AlertTriangle className="w-4 h-4" /> {error}</p>
            )}
          </div>

          {result && (
            <div className={`${panel} p-4 space-y-1 text-[13px] text-ink dark:text-[#f5f2ea]`}>
              <p className="flex items-center gap-1.5 font-semibold"><CheckCircle2 className="w-4 h-4 text-[#1f7a4d] dark:text-[#5fd39a]" /> <Trans>Import applied</Trans></p>
              <p><Trans>{result.created} created, {result.updated} updated, {result.validated} validated.</Trans></p>
              {result.stale > 0 && <p><Plural value={result.stale} one="# item skipped: the directory changed since the preview." other="# items skipped: the directory changed since the preview." /></p>}
              {result.errors.map((e) => <p key={`${e.index}-${e.name}`} className="text-[#b23b3b] dark:text-[#f08c8c]">{e.name} — {e.error}</p>)}
            </div>
          )}

          {plan && !result && (
            <>
              <div className="flex flex-wrap gap-2 text-[12px] font-semibold">
                <span className="inline-flex items-center h-7 px-3 rounded-full bg-cream-300/70 dark:bg-white/10 text-muted dark:text-[#a8a293]">
                  <Trans>{plan.lab}: {plan.siteCount} on the site, {plan.labCount} in Druid</Trans>
                </span>
                {plan.source && <span className="inline-flex items-center h-7 px-3 rounded-full bg-cream-300/70 dark:bg-white/10 text-muted dark:text-[#a8a293]">{plan.source}</span>}
              </div>

              {plan.creations.length > 0 && (
                <div className={panel}>
                  <div className={`${panelHead} text-[#1f7a4d] dark:text-[#5fd39a] bg-[rgba(46,160,102,.12)]`}>
                    <UserPlus className="w-3.5 h-3.5" /> <Plural value={plan.creations.length} one="# person to create (not validated)" other="# people to create (not validated)" />
                  </div>
                  <div className="max-h-56 overflow-auto divide-y divide-ink/5 dark:divide-white/5">
                    {plan.creations.map((c) => (
                      <label key={c.index} className={`${row} cursor-pointer hover:bg-accent/10`}>
                        <input type="checkbox" className={box} checked={creations.has(c.index)} onChange={() => toggle(creations, c.index, setCreations)} />
                        <span className="flex-1">
                          <span className="font-semibold">{who(c.person)}</span>
                          <span className="text-muted dark:text-[#a8a293]"> · {[c.person.team, c.employer, c.grade || c.employmentType || c.person.position].filter(Boolean).join(' · ')}</span>
                          {c.sameEmailLabs.length > 0 && (
                            <span className="block text-[12px] text-[#9a6a12] dark:text-[#f0c266]"><Trans>Same email already in {c.sameEmailLabs.join(', ')}: probably the same person (multi-affiliation).</Trans></span>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                  <label className="flex items-center gap-2 px-4 py-2 border-t border-ink/5 dark:border-white/5 text-[12.5px] font-semibold text-ink dark:text-[#f5f2ea] cursor-pointer">
                    <input type="checkbox" className={box} checked={validateNew} onChange={(e) => setValidateNew(e.target.checked)} />
                    <Trans>Validate the created records too (the site is a reliable list)</Trans>
                  </label>
                </div>
              )}

              {withComplements.length > 0 && (
                <div className={panel}>
                  <div className={`${panelHead} text-ink dark:text-[#f5f2ea] bg-white/50 dark:bg-white/5`}>
                    <PenLine className="w-3.5 h-3.5" /> <Plural value={withComplements.length} one="# record to complete (empty fields)" other="# records to complete (empty fields)" />
                  </div>
                  <div className="max-h-56 overflow-auto divide-y divide-ink/5 dark:divide-white/5">
                    {withComplements.map((m) => (
                      <div key={m.index} className={row}>
                        <span className="w-48 shrink-0 font-semibold">{m.name}</span>
                        <span className="flex-1 flex flex-wrap gap-x-4 gap-y-1">
                          {m.complements.map((c) => (
                            <label key={c.field} className="inline-flex items-center gap-1.5 cursor-pointer" title={c.value}>
                              <input type="checkbox" className={box} checked={fields.has(fieldKey(m.index, c.field))} onChange={() => toggle(fields, fieldKey(m.index, c.field), setFields)} />
                              {t(FIELD_LABELS[c.field])}
                            </label>
                          ))}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {withDifferences.length > 0 && (
                <div className={panel}>
                  <div className={`${panelHead} text-[#9a6a12] dark:text-[#f0c266] bg-[rgba(224,158,42,.14)] flex-wrap`}>
                    <AlertTriangle className="w-3.5 h-3.5" /> <Plural value={withDifferences.length} one="# record differs from the site — tick where the site is right" other="# records differ from the site — tick where the site is right" />
                    <span className="flex-1" />
                    {differenceFields.map((f) => (
                      <label key={f} className="inline-flex items-center gap-1 cursor-pointer">
                        <input type="checkbox" className={box} checked={allTicked(keysOfField(f))} onChange={(e) => setMany(keysOfField(f), e.target.checked)} />
                        <Trans>all: {t(FIELD_LABELS[f])}</Trans>
                      </label>
                    ))}
                  </div>
                  <div className="max-h-64 overflow-auto divide-y divide-ink/5 dark:divide-white/5">
                    {withDifferences.map((m) => (
                      <div key={m.index} className={row}>
                        <span className="w-48 shrink-0 font-semibold">{m.name}</span>
                        <span className="flex-1 space-y-1">
                          {m.differences.map((d) => (
                            <label key={d.field} className="flex items-start gap-1.5 cursor-pointer">
                              <input type="checkbox" className={box} checked={fields.has(fieldKey(m.index, d.field))} onChange={() => toggle(fields, fieldKey(m.index, d.field), setFields)} />
                              <span><span className="text-muted dark:text-[#a8a293]">{t(FIELD_LABELS[d.field])} :</span> <s className="opacity-60">{d.current}</s> → <span className="font-semibold">{d.site}</span></span>
                            </label>
                          ))}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {toValidate.length > 0 && (
                <div className={panel}>
                  <div className={`${panelHead} text-ink dark:text-[#f5f2ea] bg-white/50 dark:bg-white/5 flex-wrap`}>
                    <ShieldCheck className="w-3.5 h-3.5" /> <Plural value={toValidate.length} one="# member present on the site, not validated" other="# members present on the site, not validated" />
                    <span className="flex-1" />
                    <label className="inline-flex items-center gap-1 cursor-pointer">
                      <input type="checkbox" className={box} checked={toValidate.every((m) => validate.has(m.index))}
                        onChange={(e) => setValidate(e.target.checked ? new Set(toValidate.map((m) => m.index)) : new Set())} />
                      <Trans>validate all</Trans>
                    </label>
                  </div>
                  <div className="max-h-48 overflow-auto divide-y divide-ink/5 dark:divide-white/5">
                    {toValidate.map((m) => (
                      <label key={m.index} className={`${row} cursor-pointer hover:bg-accent/10`}>
                        <input type="checkbox" className={box} checked={validate.has(m.index)} onChange={() => toggle(validate, m.index, setValidate)} />
                        <span className="font-semibold">{m.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {plan.ambiguous.length > 0 && (
                <div className={panel}>
                  <div className={`${panelHead} text-muted dark:text-[#a8a293] bg-white/50 dark:bg-white/5`}>
                    <HelpCircle className="w-3.5 h-3.5" /> <Plural value={plan.ambiguous.length} one="# homonym left out (to handle on the record)" other="# homonyms left out (to handle on the records)" />
                  </div>
                  <div className="max-h-40 overflow-auto divide-y divide-ink/5 dark:divide-white/5">
                    {plan.ambiguous.map((a) => (
                      <div key={a.index} className={row}>
                        <span className="font-semibold">{who(a.person)}</span>
                        <span className="text-muted dark:text-[#a8a293]">→ {a.candidates.map((c) => c.name).join(', ')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {plan.absent.length > 0 && (
                <div className={panel}>
                  <div className={`${panelHead} text-muted dark:text-[#a8a293] bg-white/50 dark:bg-white/5`}>
                    <UserMinus className="w-3.5 h-3.5" /> <Plural value={plan.absent.length} one="# member absent from the site (departure? other spelling?) — nothing is changed" other="# members absent from the site (departures? other spellings?) — nothing is changed" />
                  </div>
                  <div className="max-h-40 overflow-auto divide-y divide-ink/5 dark:divide-white/5">
                    {plan.absent.map((a) => (
                      <div key={a.researcherId} className={row}>
                        <span className="font-semibold">{a.name}</span>
                        <span className="text-muted dark:text-[#a8a293]">{[a.grade, a.team, a.validated ? t`validated` : ''].filter(Boolean).join(' · ')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-ink/5 dark:border-white/5">
          <button onClick={onClose} className="btn-pill">{result ? <Trans>Close</Trans> : <Trans>Cancel</Trans>}</button>
          {plan && !result && (
            <button onClick={() => void apply()} disabled={busy || total === 0}
              className="inline-flex items-center justify-center h-10 px-5 rounded-full font-disp font-semibold text-sm bg-ink text-white hover:bg-black dark:bg-accent dark:text-ink dark:hover:bg-accent-strong shadow-soft transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              <Plural value={total} one="Apply (# record)" other="Apply (# records)" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
