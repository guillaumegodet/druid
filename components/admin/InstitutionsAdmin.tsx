import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Building2, CheckCircle2, ExternalLink, Loader2, Pencil, Plus, RefreshCw, Search, X } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import type { Researcher } from '../../types';
import type { Institution } from '../../lib/directory/gristMapping';
import type { InstitutionInput } from '../../lib/directory/institutionWrite';
import { DirectoryApi } from '../../lib/directoryApi';
import { GristService } from '../../lib/gristService';
import { apiErrorText } from '../../lib/apiErrors';
import { numberLocale } from '../../lib/i18n';

/** Form fields of an institution (the five columns of the Etablissements table). */
type InstitutionForm = Required<InstitutionInput>;
const EMPTY_FORM: InstitutionForm = { name: '', label: '', uai: '', ror: '', idref: '' };
const formOf = (e: Institution): InstitutionForm => ({ name: e.name, label: e.label === e.name ? '' : e.label, uai: e.uai, ror: e.ror, idref: e.idref });

const inputCls = 'input-soft py-1.5 text-sm font-normal w-full';
const labelCls = 'flex flex-col gap-1 text-xs font-semibold text-muted dark:text-[#c3beb0]';
const linkCls = 'inline-flex items-center gap-1 text-ink dark:text-[#f5f2ea] hover:underline';

/** Comparison key of the search box and of the sort: case and accents ignored. */
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/**
 * @component InstitutionsAdmin
 * @description « Administration › Institutions »: the employing institutions offered by the record form (« Employing
 * institution » dropdown) — the `Etablissements` table of the directory, read through GET /api/v1/institutions and
 * written through POST / PUT /api/v1/institutions (institution right). Each row: name (the dropdown value), long
 * form, UAI, ROR, IdRef, and how many directory records carry it. No deletion from here: records reference the rows.
 */
