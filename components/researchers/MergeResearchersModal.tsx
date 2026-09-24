import React, { useEffect, useMemo, useState } from 'react';
import { X, GitMerge, RefreshCw, ArrowLeftRight, AlertTriangle, ShieldCheck, ChevronDown, ChevronRight } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { GristService, AnnuaireColumnMeta, gristDateToIso } from '../../lib/gristService';
import { buildMergeProposal, pickDefaultKeep, resolveMergeFields, MergeProposal, MergeField, MergeChoice, MergeRow } from '../../lib/mergeProposal';
import { getUserInfo } from '../../lib/auth';
import { apiErrorText } from '../../lib/apiErrors';

interface MergeResearchersModalProps {
  /** The two Annuaire rows (Grist row numbers) to merge. */
  rowIds: [number, number];
  onClose: () => void;
  /** Called after a successful merge (refresh the data, recompute the review…). */
  onMerged: (info: { keptRowId: number; droppedRowId: number; logId: number }) => void;
}

/** Columns shown first in the comparison. */
const FIELD_ORDER = [
  'Nom', 'Prenom', 'Civilite', 'uid_dyna', 'Email', 'LABO', 'team', 'Employeur', 'Corps_grade', 'TYPE_EMPLOI',
  'statut_dyna', 'HDR', 'validated', 'IdRef', 'IdHAL', 'ORCID', 'ID_SCOPUS', 'OpenAlex_ids', 'openalex_author_id',
];

/**
 * Merge assistant for two Annuaire rows (docs/archive/plan-fusion-doublons.md, lot 2).
 * Loads the two raw rows, proposes a row to keep and a value per diverging
 * field (lib/mergeProposal.ts), lets the user arbitrate, then writes via
 * GristService.mergeAnnuaireRows (logged in Fusions_log, restorable).
 */
