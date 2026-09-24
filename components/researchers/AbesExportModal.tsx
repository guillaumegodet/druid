import React, { useEffect, useMemo, useState } from 'react';
import { X, FileDown, Send, Loader2, BookMarked, AlertTriangle } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { Researcher, Structure } from '../../types';
import { GristService, Institution } from '../../lib/gristService';
import { ExportService } from '../../lib/exportService';
import { computeAbesDiff, AbesDiff, AbesAction, AbesRow, abesTaskTypes } from '../../lib/abesExport';
import { hasRole, isSuperAdmin, hasCapability } from '../../lib/auth';
import { TasksApi } from '../../lib/tasks';
import { apiErrorText } from '../../lib/apiErrors';

/**
 * @component AbesExportModal
 * @description « enrichissement IdRef » export for ABES (docs/plan-export-abes-idref.md, lot 3).
 * The scope is the **already filtered** list (statuses, validation, employers, labs, grades…
 * of ResearcherList); the modal adds the export-specific options, computes the diff
 * (lib/abesExport, pure) against the IdRef cache re-read by `sync_idref.cjs --mode=verify`, shows
 * a preview, then downloads the workbook (4 sheets) or the CSV, and allows flagging the rows
 * as sent (Annuaire columns ABES_export_hash / ABES_export_date).
 */
interface Props {
  researchers: Researcher[];
  /** Applies the « Nantes U validés » preset to the list (employer + status + validation). */
  onApplyPreset?: () => void;
  onClose: () => void;
}

const today = () => new Date().toISOString().slice(0, 10);

