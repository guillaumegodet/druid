import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw, RotateCw, ExternalLink, Settings } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { TasksApi, type OpenAlexAffiliationCorrection } from '../../lib/tasks';
import { apiErrorText } from '../../lib/apiErrors';
import { StatCard, PixelBtn } from './alignAtoms';

interface Props {
  /** Opens the ETL console of a structure (Administration), where the corrections are edited. */
  onOpenConsole?: (slug: string) => void;
}

const OPEN = new Set(['Détectée', 'Soumise']);
const MAX_ROWS = 300;

/**
 * « À traiter › Affiliations OpenAlex » tab (docs/plan-chantiers-taches.md, lot 6): read-only view
 * of the suspicious OpenAlex affiliations detected by the ETL console (Grist table
 * Corrections_affiliations_Openalex). Status, dates and notes stay edited in Administration ›
 * ETL console (CorrectionsPanel) — this tab only gathers what is left to do across labs.
 */
export const OpenAlexAffiliationsPage: React.FC<Props> = ({ onOpenConsole }) => {
  const { t } = useLingui();
  const [items, setItems] = useState<OpenAlexAffiliationCorrection[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [labo, setLabo] = useState('');
  const [openOnly, setOpenOnly] = useState(true);
  const [query, setQuery] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try { setItems(await TasksApi.openalexAffiliations()); }
    catch (e) { setError(apiErrorText(e)); setItems((prev) => prev ?? []); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const byLab = useMemo(() => {
    const m = new Map<string, { open: number; total: number }>();
    for (const c of items ?? []) {
      const k = c.labo_slug || '—';
      const cur = m.get(k) || { open: 0, total: 0 };
      cur.total++;
      if (OPEN.has(c.statut)) cur.open++;
      m.set(k, cur);
    }
    return [...m.entries()].sort((a, b) => b[1].open - a[1].open || a[0].localeCompare(b[0]));
  }, [items]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items ?? [])
      .filter((c) => !labo || c.labo_slug === labo)
      .filter((c) => !openOnly || OPEN.has(c.statut))
      .filter((c) => !q || `${c.titre} ${c.auteur} ${c.affiliation_brute}`.toLowerCase().includes(q))
      .sort((a, b) => String(b.annee).localeCompare(String(a.annee)));
  }, [items, labo, openOnly, query]);

  const openCount = (items ?? []).filter((c) => OPEN.has(c.statut)).length;
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-4 md:px-7 pt-2 pb-3 flex flex-wrap items-center gap-2">
        <select value={labo} onChange={(e) => setLabo(e.target.value)} className="input-soft !h-9 !py-1 text-[13px] w-auto">
          <option value="">{t`All labs`}</option>
          {byLab.map(([slug, n]) => <option key={slug} value={slug}>{slug} ({n.open})</option>)}
        </select>
        <label className="inline-flex items-center gap-1.5 text-[13px] text-ink dark:text-[#f5f2ea] cursor-pointer">
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} /> <Trans>To process only</Trans>
        </label>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t`Search (title, author, affiliation…)`} className="input-soft !h-9 !py-1 text-[13px] w-64" />
        <div className="flex-1" />
        {labo && onOpenConsole && (
          <PixelBtn onClick={() => onOpenConsole(labo)} title={t`Status, submission and notes are edited in the ETL console of the lab`}>
            <Settings className="w-4 h-4" /> <Trans>Process in the ETL console</Trans>
          </PixelBtn>
        )}
        <PixelBtn onClick={load} disabled={loading} title={t`Re-reads the Grist table`}>
          {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />} <Trans>Refresh</Trans>
        </PixelBtn>
      </div>

      <div className="flex-1 overflow-auto px-4 md:px-7 pb-6 space-y-4" data-page-scroll>
        {error && <p className="text-[13px] font-semibold text-[#b23b3b] dark:text-[#f08c8c]">{error}</p>}
        {!items ? (
          <div className="flex flex-col items-center justify-center py-24 text-muted-faint gap-3">
            <RefreshCw className="w-8 h-8 animate-spin" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <StatCard label={t`To process`} value={openCount} tone="bg-[rgba(231,111,154,.15)] dark:bg-[rgba(231,111,154,.12)]" />
              <StatCard label={t`Labs concerned`} value={byLab.filter(([, n]) => n.open > 0).length} />
              <StatCard label={t`Detected in total`} value={items.length} />
            </div>
            <p className="text-[12px] text-muted dark:text-[#8f897c]">
              <Trans>Publications whose raw OpenAlex affiliation does not match the lab. Read-only here: to submit a correction to OpenAlex or mark it processed, open the lab in the ETL console.</Trans>
            </p>
            {rows.length === 0 ? (
              <p className="text-[13px] text-muted dark:text-[#8f897c] py-8 text-center"><Trans>Nothing to show with these filters.</Trans></p>
            ) : (
              <div className="rounded-2xl border border-ink/10 dark:border-white/10 overflow-hidden bg-white/40 dark:bg-white/[.04]">
                <table className="w-full text-[13px]">
                  <thead className="text-[11px] uppercase tracking-wide text-muted-lighter dark:text-[#8f897c] bg-white/60 dark:bg-white/5">
                    <tr>
                      <th className="text-left px-3 py-2"><Trans>Lab</Trans></th>
                      <th className="text-left px-3 py-2"><Trans>Publication</Trans></th>
                      <th className="text-left px-3 py-2"><Trans>Author</Trans></th>
                      <th className="text-left px-3 py-2"><Trans>Raw affiliation</Trans></th>
                      <th className="text-left px-3 py-2"><Trans>Status</Trans></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, MAX_ROWS).map((c) => (
                      <tr key={c.id} className="border-t border-ink/5 dark:border-white/5 align-top">
                        <td className="px-3 py-2 font-semibold whitespace-nowrap">{c.labo_slug}</td>
                        <td className="px-3 py-2">
                          <a href={c.url_openalex || `https://openalex.org/works/${c.work_id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1 text-ink dark:text-[#f5f2ea] hover:underline">
                            <span>{c.titre || c.work_id}</span> <ExternalLink className="w-3 h-3 shrink-0 mt-1 text-muted-faint" />
                          </a>
                          <div className="text-[11px] text-muted-light dark:text-[#8f897c]">{c.annee}{c.raison_detection ? ` · ${c.raison_detection}` : ''}</div>
                        </td>
                        <td className="px-3 py-2">{c.auteur}</td>
                        <td className="px-3 py-2 text-[12px] text-muted dark:text-[#8f897c] whitespace-pre-wrap max-w-md">{c.affiliation_brute}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{c.statut}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > MAX_ROWS && (
                  <div className="px-3 py-2 text-[11px] text-muted dark:text-[#8f897c] border-t border-ink/5 dark:border-white/5">
                    <Trans>First {MAX_ROWS} rows out of {rows.length} — narrow with the lab filter.</Trans>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
