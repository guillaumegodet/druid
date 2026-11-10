import React, { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Lock, Send, Sparkles, X } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import { apiErrorText } from '../../lib/apiErrors';
import { numberLocale } from '../../lib/i18n';
import { getTenantInfo, getUserInfo, isLockedByPlan } from '../../lib/auth';
import { planUnlocking, type PlanFeature } from '../../lib/saas/planFeatures';

/**
 * Plans of a hosted Druid in the interface (druid-internal docs/plan-druid-saas.md, lot 6 b): a feature the plan locks
 * stays visible with what it brings and the plan that unlocks it (`LockedFeature`), « Request a quote » opens
 * `QuoteDialog` (POST /api/tenant/quote: e-mail to DirlaData), and a trial shows `TrialBanner` at the top of the app.
 * The API refuses the routes of a locked feature anyway (functions/api/_middleware.js).
 */

interface OfferPlan { code: string; label: string; seats: number | null; features?: unknown }
let offerCache: Promise<OfferPlan[]> | null = null;
/** The plans of the deployment, cheapest first (one request per page load). */
const loadPlans = (): Promise<OfferPlan[]> => {
  offerCache ??= fetch('/api/tenant/offer').then((r) => (r.ok ? r.json() : { plans: [] })).then((d) => d.plans || []).catch(() => []);
  return offerCache;
};

const FEATURE_TEXT: Record<PlanFeature, { title: MessageDescriptor; body: MessageDescriptor }> = {
  benchmark: {
    title: msg`Benchmark`,
    body: msg`Position your institution and its labs among comparable universities: Leiden ranking, OpenAlex indicators, peers chosen by you.`,
  },
  reports: {
    title: msg`My reports`,
    body: msg`Build reports from the charts of the dashboards, share them with colleagues and export them as PDF — for a lab assessment, a board or a partner.`,
  },
  calls: {
    title: msg`Calls for proposals`,
    body: msg`The open calls of the funding programmes (Horizon Europe, ANR, Region…) matched with the researchers whose publications relate to them.`,
  },
  media: {
    title: msg`Media watch`,
    body: msg`Press mentions of your researchers and a research newsletter built from the latest publications.`,
  },
  ai: {
    title: msg`AI assistants`,
    body: msg`Summaries of reports and a project assistant, with the language model keys of your institution.`,
  },
};

export const QuoteDialog: React.FC<{ onClose: () => void; feature?: PlanFeature | null; plan?: string | null }> = ({ onClose, feature = null, plan = null }) => {
  const { t } = useLingui();
  const [plans, setPlans] = useState<OfferPlan[]>([]);
  const [code, setCode] = useState(plan || 'complete');
  const [researchers, setResearchers] = useState('');
  const [accounts, setAccounts] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { loadPlans().then(setPlans); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const choices = [...plans.filter((p) => p.code !== 'trial').map((p) => ({ code: p.code, label: p.label })), { code: 'onsite', label: t`On site (installed at the institution)` }];
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/tenant/quote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: code, researchers: researchers ? Number(researchers) : null, accounts: accounts ? Number(accounts) : null, message, feature }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setDone(true);
    } catch (err) { setError(apiErrorText(err) || String(err)); } finally { setBusy(false); }
  };
  const field = 'flex flex-col gap-1 text-[12px] font-semibold text-muted dark:text-[#c3beb0]';
  const input = 'input-soft py-1.5 text-sm font-normal';
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm" onClick={onClose}>
      <div className="glass-card-strong w-full max-w-lg max-h-[90vh] overflow-auto p-5 flex flex-col gap-4 bg-white/95 dark:bg-[#33312c]"
        onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={t`Request a quote`}>
        <div className="flex items-center justify-between">
          <h2 className="font-disp font-bold text-xl text-ink dark:text-[#f5f2ea]"><Trans>Request a quote</Trans></h2>
          <button type="button" onClick={onClose} aria-label={t`Close`} className="p-1.5 rounded-lg hover:bg-ink/5 dark:hover:bg-white/10"><X className="w-4 h-4" /></button>
        </div>
        {done ? (
          <div className="flex flex-col gap-3 text-[14px] text-ink dark:text-[#f5f2ea]">
            <p className="flex items-start gap-2"><CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <Trans>Your request is sent. We answer you by e-mail ({getUserInfo().email}) with a quote.</Trans></p>
            <button type="button" onClick={onClose} className="self-end inline-flex items-center h-9 px-4 rounded-full text-sm font-semibold bg-ink text-white dark:bg-[#f5f2ea] dark:text-[#1c1a14]"><Trans>Close</Trans></button>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-3">
            <p className="text-[13px] text-muted dark:text-[#c3beb0]">
              <Trans>Public institutions pay on invoice with a purchase order; the price depends on the number of researchers. Nothing is committed by this request.</Trans>
            </p>
            <label className={field}><Trans>Plan</Trans>
              <select className={input} value={code} onChange={(e) => setCode(e.target.value)}>
                {choices.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className={field}><Trans>Researchers (approx.)</Trans>
                <input className={input} type="number" min={0} max={1000000} value={researchers} onChange={(e) => setResearchers(e.target.value)} />
              </label>
              <label className={field}><Trans>Accounts needed</Trans>
                <input className={input} type="number" min={0} max={100000} value={accounts} onChange={(e) => setAccounts(e.target.value)} />
              </label>
            </div>
            <label className={field}><Trans>Message (optional)</Trans>
              <textarea className={`${input} min-h-[90px] rounded-2xl`} maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)}
                placeholder={t`Context, deadline, who will use Druid…`} />
            </label>
            {error && <p className="text-[13px] font-semibold text-[#b23b3b] dark:text-[#f08c8c]">{error}</p>}
            <button type="submit" disabled={busy} className="self-end inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-sm font-semibold bg-ink text-white dark:bg-[#f5f2ea] dark:text-[#1c1a14] disabled:opacity-50">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} <Trans>Send the request</Trans>
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