export const MergeResearchersModal: React.FC<MergeResearchersModalProps> = ({ rowIds, onClose, onMerged }) => {
  const { t, i18n } = useLingui();
  const [rows, setRows] = useState<MergeRow[] | null>(null);
  const [columns, setColumns] = useState<AnnuaireColumnMeta[]>([]);
  const [etab, setEtab] = useState<Record<number, string>>({});
  const [keepRowId, setKeepRowId] = useState<number | null>(null);
  const [choices, setChoices] = useState<Record<string, MergeChoice>>({});
  const [showSame, setShowSame] = useState(false);
  const [confirmDifferentPerson, setConfirmDifferentPerson] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const [rs, cols, labels] = await Promise.all([
          GristService.fetchAnnuaireRows(rowIds),
          GristService.fetchAnnuaireColumns(),
          GristService.fetchInstitutionLabels().catch(() => ({} as Record<number, string>)),
        ]);
        if (cancelled) return;
        if (rs.length !== 2) throw new Error(t`One of the two rows cannot be found in Grist (already merged or deleted?)`);
        setRows(rs);
        setColumns(cols);
        setEtab(labels);
        setKeepRowId(pickDefaultKeep(rs[0], rs[1]).keep.rowId);
      } catch (e: any) {
        if (!cancelled) setError(apiErrorText(e) || String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [rowIds[0], rowIds[1]]);

  /** Proposal recomputed when the kept row changes; manual choices are reset. */
  const proposal: MergeProposal | null = useMemo(() => {
    if (!rows || keepRowId === null) return null;
    const keep = rows.find((r) => r.rowId === keepRowId)!;
    const drop = rows.find((r) => r.rowId !== keepRowId)!;
    return buildMergeProposal(keep, drop, columns);
  }, [rows, keepRowId, columns]);
  useEffect(() => { setChoices({}); }, [keepRowId]);

  const effective: MergeProposal | null = useMemo(() => {
    if (!proposal) return null;
    return { ...proposal, fields: proposal.fields.map((f) => (choices[f.col] ? { ...f, choice: choices[f.col] } : f)) };
  }, [proposal, choices]);

  const colType = (col: string) => columns.find((c) => c.id === col)?.type || '';
  const fmt = (col: string, v: any): string => {
    if (v === null || v === undefined || v === '') return '';
    const type = colType(col);
    if (type.startsWith('Date')) return gristDateToIso(v) || String(v);
    if (type.startsWith('Ref:') && typeof v === 'number') return etab[v] ? `${etab[v]} (#${v})` : `#${v}`;
    if (type === 'Bool') return v ? t`yes` : t`no`;
    if (Array.isArray(v)) return v.filter((x) => x !== 'L').join(', ');
    return String(v);
  };
  const reasonLabel = (r: string): string => {
    switch (r) {
      case 'validated': return t`the manually validated row wins`;
      case 'validation_date': return t`most recent validation`;
      case 'ldap_date': return t`most recent LDAP update`;
      case 'ldap_name': return t`civil-status spelling (LDAP row)`;
      case 'fill': return t`fills an empty field`;
      case 'latest': return t`most recent date`;
      case 'concat': return t`union of both values`;
      default: return t`default: kept row`;
    }
  };

  const ordered = (fields: MergeField[]) => [...fields].sort((a, b) => {
    const ia = FIELD_ORDER.indexOf(a.col); const ib = FIELD_ORDER.indexOf(b.col);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.label.localeCompare(b.label);
  });
  const decisions = effective ? ordered(effective.fields.filter((f) => f.kind !== 'same')) : [];
  const sameFields = effective ? ordered(effective.fields.filter((f) => f.kind === 'same')) : [];

  const handleMerge = async () => {
    if (!effective) return;
    try {
      setSaving(true);
      setError('');
      const today = new Date().toISOString().slice(0, 10);
      const fields = resolveMergeFields(effective, today);
      const user = getUserInfo();
      const author = user.preferred_username || user.name || 'druid';
      const { logId } = await GristService.mergeAnnuaireRows({
        keepRowId: effective.keep.rowId, dropRowId: effective.drop.rowId, fields, author,
        note: effective.sameUid ? '' : 'uid_dyna différents ou absents — même personne confirmée par l’utilisateur',
      });
      onMerged({ keptRowId: effective.keep.rowId, droppedRowId: effective.drop.rowId, logId });
    } catch (e: any) {
      setError(apiErrorText(e) || String(e));
    } finally {
      setSaving(false);
    }
  };

  const rowTitle = (r: MergeRow) => {
    const f = r.fields;
    return `${String(f['Prenom'] || '')} ${String(f['Nom'] || '')}`.trim() || '—';
  };
  const canMerge = !!effective && !saving && (effective.sameUid || confirmDifferentPerson);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-5xl max-h-[90vh] flex flex-col rounded-hero bg-cream-100 dark:bg-[#201e1a] shadow-soft-lg border border-white/50 dark:border-white/10 overflow-hidden">
        <header className="flex items-center justify-between px-6 py-4 border-b border-ink/5 dark:border-white/5">
          <div className="flex items-center gap-3">
            <GitMerge className="w-5 h-5 text-ink dark:text-accent" />
            <div>
              <h2 className="font-disp text-lg font-bold tracking-tight text-ink dark:text-[#f5f2ea]"><Trans>Merge two records</Trans></h2>
              <p className="text-[12px] text-muted-light dark:text-[#8f897c]"><Trans>The kept row is completed, then the other one is deleted. The operation is logged in Grist (Fusions_log table) and can be restored.</Trans></p>
            </div>
          </div>
          <button onClick={onClose} disabled={saving} className="p-2 rounded-full hover:bg-ink/5 dark:hover:bg-white/10 text-muted dark:text-[#8f897c]"><X className="w-5 h-5" /></button>
        </header>

        <div className="flex-1 overflow-auto px-6 py-5 space-y-5">
          {error && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-card bg-[rgba(214,69,69,.12)] border border-[rgba(214,69,69,.35)] text-[13px] font-semibold text-[#b23b3b] dark:text-[#f08c8c]">
              <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
            </div>
          )}
          {loading && <p className="text-[13px] text-muted-faint flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> <Trans>Loading both rows…</Trans></p>}

          {effective && rows && (
            <>
              {/* Choice of the kept row */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {rows.map((r) => {
                  const isKeep = r.rowId === effective.keep.rowId;
                  const f = r.fields;
                  return (
                    <button
                      key={r.rowId}
                      type="button"
                      onClick={() => setKeepRowId(r.rowId)}
                      className={`text-left rounded-card p-4 border transition-colors ${isKeep
                        ? 'bg-white/80 dark:bg-white/10 border-ink/20 dark:border-accent/50 shadow-soft'
                        : 'bg-white/30 dark:bg-white/[.03] border-ink/5 dark:border-white/5 opacity-75 hover:opacity-100'}`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-disp text-[15px] font-semibold text-ink dark:text-[#f5f2ea]">{rowTitle(r)}</span>
                        <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${isKeep ? 'bg-ink text-white dark:bg-accent dark:text-ink' : 'bg-white/60 dark:bg-white/5 text-muted dark:text-[#8f897c]'}`}>
                          {isKeep ? t`Kept` : t`Absorbed`}
                        </span>
                      </div>
                      <div className="text-[12px] text-muted dark:text-[#8f897c] flex flex-wrap gap-x-3 gap-y-0.5">
                        <span className="font-mono">G-{r.rowId}</span>
                        <span>{String(f['LABO'] || '∅')}</span>
                        {f['uid_dyna'] && <span className="font-mono">{String(f['uid_dyna'])}</span>}
                        {f['validated'] && <span className="inline-flex items-center gap-1 text-[#1f7a4d] dark:text-[#5fd39a]"><ShieldCheck className="w-3 h-3" /> <Trans>validated</Trans></span>}
                        <span className="truncate max-w-full" title={String(f['Data_source'] || '')}>{String(f['Data_source'] || '—')}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
              <p className="text-[12px] text-muted-faint flex items-center gap-1.5">
                <ArrowLeftRight className="w-3.5 h-3.5" />
                <Trans>Click a record to make it the kept row (suggested: outside the holding area, then validated, then the most complete).</Trans>
              </p>

              {!effective.sameUid && (
                <label className="flex items-start gap-3 px-4 py-3 rounded-card bg-[rgba(224,158,42,.18)] dark:bg-[rgba(224,158,42,.14)] border border-[rgba(224,158,42,.45)] text-[13px] text-[#9a6a12] dark:text-[#f0c266] cursor-pointer">
                  <input type="checkbox" className="mt-0.5 w-4 h-4" checked={confirmDifferentPerson} onChange={(e) => setConfirmDifferentPerson(e.target.checked)} />
                  <span><AlertTriangle className="w-4 h-4 inline mr-1" /><Trans>The two rows do not share the same uid_dyna. I confirm they are the same person.</Trans></span>
                </label>
              )}

              {/* Field-by-field decisions */}
              <section>
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-ink/5 dark:border-white/5">
                  <h3 className="font-disp text-base font-bold tracking-tight text-ink dark:text-[#f5f2ea]"><Trans>Fields to decide ({decisions.length})</Trans></h3>
                  <span className="text-[12px] text-muted-faint"><Trans>Suggested value pre-selected — change it if needed.</Trans></span>
                </div>
                {decisions.length === 0 ? (
                  <p className="text-[13px] text-muted-faint"><Trans>No difference: the absorbed row adds nothing and will simply be deleted.</Trans></p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-[12.5px]">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-[.09em] text-muted-lighter dark:text-[#8f897c]">
                          <th className="text-left py-1.5 pr-3 font-bold"><Trans>Field</Trans></th>
                          <th className="text-left py-1.5 pr-3 font-bold w-[36%]"><Trans>Kept</Trans> <span className="font-mono normal-case">G-{effective.keep.rowId}</span></th>
                          <th className="text-left py-1.5 pr-3 font-bold w-[36%]"><Trans>Absorbed</Trans> <span className="font-mono normal-case">G-{effective.drop.rowId}</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {decisions.map((f) => {
                          const editable = f.kind === 'conflict' || f.kind === 'validation';
                          const cell = (side: 'keep' | 'drop', v: any) => {
                            const active = f.choice === side || f.choice === 'both';
                            const label = f.kind === 'validation'
                              ? (side === 'keep' ? effective.keep : effective.drop).fields['validated']
                                ? t`validated (${fmt('validation_source', (side === 'keep' ? effective.keep : effective.drop).fields['validation_source']) || '—'}, ${fmt('validation_date', (side === 'keep' ? effective.keep : effective.drop).fields['validation_date']) || '—'})`
                                : t`not validated`
                              : fmt(f.col, v);
                            return (
                              <td className="py-1.5 pr-3 align-top">
                                <label className={`flex items-start gap-2 rounded-md px-2 py-1 ${active ? 'bg-accent/20 dark:bg-accent/10' : ''} ${editable ? 'cursor-pointer' : ''}`}>
                                  {editable && (
                                    <input type="radio" name={`f-${f.col}`} className="mt-0.5" checked={f.choice === side} onChange={() => setChoices((c) => ({ ...c, [f.col]: side }))} />
                                  )}
                                  <span className={`break-words ${active ? 'text-ink dark:text-[#f5f2ea] font-semibold' : 'text-muted dark:text-[#8f897c]'}`}>{label || <span className="italic text-muted-faint">{t`empty`}</span>}</span>
                                </label>
                              </td>
                            );
                          };
                          return (
                            <tr key={f.col} className="border-t border-ink/5 dark:border-white/5">
                              <td className="py-1.5 pr-3 align-top">
                                <div className="font-semibold text-ink dark:text-[#f5f2ea]">{f.label}</div>
                                <div className="text-[11px] text-muted-faint" title={f.col}>
                                  {f.kind === 'fill' && <Trans>fill-in</Trans>}
                                  {f.kind === 'concat' && <Trans>union</Trans>}
                                  {(f.kind === 'conflict' || f.kind === 'validation') && <span>{t`conflict`} · {reasonLabel(f.reason)}</span>}
                                </div>
                              </td>
                              {cell('keep', f.keepValue)}
                              {cell('drop', f.dropValue)}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {/* Identical / already filled fields */}
              <section>
                <button type="button" onClick={() => setShowSame((v) => !v)} className="flex items-center gap-1.5 text-[12px] font-semibold text-muted dark:text-[#8f897c] hover:text-ink dark:hover:text-[#f5f2ea]">
                  {showSame ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  <Trans>Fields without decision ({sameFields.length}) — identical, or filled only on the kept row</Trans>
                </button>
                {showSame && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {sameFields.map((f) => (
                      <span key={f.col} className="px-2.5 py-0.5 rounded-full bg-white/50 dark:bg-white/5 border border-ink/5 dark:border-white/10 text-[11px] text-muted dark:text-[#8f897c]" title={fmt(f.col, f.keepValue)}>
                        {f.label}{fmt(f.col, f.keepValue) ? ` : ${fmt(f.col, f.keepValue).slice(0, 40)}` : ''}
                      </span>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        <footer className="px-6 py-4 border-t border-ink/5 dark:border-white/5 bg-white/50 dark:bg-white/[.03] flex items-center justify-between gap-3">
          <span className="text-[12px] text-muted-faint">
            {effective && <Trans>Will be deleted: G-{effective.drop.rowId}. A trace is added to Data_source and Commentaires of G-{effective.keep.rowId}.</Trans>}
          </span>
          <div className="flex items-center gap-3">
            <button onClick={onClose} disabled={saving} className="inline-flex items-center justify-center gap-2 h-10 px-5 rounded-full font-disp font-semibold text-[13px] bg-white/75 dark:bg-white/10 border border-white/80 dark:border-white/15 text-ink dark:text-[#f5f2ea] hover:bg-white dark:hover:bg-white/15 shadow-soft transition-colors disabled:opacity-50">
              <Trans>Cancel</Trans>
            </button>
            <button
              onClick={handleMerge}
              disabled={!canMerge}
              className="inline-flex items-center justify-center gap-2 h-10 px-6 rounded-full font-disp font-semibold text-[13px] bg-ink text-white hover:bg-black dark:bg-accent dark:text-ink dark:hover:bg-accent-strong shadow-soft transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <GitMerge className="w-4 h-4" />}
              {saving ? t`Merging…` : t`Merge`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};
