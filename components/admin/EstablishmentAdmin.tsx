import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Globe, Inbox, Loader2, Mail, RefreshCw, Send, Trash2, UserPlus, Users, X } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { apiErrorText } from '../../lib/apiErrors';
import { numberLocale } from '../../lib/i18n';

/**
 * « My institution » tab of the Administration page on a tenant (druid-internal docs/plan-druid-saas.md, lot 6 a-1):
 * the plan and its seats, the members (invite, role, remove), the access requests of colleagues, the mail domains.
 * The owners write, the admins read. API: functions/api/tenant, rules in lib/saas/members.ts.
 */

type Role = 'owner' | 'admin' | 'viewer' | 'lab';
interface MemberView { id: string; email: string; role: Role; labScope: string[]; invitedBy: string | null; createdAt: string; lastLoginAt: string | null; pending: boolean }
interface AccessRequestView { id: string; email: string; note: string | null; createdAt: string }
interface PlanView { code: string; label: string; seats: number | null; historyYears: number | null; refresh: string }
interface TenantView {
  slug: string; label: string; status: string;
  plan: PlanView | null; plans: PlanView[];
  seats: { used: number; allowed: number | null };
  members: MemberView[]; accessRequests: AccessRequestView[]; mailDomains: string[];
  me: { email: string; role: Role };
}

const ROLES: Role[] = ['owner', 'admin', 'viewer', 'lab'];
const inputCls = 'input-soft py-1.5 text-sm font-normal';
const btnDark = 'inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-xs font-semibold bg-ink text-white dark:bg-[#f5f2ea] dark:text-[#1c1a14] disabled:opacity-50';
const btnLight = 'inline-flex items-center gap-1 h-7 px-3 rounded-full text-[11.5px] font-semibold bg-white/70 dark:bg-white/10 border border-ink/10 dark:border-white/15 text-ink dark:text-[#f5f2ea] hover:bg-white dark:hover:bg-white/15 disabled:opacity-50';

