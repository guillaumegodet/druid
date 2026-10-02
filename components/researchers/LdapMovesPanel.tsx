import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, RotateCw, UserPlus, UserMinus, AlertTriangle, CheckCircle2, CalendarClock } from 'lucide-react';
import { Trans, Plural, useLingui } from '@lingui/react/macro';
import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import type { Researcher, Structure } from '../../types';
import {
  LdapMoves, LdapAccountState, LdapDeparture, buildArrivals, buildDepartures, defaultSince, fetchLdapMoves,
  DEFAULT_HIDDEN_CATEGORIES,
} from '../../lib/ldapMoves';
import { formatFuzzyDate } from '../../lib/dates';
import { usePersistedState } from '../../lib/usePersistedState';
import { StatusBadge } from './StatusBadge';
import { PixelBtn } from './alignAtoms';

/**
 * « Arrivals and departures » tab of the LDAP alignment page: staff accounts created since a date
 * (no Annuaire record yet → « Create » opens the creation form filled from LDAP) and records whose
 * account left since that date (→ « Mark as left »). Live LDAP search (GET /api/ldap/moves), kept
 * in memory for the session so coming back from the creation form does not search again.
 */

type MovesView = 'arrivals' | 'departures';

interface Props {
  researchers: Researcher[];
  structures: Structure[];
  /** Opens the creation form for this uid, filled from LDAP (absent = read-only right). */
  onCreate?: (uid: string) => void;
  onOpenResearcher: (researcher: Researcher) => void;
  /** Writes the departure on the uid's rows (absent = read-only right). */
  onMarkDeparted?: (departure: LdapDeparture, accountLabel: string) => Promise<void>;
}

/** Last search of the session (survives the unmount while the creation form is open). */
let lastMoves: LdapMoves | null = null;

const ACCOUNT_LABEL = (acc: LdapAccountState | null): MessageDescriptor => {
  if (acc?.state === 'A') return msg`Grace period`;
  if (acc?.state === 'S') return msg`Locked`;
  return msg`Inactive`;
};

const Chip: React.FC<{ children: React.ReactNode; title?: string }> = ({ children, title }) => (
  <span title={title} className="px-2 py-0.5 rounded-full bg-white/60 dark:bg-white/5 border border-ink/10 dark:border-white/10 text-[11px] font-semibold text-muted dark:text-[#8f897c] whitespace-nowrap">{children}</span>
);

const th = 'px-3 py-2 text-left text-[10.5px] font-bold uppercase tracking-[.06em] text-muted-lighter dark:text-[#8f897c] whitespace-nowrap';
const td = 'px-3 py-2 align-top text-[12.5px] text-ink dark:text-[#e7e2d6]';