/** In place of the content of a feature the plan locks: what it brings, the plan that unlocks it, a quote. */
export const LockedFeature: React.FC<{ feature: PlanFeature }> = ({ feature }) => {
  const { t } = useLingui();
  const [unlocking, setUnlocking] = useState<OfferPlan | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { loadPlans().then((plans) => setUnlocking(planUnlocking(plans, feature))); }, [feature]);
  const text = FEATURE_TEXT[feature];
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="glass-card max-w-lg w-full p-6 flex flex-col gap-3 text-center items-center">
        <div className="w-11 h-11 rounded-full bg-accent/30 flex items-center justify-center"><Lock className="w-5 h-5 text-ink dark:text-[#f5f2ea]" /></div>
        <h3 className="font-disp font-bold text-lg text-ink dark:text-[#f5f2ea]">{t(text.title)}</h3>
        <p className="text-[14px] leading-relaxed text-muted dark:text-[#c3beb0]">{t(text.body)}</p>
        <p className="text-[13px] font-semibold text-ink dark:text-[#f5f2ea]">
          {unlocking ? t`Available with the ${unlocking.label} plan.` : t`Not included in your plan.`}
        </p>
        <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-sm font-semibold bg-ink text-white dark:bg-[#f5f2ea] dark:text-[#1c1a14]">
          <Sparkles className="w-4 h-4" /> <Trans>Request a quote</Trans>
        </button>
      </div>
      {open && <QuoteDialog feature={feature} plan={unlocking?.code ?? null} onClose={() => setOpen(false)} />}
    </div>
  );
};

/** Small lock next to the label of an entry the plan locks. */
export const LockMark: React.FC<{ feature: PlanFeature }> = ({ feature }) =>
  isLockedByPlan(feature) ? <Lock className="w-3 h-3 opacity-70 shrink-0" aria-hidden /> : null;

/** Thin banner of a trial: « Trial — powered by Druid », and the quote; of a planned deletion (lot 6 a-3), its date. */
export const TrialBanner: React.FC = () => {
  const [open, setOpen] = useState(false);
  const deleteAfter = getTenantInfo()?.deleteAfter;
  if (deleteAfter) {
    const day = new Date(deleteAfter).toLocaleDateString(numberLocale(), { day: 'numeric', month: 'long', year: 'numeric' });
    return (
      <div className="mb-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-1.5 rounded-full text-[12px] font-semibold bg-[#b23b3b]/15 text-[#8f2c2c] dark:text-[#f08c8c]">
        <span><Trans>This Druid will be deleted on {day}: it is read-only until then.</Trans></span>
      </div>
    );
  }
  if (getTenantInfo()?.plan?.code !== 'trial') return null;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-1.5 rounded-full text-[12px] font-semibold bg-accent/35 dark:bg-accent/15 text-ink dark:text-[#f0c266]">
        <span><Trans>Trial — powered by Druid</Trans></span>
        <button type="button" onClick={() => setOpen(true)} className="underline underline-offset-2 hover:no-underline"><Trans>Discover the plans</Trans></button>
      </div>
      {open && <QuoteDialog onClose={() => setOpen(false)} />}
    </>
  );
};
