import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, KeyRound, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { apiErrorText } from '../../lib/apiErrors';
import { numberLocale } from '../../lib/i18n';

/**
 * « API keys » card of « My institution » on a tenant (druid-internal docs/plan-druid-saas.md, decision D7 and lot 6 a-2):
 * the language model of the establishment (any OpenAI-compatible service) and its Elsevier keys, tested at entry,
 * stored encrypted. The keys are never shown back — only whether they are set and the outcome of the last test.
 * API: functions/api/tenant (keys), rules in lib/saas/clientKeys.ts.
 */

type Group = 'llm' | 'scopus';
interface Check { ok: boolean; code: string; detail: string | null; checkedAt?: string; checkedBy?: string | null }
interface GroupView { set: Record<string, boolean>; values: Record<string, string>; check: Check | null }
interface KeysView { available: boolean; groups: Record<Group, GroupView> }

const inputCls = 'input-soft py-1.5 text-sm font-normal';
const btnDark = 'inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-xs font-semibold bg-ink text-white dark:bg-[#f5f2ea] dark:text-[#1c1a14] disabled:opacity-50';
const btnLight = 'inline-flex items-center gap-1 h-7 px-3 rounded-full text-[11.5px] font-semibold bg-white/70 dark:bg-white/10 border border-ink/10 dark:border-white/15 text-ink dark:text-[#f5f2ea] hover:bg-white dark:hover:bg-white/15 disabled:opacity-50';
const labelCls = 'flex flex-col gap-1 text-[11.5px] font-semibold text-muted dark:text-[#c3beb0]';

