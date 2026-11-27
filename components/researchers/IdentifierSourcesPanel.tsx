import React from 'react';
import { BadgeCheck, History, X } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { DirectoryApi } from '../../lib/directoryApi';
import { SOURCE_LABELS } from '../../lib/fieldConflicts';
import { isSovisuplusAuthor, sovisuplusMarks, type SovisuplusMark } from '../../lib/identifierMarks';
import type { IdentifierSourceDetail } from '../../types';

const SCHEME_LABELS: Record<string, string> = {
  orcid: 'ORCID', idref: 'IdRef', idhal: 'IdHAL', idhal_i: 'IdHAL_i', scopus: 'Scopus', openalex: 'OpenAlex',
};
const ALIGN_LABELS: Record<string, string> = { orcid: 'ORCID', idref: 'IdRef', hal: 'HAL', openalex: 'OpenAlex', scopus: 'Scopus' };

/**
 * Sources of the identifiers of a record (lot 4 b of druid-internal `docs/plan-maj-chercheurs.md`): for each value,
 * primary or secondary, who brought it (alignment, import, record, job…) and when, and the values a person set aside
 * (« Rejeté » — also written when a value is removed from the record — or « Identité mêlée »), which the alignments
 * no longer propose nor write back. Read on demand.
 */
export const IdentifierSourcesButton: React.FC<{ recordId?: number }> = ({ recordId }) => {
  const { t, i18n } = useLingui();
  const [open, setOpen] = React.useState(false);
  const [data, setData] = React.useState<Record<string, IdentifierSourceDetail[]> | null>(null);
  const [error, setError] = React.useState('');
  if (!recordId) return null;
  const sourceName = (code: string) => {
    if (code.startsWith('align:')) { const name = ALIGN_LABELS[code.slice(6)] ?? code.slice(6); return t`Alignment ${name}`; }
    if (code === 'job') return t`Automatic job`;
    if (code === 'sovisuplus:auth') return t`SoVisu+, authenticated by the researcher`;
    if (code === 'sovisuplus') return t`SoVisu+, typed by library staff`;
    return SOURCE_LABELS[code] ? i18n._(SOURCE_LABELS[code]) : code;
  };
  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next) return;
    setError('');
    try { setData((await DirectoryApi.identifierSources(recordId)).identifiers); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <span className="relative inline-block">
      <button type="button" onClick={toggle} aria-expanded={open} className="btn-pill h-7 text-[11px]" title={t`Where each identifier comes from`}>
        <History className="w-3 h-3" /> <Trans>Sources</Trans>
      </button>
      {open && (
        <div role="dialog" aria-label={t`Sources of the identifiers`}
          className="absolute right-0 top-full mt-1 z-20 w-[22rem] max-h-[28rem] overflow-auto rounded-xl border border-ink/10 dark:border-white/15 bg-white dark:bg-[#24221f] shadow-lg p-3 text-[12px] normal-case font-normal">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-ink dark:text-[#f5f2ea]"><Trans>Sources of the identifiers</Trans></span>
            <button type="button" onClick={() => setOpen(false)} aria-label={t`Close`} className="text-muted hover:text-ink"><X className="w-3.5 h-3.5" /></button>
          </div>
          {error && <p className="text-[#b23b3b] dark:text-[#f08c8c]">{error}</p>}
          {!data && !error && <p className="text-muted"><Trans>Loading…</Trans></p>}
          {data && Object.keys(data).length === 0 && <p className="text-muted"><Trans>No identifier recorded yet.</Trans></p>}
          {data && Object.entries(data).map(([scheme, values]) => (
            <div key={scheme} className="mb-2">
              <div className="text-[11px] font-bold uppercase tracking-wide text-muted-faint mb-0.5">{SCHEME_LABELS[scheme] ?? scheme}</div>
              <ul className="space-y-1">
                {values.map((v) => {
                  const by = isSovisuplusAuthor(v.setAside?.by) ? t`the researcher in SoVisu+` : v.setAside?.by ?? '';
                  const on = v.setAside?.at ? v.setAside.at.slice(0, 10) : '';
                  return (
                    <li key={v.value}>
                      <span className={`font-mono ${v.shown ? 'text-ink dark:text-[#f5f2ea]' : 'text-muted line-through'}`}>{v.value}</span>
                      {v.shown && <span className="ml-1 text-muted">{v.primary ? t`primary` : t`secondary`}</span>}
                      {v.sources.length > 0 && (
                        <span className="ml-1 text-muted">
                          · {v.sources.map((s) => `${sourceName(s.source)} ${s.at.slice(0, 10)}${s.by && !isSovisuplusAuthor(s.by) ? ` (${s.by})` : ''}`).join(', ')}
                        </span>
                      )}
                      {v.setAside && (
                        <div className="text-[11px] italic text-amber-800 dark:text-amber-300">
                          {v.setAside.decision === 'Rejeté'
                            ? <Trans>set aside by {by} on {on}: no longer proposed nor written back</Trans>
                            : <Trans>mixed identity, reported by {by} on {on}</Trans>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </span>
  );
};

/**
 * Marks of the identifiers changed in SoVisu+ (lot 6 of druid-internal docs/plan-retour-identifiants-sovisuplus.md),
 * read once with the record (PostgreSQL only: `recordId` is undefined otherwise).
 */
export const useSovisuplusMarks = (recordId?: number): Record<string, SovisuplusMark> => {
  const [marks, setMarks] = React.useState<Record<string, SovisuplusMark>>({});
  React.useEffect(() => {
    if (!recordId) { setMarks({}); return undefined; }
    let cancelled = false;
    DirectoryApi.identifierSources(recordId)
      .then((r) => { if (!cancelled) setMarks(sovisuplusMarks(r.identifiers)); })
      .catch(() => { if (!cancelled) setMarks({}); });
    return () => { cancelled = true; };
  }, [recordId]);
  return marks;
};

/** Pill next to an identifier the researcher or library staff chose in SoVisu+: change it knowingly. */
export const SovisuplusPill: React.FC<{ mark?: SovisuplusMark }> = ({ mark }) => {
  const { t } = useLingui();
  if (!mark) return null;
  const on = mark.at.slice(0, 10);
  const value = mark.value;
  const title = mark.kind === 'authenticated'
    ? t`Authenticated by the researcher in SoVisu+ on ${on}: the researcher proved this identifier is theirs.`
    : mark.kind === 'added'
      ? t`Typed in SoVisu+ by library staff on ${on}.`
      : t`${value} removed by the researcher in SoVisu+ on ${on}: set aside, no longer proposed by the alignments.`;
  const label = mark.kind === 'authenticated' ? t`authenticated in SoVisu+` : mark.kind === 'added' ? t`from SoVisu+` : t`removed in SoVisu+`;
  return (
    <span title={title} className={`ml-1.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[10px] font-semibold ${
      mark.kind === 'removed' ? 'bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300' : 'bg-[rgba(122,154,36,.15)] text-[#5d761b] dark:text-[#b9d36a]'}`}>
      {mark.kind === 'authenticated' && <BadgeCheck className="w-3 h-3" />}{label}
    </span>
  );
};