export const InstitutionsAdmin: React.FC<{
  /** Loaded directory, to count the records of each institution (by employer name). */
  researchers?: Researcher[];
}> = ({ researchers = [] }) => {
  const { t } = useLingui();
  const [items, setItems] = useState<Institution[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const [form, setForm] = useState<InstitutionForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formOk, setFormOk] = useState<string | null>(null);

  /** Row being edited (id) and its draft. */
  const [editing, setEditing] = useState<{ id: number; draft: InstitutionForm } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    DirectoryApi.institutions()
      .then((list) => setItems(list))
      .catch((e: unknown) => setError(apiErrorText(e)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  /** Records per employer name (the record form stores the name, not the row id). */
  const usage = useMemo(() => {
    const out = new Map<string, number>();
    for (const r of researchers) {
      const name = r.employment?.employer;
      if (name) out.set(name, (out.get(name) ?? 0) + 1);
    }
    return out;
  }, [researchers]);

  const visible = useMemo(() => {
    const q = fold(query.trim());
    const list = items ?? [];
    return q ? list.filter((e) => [e.name, e.label, e.uai, e.ror, e.idref].some((v) => fold(v || '').includes(q))) : list;
  }, [items, query]);

  /** After a write: the API list again, and the cached dropdown of the record form dropped. */
  const written = () => {
    GristService.invalidateInstitutions();
    load();
  };

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    setFormOk(null);
    try {
      await DirectoryApi.createInstitution(form);
      const name = form.name.trim();
      setForm(EMPTY_FORM);
      setFormOk(t`“${name}” added: it is now offered in the employing institution dropdown of the record form.`);
      written();
    } catch (err) {
      setFormError(apiErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  const submitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    setEditError(null);
    try {
      await DirectoryApi.updateInstitution(editing.id, editing.draft);
      setEditing(null);
      written();
    } catch (err) {
      setEditError(apiErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  const field = (draft: InstitutionForm, set: (d: InstitutionForm) => void, key: keyof InstitutionForm, label: React.ReactNode, placeholder: string, required = false) => (
    <label className={labelCls}>
      {label}
      <input className={inputCls} required={required} value={draft[key]} placeholder={placeholder} maxLength={200}
        onChange={(ev) => set({ ...draft, [key]: ev.target.value })} />
    </label>
  );
  const fields = (draft: InstitutionForm, set: (d: InstitutionForm) => void) => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
      {field(draft, set, 'name', <Trans>Name (dropdown value)</Trans>, t`e.g. U PARIS NANTERRE`, true)}
      {field(draft, set, 'label', <Trans>Long form</Trans>, t`e.g. Université Paris Nanterre`)}
      {field(draft, set, 'uai', <Trans>UAI code</Trans>, '0921204J')}
      {field(draft, set, 'ror', <Trans>ROR identifier</Trans>, '013bkhk48')}
      {field(draft, set, 'idref', <Trans>IdRef PPN</Trans>, '026403587')}
    </div>
  );

  const nf = new Intl.NumberFormat(numberLocale());

  return (
    <div className="flex flex-col gap-6">
      {/* ── New institution ─────────────────────────────────────────────── */}
      <form onSubmit={submitCreate} className="glass-card p-4 flex flex-col gap-3">
        <h4 className="font-disp font-semibold text-[14px] text-ink dark:text-[#f5f2ea] flex items-center gap-2">
          <Plus className="w-4 h-4" /> <Trans>Add an employing institution</Trans>
        </h4>
        <p className="text-[11px] text-muted dark:text-[#c3beb0] -mt-1">
          <Trans>The name is what the record form shows in its « Employing institution » dropdown (short, in capitals like the existing ones). The identifiers are optional: UAI (7 digits and a letter), ROR (9 characters, with or without https://ror.org/), IdRef PPN (9 characters).</Trans>
        </p>
        {fields(form, setForm)}
        {formError && (
          <div className="flex items-start gap-2 text-xs text-[#b23b3b] dark:text-[#f08c8c]">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {formError}
          </div>
        )}
        {formOk && (
          <div className="flex items-start gap-2 text-xs text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {formOk}
          </div>
        )}
        <button type="submit" disabled={busy || !form.name.trim()}
          className="self-start inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-xs font-semibold bg-ink text-white dark:bg-[#f5f2ea] dark:text-[#1c1a14] disabled:opacity-50">
          {busy && !editing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          <Trans>Add</Trans>
        </button>
      </form>

      {/* ── List ────────────────────────────────────────────────────────── */}
      <div className="glass-card p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h4 className="font-disp font-semibold text-[14px] text-ink dark:text-[#f5f2ea] flex items-center gap-2">
            <Building2 className="w-4 h-4" /> <Trans>Employing institutions ({items?.length ?? '…'})</Trans>
          </h4>
          <div className="flex items-center gap-3">
            <label className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted dark:text-[#c3beb0]" />
              <input className="input-soft py-1 pl-8 text-sm font-normal w-56" value={query} placeholder={t`Filter…`}
                onChange={(e) => setQuery(e.target.value)} aria-label={t`Filter the institutions`} />
            </label>
            <button type="button" onClick={load}
              className="inline-flex items-center gap-1 text-xs text-muted dark:text-[#c3beb0] hover:text-ink dark:hover:text-[#f5f2ea]">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> <Trans>Refresh</Trans>
            </button>
          </div>
        </div>
        {error && (
          <div className="flex items-center gap-2 text-sm text-[#b23b3b] dark:text-[#f08c8c]">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}
        {loading && !items ? (
          <div className="flex items-center gap-2 text-[13px] text-muted dark:text-[#c3beb0] py-6 justify-center">
            <RefreshCw className="w-4 h-4 animate-spin" /> <Trans>Loading institutions…</Trans>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-muted dark:text-[#c3beb0] border-b border-white/60 dark:border-white/10">
                  <th className="py-1.5 pr-3 font-semibold"><Trans>Name</Trans></th>
                  <th className="py-1.5 pr-3 font-semibold"><Trans>Long form</Trans></th>
                  <th className="py-1.5 pr-3 font-semibold">UAI</th>
                  <th className="py-1.5 pr-3 font-semibold">ROR</th>
                  <th className="py-1.5 pr-3 font-semibold">IdRef</th>
                  <th className="py-1.5 pr-3 font-semibold text-right"><Trans>Records</Trans></th>
                  <th className="py-1.5 pr-3 font-semibold"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((e) => editing?.id === e.id ? (
                  <tr key={e.id} className="border-b border-white/40 dark:border-white/5 last:border-0">
                    <td colSpan={7} className="py-3 pr-3">
                      <form onSubmit={submitEdit} className="flex flex-col gap-3">
                        {fields(editing.draft, (draft) => setEditing({ id: e.id, draft }))}
                        {editError && (
                          <div className="flex items-start gap-2 text-xs text-[#b23b3b] dark:text-[#f08c8c]">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {editError}
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <button type="submit" disabled={busy || !editing.draft.name.trim()}
                            className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-xs font-semibold bg-ink text-white dark:bg-[#f5f2ea] dark:text-[#1c1a14] disabled:opacity-50">
                            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                            <Trans>Save</Trans>
                          </button>
                          <button type="button" onClick={() => { setEditing(null); setEditError(null); }}
                            className="inline-flex items-center gap-1 h-8 px-3 rounded-full text-xs text-muted dark:text-[#c3beb0] hover:text-ink dark:hover:text-[#f5f2ea]">
                            <X className="w-3.5 h-3.5" /> <Trans>Cancel</Trans>
                          </button>
                        </div>
                      </form>
                    </td>
                  </tr>
                ) : (
                  <tr key={e.id} className="border-b border-white/40 dark:border-white/5 last:border-0">
                    <td className="py-1.5 pr-3 font-medium text-ink dark:text-[#f5f2ea] whitespace-nowrap">{e.name}</td>
                    <td className="py-1.5 pr-3 text-muted dark:text-[#c3beb0]">{e.label !== e.name ? e.label : ''}</td>
                    <td className="py-1.5 pr-3 text-muted dark:text-[#c3beb0] font-mono text-[11.5px]">{e.uai}</td>
                    <td className="py-1.5 pr-3 font-mono text-[11.5px]">
                      {e.ror && (
                        <a href={`https://ror.org/${e.ror}`} target="_blank" rel="noopener noreferrer" className={linkCls}>
                          {e.ror} <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-[11.5px]">
                      {e.idref && (
                        <a href={`https://www.idref.fr/${e.idref}`} target="_blank" rel="noopener noreferrer" className={linkCls}>
                          {e.idref} <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums text-muted dark:text-[#c3beb0]">
                      {usage.get(e.name) ? nf.format(usage.get(e.name)!) : ''}
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      <button type="button" onClick={() => { setEditing({ id: e.id, draft: formOf(e) }); setEditError(null); }}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted dark:text-[#c3beb0] hover:text-ink dark:hover:text-[#f5f2ea]">
                        <Pencil className="w-3 h-3" /> <Trans>Edit</Trans>
                      </button>
                    </td>
                  </tr>
                ))}
                {items && visible.length === 0 && (
                  <tr><td colSpan={7} className="py-4 text-center text-muted dark:text-[#c3beb0]"><Trans>No institution matches.</Trans></td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[11px] text-muted dark:text-[#c3beb0]">
          <Trans>Institutions are never deleted from here: directory records refer to them. « Records » counts the loaded records whose employer is this institution.</Trans>
        </p>
      </div>
    </div>
  );
};
