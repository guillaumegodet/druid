// Sharing of a report (docs/plan-mes-rapports.md § 4.7, lot 6): named grantees (read only or
// edit), visibility to every user of the instance, and — super admins — publication as an
// instance template. Readers see the report computed with their own access to the data
// (decision R1): a block on a structure they cannot open shows as unavailable.

import React, { useEffect, useMemo, useState } from 'react';
import { Check, Copy, RefreshCw, Trash2, UserPlus, X } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { apiErrorText } from '../../lib/apiErrors';
import { getUserInfo, isSuperAdmin } from '../../lib/auth';
import { copyToClipboard } from '../../lib/clipboard';
import { CHART_META } from '../dashboard/chartMeta';
import type { ReportDefinition } from '../dashboard/report/definition';
import type { ReportsBackend, ShareRole, StoredReport } from '../dashboard/report/reportsApi';
import { selectCls } from './ReportControls';

/** A person the report can be shared with (suggestion list). */
export interface ShareCandidate {
  id: string;
  label: string;
}

export const ShareDialog: React.FC<{
  report: StoredReport;
  definition: ReportDefinition;
  backend: ReportsBackend;
  candidates: ShareCandidate[];
  onClose: () => void;
  onSaved: (r: StoredReport) => void;
}> = ({ report, definition, backend, candidates, onClose, onSaved }) => {
  const { t } = useLingui();
  const [shares, setShares] = useState<{ grantee: string; role: ShareRole }[]>(
    () => (report.shares ?? []).map((s) => ({ grantee: s.grantee, role: s.role === 'editor' ? 'editor' : 'viewer' })),
  );
  const [instanceWide, setInstanceWide] = useState(report.visibility === 'instance');
  const [template, setTemplate] = useState(!!report.publishedTemplate);
  const [grantee, setGrantee] = useState('');
  const [role, setRole] = useState<ShareRole>('viewer');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const me = getUserInfo().preferred_username.toLowerCase();
  const labelOf = useMemo(() => new Map(candidates.map((c) => [c.id.toLowerCase(), c.label])), [candidates]);
  const nominative = useMemo(
    () => definition.blocks.some((b) => b.kind === 'chart' && CHART_META[b.chartId]?.nominative),
    [definition],
  );
  const link = `${window.location.origin}/?page=REPORTS&id=${report.id}`;

  const add = () => {
    const id = grantee.trim().toLowerCase();
    if (!id || id === me || id === report.owner.toLowerCase()) return;
    setShares((cur) => [...cur.filter((s) => s.grantee !== id), { grantee: id, role }]);
    setGrantee('');
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await backend.setShares(report.id, shares);
      const update: { visibility: 'private' | 'instance'; publishedTemplate?: boolean } = {
        visibility: instanceWide ? 'instance' : 'private',
      };
      if (isSuperAdmin()) update.publishedTemplate = template;
      onSaved(await backend.update(report.id, update));
      onClose();
    } catch (e) {
      setError(apiErrorText(e));
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-ink/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="glass-card-strong w-full max-w-lg max-h-[90vh] overflow-auto p-5 flex flex-col gap-4 bg-white/95 dark:bg-[#33312c]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-disp font-bold text-xl text-ink dark:text-[#f5f2ea]"><Trans>Share the report</Trans></h2>
            <p className="text-sm text-muted dark:text-[#c3beb0]">{report.name}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t`Close`} className="p-1.5 rounded-lg hover:bg-ink/5 dark:hover:bg-white/10">
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-muted dark:text-[#c3beb0]">
          <Trans>Each reader sees the report computed with their own access to the data: a chart on a structure they cannot open shows as unavailable.</Trans>
        </p>
        {nominative && (
          <p className="text-xs text-[#9a6b00] dark:text-[#f4d24a]">
            <Trans>This report names people (researcher rankings, co-authorship network…): share it with care.</Trans>
          </p>
        )}

        <section className="flex flex-col gap-2">
          <h3 className="section-label"><Trans>People</Trans></h3>
          {shares.length === 0 && (
            <p className="text-sm text-muted-light dark:text-[#8f897c]"><Trans>Not shared with anyone yet.</Trans></p>
          )}
          <ul className="flex flex-col gap-1">
            {shares.map((s) => (
              <li key={s.grantee} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate">
                  {labelOf.get(s.grantee) ?? s.grantee}
                  {labelOf.has(s.grantee) && <span className="text-xs text-muted-light"> · {s.grantee}</span>}
                </span>
                <select
                  className={selectCls}
                  value={s.role}
                  onChange={(e) => setShares((cur) => cur.map((x) => (x.grantee === s.grantee ? { ...x, role: e.target.value as ShareRole } : x)))}
                >
                  <option value="viewer">{t`Can view`}</option>
                  <option value="editor">{t`Can edit`}</option>
                </select>
                <button
                  type="button"
                  onClick={() => setShares((cur) => cur.filter((x) => x.grantee !== s.grantee))}
                  aria-label={t`Remove`}
                  className="p-1.5 rounded hover:bg-ink/10 dark:hover:bg-white/10"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input-soft flex-1 min-w-[200px]"
              list="report-share-candidates"
              value={grantee}
              onChange={(e) => setGrantee(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
              placeholder={me.includes('@') ? t`E-mail address` : t`Login (uid)`}
              aria-label={t`Person to add`}
            />
            <datalist id="report-share-candidates">
              {candidates.slice(0, 2000).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </datalist>
            <select className={selectCls} value={role} onChange={(e) => setRole(e.target.value as ShareRole)}>
              <option value="viewer">{t`Can view`}</option>
              <option value="editor">{t`Can edit`}</option>
            </select>
            <button type="button" onClick={add} disabled={!grantee.trim()} className="btn-pill h-9 px-3 text-[13px] disabled:opacity-40">
              <UserPlus className="w-4 h-4" /> <Trans>Add</Trans>
            </button>
          </div>
        </section>

        <section className="flex flex-col gap-2 text-sm">
          <label className="flex items-start gap-2 cursor-pointer">
            <input type="checkbox" className="mt-1" checked={instanceWide} onChange={(e) => setInstanceWide(e.target.checked)} />
            <span>
              <Trans>Visible to every user of this instance</Trans>
              <span className="block text-xs text-muted-light dark:text-[#8f897c]"><Trans>Read only; anyone can duplicate it to make their own version.</Trans></span>
            </span>
          </label>
          {isSuperAdmin() && (
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" className="mt-1" checked={template} onChange={(e) => setTemplate(e.target.checked)} />
              <span>
                <Trans>Publish as a template of the instance</Trans>
                <span className="block text-xs text-muted-light dark:text-[#8f897c]"><Trans>Offered to everyone in « New report », on the structure and period they choose.</Trans></span>
              </span>
            </label>
          )}
        </section>

        <div className="flex items-center gap-2 text-xs">
          <code className="flex-1 truncate px-2 py-1.5 rounded bg-ink/5 dark:bg-white/10">{link}</code>
          <button
            type="button"
            className="btn-pill h-8 px-3 text-[12px]"
            onClick={() => void copyToClipboard(link).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); })}
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />} {copied ? t`Copied!` : t`Copy link`}
          </button>
        </div>

        {error && <p className="text-sm text-[#b23b3b] dark:text-[#f08c8c]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-pill h-9 px-4 text-[13px]"><Trans>Cancel</Trans></button>
          <button type="button" onClick={() => void save()} disabled={saving} className="btn-pill-dark h-9 px-4 text-[13px] disabled:opacity-40">
            {saving && <RefreshCw className="w-4 h-4 animate-spin" />}
            <Trans>Save</Trans>
          </button>
        </div>
      </div>
    </div>
  );
};
