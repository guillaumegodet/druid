import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, Check, CheckSquare, ChevronDown, ChevronRight, CircleHelp, CircleStop, ExternalLink, Link2, RefreshCw, RotateCw,
  Save, SearchX, Sparkles, Square, UsersRound, X,
} from 'lucide-react';
import { Trans, Plural, useLingui } from '@lingui/react/macro';
import { DirectoryApi } from '../../lib/directoryApi';
import { apiErrorText } from '../../lib/apiErrors';
import { numberLocale } from '../../lib/i18n';
import { hasCapability } from '../../lib/auth';
import { STRUCTURE_ID_META, type StructureIdType } from '../../lib/structures/identifiers';
import { isActionable, type StructureAlignCell, type StructureAlignOverview, type StructureAlignRow, type StructureCandidateView, type StructureCellStatus } from '../../lib/structures/alignView';
import { PixelBtn, StatCard } from '../researchers/alignAtoms';

/**
 * « Structures » tab of the alignment page (druid-internal docs/plan-druid-saas.md, § 4.5): one row per structure
 * (labs, then teams), one column per identifier type, a badge per cell saying its state, a drawer to decide — accept a
 * candidate with its evidence (record label, acronym, city, supervising institutions, works count, the bridges that
 * reached it), refuse it with a note, type a value by hand. « Check all strong candidates » then Apply validates in
 * bulk. Runs are server jobs (HAS_SERVER_JOBS): /api/structures-align/*, same contract as the people alignments.
 */

/** Short column headers of the narrow table (index.css .unified-table). */
const TYPE_SHORT: Record<StructureIdType, string> = { rnsr: 'RNSR', ror: 'ROR', hal_struct: 'HAL', hal_collection: 'Coll.', openalex: 'OA', idref: 'IdRef', wikidata: 'WD', isni: 'ISNI', uai: 'UAI', siret: 'SIRET', grid: 'GRID', scopus_affil: 'Sco.' };
type KindFilter = 'strong' | 'ambiguous' | 'arbitrate' | 'conflict' | '';
type LevelFilter = 'lab' | 'team' | '';
const cellKey = (row: StructureAlignRow, type: StructureIdType) => `${row.structureId}::${type}`;
const candKey = (row: StructureAlignRow, type: StructureIdType, candidateId: string) => `${row.structureId}::${type}::${candidateId}`;

interface RunProgress { running: boolean; total?: number; done?: number; error?: string; stopped?: boolean; candidates?: number; conflicts?: number; verificationIssues?: number }

/** Why the engine kept a candidate, in words. */
const ReasonPills: React.FC<{ c: StructureCandidateView }> = ({ c }) => {
  const { t } = useLingui();
  const label: Record<string, string> = {
    bridge: t`reached through another identifier`, acronym: t`same acronym`, name: t`same name`, unit_label: t`same unit number`, other_unit_label: t`other unit number`,
    city: t`same city`, supervisor: t`same supervising institution`, other_kind: t`other kind of organization`, closed: t`closed record`, no_works: t`no works`,
    other_country: t`other country`, share: t`share of the lab's documents`, team_collection: t`collection of a team`,
  };
  const pills = c.evidence.reasons.filter((r) => label[r]).map((r) => label[r]);
  return (
    <span className="flex flex-wrap gap-1">
      {pills.map((p) => <span key={p} className="px-1.5 py-0.5 rounded-full bg-cream-50 dark:bg-white/10 border border-ink/5 dark:border-white/10 text-[10.5px] font-semibold text-muted dark:text-[#cfc9bb]">{p}</span>)}
      {c.evidence.reasons.filter((r) => /%$/.test(r)).map((r) => <span key={r} className="px-1.5 py-0.5 rounded-full bg-cream-50 dark:bg-white/10 border border-ink/5 dark:border-white/10 text-[10.5px] font-mono text-muted dark:text-[#cfc9bb]">{r}</span>)}
    </span>
  );
};