/** Answer of the keys API, with the 409 of a failed test kept as data (it carries the outcome). */
const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`/api/tenant/keys${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 409) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
};

export const ClientKeys: React.FC<{ owner: boolean }> = ({ owner }) => {
  const { t } = useLingui();
  const [data, setData] = useState<KeysView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Group | null>(null);
  // Outcome of a failed test of what was just typed (nothing stored): offers « Save anyway ».
  const [failed, setFailed] = useState<Partial<Record<Group, Check>>>({});
  const [llm, setLlm] = useState({ apiBase: '', model: '', apiKey: '' });
  const [scopus, setScopus] = useState({ apiKey: '', instToken: '', apiKey2: '', instToken2: '' });

  const load = async () => {
    try {
      const d = await call('GET', '') as KeysView;
      setData(d); setError(null);
      setLlm((v) => ({ ...v, apiBase: d.groups.llm.values.ILAAS_API_BASE || '', model: d.groups.llm.values.ILAAS_MODEL || '', apiKey: '' }));
      setScopus({ apiKey: '', instToken: '', apiKey2: '', instToken2: '' });
    } catch (e) { setError(apiErrorText(e) || String(e)); }
  };
  useEffect(() => { load(); }, []);

  const codeText: Record<string, string> = {
    ok: t`Working`,
    invalid_key: t`Key refused by the service`,
    not_entitled: t`Key recognized but not authorized from outside your institution's network: ask Elsevier for an institution token (insttoken) and enter it below`,
    model_not_found: t`Model unknown to this service`,
    quota: t`Quota exceeded (the key is recognized)`,
    unreachable: t`Service unreachable at this address`,
    http_error: t`Unexpected answer from the service`,
  };
  const date = (iso?: string) => (iso ? new Date(iso).toLocaleString(numberLocale(), { dateStyle: 'short', timeStyle: 'short' }) : '');

  const run = async (group: Group, fn: () => Promise<any>) => {
    setBusy(group); setError(null);
    try {
      const r = await fn();
      setFailed((f) => ({ ...f, [group]: r?.stored === false ? r.check : undefined }));
      if (r?.stored !== false) await load();
    } catch (e) { setError(apiErrorText(e) || String(e)); } finally { setBusy(null); }
  };
  const save = (group: Group, force = false) => run(group, () => {
    if (group === 'llm') return call('PUT', '/llm', { ...llm, force });
    const s = data!.groups.scopus.set;
    return call('PUT', '/scopus', {
      ...scopus, force,
      // A field left empty keeps what is stored (the keys are never shown back).
      keepInstToken: s.SCOPUS_INST_TOKEN, keepApiKey2: s.SCOPUS_API_KEY_2, keepInstToken2: s.SCOPUS_INST_TOKEN_2,
    });
  });

  if (!data) {
    return error ? (
      <div className="glass-card p-4 flex items-center gap-2 text-[13px] text-[#b23b3b] dark:text-[#f08c8c]"><AlertCircle className="w-4 h-4" /> {error}</div>
    ) : null;
  }
  const canWrite = owner && data.available;

  const status = (group: Group) => {
    const g = data.groups[group];
    const main = group === 'llm' ? g.set.ILAAS_API_KEY : g.set.SCOPUS_API_KEY;
    if (!main) return <span className="text-[12px] text-muted dark:text-[#8f897c]"><Trans>Not configured</Trans></span>;
    if (!g.check) return <span className="text-[12px] text-muted dark:text-[#8f897c]"><Trans>Configured, not tested</Trans></span>;
    return (
      <span className={`inline-flex items-start gap-1 text-[12px] ${g.check.ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-[#b3441f] dark:text-[#e08a6a]'}`}>
        {g.check.ok ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />}
        <span>
          {codeText[g.check.code] ?? g.check.code}
          {g.check.detail && !g.check.ok && <span className="text-muted dark:text-[#8f897c]"> — {g.check.detail}</span>}
          <span className="text-muted dark:text-[#8f897c]"> · <Trans>tested on {date(g.check.checkedAt)}</Trans></span>
        </span>
      </span>
    );
  };

  /** Buttons of a group: save (tests first), test again, remove; « Save anyway » after a failed test. */
  const actions = (group: Group, ready: boolean) => {
    const g = data.groups[group];
    const main = group === 'llm' ? g.set.ILAAS_API_KEY : g.set.SCOPUS_API_KEY;
    const f = failed[group];
    return (
      <div className="basis-full flex flex-wrap items-center gap-2">
        <button type="submit" className={btnDark} disabled={!!busy || !ready}>
          {busy === group ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />} <Trans>Test and save</Trans>
        </button>
        {main && (
          <button type="button" className={btnLight} disabled={!!busy} onClick={() => run(group, () => call('POST', `/${group}/test`))}>
            <RefreshCw className="w-3.5 h-3.5" /> <Trans>Test again</Trans>
          </button>
        )}
        {main && (
          <button type="button" className={btnLight} disabled={!!busy}
            onClick={() => { if (window.confirm(t`Remove these keys? The features that use them stop at once.`)) run(group, () => call('DELETE', `/${group}`)); }}>
            <Trash2 className="w-3.5 h-3.5" /> <Trans>Remove</Trans>
          </button>
        )}
        {f && (
          <div className="basis-full flex flex-wrap items-center gap-2 text-[12px] text-[#b3441f] dark:text-[#e08a6a]">
            <AlertCircle className="w-3.5 h-3.5" />
            <span><Trans>Test failed, nothing was saved:</Trans> {codeText[f.code] ?? f.code}{f.detail ? ` — ${f.detail}` : ''}</span>
            <button type="button" className={btnLight} disabled={!!busy} onClick={() => save(group, true)}><Trans>Save anyway</Trans></button>
          </div>
        )}
      </div>
    );
  };

  const keyPlaceholder = (stored: boolean) => (stored ? t`•••• stored — leave empty to keep it` : '');

  return (
    <div className="glass-card p-4 flex flex-col gap-4">
      <h4 className="font-disp font-semibold text-[14px] text-ink dark:text-[#f5f2ea] flex items-center gap-2">
        <KeyRound className="w-4 h-4" /> <Trans>API keys of the institution</Trans>
      </h4>
      <p className="text-[11.5px] text-muted dark:text-[#c3beb0] -mt-2">
        <Trans>Druid uses your institution's own services: the language model writes the AI texts of the reports and runs the thematic search of the collaborations; the Elsevier key opens the Scopus alignment. The keys are tested when you save them, stored encrypted and never shown again.</Trans>
      </p>
      {!data.available && (
        <p className="text-[12px] font-semibold text-[#8a6113] dark:text-[#f0c266]"><Trans>Key storage is not enabled on this server yet: contact the host of your Druid.</Trans></p>
      )}
      {error && <div className="flex items-start gap-2 text-[13px] text-[#b23b3b] dark:text-[#f08c8c]"><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}</div>}

      {/* ── Language model ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-semibold text-[13px] text-ink dark:text-[#f5f2ea]"><Trans>Language model (OpenAI-compatible service)</Trans></span>
          {status('llm')}
        </div>
        {canWrite ? (
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); save('llm'); }}>
            <label className={labelCls}>
              <Trans>Address of the API</Trans>
              <input className={`${inputCls} w-72`} value={llm.apiBase} placeholder="https://api.mistral.ai/v1" onChange={(e) => setLlm({ ...llm, apiBase: e.target.value })} />
            </label>
            <label className={labelCls}>
              <Trans>Model</Trans>
              <input className={`${inputCls} w-56`} value={llm.model} placeholder="mistral-small-latest" onChange={(e) => setLlm({ ...llm, model: e.target.value })} />
            </label>
            <label className={labelCls}>
              <Trans>API key</Trans>
              <input type="password" autoComplete="off" className={`${inputCls} w-72`} value={llm.apiKey} placeholder={keyPlaceholder(data.groups.llm.set.ILAAS_API_KEY)} onChange={(e) => setLlm({ ...llm, apiKey: e.target.value })} />
            </label>
            {actions('llm', !!llm.apiKey.trim() || data.groups.llm.set.ILAAS_API_KEY)}
          </form>
        ) : data.groups.llm.set.ILAAS_API_KEY && (
          <p className="text-[12.5px] text-ink dark:text-[#f5f2ea]">{data.groups.llm.values.ILAAS_API_BASE} · {data.groups.llm.values.ILAAS_MODEL}</p>
        )}
      </div>

      {/* ── Elsevier ───────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 pt-3 border-t border-white/60 dark:border-white/10">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-semibold text-[13px] text-ink dark:text-[#f5f2ea]"><Trans>Elsevier (Scopus alignment)</Trans></span>
          {status('scopus')}
        </div>
        {canWrite && (
          <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); save('scopus'); }}>
            <label className={labelCls}>
              <Trans>API key</Trans>
              <input type="password" autoComplete="off" className={`${inputCls} w-72`} value={scopus.apiKey} placeholder={keyPlaceholder(data.groups.scopus.set.SCOPUS_API_KEY)} onChange={(e) => setScopus({ ...scopus, apiKey: e.target.value })} />
            </label>
            <label className={labelCls}>
              <Trans>Institution token (optional)</Trans>
              <input type="password" autoComplete="off" className={`${inputCls} w-72`} value={scopus.instToken} placeholder={keyPlaceholder(data.groups.scopus.set.SCOPUS_INST_TOKEN)} onChange={(e) => setScopus({ ...scopus, instToken: e.target.value })} />
            </label>
            <details className="basis-full text-[12px] text-muted dark:text-[#c3beb0]">
              <summary className="cursor-pointer font-semibold"><Trans>Backup key (used once the weekly quota of the first one is reached)</Trans></summary>
              <div className="flex flex-wrap items-end gap-2 pt-2">
                <label className={labelCls}>
                  <Trans>Backup API key</Trans>
                  <input type="password" autoComplete="off" className={`${inputCls} w-72`} value={scopus.apiKey2} placeholder={keyPlaceholder(data.groups.scopus.set.SCOPUS_API_KEY_2)} onChange={(e) => setScopus({ ...scopus, apiKey2: e.target.value })} />
                </label>
                <label className={labelCls}>
                  <Trans>Its institution token</Trans>
                  <input type="password" autoComplete="off" className={`${inputCls} w-72`} value={scopus.instToken2} placeholder={keyPlaceholder(data.groups.scopus.set.SCOPUS_INST_TOKEN_2)} onChange={(e) => setScopus({ ...scopus, instToken2: e.target.value })} />
                </label>
              </div>
            </details>
            {actions('scopus', !!scopus.apiKey.trim() || data.groups.scopus.set.SCOPUS_API_KEY)}
          </form>
        )}
      </div>
    </div>
  );
};