export const LdapMovesPanel: React.FC<Props> = ({ researchers, structures, onCreate, onOpenResearcher, onMarkDeparted }) => {
  const { t } = useLingui();
  const [since, setSince] = usePersistedState<string>('druid.ldapMoves.since', defaultSince());
  const [view, setView] = usePersistedState<MovesView>('druid.ldapMoves.view', 'arrivals');
  const [hiddenCats, setHiddenCats] = usePersistedState<string[]>('druid.ldapMoves.hiddenCategories', DEFAULT_HIDDEN_CATEGORIES);
  const [labOnly, setLabOnly] = usePersistedState<boolean>('druid.ldapMoves.labOnly', false);
  const [moves, setMoves] = useState<LdapMoves | null>(lastMoves);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<Record<string, 'saving' | 'done' | string>>({});
  const requestRef = useRef(0);

  const load = async (date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const id = ++requestRef.current;
    setLoading(true);
    setError('');
    try {
      const data = await fetchLdapMoves(date);
      if (id !== requestRef.current) return;
      lastMoves = data;
      setMoves(data);
    } catch (e) {
      if (id === requestRef.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === requestRef.current) setLoading(false);
    }
  };
  useEffect(() => {
    if (!lastMoves || lastMoves.since !== since) void load(since);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [since]);

  const arrivals = useMemo(() => buildArrivals(moves?.arrivals ?? [], researchers, structures), [moves, researchers, structures]);
  const departures = useMemo(() => buildDepartures(moves?.departures ?? [], researchers), [moves, researchers]);
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of arrivals) if (!labOnly || a.labs.length) counts.set(a.categorie || '', (counts.get(a.categorie || '') || 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [arrivals, labOnly]);
  const hidden = new Set(hiddenCats);
  const shownArrivals = arrivals.filter((a) => !hidden.has(a.categorie || '') && (!labOnly || a.labs.length));
  const toggleCat = (c: string) => setHiddenCats(hidden.has(c) ? hiddenCats.filter((x) => x !== c) : [...hiddenCats, c]);

  const markDeparted = async (d: LdapDeparture) => {
    if (!onMarkDeparted) return;
    const key = d.researcher.id;
    setBusy((b) => ({ ...b, [key]: 'saving' }));
    try {
      await onMarkDeparted(d, t(ACCOUNT_LABEL(d.person.account)));
      setBusy((b) => ({ ...b, [key]: 'done' }));
    } catch (e) {
      setBusy((b) => ({ ...b, [key]: e instanceof Error ? e.message : String(e) }));
    }
  };

  const tabBtn = (v: MovesView, icon: React.ReactNode, label: React.ReactNode) => (
    <button onClick={() => setView(v)}
      className={`inline-flex items-center gap-1.5 h-9 px-4 rounded-full font-disp text-[13px] font-semibold transition-colors ${view === v ? 'bg-ink text-white dark:bg-accent dark:text-ink' : 'bg-white/60 dark:bg-white/5 border border-ink/10 dark:border-white/10 text-muted dark:text-[#8f897c] hover:bg-white dark:hover:bg-white/10'}`}>
      {icon}{label}
    </button>
  );

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto px-4 md:px-7 py-4 space-y-4" data-page-scroll>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-bold uppercase tracking-[.06em] text-muted-lighter dark:text-[#8f897c]"><Trans>Since</Trans></span>
            <input type="date" value={since} max={new Date().toISOString().slice(0, 10)} onChange={(e) => e.target.value && setSince(e.target.value)} className="input-soft h-10" />
          </label>
          <PixelBtn onClick={() => void load(since)} disabled={loading} title={t`Search the LDAP directory again`}>
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />}
            {loading ? t`Searching LDAP…` : t`Refresh`}
          </PixelBtn>
          <div className="flex-1" />
          {tabBtn('arrivals', <UserPlus className="w-4 h-4" />, <Trans>Arrivals ({shownArrivals.length})</Trans>)}
          {tabBtn('departures', <UserMinus className="w-4 h-4" />, <Trans>Departures ({departures.length})</Trans>)}
        </div>

        {error && (
          <p className="flex items-start gap-1.5 text-[13px] font-semibold text-[#b3261e] dark:text-[#f2b8b5]">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{error}
          </p>
        )}
        {!moves && loading && (
          <div className="flex flex-col items-center justify-center py-24 text-muted-faint gap-3">
            <RefreshCw className="w-8 h-8 animate-spin" />
            <p className="text-[13px] font-semibold text-muted dark:text-[#8f897c]"><Trans>Searching LDAP…</Trans></p>
          </div>
        )}

        {moves && view === 'arrivals' && (
          <section className="space-y-3">
            <p className="text-[12.5px] text-muted-light dark:text-[#8f897c]">
              <Trans>Staff accounts created in LDAP since {formatFuzzyDate(moves.since)}, and pre-created accounts (arrival to come), without a Directory record. A person returning with their former account does not appear here.</Trans>
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {categories.map(([c, n]) => (
                <button key={c || '∅'} onClick={() => toggleCat(c)}
                  className={`px-2.5 py-1 rounded-full text-[11.5px] font-semibold border transition-colors ${hidden.has(c) ? 'border-ink/10 dark:border-white/10 text-muted-faint line-through' : 'bg-accent/30 dark:bg-accent/15 border-accent-strong/50 text-ink dark:text-[#f5f2ea]'}`}>
                  {c || t`No category`} · {n}
                </button>
              ))}
              <label className="ml-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-muted dark:text-[#8f897c] cursor-pointer">
                <input type="checkbox" checked={labOnly} onChange={(e) => setLabOnly(e.target.checked)} />
                <Trans>Assigned to a lab only</Trans>
              </label>
            </div>
            {shownArrivals.length === 0 ? (
              <p className="text-[13px] text-muted-faint"><Trans>No new arrival without a record for these categories.</Trans></p>
            ) : (
              <div className="overflow-x-auto rounded-card border border-ink/5 dark:border-white/10 bg-white/50 dark:bg-white/[.03]">
                <table className="min-w-full">
                  <thead className="border-b border-ink/5 dark:border-white/10">
                    <tr>
                      <th className={th}><Trans>Name</Trans></th>
                      <th className={th}><Trans>Category</Trans></th>
                      <th className={th}><Trans>Principal affectation</Trans></th>
                      <th className={th}><Trans>Lab</Trans></th>
                      <th className={th}><Trans>Account created</Trans></th>
                      <th className={th}><Trans>Contract end</Trans></th>
                      {onCreate && <th className={th} />}
                    </tr>
                  </thead>
                  <tbody>
                    {shownArrivals.map((a) => (
                      <tr key={a.uid} className="border-b border-ink/5 dark:border-white/5 last:border-0">
                        <td className={td}>
                          <div className="font-semibold">{a.lastName.toUpperCase()} {a.firstName}</div>
                          <div className="font-mono text-[11px] text-muted-faint">{a.uid}{a.email ? ` · ${a.email}` : ''}</div>
                        </td>
                        <td className={td}>{a.categorie || '—'}</td>
                        <td className={`${td} max-w-xs`}>{a.affectationPrincipaleLabel || '—'}</td>
                        <td className={td}>
                          <div className="flex flex-wrap gap-1">{a.labs.length ? a.labs.map((l) => <Chip key={l}>{l}</Chip>) : <span className="text-muted-faint">—</span>}</div>
                        </td>
                        <td className={`${td} whitespace-nowrap`}>
                          {a.upcoming
                            ? <span title={t`Pre-created account: the arrival is still to come`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[rgba(224,158,42,.2)] text-[#9a6a12] dark:text-[#f0c266] text-[11px] font-semibold"><CalendarClock className="w-3 h-3" /><Trans>To come</Trans></span>
                            : formatFuzzyDate(a.createdAt) || '—'}
                        </td>
                        <td className={`${td} whitespace-nowrap`}>{formatFuzzyDate(a.dateFin) || '—'}</td>
                        {onCreate && (
                          <td className={`${td} text-right`}>
                            <button className="btn-pill" onClick={() => onCreate(a.uid)} title={t`Open the creation form filled from LDAP`}>
                              <UserPlus className="w-4 h-4" /><Trans>Create</Trans>
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {moves && view === 'departures' && (
          <section className="space-y-3">
            <p className="text-[12.5px] text-muted-light dark:text-[#8f897c]">
              <Trans>Directory records whose LDAP account entered a grace period, was locked or became inactive since {formatFuzzyDate(moves.since)}, except records already “Left”. “Mark as left” sets the employment and membership end to that date.</Trans>
            </p>
            {departures.length === 0 ? (
              <p className="text-[13px] text-muted-faint"><Trans>No departure to record since this date.</Trans></p>
            ) : (
              <div className="overflow-x-auto rounded-card border border-ink/5 dark:border-white/10 bg-white/50 dark:bg-white/[.03]">
                <table className="min-w-full">
                  <thead className="border-b border-ink/5 dark:border-white/10">
                    <tr>
                      <th className={th}><Trans>Name</Trans></th>
                      <th className={th}><Trans>Lab</Trans></th>
                      <th className={th}><Trans>Druid status</Trans></th>
                      <th className={th}><Trans>LDAP account</Trans></th>
                      <th className={th}><Trans>Since</Trans></th>
                      <th className={th}><Trans>Category</Trans></th>
                      {onMarkDeparted && <th className={th} />}
                    </tr>
                  </thead>
                  <tbody>
                    {departures.map((d) => {
                      const state = busy[d.researcher.id];
                      const labs = Array.from(new Set((d.researcher.affiliations || []).filter((a) => !a.endDate).map((a) => a.structureName).filter(Boolean)));
                      return (
                        <tr key={d.researcher.id} className="border-b border-ink/5 dark:border-white/5 last:border-0">
                          <td className={td}>
                            <button className="font-semibold text-left hover:underline" onClick={() => onOpenResearcher(d.researcher)}>{d.researcher.displayName}</button>
                            <div className="font-mono text-[11px] text-muted-faint">{d.person.uid}</div>
                          </td>
                          <td className={td}><div className="flex flex-wrap gap-1">{labs.length ? labs.map((l) => <Chip key={l}>{l}</Chip>) : <span className="text-muted-faint">—</span>}</div></td>
                          <td className={td}><StatusBadge status={d.researcher.status} /></td>
                          <td className={td}>{t(ACCOUNT_LABEL(d.person.account))}</td>
                          <td className={`${td} whitespace-nowrap`}>{formatFuzzyDate(d.since)}</td>
                          <td className={td}>{d.person.categorie || '—'}</td>
                          {onMarkDeparted && (
                            <td className={`${td} text-right whitespace-nowrap`}>
                              {state === 'done' ? (
                                <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#2e7d32] dark:text-[#a5d6a7]"><CheckCircle2 className="w-4 h-4" /><Trans>Marked as left</Trans></span>
                              ) : (
                                <>
                                  <button className="btn-pill" disabled={state === 'saving'} onClick={() => void markDeparted(d)}
                                    title={t`statut_dyna = DEPART, employment and membership end on ${formatFuzzyDate(d.since)}`}>
                                    {state === 'saving' ? <RefreshCw className="w-4 h-4 animate-spin" /> : <UserMinus className="w-4 h-4" />}
                                    <Trans>Mark as left</Trans>
                                  </button>
                                  {state && state !== 'saving' && <p className="mt-1 text-[11px] font-semibold text-[#b3261e] dark:text-[#f2b8b5] max-w-[16rem] whitespace-normal">{state}</p>}
                                </>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>

      {moves && (
        <footer className="px-4 md:px-7 py-3 border-t border-ink/5 dark:border-white/5 bg-white/60 dark:bg-white/5 backdrop-blur-xl text-[12px] text-muted-faint">
          <Plural value={moves.arrivals.length} one="# LDAP account created or pre-created since this date" other="# LDAP accounts created or pre-created since this date" />
          {' · '}
          <Plural value={moves.departures.length} one="# account left since this date (all staff)" other="# accounts left since this date (all staff)" />
        </footer>
      )}
    </div>
  );
};