const ActionPill: React.FC<{ action: AbesAction }> = ({ action }) => {
  if (!action) return <span className="text-muted-light dark:text-[#6f6a60]">—</span>;
  const cls =
    action === 'AJOUT' ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200'
    : action === 'MAJ_DATES' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
    : action === 'CONFLIT' ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200'
    : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200';
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-mono font-semibold ${cls}`}>{action}</span>;
};

const Stat: React.FC<{ label: React.ReactNode; value: React.ReactNode; accent?: boolean }> = ({ label, value, accent }) => (
  <div className="rounded-2xl bg-white/70 dark:bg-white/5 border border-white/70 dark:border-white/10 px-4 py-3">
    <div className={`font-disp text-2xl font-bold tabular-nums ${accent ? 'text-ink dark:text-accent' : 'text-ink dark:text-[#f5f2ea]'}`}>{value}</div>
    <div className="text-[12px] text-muted dark:text-[#8f897c] mt-0.5">{label}</div>
  </div>
);

export const AbesExportModal: React.FC<Props> = ({ researchers, onApplyPreset, onClose }) => {
  const { t } = useLingui();
  const [structures, setStructures] = useState<Structure[] | null>(null);
  const [etablissements, setEtablissements] = useState<Institution[] | null>(null);
  const [cache, setCache] = useState<Record<string, any> | null>(null);
  const [alreadySent, setAlreadySent] = useState<Record<string, { hash: string; date: string }>>({});
  const [error, setError] = useState<string | null>(null);

  const [validatedOnly, setValidatedOnly] = useState(true);
  const [excludePhdStudents, setExcludeDoctorants] = useState(true);
  const [proposeNotes, setProposeNotes] = useState(true);
  const [includeSansNotice, setIncludeSansNotice] = useState(false);
  const [includeAlreadySent, setIncludeAlreadySent] = useState(false);
  const [marking, setMarking] = useState(false);
  const [marked, setMarked] = useState<number | null>(null);
  const [tasksClosed, setTasksClosed] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [s, e, c, sent] = await Promise.all([
          GristService.fetchStructures(),
          GristService.fetchInstitutions(),
          fetch('/idref_align_cache.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : {})),
          GristService.fetchAbesSent().catch(() => ({})),
        ]);
        if (!alive) return;
        setStructures(s); setEtablissements(e); setCache(c || {}); setAlreadySent(sent);
      } catch (err: any) {
        if (alive) setError(err?.message || String(err));
      }
    })();
    return () => { alive = false; };
  }, []);

  const extractionDate = today();
  const diff: AbesDiff | null = useMemo(() => {
    if (!structures || !etablissements || !cache) return null;
    const sentHashes: Record<string, string> = {};
    for (const [uid, v] of Object.entries(alreadySent)) sentHashes[uid] = v.hash;
    return computeAbesDiff(researchers, structures, etablissements, cache, {
      extractionDate,
      validatedOnly,
      excludeEmploymentTypes: excludePhdStudents ? ['DOCTORANT', 'VACATAIRE'] : [],
      proposeNotes,
      includeSansNotice,
      alreadySent: sentHashes,
      includeAlreadySent,
    });
  }, [researchers, structures, etablissements, cache, alreadySent, validatedOnly, excludePhdStudents, proposeNotes, includeSansNotice, includeAlreadySent, extractionDate]);

  const fileBase = `abes-idref-${extractionDate}`;

  const downloadXlsx = () => {
    if (!diff) return;
    ExportService.exportWorkbook([
      { name: 'enrichissements', rows: diff.enrichissements },
      { name: 'conflits', rows: diff.conflits, headers: ['ppn', 'nom', 'prenom', 'id_local', 'champ', 'valeur_idref', 'valeur_druid', 'source_druid', 'commentaire'] },
      { name: 'sans_notice', rows: diff.sansNotice, headers: ['nom', 'prenom', 'id_local', 'orcid', 'idhal', 'scopus', 'etab_ppn', 'etab_nom', 'labo_ppn', 'labo_nom', 'fonction', 'note_340', 'annee_naissance'] },
      { name: 'structures', rows: diff.structures, headers: ['acronyme', 'nom', 'ppn_idref', 'rnsr', 'ror', 'type', 'action'] },
    ], fileBase);
  };
  const downloadCsv = () => { if (diff) ExportService.exportToCSV(diff.enrichissements, `${fileBase}-enrichissements`, ';'); };

  const markSent = async () => {
    if (!diff) return;
    setMarking(true); setError(null);
    try {
      const rowIdByUid = new Map<string, number>();
      for (const r of researchers) if (r.gristRowId) rowIdByUid.set(r.uid || r.id, r.gristRowId);
      const entries = diff.enrichissements
        .map((row: AbesRow) => ({ gristRowId: rowIdByUid.get(row.id_local) || 0, hash: diff.hashes[row.id_local] || '' }))
        .filter((e) => e.gristRowId && e.hash);
      const n = await GristService.markAbesSent(entries, extractionDate);
      setMarked(n);
      // A single pass to build the reverse map (gristRowId → uid), rather than a full scan
      // of rowIdByUid for each sent entry (O(n·m) on a large batch, review lot 6b).
      const uidByRowId = new Map<number, string>();
      for (const [uid, id] of rowIdByUid) uidByRowId.set(id, uid);
      const next = { ...alreadySent };
      for (const e of entries) {
        const uid = uidByRowId.get(e.gristRowId);
        if (uid) next[uid] = { hash: e.hash, date: extractionDate };
      }
      setAlreadySent(next);
      // « À traiter › Tâches » (lot 6): the open « lot ABES » tasks covered by these rows are done.
      if (isSuperAdmin() && hasCapability('HAS_TASKS')) {
        try {
          const items = diff.enrichissements
            .map((row: AbesRow) => ({ rowId: rowIdByUid.get(row.id_local) || 0, uid: row.id_local, types: abesTaskTypes(row) }))
            .filter((it) => it.types.length);
          setTasksClosed(items.length ? await TasksApi.abesSent(extractionDate, items) : 0);
        } catch (e) {
          setError(t`Records marked, but the ABES tasks could not be closed: ${apiErrorText(e)}`);
        }
      }
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally { setMarking(false); }
  };

  const actionRows = diff ? Object.entries(diff.stats.actions).sort((a, b) => b[1] - a[1]) : [];
  const preview = diff ? diff.enrichissements.slice(0, 20) : [];
  const checkbox = 'flex items-center gap-2 text-[13px] text-ink dark:text-[#f5f2ea] cursor-pointer select-none';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-6xl max-h-[92vh] flex flex-col rounded-hero bg-cream-100 dark:bg-[#201e1a] shadow-soft-lg border border-white/50 dark:border-white/10 overflow-hidden">
        <header className="flex items-center justify-between px-6 py-4 border-b border-ink/5 dark:border-white/5">
          <div className="flex items-center gap-3">
            <BookMarked className="w-5 h-5 text-ink dark:text-accent" />
            <div>
              <h2 className="font-disp text-lg font-bold tracking-tight text-ink dark:text-[#f5f2ea]"><Trans>ABES export — IdRef enrichment</Trans></h2>
              <p className="text-[12px] text-muted-light dark:text-[#8f897c]">
                <Trans>Identifiers (035), affiliations (510) and notes (340) known to Druid but missing from IdRef records. Scope = the filtered list ({researchers.length} records).</Trans>
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-ink/5 dark:hover:bg-white/10 text-muted dark:text-[#8f897c]"><X className="w-5 h-5" /></button>
        </header>

        <div className="flex-1 overflow-auto px-6 py-5 space-y-5">
          {error && (
            <div className="rounded-2xl bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 px-4 py-3 text-[13px] text-rose-800 dark:text-rose-200 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> <span>{error}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <label className={checkbox}><input type="checkbox" checked={validatedOnly} onChange={(e) => setValidatedOnly(e.target.checked)} /> <Trans>Validated records only</Trans></label>
            <label className={checkbox}><input type="checkbox" checked={excludePhdStudents} onChange={(e) => setExcludeDoctorants(e.target.checked)} /> <Trans>Exclude PhD students and adjuncts</Trans></label>
            <label className={checkbox}><input type="checkbox" checked={proposeNotes} onChange={(e) => setProposeNotes(e.target.checked)} /> <Trans>Propose 340 notes</Trans></label>
            <label className={checkbox}><input type="checkbox" checked={includeSansNotice} onChange={(e) => setIncludeSansNotice(e.target.checked)} /> <Trans>“No record” sheet (people without IdRef)</Trans></label>
            <label className={checkbox}><input type="checkbox" checked={includeAlreadySent} onChange={(e) => setIncludeAlreadySent(e.target.checked)} /> <Trans>Include rows already sent</Trans></label>
            {onApplyPreset && (
              <button onClick={onApplyPreset} className="btn-pill text-[13px]" title={t`Employer Nantes Université, status INTERNE, validated records`}>
                <Trans>Preset “Nantes U validated”</Trans>
              </button>
            )}
          </div>

          {!diff ? (
            <div className="flex items-center gap-2 text-[13px] text-muted dark:text-[#8f897c] py-8 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" /> <Trans>Loading structures, institutions and the IdRef cache…</Trans>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                <Stat label={<Trans>records in scope</Trans>} value={diff.stats.perimetre} />
                <Stat label={<Trans>with IdRef</Trans>} value={diff.stats.avecIdref} />
                <Stat label={<Trans>rows to send</Trans>} value={diff.stats.lignes} accent />
                <Stat label={<Trans>conflicts</Trans>} value={diff.stats.conflits} />
                <Stat label={<Trans>record not re-read</Trans>} value={diff.stats.sansCache + diff.stats.noticeIllisible} />
                <Stat label={<Trans>already sent</Trans>} value={diff.stats.dejaEnvoyees} />
                <Stat label={<Trans>structures to create</Trans>} value={diff.stats.structuresACreer} />
              </div>

              {diff.stats.sansCache > 0 && (
                <p className="text-[12px] text-muted dark:text-[#8f897c]">
                  <Trans>{diff.stats.sansCache} records have an IdRef but their notice has not been re-read: run “Align IdRef → Verify existing” then reopen this export.</Trans>
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                {actionRows.map(([k, v]) => (
                  <span key={k} className="inline-flex items-center gap-1.5 rounded-full bg-white/70 dark:bg-white/5 border border-white/70 dark:border-white/10 px-3 py-1 text-[12px] font-mono text-ink dark:text-[#f5f2ea]">
                    {k} <b className="tabular-nums">{v}</b>
                  </span>
                ))}
              </div>

              <div className="rounded-2xl border border-white/70 dark:border-white/10 overflow-x-auto bg-white/50 dark:bg-white/5">
                <table className="min-w-full text-[12.5px]">
                  <thead className="text-[11px] uppercase tracking-wide text-muted dark:text-[#8f897c]">
                    <tr>
                      <th className="text-left px-3 py-2"><Trans>Person</Trans></th>
                      <th className="text-left px-3 py-2">PPN</th>
                      <th className="text-left px-3 py-2">ORCID</th>
                      <th className="text-left px-3 py-2">IdHAL</th>
                      <th className="text-left px-3 py-2">Scopus</th>
                      <th className="text-left px-3 py-2"><Trans>Employer</Trans></th>
                      <th className="text-left px-3 py-2"><Trans>Lab</Trans></th>
                      <th className="text-left px-3 py-2">340</th>
                      <th className="text-left px-3 py-2"><Trans>Comment</Trans></th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row) => (
                      <tr key={row.id_local} className="border-t border-ink/5 dark:border-white/5 align-top">
                        <td className="px-3 py-2 whitespace-nowrap text-ink dark:text-[#f5f2ea]">{row.nom} {row.prenom}</td>
                        <td className="px-3 py-2 font-mono">{row.ppn}</td>
                        <td className="px-3 py-2"><ActionPill action={row.orcid_action} /></td>
                        <td className="px-3 py-2"><ActionPill action={row.idhal_action} /></td>
                        <td className="px-3 py-2"><ActionPill action={row.scopus_action} /></td>
                        <td className="px-3 py-2 whitespace-nowrap"><ActionPill action={row.etab_action} />{row.etab2_ppn && <> <ActionPill action={row.etab2_action} /></>}</td>
                        <td className="px-3 py-2"><span className="whitespace-nowrap">{row.labo_nom ? `${row.labo_nom.slice(0, 40)}${row.labo_nom.length > 40 ? '…' : ''} ` : ''}</span><ActionPill action={row.labo_action} />{row.labo2_ppn && <> <ActionPill action={row.labo2_action} /></>}</td>
                        <td className="px-3 py-2"><ActionPill action={row.note_340_action} /></td>
                        <td className="px-3 py-2 text-muted dark:text-[#8f897c] max-w-[280px]">{row.commentaire}</td>
                      </tr>
                    ))}
                    {preview.length === 0 && (
                      <tr><td colSpan={9} className="px-3 py-6 text-center text-muted dark:text-[#8f897c]"><Trans>No row to send with these options.</Trans></td></tr>
                    )}
                  </tbody>
                </table>
                {diff.enrichissements.length > preview.length && (
                  <div className="px-3 py-2 text-[11px] text-muted dark:text-[#8f897c] border-t border-ink/5 dark:border-white/5">
                    <Trans>Preview of the first {preview.length} rows out of {diff.enrichissements.length}.</Trans>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-t border-ink/5 dark:border-white/5">
          <div className="text-[12px] text-muted dark:text-[#8f897c]">
            {marked !== null
              ? <>
                  <Trans>{marked} records marked as sent on {extractionDate}.</Trans>
                  {tasksClosed !== null && tasksClosed > 0 && <> <Trans>{tasksClosed} « ABES batch » task(s) closed.</Trans></>}
                </>
              : <Trans>Workbook: sheets enrichissements, conflits, sans_notice, structures. Format and action vocabulary: docs/plan-export-abes-idref.md.</Trans>}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={downloadCsv} disabled={!diff || diff.enrichissements.length === 0} className="btn-pill disabled:opacity-40"><FileDown className="w-4 h-4" /> CSV</button>
            <button onClick={downloadXlsx} disabled={!diff} className="btn-pill disabled:opacity-40"><FileDown className="w-4 h-4" /> <Trans>XLSX workbook</Trans></button>
            {hasRole('admin') && (
              <button onClick={markSent} disabled={!diff || marking || diff.enrichissements.length === 0} className="btn-pill bg-ink text-white dark:bg-accent dark:text-ink disabled:opacity-40">
                {marking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} <Trans>Mark as sent</Trans>
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
};