const send = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(`/api/tenant${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
};

const labsOf = (text: string) => text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);

export const EstablishmentAdmin: React.FC = () => {
  const { t } = useLingui();
  const [data, setData] = useState<TenantView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('viewer');
  const [labs, setLabs] = useState('');
  const [domains, setDomains] = useState('');

  const roleLabel: Record<Role, string> = { owner: t`Owner`, admin: t`Administrator`, viewer: t`Reader`, lab: t`Lab account` };
  const roleHint: Record<Role, string> = {
    owner: t`Everything, including the accounts and the plan`,
    admin: t`Writes in the directory, runs the alignments and the dashboards`,
    viewer: t`Reads everything, writes nothing`,
    lab: t`Reads and writes its labs only`,
  };
  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(numberLocale()) : '');

  const load = async () => {
    try {
      const d = await send('GET', '') as TenantView;
      setData(d); setDomains(d.mailDomains.join(', ')); setError(null);
    } catch (e) { setError(apiErrorText(e) || String(e)); }
  };
  useEffect(() => { load(); }, []);

  /** Runs a write, shows its outcome, reloads; true when it succeeded. */
  const act = async (fn: () => Promise<unknown>, ok?: (r: any) => string | null): Promise<boolean> => {
    setBusy(true); setNotice(null); setError(null);
    try { const r = await fn(); setNotice(ok ? ok(r) : null); await load(); return true; } catch (e) { setError(apiErrorText(e) || String(e)); return false; } finally { setBusy(false); }
  };
  /** What the invitation call says: e-mail sent, or the link to hand over when no e-mail could leave. */
  const invited = (who: string) => (r: { sent?: boolean; loginUrl?: string }) =>
    r.sent ? t`Invitation sent to ${who}.` : t`${who} is a member; no e-mail could be sent — send them this link: ${r.loginUrl ?? ''}`;

  if (!data) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-muted dark:text-[#c3beb0] py-10 justify-center">
        {error ? <><AlertCircle className="w-4 h-4 text-[#b23b3b]" /> {error}</> : <><RefreshCw className="w-4 h-4 animate-spin" /> <Trans>Loading…</Trans></>}
      </div>
    );
  }
  const owner = data.me.role === 'owner' && data.status === 'active';
  const full = data.seats.allowed !== null && data.seats.used >= data.seats.allowed;
  const otherOwners = data.members.filter((m) => m.role === 'owner').length;

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      {/* ── Plan and seats ─────────────────────────────────────────────── */}
      <div className="glass-card p-4 flex flex-wrap items-center gap-x-8 gap-y-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted dark:text-[#c3beb0]"><Trans>Plan</Trans></div>
          <div className="font-disp font-bold text-lg text-ink dark:text-[#f5f2ea]">{data.plan?.label ?? '—'}</div>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted dark:text-[#c3beb0]"><Trans>Accounts</Trans></div>
          <div className={`font-disp font-bold text-lg ${full ? 'text-[#b3441f] dark:text-[#e08a6a]' : 'text-ink dark:text-[#f5f2ea]'}`}>
            {data.seats.allowed === null ? t`${data.seats.used} (unlimited)` : `${data.seats.used} / ${data.seats.allowed}`}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted dark:text-[#c3beb0]"><Trans>Publication history</Trans></div>
          <div className="font-disp font-bold text-lg text-ink dark:text-[#f5f2ea]">{data.plan?.historyYears ? t`${data.plan.historyYears} years` : t`Complete`}</div>
        </div>
        {full && (
          <p className="basis-full text-[12px] text-muted dark:text-[#c3beb0]">
            <Trans>Every account of the plan is used. The Team and Complete plans add accounts: ask DirlaData for a quote.</Trans>
          </p>
        )}
        {data.status !== 'active' && (
          <p className="basis-full text-[12px] font-semibold text-[#8a6113] dark:text-[#f0c266]"><Trans>This Druid is suspended: it can be read, nothing can be changed.</Trans></p>
        )}
      </div>

      {(error || notice) && (
        <div className={`flex items-start gap-2 text-[13px] ${error ? 'text-[#b23b3b] dark:text-[#f08c8c]' : 'text-emerald-700 dark:text-emerald-300'}`}>
          {error ? <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> : <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />}
          <span className="break-all">{error || notice}</span>
        </div>
      )}

      {/* ── Access requests ────────────────────────────────────────────── */}
      {data.accessRequests.length > 0 && (
        <div className="glass-card p-4 flex flex-col gap-3">
          <h4 className="font-disp font-semibold text-[14px] text-ink dark:text-[#f5f2ea] flex items-center gap-2">
            <Inbox className="w-4 h-4" /> <Trans>Access requests ({data.accessRequests.length})</Trans>
          </h4>
          {data.accessRequests.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="font-semibold text-ink dark:text-[#f5f2ea]">{r.email}</span>
              <span className="text-[11.5px] text-muted dark:text-[#8f897c]">{date(r.createdAt)}</span>
              <div className="flex-1" />
              {owner && (
                <>
                  <button type="button" className={btnLight} disabled={busy || full} title={full ? t`Every account of the plan is used` : undefined}
                    onClick={() => act(() => send('POST', `/access-requests/${r.id}/accept`, { role: 'viewer' }), invited(r.email))}>
                    <UserPlus className="w-3.5 h-3.5" /> <Trans>Invite as reader</Trans>
                  </button>
                  <button type="button" className={btnLight} disabled={busy} onClick={() => act(() => send('POST', `/access-requests/${r.id}/dismiss`))}>
                    <X className="w-3.5 h-3.5" /> <Trans>Dismiss</Trans>
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Members ────────────────────────────────────────────────────── */}
      <div className="glass-card p-4 flex flex-col gap-3">
        <h4 className="font-disp font-semibold text-[14px] text-ink dark:text-[#f5f2ea] flex items-center gap-2">
          <Users className="w-4 h-4" /> <Trans>Members ({data.members.length})</Trans>
        </h4>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-muted dark:text-[#c3beb0] border-b border-white/60 dark:border-white/10">
                <th className="py-1.5 pr-3 font-semibold"><Trans>E-mail</Trans></th>
                <th className="py-1.5 pr-3 font-semibold"><Trans>Role</Trans></th>
                <th className="py-1.5 pr-3 font-semibold"><Trans>Labs</Trans></th>
                <th className="py-1.5 pr-3 font-semibold"><Trans>Last sign-in</Trans></th>
                <th className="py-1.5 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => {
                const lastOwner = m.role === 'owner' && otherOwners <= 1;
                return (
                  <tr key={m.id} className="border-b border-white/40 dark:border-white/5 align-middle">
                    <td className="py-1.5 pr-3 font-semibold text-ink dark:text-[#f5f2ea]">{m.email}{m.email === data.me.email && <span className="ml-1 text-muted font-normal">(<Trans>you</Trans>)</span>}</td>
                    <td className="py-1.5 pr-3">
                      {owner && !lastOwner ? (
                        <select className={`${inputCls} !w-auto`} value={m.role} disabled={busy} aria-label={t`Role of ${m.email}`}
                          onChange={(e) => {
                            const next = e.target.value as Role;
                            const scope = next === 'lab' ? labsOf(window.prompt(t`Labs of this account (acronyms, separated by commas)`, m.labScope.join(', ')) || '') : [];
                            if (next === 'lab' && !scope.length) return;
                            act(() => send('PATCH', `/members/${m.id}`, { role: next, labScope: scope }));
                          }}>
                          {ROLES.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
                        </select>
                      ) : roleLabel[m.role]}
                    </td>
                    <td className="py-1.5 pr-3 text-muted dark:text-[#c3beb0]">{m.role === 'lab' ? m.labScope.join(', ') : '—'}</td>
                    <td className="py-1.5 pr-3 text-muted dark:text-[#c3beb0]">{m.pending ? <span className="font-semibold text-[#8a6113] dark:text-[#f0c266]"><Trans>Invited, never signed in</Trans></span> : date(m.lastLoginAt)}</td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      {owner && m.pending && (
                        <button type="button" className={btnLight} disabled={busy} onClick={() => act(() => send('POST', `/members/${m.id}/resend`), invited(m.email))}>
                          <Send className="w-3.5 h-3.5" /> <Trans>Resend</Trans>
                        </button>
                      )}
                      {owner && !lastOwner && m.email !== data.me.email && (
                        <button type="button" className={`${btnLight} ml-1`} disabled={busy} aria-label={t`Remove ${m.email}`}
                          onClick={() => { if (window.confirm(t`Remove ${m.email} from this Druid? Their sessions are closed at once.`)) act(() => send('DELETE', `/members/${m.id}`)); }}>
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {owner && (
          <form className="flex flex-wrap items-end gap-2 pt-2 border-t border-white/60 dark:border-white/10"
            onSubmit={(e) => {
              e.preventDefault();
              const who = email.trim();
              act(() => send('POST', '/members', { email: who, role, labScope: role === 'lab' ? labsOf(labs) : [] }), invited(who)).then((done) => { if (done) { setEmail(''); setLabs(''); } });
            }}>
            <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-muted dark:text-[#c3beb0]">
              <Trans>Invite a colleague</Trans>
              <input type="email" required className={`${inputCls} w-64`} value={email} placeholder="prenom.nom@example.org" onChange={(e) => setEmail(e.target.value)} disabled={full} />
            </label>
            <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-muted dark:text-[#c3beb0]">
              <Trans>Role</Trans>
              <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={full} title={roleHint[role]}>
                {ROLES.map((r) => <option key={r} value={r}>{roleLabel[r]}</option>)}
              </select>
            </label>
            {role === 'lab' && (
              <label className="flex flex-col gap-1 text-[11.5px] font-semibold text-muted dark:text-[#c3beb0]">
                <Trans>Labs (acronyms)</Trans>
                <input className={`${inputCls} w-48`} value={labs} placeholder="LS2N, GeM" onChange={(e) => setLabs(e.target.value)} required />
              </label>
            )}
            <button type="submit" className={btnDark} disabled={busy || full || !email.trim()}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />} <Trans>Invite</Trans>
            </button>
            <p className="basis-full text-[11.5px] text-muted dark:text-[#8f897c]">{roleHint[role]}</p>
          </form>
        )}
      </div>

      {/* ── Mail domains ───────────────────────────────────────────────── */}
      <div className="glass-card p-4 flex flex-col gap-3">
        <h4 className="font-disp font-semibold text-[14px] text-ink dark:text-[#f5f2ea] flex items-center gap-2">
          <Globe className="w-4 h-4" /> <Trans>Mail domains of the institution</Trans>
        </h4>
        <p className="text-[11.5px] text-muted dark:text-[#c3beb0] -mt-1">
          <Trans>A colleague with an address of these domains who asks for a sign-in link without an account sends you an access request (you receive an e-mail).</Trans>
        </p>
        {owner ? (
          <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); act(() => send('PUT', '/mail-domains', { mailDomains: labsOf(domains) }), () => t`Mail domains saved.`); }}>
            <input className={`${inputCls} w-96`} value={domains} placeholder="univ-exemple.fr, etu.univ-exemple.fr" onChange={(e) => setDomains(e.target.value)} aria-label={t`Mail domains of the institution`} />
            <button type="submit" className={btnDark} disabled={busy}><Trans>Save</Trans></button>
          </form>
        ) : (
          <p className="text-[13px] text-ink dark:text-[#f5f2ea]">{data.mailDomains.join(', ') || '—'}</p>
        )}
      </div>
    </div>
  );
};