const CandidateLine: React.FC<{ type: StructureIdType; c: StructureCandidateView }> = ({ type, c }) => {
  const { t } = useLingui();
  const e = c.evidence;
  const details = [e.acronym && e.acronym !== e.label ? e.acronym : null, e.unitLabel, e.kind, e.city, e.worksCount !== null && e.worksCount !== undefined ? t`${e.worksCount.toLocaleString(numberLocale())} works` : null].filter(Boolean);
  return (
    <div className="flex-1 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <a href={e.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/70 dark:bg-white/10 border border-ink/10 dark:border-white/15 font-mono text-[11px] font-bold text-ink dark:text-[#e7e2d6] hover:underline">
          <Link2 className="w-3 h-3" /> {c.candidateId}
        </a>
        <span className="font-semibold text-[13px] text-ink dark:text-[#f5f2ea]">{e.label}</span>
        {e.closed && <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#8a6113] dark:text-[#f0c266]"><AlertTriangle className="w-3 h-3" /> <Trans>closed</Trans></span>}
        <span className="font-mono text-[11px] text-muted-faint" title={t`Score of the candidate`}>{Math.round(c.score * 100)}</span>
      </div>
      {details.length > 0 && <div className="text-[12px] text-muted dark:text-[#8f897c] mt-0.5">{details.join(' · ')}</div>}
      {e.tutelles.length > 0 && <div className="text-[11.5px] text-muted-faint mt-0.5 truncate" title={e.tutelles.join(', ')}>{e.tutelles.join(', ')}</div>}
      {e.paths.length > 0 && <div className="text-[11px] font-mono text-muted-faint mt-0.5 truncate" title={e.paths.join('\n')}>{e.paths.join(' ; ')}</div>}
      {e.conflictWith && <div className="mt-1 text-[12px] font-semibold text-[#8a6113] dark:text-[#f0c266]"><Trans>Contradicts the confirmed value {e.conflictWith} ({STRUCTURE_ID_META[type].label}) — accepting it replaces the primary value.</Trans></div>}
      <div className="mt-1"><ReasonPills c={c} /></div>
    </div>
  );
};

const Pastille: React.FC<{ type: StructureIdType; cell?: StructureAlignCell; row: StructureAlignRow; isOpen: boolean; onToggleOpen: () => void; selected: ReadonlySet<string>; onToggleSelect: (key: string) => void }> =
  ({ type, cell, row, isOpen, onToggleOpen, selected, onToggleSelect }) => {
    const { t } = useLingui();
    const label = STRUCTURE_ID_META[type].label;
    const base = `inline-flex w-full min-h-[32px] items-center justify-center gap-1.5 px-1.5 py-1 rounded-full text-[12.5px] font-semibold transition-colors ${isOpen ? 'ring-2 ring-accent-strong' : ''}`;
    const both = (text: React.ReactNode, icon: React.ReactNode) => <><span className="ua-text">{text}</span><span className="ua-icon items-center gap-0.5">{icon}</span></>;
    if (!cell) return <span className="block w-full text-center text-muted-faint text-[12px]">—</span>;
    const strong = cell.candidates.filter((c) => c.strength === 'strong');
    if (cell.status === 'strong' && strong.length === 1) {
      const key = candKey(row, type, strong[0].candidateId);
      const title = t`${label}: one strong candidate — tick to accept, click to see it`;
      return (
        <span className={`${base} bg-[rgba(46,160,102,.14)] text-[#1f7a4d] dark:bg-[rgba(46,160,102,.18)] dark:text-[#5fd39a] border border-transparent cursor-pointer hover:border-accent-strong ${selected.has(key) ? '!bg-accent/25 !border-accent-strong' : ''}`}>
          <input type="checkbox" checked={selected.has(key)} onChange={() => onToggleSelect(key)} className="accent-[#1c1b19] dark:accent-[#f4d24a]" onClick={(e) => e.stopPropagation()} aria-label={title} />
          <span onClick={onToggleOpen} className="flex-1 inline-flex items-center justify-center gap-1" title={title}>{both(cell.existing.length ? t`+1 strong` : t`strong candidate`, <Sparkles className="w-3.5 h-3.5" />)}</span>
        </span>
      );
    }
    if (cell.status === 'ambiguous') {
      const title = t`${label}: several strong candidates — pick`;
      return <button onClick={onToggleOpen} title={title} aria-label={title} className={`${base} bg-[rgba(231,111,154,.15)] text-[#a3436a] dark:bg-[rgba(231,111,154,.2)] dark:text-[#e88fb0]`}>{both(<Plural value={strong.length} one="# candidate ?" other="# candidates ?" />, <><CircleHelp className="w-3.5 h-3.5" /><span className="font-mono text-[11.5px]">{strong.length}</span></>)}</button>;
    }
    if (cell.status === 'arbitrate') {
      const n = cell.candidates.filter((c) => c.strength === 'medium').length;
      const title = t`${label}: candidates to review`;
      return <button onClick={onToggleOpen} title={title} aria-label={title} className={`${base} bg-white/70 dark:bg-white/10 border border-ink/10 dark:border-white/15`}>{both(<Plural value={n} one="# to review" other="# to review" />, <><UsersRound className="w-3.5 h-3.5" /><span className="font-mono text-[11.5px]">{n}</span></>)}</button>;
    }
    if (cell.status === 'conflict') {
      const title = t`${label}: the confirmed value is contradicted or its record is unreadable`;
      return <button onClick={onToggleOpen} title={title} aria-label={title} className={`${base} bg-[rgba(224,158,42,.18)] text-[#8a6113] dark:bg-[rgba(224,158,42,.16)] dark:text-[#f0c266]`}><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{both(t`conflict`, null)}</button>;
    }
    if (cell.status === 'present') {
      const title = t`Confirmed: ${cell.existing.map((i) => i.value).join(', ')}`;
      return <button onClick={onToggleOpen} title={title} aria-label={title} className={`${base} bg-[rgba(46,160,102,.10)] text-[#1f7a4d]/80 dark:text-[#5fd39a]/80`}><Check className="w-3.5 h-3.5 shrink-0" /><span className="ua-text">{cell.existing.length > 1 ? t`${cell.existing.length} values` : t`confirmed`}</span></button>;
    }
    if (cell.status === 'absent') {
      const title = cell.error ? t`Search failed: ${cell.error}` : t`Searched, nothing found`;
      return <button onClick={onToggleOpen} title={title} aria-label={title} className="flex w-full items-center justify-center gap-1 text-muted-faint text-[12px]">{cell.error ? <AlertTriangle className="w-3.5 h-3.5 text-[#8a6113]" /> : null}{both(t`not found`, <SearchX className="w-3.5 h-3.5" />)}</button>;
    }
    return <button onClick={onToggleOpen} className="block w-full text-center text-muted-faint text-[12px]" title={t`Never searched`}>·</button>;
  };

interface DrawerProps {
  type: StructureIdType;
  row: StructureAlignRow;
  cell: StructureAlignCell;
  selected: ReadonlySet<string>;
  onToggleSelect: (key: string) => void;
  writable: boolean;
  busy: boolean;
  onReject: (c: StructureCandidateView) => void;
  onAdd: (value: string) => Promise<void>;
  onRemove: (value: string) => void;
  onPrimary: (value: string) => void;
  onSearchRow?: () => void;
  running: boolean;
}

const CellDrawer: React.FC<DrawerProps> = ({ type, row, cell, selected, onToggleSelect, writable, busy, onReject, onAdd, onRemove, onPrimary, onSearchRow, running }) => {
  const { t } = useLingui();
  const [manual, setManual] = useState('');
  const meta = STRUCTURE_ID_META[type];
  const byStrength = (s: StructureCandidateView['strength']) => cell.candidates.filter((c) => c.strength === s);
  const section = (title: React.ReactNode, list: StructureCandidateView[]) => list.length > 0 && (
    <div className="space-y-1">
      <p className="text-[11px] font-bold uppercase tracking-[.09em] text-muted-lighter dark:text-[#8f897c]">{title}</p>
      {list.map((c) => {
        const key = candKey(row, type, c.candidateId);
        return (
          <div key={c.candidateId} className={`flex items-start gap-2 p-2 rounded-xl transition-colors ${selected.has(key) ? 'bg-white/70 dark:bg-white/10' : 'hover:bg-accent/10'}`}>
            {writable && <input type="checkbox" checked={selected.has(key)} onChange={() => onToggleSelect(key)} className="mt-1 accent-[#1c1b19] dark:accent-[#f4d24a]" aria-label={t`Accept ${c.candidateId}`} />}
            <CandidateLine type={type} c={c} />
            {writable && (
              <button type="button" onClick={() => onReject(c)} disabled={busy} title={t`Wrong candidate: never suggested again`}
                className="self-center shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full border border-ink/15 dark:border-white/15 text-[11.5px] font-semibold text-muted dark:text-[#8f897c] hover:bg-[rgba(214,69,69,.12)] hover:text-[#b23b3b] disabled:opacity-50">
                <X className="w-3.5 h-3.5" /> <span className="ua-text"><Trans>Refuse</Trans></span>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
  return (
    <div className="space-y-4">
      {cell.existing.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-bold uppercase tracking-[.09em] text-muted-lighter dark:text-[#8f897c]"><Trans>Confirmed</Trans></p>
          {cell.existing.map((i) => (
            <div key={i.value} className="flex flex-wrap items-center gap-2 text-[12.5px]">
              <a href={i.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/70 dark:bg-white/10 border border-ink/10 dark:border-white/15 font-mono text-[11px] font-bold text-ink dark:text-[#e7e2d6] hover:underline"><Link2 className="w-3 h-3" /> {i.value}</a>
              {i.isPrimary && meta.multi && <span className="px-2 py-0.5 rounded-full bg-ink text-white dark:bg-[#f5f2ea] dark:text-ink text-[10.5px] font-bold"><Trans>primary</Trans></span>}
              <span className="text-muted-faint text-[11.5px]">{i.source}{i.checkedAt ? ` · ${t`checked on`} ${new Date(i.checkedAt).toLocaleDateString(numberLocale())}` : ''}</span>
              {i.checkResult && (i.checkResult as any).ok === false && (
                <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#8a6113] dark:text-[#f0c266]"><AlertTriangle className="w-3 h-3" />
                  {(i.checkResult as any).exists === false ? t`record not found` : (i.checkResult as any).closed ? t`closed record` : t`record names something else: ${String((i.checkResult as any).label || '')}`}
                </span>
              )}
              {writable && (
                <span className="flex items-center gap-1">
                  {meta.multi && !i.isPrimary && <button type="button" onClick={() => onPrimary(i.value)} disabled={busy} className="text-[11.5px] font-semibold underline text-muted hover:text-ink dark:hover:text-[#f5f2ea] disabled:opacity-50"><Trans>make primary</Trans></button>}
                  <button type="button" onClick={() => onRemove(i.value)} disabled={busy} className="text-[11.5px] font-semibold underline text-muted hover:text-[#b23b3b] disabled:opacity-50"><Trans>remove</Trans></button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {section(<Trans>Conflicts</Trans>, byStrength('conflict'))}
      {section(<Trans>Strong candidates</Trans>, byStrength('strong'))}
      {section(<Trans>To review</Trans>, byStrength('medium'))}
      {section(<Trans>Weak</Trans>, byStrength('weak'))}
      {cell.status === 'absent' && <p className="text-[12.5px] text-muted-faint">{cell.error ? t`The last search failed: ${cell.error}` : t`Nothing found during the last search.`}</p>}
      {cell.status === 'none' && <p className="text-[12.5px] text-muted-faint"><Trans>Never searched for this structure.</Trans></p>}
      <div className="flex flex-wrap items-center gap-2">
        {writable && (
          <form className="flex items-center gap-2" onSubmit={async (e) => { e.preventDefault(); if (!manual.trim()) return; await onAdd(manual.trim()); setManual(''); }}>
            <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder={t`Type a ${meta.label} identifier or URL`} className="input-soft !w-64 h-9 py-1 font-mono text-[12.5px]" />
            <button type="submit" disabled={busy || !manual.trim()} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-ink/15 dark:border-white/15 text-[12px] font-semibold hover:bg-white/70 dark:hover:bg-white/10 disabled:opacity-50"><Check className="w-3.5 h-3.5" /> <Trans>Add</Trans></button>
          </form>
        )}
        {onSearchRow && (
          <button type="button" onClick={onSearchRow} disabled={running} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-ink/15 dark:border-white/15 text-[12px] font-semibold hover:bg-white/70 dark:hover:bg-white/10 disabled:opacity-50"
            title={t`Searches every registry again for this structure, even the types already searched`}>
            <RotateCw className="w-3.5 h-3.5" /> <Trans>Search this structure again</Trans>
          </button>
        )}
      </div>
    </div>
  );
};

export interface StructureAlignPanelProps {
  writable: boolean;
  onToast: (text: string) => void;
}

export const StructureAlignPanel: React.FC<StructureAlignPanelProps> = ({ writable, onToast }) => {
  const { t } = useLingui();
  const [overview, setOverview] = useState<StructureAlignOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<KindFilter>('');
  const [level, setLevel] = useState<LevelFilter>('');
  const [typeFilter, setTypeFilter] = useState<StructureIdType | ''>('');
  const [query, setQuery] = useState('');
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const pollRef = useRef<number | null>(null);
  const canRun = hasCapability('HAS_SERVER_JOBS') && writable;

  const load = async () => {
    try { setOverview(await DirectoryApi.structureAlignment()); setError(null); } catch (e) { setError(apiErrorText(e) || t`Error loading the structures`); }
  };
  useEffect(() => { load(); return () => { if (pollRef.current) window.clearTimeout(pollRef.current); }; }, []);
  useEffect(() => { setSelected(new Set()); setOpenKey(null); }, [overview?.generatedAt]);

  /** Polls the run until it closes its progress, then reloads the overview. */
  const track = () => {
    if (pollRef.current) window.clearTimeout(pollRef.current);
    const tick = async () => {
      try {
        const r = await fetch('/api/structures-align/progress');
        const p: RunProgress = r.ok ? await r.json() : { running: false, error: `HTTP ${r.status}` };
        setProgress(p);
        if (p.running) { pollRef.current = window.setTimeout(tick, 2500); return; }
        await load();
      } catch (e) { setProgress({ running: false, error: e instanceof Error ? e.message : String(e) }); }
    };
    tick();
  };
  useEffect(() => {
    // A run started elsewhere (another tab, a cron) is tracked too.
    if (!canRun) return;
    fetch('/api/structures-align/progress').then((r) => (r.ok ? r.json() : null)).then((p: RunProgress | null) => { if (p?.running) { setProgress(p); track(); } }).catch(() => {});
  }, [canRun]);

  const run = async (params: Record<string, string>) => {
    const q = new URLSearchParams(params);
    const r = await fetch(`/api/structures-align/trigger?${q}`);
    if (r.status === 409) { track(); return; }
    if (!r.ok) { const d = await r.json().catch(() => ({})); onToast(apiErrorText(new Error(d.error || `HTTP ${r.status}`)) || `HTTP ${r.status}`); return; }
    setProgress({ running: true, total: 0, done: 0 });
    track();
  };
  const stop = async () => { await fetch('/api/structures-align/stop', { method: 'POST' }).catch(() => {}); };

  const rows = useMemo(() => {
    if (!overview) return [];
    const q = query.trim().toLowerCase();
    const types = typeFilter ? [typeFilter] : overview.types;
    const matchKind = (c?: StructureAlignCell) => !!c && (kind ? c.status === kind : isActionable(c));
    return overview.rows.filter((r) => {
      if (level && r.level !== level) return false;
      if (q && !(`${r.acronym} ${r.name} ${r.parentAcronym || ''}`.toLowerCase().includes(q))) return false;
      // Without a text search, only the structures with something to do are listed (as for the people).
      return q ? true : types.some((ty) => matchKind(r.cells[ty]));
    });
  }, [overview, kind, level, typeFilter, query]);

  const counts = useMemo(() => {
    const c = { strong: 0, ambiguous: 0, arbitrate: 0, conflict: 0 };
    for (const r of rows) for (const ty of overview?.types || []) { const s = r.cells[ty]?.status as StructureCellStatus | undefined; if (s && s in c) (c as any)[s]++; }
    return c;
  }, [rows, overview]);
  const typeCounts = useMemo(() => {
    const c = {} as Record<StructureIdType, number>;
    for (const ty of overview?.types || []) c[ty] = (overview?.rows || []).filter((r) => (level ? r.level === level : true) && isActionable(r.cells[ty])).length;
    return c;
  }, [overview, level]);

  const strongKeys = useMemo(() => rows.flatMap((r) => (overview?.types || []).flatMap((ty) => {
    const cell = r.cells[ty];
    const strong = cell?.candidates.filter((c) => c.strength === 'strong') || [];
    return cell?.status === 'strong' && strong.length === 1 ? [candKey(r, ty, strong[0].candidateId)] : [];
  })), [rows, overview]);
  const allStrong = strongKeys.length > 0 && strongKeys.every((k) => selected.has(k));
  const toggleSelect = (key: string) => setSelected((p) => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const apply = async () => {
    if (!selected.size) return;
    setBusy(true);
    try {
      const items = [...selected].map((k) => { const [sid, type, ...rest] = k.split('::'); return { structureId: Number(sid), type: type as StructureIdType, candidateId: rest.join('::') }; });
      const { accepted } = await DirectoryApi.acceptStructureCandidates(items);
      onToast(t`${accepted} identifier(s) confirmed.`);
      setSelected(new Set());
      await load();
    } catch (e) { onToast(apiErrorText(e) || String(e)); } finally { setBusy(false); }
  };
  const reject = async (row: StructureAlignRow, type: StructureIdType, c: StructureCandidateView) => {
    const note = window.prompt(t`Why is ${c.candidateId} wrong? (optional note)`, '');
    if (note === null) return;
    setBusy(true);
    try { await DirectoryApi.rejectStructureCandidate({ structureId: row.structureId, type, candidateId: c.candidateId, note: note || null }); onToast(t`Candidate ${c.candidateId} refused for ${row.acronym}.`); await load(); } catch (e) { onToast(apiErrorText(e) || String(e)); } finally { setBusy(false); }
  };
  const add = async (row: StructureAlignRow, type: StructureIdType, value: string) => {
    setBusy(true);
    try { await DirectoryApi.addStructureIdentifier(row.structureId, type, value); onToast(t`${STRUCTURE_ID_META[type].label} identifier added to ${row.acronym}.`); await load(); } catch (e) { onToast(apiErrorText(e) || String(e)); } finally { setBusy(false); }
  };
  const remove = async (row: StructureAlignRow, type: StructureIdType, value: string) => {
    if (!window.confirm(t`Remove ${value} from ${row.acronym}? It will not be suggested again.`)) return;
    setBusy(true);
    try { await DirectoryApi.removeStructureIdentifier(row.structureId, type, value); await load(); } catch (e) { onToast(apiErrorText(e) || String(e)); } finally { setBusy(false); }
  };
  const primary = async (row: StructureAlignRow, type: StructureIdType, value: string) => {
    setBusy(true);
    try { await DirectoryApi.setPrimaryStructureIdentifier(row.structureId, type, value); await load(); } catch (e) { onToast(apiErrorText(e) || String(e)); } finally { setBusy(false); }
  };

  const types = overview?.types || [];
  const running = !!progress?.running;
  const generatedAt = overview && overview.generatedAt > '1971' ? new Date(overview.generatedAt).toLocaleString(numberLocale()) : '';
  const levelBtn = (l: LevelFilter, label: React.ReactNode) => (
    <button onClick={() => setLevel(l)} className={`px-3.5 py-1.5 rounded-full font-disp text-[13px] font-semibold transition-colors ${level === l ? 'bg-ink text-white dark:bg-accent dark:text-ink shadow-nav-active' : 'text-muted dark:text-[#8f897c] hover:text-ink dark:hover:text-[#f5f2ea]'}`}>{label}</button>
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 px-4 md:px-7 pb-4">
        <div className="flex flex-wrap items-center gap-1 rounded-3xl bg-white/70 dark:bg-white/10 backdrop-blur-xl border border-white/70 dark:border-white/15 p-1 shadow-soft">
          {levelBtn('', <Trans>All</Trans>)}{levelBtn('lab', <Trans>Labs</Trans>)}{levelBtn('team', <Trans>Teams</Trans>)}
        </div>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t`Find a structure…`} className="input-soft !w-56 h-10 py-1.5 text-[13px]" />
        <div className="flex-1" />
        {canRun && (
          <>
            <PixelBtn onClick={() => run({ mode: 'search' })} disabled={running} tone="bg-ink text-white hover:bg-black dark:bg-accent dark:text-ink dark:hover:bg-accent-strong"
              title={t`Reads RNSR, ROR, HAL, OpenAlex, IdRef and Wikidata for the structures not searched yet (bridges from the known identifiers first, then a search by name)`}>
              {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />}
              {running ? t`Search running…` : t`Find missing identifiers`}
            </PixelBtn>
            <PixelBtn onClick={() => run({ mode: 'verify', force: '1' })} disabled={running} title={t`Reads the records of every confirmed identifier: missing, closed or contradicted records become conflicts`}>
              <Check className="w-4 h-4" /> {t`Check existing ones`}
            </PixelBtn>
          </>
        )}
      </div>
      {progress && (
        <div className="flex flex-wrap items-center gap-3 px-4 md:px-7 pb-3 text-[11px] font-semibold text-muted dark:text-[#8f897c]">
          <span className={progress.error ? 'text-[#b3441f] dark:text-[#e08a6a]' : ''}>
            <Trans>Structures</Trans> {progress.running ? `${progress.done ?? 0}/${progress.total ?? '?'}` : progress.error ? t`error: ${progress.error}` : progress.stopped ? t`stopped at ${progress.done ?? 0}/${progress.total ?? '?'}` : t`done`}
            {!progress.running && !progress.error && progress.candidates !== undefined ? ` · ${t`${progress.candidates} candidate(s), ${progress.conflicts ?? 0} conflict(s)`}` : ''}
          </span>
          {progress.running && <button type="button" onClick={stop} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-ink/15 dark:border-white/15 hover:bg-white/70 dark:hover:bg-white/10"><CircleStop className="w-3 h-3" /> {t`Stop`}</button>}
        </div>
      )}
      <div className="flex-1 md:overflow-auto px-4 md:px-7 py-4" data-page-scroll>
        {error && <p className="text-[13px] font-semibold text-[#b3441f] dark:text-[#e08a6a] mb-4">{error}</p>}
        {!overview && !error ? (
          <div className="flex flex-col items-center justify-center py-24 text-muted-faint gap-3"><RefreshCw className="w-8 h-8 animate-spin" /><p className="text-[13px] font-semibold text-muted dark:text-[#8f897c]">{t`Loading the structures…`}</p></div>
        ) : overview && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
              <StatCard label={t`Structures to process`} value={rows.length} />
              {([
                ['strong', t`Strong candidates`, counts.strong, 'bg-[rgba(46,160,102,.16)] dark:bg-[rgba(46,160,102,.14)]'],
                ['ambiguous', t`Ambiguous`, counts.ambiguous, 'bg-[rgba(231,111,154,.15)] dark:bg-[rgba(231,111,154,.12)]'],
                ['arbitrate', t`To review`, counts.arbitrate, 'bg-white/60 dark:bg-white/5'],
                ['conflict', t`Conflicts`, counts.conflict, 'bg-[rgba(224,158,42,.18)] dark:bg-[rgba(224,158,42,.12)]'],
              ] as [KindFilter, string, number, string][]).map(([k, label, value, tone]) => (
                <button key={k} type="button" onClick={() => setKind((cur) => (cur === k ? '' : k))} title={kind === k ? t`Remove this filter` : t`Show only this kind of work`}
                  className={`text-left rounded-card transition-shadow ${kind === k ? 'ring-2 ring-ink dark:ring-accent' : 'hover:ring-2 hover:ring-ink/30 dark:hover:ring-white/30'}`}>
                  <StatCard label={label} value={value} tone={tone} />
                </button>
              ))}
            </div>
            <div className="w-full space-y-4">
              <div className="flex items-center gap-3 px-4 py-3 rounded-card bg-accent/20 dark:bg-accent/10 border border-accent-strong/40 dark:border-accent/20 text-[13px] font-semibold text-ink dark:text-[#f0c266]">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <Trans>A candidate is strong when two registries point to it independently or when the record carries the acronym or the unit number. Accepting a candidate confirms the identifier; the exports and the bibliometric ETL read the confirmed values.</Trans>
              </div>
              {writable && strongKeys.length > 0 && (
                <button onClick={() => setSelected((p) => { const n = new Set(p); for (const k of strongKeys) allStrong ? n.delete(k) : n.add(k); return n; })} className="flex items-center gap-1.5 text-[12px] font-semibold text-[#1f7a4d] dark:text-[#5fd39a] hover:underline">
                  {allStrong ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                  {allStrong ? t`Uncheck all strong candidates` : t`Check all strong candidates`} ({strongKeys.filter((k) => selected.has(k)).length}/{strongKeys.length})
                </button>
              )}
              {rows.length === 0 ? (
                <p className="text-[13px] text-muted-faint py-8">{overview.stats.structures === 0 ? t`No structure in the directory yet.` : query || kind || level ? t`No structure to show for this filter.` : canRun ? t`Nothing to do: run a search to find the missing identifiers.` : t`Nothing to do.`}</p>
              ) : (
                <div className="unified-table rounded-card border border-ink/8 dark:border-white/8 bg-white/40 dark:bg-white/[.03]">
                  <div>
                    <div className="grid unified-grid sticky -top-4 max-md:top-0 z-10 rounded-t-card items-center px-3 py-2 bg-[#f3efe4] dark:bg-[#24231f] border-b border-ink/8 dark:border-white/10 text-[10.5px] font-bold uppercase tracking-[.09em] text-muted-lighter dark:text-[#8f897c]" style={{ '--src-count': types.length } as React.CSSProperties}>
                      <span />
                      <span><Trans>Structure</Trans></span>
                      {types.map((ty) => (
                        <button key={ty} type="button" onClick={() => setTypeFilter((f) => (f === ty ? '' : ty))} title={typeFilter === ty ? t`Remove the type filter` : t`Only structures with something to do on ${STRUCTURE_ID_META[ty].label}`}
                          className={`text-center rounded-full py-0.5 transition-colors ${typeFilter === ty ? 'bg-ink text-white dark:bg-accent dark:text-ink' : typeFilter ? 'opacity-40 hover:opacity-100' : 'hover:text-ink dark:hover:text-[#f5f2ea]'}`}>
                          <span className="ua-text">{STRUCTURE_ID_META[ty].label}</span><span className="ua-icon justify-center">{TYPE_SHORT[ty]}</span> <span className={`ua-text font-mono normal-case tracking-normal ${typeFilter === ty ? 'opacity-80' : 'text-muted-faint'}`}>{typeCounts[ty]}</span>
                        </button>
                      ))}
                    </div>
                    {rows.map((row, i) => {
                      const openType = openKey && openKey.startsWith(`${row.structureId}::`) ? openKey.slice(String(row.structureId).length + 2) as StructureIdType : null;
                      const openCell = openType ? row.cells[openType] : undefined;
                      return (
                        <div key={row.id} className={`border-b border-ink/5 dark:border-white/5 last:border-b-0 ${openType ? 'bg-accent/15 dark:bg-accent/10' : i % 2 ? 'bg-white/30 dark:bg-white/[.02]' : ''}`}>
                          <div className="grid unified-grid items-center px-3 py-2 hover:bg-white/70 dark:hover:bg-white/[.06] transition-colors" style={{ '--src-count': types.length } as React.CSSProperties}>
                            <button type="button" onClick={() => setOpenKey((k) => (k && k.startsWith(`${row.structureId}::`) ? null : cellKey(row, types.find((ty) => isActionable(row.cells[ty])) || types[0])))} title={openType ? t`Close` : t`Open the detail`} className="flex items-center justify-center w-7 h-7 rounded-full text-muted-faint hover:bg-ink/5 dark:hover:bg-white/10">
                              {openType ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </button>
                            <div className="min-w-0 pr-3">
                              <div className="flex items-center gap-2 min-w-0">
                                <a href={`${window.location.pathname}?page=STRUCTURE_DETAIL&id=${encodeURIComponent(row.id)}`} target="_blank" rel="noreferrer" title={t`Open the structure record in a new tab`}
                                  className="group/name inline-flex items-center gap-1 min-w-0 font-disp text-[15px] font-semibold text-ink dark:text-[#f5f2ea] hover:underline">
                                  <span className="truncate">{row.acronym || row.name}</span>
                                  <ExternalLink className="w-3.5 h-3.5 shrink-0 text-muted-faint opacity-0 group-hover/name:opacity-100 transition-opacity" />
                                </a>
                                {row.level === 'team' && row.parentAcronym && <span className="inline-flex shrink-0 items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-cream-50 dark:bg-white/10 border border-ink/5 dark:border-white/10 text-[11px] font-semibold text-ink dark:text-[#e7e2d6]"><span className="w-1.5 h-1.5 rounded-full bg-[#7048e8] dark:bg-[#9a7bff]" />{row.parentAcronym}</span>}
                              </div>
                              <div className="text-[11px] text-muted-faint mt-0.5 truncate">{row.name}</div>
                            </div>
                            {types.map((ty) => (
                              <div key={ty} className={`px-1 ${typeFilter && typeFilter !== ty ? 'opacity-40' : ''}`}>
                                <Pastille type={ty} cell={row.cells[ty]} row={row} isOpen={openType === ty} onToggleOpen={() => setOpenKey((k) => (k === cellKey(row, ty) ? null : cellKey(row, ty)))} selected={selected} onToggleSelect={toggleSelect} />
                              </div>
                            ))}
                          </div>
                          {openType && openCell && (
                            <div className="px-3 sm:px-5 pb-4 sm:pl-12 pt-3 border-t border-ink/5 dark:border-white/5 bg-white/50 dark:bg-white/[.03]">
                              <div className="text-[10.5px] font-bold uppercase tracking-[.09em] text-muted-lighter dark:text-[#8f897c] mb-2">{STRUCTURE_ID_META[openType].label} — {row.acronym}</div>
                              <CellDrawer type={openType} row={row} cell={openCell} selected={selected} onToggleSelect={toggleSelect} writable={writable} busy={busy} running={running}
                                onReject={(c) => reject(row, openType, c)} onAdd={(v) => add(row, openType, v)} onRemove={(v) => remove(row, openType, v)} onPrimary={(v) => primary(row, openType, v)}
                                onSearchRow={canRun ? () => run({ mode: 'search', only: String(row.structureId), force: '1' }) : undefined} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <footer className="max-md:sticky max-md:bottom-0 max-md:z-20 px-4 md:px-7 py-4 border-t border-ink/5 dark:border-white/5 bg-white/60 dark:bg-white/5 backdrop-blur-xl flex flex-wrap items-center justify-between gap-3">
        <span className="text-[12px] text-muted-faint">{generatedAt ? t`Last search on ${generatedAt}` : overview ? t`No search run yet` : ''}</span>
        {writable && (
          <PixelBtn onClick={apply} disabled={busy || selected.size === 0} tone="bg-ink text-white hover:bg-black dark:bg-accent dark:text-ink dark:hover:bg-accent-strong">
            {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {busy ? t`Writing…` : t`Confirm (${selected.size})`}
          </PixelBtn>
        )}
      </footer>
    </>
  );
};
