import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, CheckCircle2, ClipboardPaste, ExternalLink, FileCode, FileUp, Link2, Loader2, Pencil, Plus, Trash2, Upload, X } from 'lucide-react';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { i18n } from '@lingui/core';
import { apiErrorText, translateApiError } from '../../lib/apiErrors';
import { numberLocale } from '../../lib/i18n';
import { FUNDER_CATEGORIES, type FunderCategory } from '../../lib/calls/programmes';
import { categoryOf, slugOf, type ExtractedCall, type FunderView, type ManualCallInput, type ManualCallView, type ManualProgrammeView, type ReviewStatus } from '../../lib/calls/manual';
import type { CatalogueReport } from '../../lib/calls/manualStore';
import { isResearchConnectText, parseResearchConnect, researchConnectRow, RESEARCHCONNECT_HEADERS } from '../../lib/calls/researchConnect';
import { rtfToText } from '../../lib/calls/rtfText';
import { FUNDER_CATEGORY_LABELS } from '../dashboard/fundersAggregates';

const inputCls = 'input-soft py-1.5 text-sm font-normal w-full';
const labelCls = 'flex flex-col gap-1 text-xs font-semibold text-muted dark:text-[#c3beb0]';
const primaryBtn = 'inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-xs font-semibold bg-ink text-white dark:bg-[#f5f2ea] dark:text-[#1c1a14] disabled:opacity-50';
const secondaryBtn = 'pill px-3 py-1.5 text-[12px] inline-flex items-center gap-1.5 bg-white/60 dark:bg-white/10 text-ink dark:text-[#f5f2ea] hover:bg-white dark:hover:bg-white/15 disabled:opacity-50';
const fmtDate = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00`).toLocaleDateString(numberLocale()) : d);
const sameName = (a: string, b: string) => slugOf(a, 200) === slugOf(b, 200);
const categoryLabel = (c: string) => (FUNDER_CATEGORY_LABELS[c] ? i18n._(FUNDER_CATEGORY_LABELS[c]) : c);

/** The form of a call: a programme of a funder, each existing or new. */
interface FormState {
  callId?: string;
  funderId: string; // '' = new funder
  funderName: string;
  funderCategory: FunderCategory;
  programmeId: string; // '' = new programme
  programmeName: string;
  title: string;
  url: string;
  lang: 'fr' | 'en';
  openingDate: string;
  deadlines: string[];
  budget: string;
  summary: string;
  objectives: string;
  scope: string;
  eligibility: string;
  /** Classification kept as it is when the call is edited (source of a catalogue). */
  taxonomy: Record<string, string>;
}

const emptyForm = (): FormState => ({
  funderId: '', funderName: '', funderCategory: 'Autre', programmeId: '', programmeName: '', title: '', url: '', lang: 'fr',
  openingDate: '', deadlines: [''], budget: '', summary: '', objectives: '', scope: '', eligibility: '', taxonomy: {},
});

/** Form prefilled from the fields the model proposed: funder and programme matched by name to the known ones. */
const formOfExtraction = (x: Partial<ExtractedCall>, url: string, funders: FunderView[], programmes: ManualProgrammeView[]): FormState => {
  const funder = x.funder ? funders.find((f) => sameName(f.name, x.funder!)) : undefined;
  const programmeName = x.programme || x.funder || '';
  const programme = funder ? programmes.find((p) => p.funderId === funder.funderId && sameName(p.name, programmeName)) : undefined;
  return {
    ...emptyForm(),
    funderId: funder?.funderId ?? '', funderName: funder ? '' : x.funder ?? '', funderCategory: categoryOf(x.funder ?? ''),
    programmeId: programme?.programmeId ?? '', programmeName: programme ? '' : programmeName,
    title: x.title ?? '', url, lang: x.lang === 'en' ? 'en' : 'fr', openingDate: x.openingDate ?? '',
    deadlines: x.deadlines?.length ? [...x.deadlines] : [''], budget: x.budget ?? '', summary: x.summary ?? '',
    objectives: x.objectives ?? '', scope: x.scope ?? '', eligibility: x.eligibility ?? '',
  };
};

const formOfCall = (c: ManualCallView): FormState => ({
  callId: c.callId, funderId: c.funderId, funderName: '', funderCategory: 'Autre', programmeId: c.programmeId, programmeName: '',
  title: c.title, url: c.url, lang: c.lang, openingDate: c.openingDate ?? '', deadlines: c.deadlines.length ? [...c.deadlines] : [''],
  budget: c.budget, summary: c.summary, objectives: c.objectives, scope: c.scope, eligibility: c.eligibility, taxonomy: c.taxonomy,
});

const inputOfForm = (f: FormState): ManualCallInput => ({
  title: f.title,
  programme: f.programmeId
    ? { programmeId: f.programmeId }
    : { name: f.programmeName, funder: f.funderId ? { funderId: f.funderId } : { name: f.funderName, category: f.funderCategory } },
  url: f.url, lang: f.lang, openingDate: f.openingDate || null, deadlines: f.deadlines.filter(Boolean),
  budget: f.budget, summary: f.summary, objectives: f.objectives, scope: f.scope, eligibility: f.eligibility, taxonomy: f.taxonomy,
});

/** JSON of a response, or an Error carrying the translated message (and the body, for the 409 of a duplicate). */
const readJson = async (res: Response) => {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const list: string[] = Array.isArray(body.errors) ? body.errors : [];
    throw Object.assign(new Error(list.length ? list.map(translateApiError).join(' · ') : body.error || `HTTP ${res.status}`), { status: res.status, body });
  }
  return body;
};

type Duplicate = { callId: string; title: string; programmeId: string };

const Duplicates: React.FC<{ items: Duplicate[] }> = ({ items }) => (
  <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-200 text-[12px]">
    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
    <div>
      <Trans>A call with this URL is already known:</Trans>
      <ul className="mt-1 list-disc pl-4">{items.map((d) => <li key={d.callId}>{d.title} <span className="text-muted dark:text-[#c3beb0]">({d.callId}, {d.programmeId})</span></li>)}</ul>
    </div>
  </div>
);

/** Editor of a call: read a URL or a PDF (new call), then review the fields and save. */
const CallEditor: React.FC<{
  initial: FormState | null;
  funders: FunderView[];
  programmes: ManualProgrammeView[];
  canExtract: boolean;
  onClose: () => void;
  onSaved: () => void;
}> = ({ initial, funders, programmes, canExtract, onClose, onSaved }) => {
  const { t } = useLingui();
  // Without the language model, the form opens empty at once.
  const [form, setForm] = useState<FormState | null>(initial ?? (canExtract ? null : emptyForm()));
  const [url, setUrl] = useState('');
  const [reading, setReading] = useState(false);
  const [readNote, setReadNote] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<FormState>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState('');
  const read = async (body: { url: string } | { text: string } | File) => {
    setReading(true);
    setError(null);
    setReadNote(null);
    try {
      const isHtml = body instanceof File && /\.html?$/i.test(body.name);
      const res = body instanceof File
        ? await fetch('/api/calls/admin/manual/read', { method: 'POST', headers: { 'Content-Type': isHtml ? 'text/html' : 'application/pdf' }, body })
        : await fetch('/api/calls/admin/manual/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await readJson(res);
      const chars = Number(data.document?.chars ?? 0).toLocaleString(numberLocale());
      setForm(formOfExtraction(data.draft ?? {}, data.document?.url ?? '', funders, programmes));
      setPasting(false);
      setDuplicates(Array.isArray(data.duplicates) ? data.duplicates : []);
      setReadNote(data.extracted
        ? t`Fields proposed by the language model from the text (${chars} characters): check each of them against the call before saving.`
        : t`The language model gave no answer: fill in the fields from the call.`);
    } catch (e) {
      setError(apiErrorText(e));
    } finally {
      setReading(false);
    }
  };

  const save = async (validate: boolean, force = false) => {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      await readJson(await fetch('/api/calls/admin/manual', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ call: inputOfForm(form), callId: form.callId, validate, force }),
      }));
      onSaved();
    } catch (e) {
      const dup = (e as { status?: number; body?: { duplicates?: Duplicate[] } }).body?.duplicates;
      if ((e as { status?: number }).status === 409 && dup) setDuplicates(dup);
      setError(apiErrorText(e));
    } finally {
      setSaving(false);
    }
  };

  const funderProgrammes = form ? programmes.filter((p) => p.funderId === form.funderId) : [];
  const forceable = duplicates.length > 0 && !form?.callId;

  return (
    <div className="glass-card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-disp font-semibold text-[14px] text-ink dark:text-[#f5f2ea]">
          {form?.callId ? <Trans>Edit a call</Trans> : <Trans>Add a call</Trans>}
        </h4>
        <button type="button" onClick={onClose} className="text-muted dark:text-[#c3beb0] hover:text-ink" aria-label={t`Close`}><X className="w-4 h-4" /></button>
      </div>

      {!form?.callId && (
        <div className="flex flex-col gap-2">
          <p className="text-[12px] text-muted dark:text-[#c3beb0]">
            {canExtract
              ? <Trans>Give the address of the page of the call, or its PDF: Druid reads the text and the language model of the instance proposes the fields. Nothing is saved before your review.</Trans>
              : <Trans>The language model of the instance is not configured (ILAAS_API_KEY): fill in the fields by hand.</Trans>}
          </p>
          {canExtract && (
            <div className="flex flex-wrap items-center gap-2">
              <form className="flex items-center gap-2 flex-1 min-w-[18rem]" onSubmit={(e) => { e.preventDefault(); if (url.trim()) read({ url: url.trim() }); }}>
                <Link2 className="w-4 h-4 text-muted dark:text-[#c3beb0] shrink-0" />
                <input className={inputCls} type="url" value={url} placeholder="https://…" onChange={(e) => setUrl(e.target.value)} aria-label={t`Address of the call`} />
                <button type="submit" className={primaryBtn} disabled={reading || !url.trim()}>
                  {reading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} <Trans>Read</Trans>
                </button>
              </form>
              <label className={`${secondaryBtn} cursor-pointer`}>
                <FileUp className="w-3.5 h-3.5" /> <Trans>PDF of the call</Trans>
                <input type="file" accept="application/pdf,.pdf" className="hidden" disabled={reading}
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) read(f); }} />
              </label>
              <label className={`${secondaryBtn} cursor-pointer`} title={t`A page saved from your browser (File › Save as), for a website the server cannot reach such as the intranet`}>
                <FileCode className="w-3.5 h-3.5" /> <Trans>Saved page (HTML)</Trans>
                <input type="file" accept="text/html,.html,.htm" className="hidden" disabled={reading}
                  onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) read(f); }} />
              </label>
              <button type="button" className={secondaryBtn} onClick={() => setPasting(!pasting)}><ClipboardPaste className="w-3.5 h-3.5" /> <Trans>Paste the text</Trans></button>
              {!form && <button type="button" className={secondaryBtn} onClick={() => setForm(emptyForm())}><Pencil className="w-3.5 h-3.5" /> <Trans>Fill in by hand</Trans></button>}
            </div>
          )}
          {canExtract && pasting && (
            <div className="flex flex-col gap-2">
              <textarea className={`${inputCls} min-h-[8rem]`} value={pasted} maxLength={200000} placeholder={t`Text of the call, copied from its page or document`}
                onChange={(e) => setPasted(e.target.value)} aria-label={t`Text of the call`} />
              <button type="button" className={`${primaryBtn} self-start`} disabled={reading || pasted.trim().length < 200} onClick={() => read({ text: pasted })}>
                {reading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} <Trans>Read the text</Trans>
              </button>
            </div>
          )}
          {reading && <p className="text-[12px] text-muted dark:text-[#c3beb0] inline-flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> <Trans>Reading the call and proposing the fields (up to a minute)…</Trans></p>}
          {readNote && <p className="text-[12px] text-ink dark:text-[#f5f2ea]">{readNote}</p>}
        </div>
      )}

      {duplicates.length > 0 && <Duplicates items={duplicates} />}
      {error && (
        <div className="flex items-start gap-2 text-xs text-[#b23b3b] dark:text-[#f08c8c]"><AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {error}</div>
      )}

      {form && (() => {
        const f = form;
        return (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className={labelCls}>
                <Trans>Funder</Trans>
                <select className={inputCls} value={f.funderId} onChange={(e) => set({ funderId: e.target.value, programmeId: '' })}>
                  <option value="">{t`New funder…`}</option>
                  {funders.map((x) => <option key={x.funderId} value={x.funderId}>{x.name}</option>)}
                </select>
              </label>
              {!f.funderId && (
                <div className="grid grid-cols-2 gap-3">
                  <label className={labelCls}>
                    <Trans>Name of the funder</Trans>
                    <input className={inputCls} value={f.funderName} maxLength={200} placeholder="Région Pays de la Loire"
                      onChange={(e) => set({ funderName: e.target.value, funderCategory: f.funderCategory === 'Autre' ? categoryOf(e.target.value) : f.funderCategory })} />
                  </label>
                  <label className={labelCls}>
                    <Trans>Category</Trans>
                    <select className={inputCls} value={f.funderCategory} onChange={(e) => set({ funderCategory: e.target.value as FunderCategory })}>
                      {FUNDER_CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
                    </select>
                  </label>
                </div>
              )}
              <label className={labelCls}>
                <Trans>Programme</Trans>
                <select className={inputCls} value={f.programmeId} onChange={(e) => set({ programmeId: e.target.value })}>
                  <option value="">{t`New programme…`}</option>
                  {funderProgrammes.map((p) => <option key={p.programmeId} value={p.programmeId}>{p.name}</option>)}
                </select>
              </label>
              {!f.programmeId && (
                <label className={labelCls}>
                  <Trans>Name of the programme</Trans>
                  <input className={inputCls} value={f.programmeName} maxLength={200} placeholder="Étoiles montantes" onChange={(e) => set({ programmeName: e.target.value })} />
                </label>
              )}
            </div>
            <label className={labelCls}>
              <Trans>Title of the call</Trans>
              <input className={inputCls} value={f.title} maxLength={400} onChange={(e) => set({ title: e.target.value })} />
            </label>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <label className={`${labelCls} md:col-span-2`}>
                <Trans>Page of the call</Trans>
                <input className={inputCls} type="url" value={f.url} maxLength={1000} placeholder="https://…" onChange={(e) => set({ url: e.target.value })} />
              </label>
              <label className={labelCls}>
                <Trans>Language of the text</Trans>
                <select className={inputCls} value={f.lang} onChange={(e) => set({ lang: e.target.value === 'en' ? 'en' : 'fr' })}>
                  <option value="fr">{t`French`}</option>
                  <option value="en">{t`English`}</option>
                </select>
              </label>
              <label className={labelCls}>
                <Trans>Opening</Trans>
                <input className={inputCls} type="date" value={f.openingDate} onChange={(e) => set({ openingDate: e.target.value })} />
              </label>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              {f.deadlines.map((d, i) => (
                <label key={i} className={`${labelCls} w-44`}>
                  {i === 0 ? <Trans>Deadline</Trans> : t`Deadline (stage ${i + 1})`}
                  <input className={inputCls} type="date" value={d} onChange={(e) => set({ deadlines: f.deadlines.map((x, k) => (k === i ? e.target.value : x)) })} />
                </label>
              ))}
              {f.deadlines.length < 4 && (
                <button type="button" className={secondaryBtn} onClick={() => set({ deadlines: [...f.deadlines, ''] })}><Plus className="w-3.5 h-3.5" /> <Trans>Another stage</Trans></button>
              )}
              <label className={`${labelCls} flex-1 min-w-[12rem]`}>
                <Trans>Budget</Trans>
                <input className={inputCls} value={f.budget} maxLength={500} placeholder={t`e.g. up to 200 k€ per project`} onChange={(e) => set({ budget: e.target.value })} />
              </label>
            </div>
            <label className={labelCls}>
              <Trans>Summary</Trans>
              <textarea className={`${inputCls} min-h-[4rem]`} value={f.summary} maxLength={2000} onChange={(e) => set({ summary: e.target.value })} />
            </label>
            <label className={labelCls}>
              <Trans>Objectives</Trans>
              <textarea className={`${inputCls} min-h-[5rem]`} value={f.objectives} maxLength={20000} onChange={(e) => set({ objectives: e.target.value })} />
            </label>
            <label className={labelCls}>
              <span><Trans>Scope and topics</Trans> <span className="font-normal">— <Trans>the text read to find the researchers concerned</Trans></span></span>
              <textarea className={`${inputCls} min-h-[8rem]`} value={f.scope} maxLength={20000} onChange={(e) => set({ scope: e.target.value })} />
            </label>
            <label className={labelCls}>
              <Trans>Eligibility</Trans>
              <textarea className={`${inputCls} min-h-[4rem]`} value={f.eligibility} maxLength={5000} onChange={(e) => set({ eligibility: e.target.value })} />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={primaryBtn} disabled={saving} onClick={() => save(true, forceable)}>
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                {forceable ? <Trans>Save and validate anyway</Trans> : <Trans>Save and validate</Trans>}
              </button>
              <button type="button" className={secondaryBtn} disabled={saving} onClick={() => save(false, forceable)}>
                {forceable ? <Trans>Save to validate later anyway</Trans> : <Trans>Save to validate later</Trans>}
              </button>
              <button type="button" className={secondaryBtn} onClick={onClose}><Trans>Cancel</Trans></button>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

/** Values of a spreadsheet cell sent to the server: a date cell becomes its local day (the server reads YYYY-MM-DD). */
const cellOf = (v: unknown): unknown => {
  if (!(v instanceof Date)) return v;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
};

/** Import of a catalogue: the browser reads the file (CSV, Excel, OpenDocument), the server previews then imports. */
const CatalogueImport: React.FC<{ onClose: () => void; onImported: () => void }> = ({ onClose, onImported }) => {
  const { t } = useLingui();
  const [file, setFile] = useState<{ name: string; headers: string[]; rows: Record<string, unknown>[] } | null>(null);
  const [report, setReport] = useState<CatalogueReport | null>(null);
  const [validate, setValidate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (f: NonNullable<typeof file>, apply: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const data = await readJson(await fetch('/api/calls/admin/manual/catalogue', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ headers: f.headers, rows: f.rows, apply, validate }),
      })) as CatalogueReport;
      setReport(data);
      if (apply) onImported();
    } catch (e) {
      setError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const load = async (picked: File) => {
    setError(null);
    setReport(null);
    try {
      // ResearchConnect export (RTF of a saved search): its funds become rows of the catalogue.
      if (/\.rtf$/i.test(picked.name)) {
        // RTF is 7-bit text with escapes; read as Latin-1 so that a stray 8-bit byte stays one character.
        const text = rtfToText(new TextDecoder('latin1').decode(await picked.arrayBuffer()));
        if (!isResearchConnectText(text)) throw new Error(t`This RTF file is not a ResearchConnect export`);
        const today = new Date().toISOString().slice(0, 10);
        const next = { name: picked.name, headers: RESEARCHCONNECT_HEADERS, rows: parseResearchConnect(text).map((f) => researchConnectRow(f, today)) };
        setFile(next);
        await send(next, false);
        return;
      }
      const XLSX = await import('xlsx');
      // A CSV is read as text, without value parsing (31/01/2027 would be taken for a US date).
      const wb = /\.(csv|txt)$/i.test(picked.name)
        ? XLSX.read(await picked.text(), { type: 'string', raw: true })
        : XLSX.read(await picked.arrayBuffer(), { type: 'array', cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const headers = ((XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false })[0] ?? []) as unknown[]).map((h) => String(h ?? '').trim()).filter(Boolean);
      const rows = (XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, unknown>[])
        .map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.trim(), cellOf(v)])));
      const next = { name: picked.name, headers, rows };
      setFile(next);
      await send(next, false);
    } catch (e) {
      setError(apiErrorText(e) || t`The file could not be read`);
    }
  };

  const valid = report ? report.lines.filter((l) => l.action !== 'error').length : 0;
  const actionLabel = { new: t`new`, update: t`update`, error: t`error` };

  return (
    <div className="glass-card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-disp font-semibold text-[14px] text-ink dark:text-[#f5f2ea]"><Trans>Import a catalogue of calls</Trans></h4>
        <button type="button" onClick={onClose} className="text-muted dark:text-[#c3beb0] hover:text-ink" aria-label={t`Close`}><X className="w-4 h-4" /></button>
      </div>
      <p className="text-[12px] text-muted dark:text-[#c3beb0] leading-relaxed">
        <Trans>
          A CSV (UTF-8) or Excel file, one call per row, the first row naming the columns: Title (required), Funder, Category,
          Programme, URL, Language, Opening, Deadline, Deadline 2, Summary, Objectives, Scope, Eligibility, Budget, Reference. The
          days are written 2027-01-31 or 31/01/2027. A row with the same Reference (or, without one, the same funder, programme,
          URL and title) updates the call imported before. The other columns are ignored.
        </Trans>
        {' '}
        <Trans>The RTF export of a ResearchConnect search is read the same way (one call per fund, source « researchconnect »).</Trans>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className={`${secondaryBtn} cursor-pointer`}>
          <Upload className="w-3.5 h-3.5" /> {file ? file.name : <Trans>Choose a file</Trans>}
          <input type="file" accept=".csv,.txt,.xlsx,.xls,.ods,.rtf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) load(f); }} />
        </label>
        <label className="inline-flex items-center gap-2 text-[12px] text-ink dark:text-[#f5f2ea] cursor-pointer">
          <input type="checkbox" checked={validate} onChange={(e) => setValidate(e.target.checked)} />
          <Trans>Import the calls as validated (else they wait for a validation)</Trans>
        </label>
        {busy && <Loader2 className="w-4 h-4 animate-spin text-muted" />}
      </div>
      {error && <div className="flex items-start gap-2 text-xs text-[#b23b3b] dark:text-[#f08c8c]"><AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {error}</div>}
      {report && (
        <div className="flex flex-col gap-2">
          <p className="text-[12px] text-muted dark:text-[#c3beb0]">
            <Trans>Columns read:</Trans> {Object.entries(report.columns).map(([h, field]) => `${h} → ${field}`).join(', ')}
            {report.ignored.length > 0 && <> · <Trans>ignored:</Trans> {report.ignored.join(', ')}</>}
            {report.truncated > 0 && <> · <Plural value={report.truncated} one="# row beyond the limit left out" other="# rows beyond the limit left out" /></>}
          </p>
          <div className="overflow-x-auto max-h-80 rounded-2xl bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/15">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted dark:text-[#c3beb0]">
                  <th className="px-3 py-1.5 font-semibold"><Trans>Row</Trans></th>
                  <th className="px-3 py-1.5 font-semibold"><Trans>Title</Trans></th>
                  <th className="px-3 py-1.5 font-semibold"><Trans>Programme</Trans></th>
                  <th className="px-3 py-1.5 font-semibold"><Trans>Result</Trans></th>
                </tr>
              </thead>
              <tbody>
                {report.lines.map((l) => (
                  <tr key={l.line} className="border-t border-white/80 dark:border-white/10 align-top">
                    <td className="px-3 py-1.5 tabular-nums text-muted dark:text-[#c3beb0]">{l.line}</td>
                    <td className="px-3 py-1.5 text-ink dark:text-[#f5f2ea]">{l.title}</td>
                    <td className="px-3 py-1.5 text-muted dark:text-[#c3beb0]">{l.programme}</td>
                    <td className={`px-3 py-1.5 ${l.action === 'error' || l.errors.length ? 'text-[#b23b3b] dark:text-[#f08c8c]' : 'text-emerald-700 dark:text-emerald-300'}`}>
                      {actionLabel[l.action]}{l.errors.length > 0 && <> — {l.errors.map(translateApiError).join(' · ')}</>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {report.applied ? (
            <p className="text-[12px] text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" />
              <Plural value={report.lines.filter((l) => l.callId && !l.errors.length).length} one="# call imported" other="# calls imported" />
            </p>
          ) : (
            <button type="button" className={`${primaryBtn} self-start`} disabled={busy || !valid || !file} onClick={() => file && send(file, true)}>
              <Upload className="w-3.5 h-3.5" /> <Plural value={valid} one="Import # call" other="Import # calls" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * @component ManualCallsAdmin
 * @description « Administration › Calls for proposals », calls added by hand (docs/plan-funding-calls.md, lot 6): the
 * calls of the funders no collector reads (Region, foundations, other France 2030 operators, internal calls…), added
 * from the page or the PDF of the call (fields proposed by the language model, reviewed here) or from a catalogue. A
 * call waits « to validate » until someone validates it; only validated calls appear in the tab.
 */
export const ManualCallsAdmin: React.FC = () => {
  const { t } = useLingui();
  const [items, setItems] = useState<ManualCallView[] | null>(null);
  const [programmes, setProgrammes] = useState<ManualProgrammeView[]>([]);
  const [funders, setFunders] = useState<FunderView[]>([]);
  const [canExtract, setCanExtract] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ form: FormState | null; key: number } | null>(null);
  const [catalogue, setCatalogue] = useState(false);
  const [filter, setFilter] = useState<ReviewStatus | 'all'>('to_validate');
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch('/api/calls/admin/manual', { cache: 'no-store' })
      .then(readJson)
      .then((data) => {
        setItems(data.items ?? []);
        setProgrammes(data.programmes ?? []);
        setFunders(data.funders ?? []);
        setCanExtract(!!data.canExtract);
      })
      .catch((e: unknown) => setError(apiErrorText(e)));
  }, []);
  useEffect(load, [load]);

  const counts = useMemo(() => {
    const c: Record<ReviewStatus, number> = { to_validate: 0, validated: 0, rejected: 0 };
    for (const x of items ?? []) c[x.reviewStatus]++;
    return c;
  }, [items]);
  // With nothing to validate, the list opens on the validated calls.
  useEffect(() => { if (items && filter === 'to_validate' && counts.to_validate === 0 && items.length) setFilter('validated'); }, [items, counts, filter]);
  const shown = (items ?? []).filter((c) => filter === 'all' || c.reviewStatus === filter);

  const review = async (c: ManualCallView, status: ReviewStatus) => {
    setBusy(c.callId);
    setError(null);
    try {
      await readJson(await fetch(`/api/calls/admin/manual/${encodeURIComponent(c.callId)}/review`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      }));
      load();
    } catch (e) {
      setError(apiErrorText(e));
    } finally {
      setBusy(null);
    }
  };
  const remove = async (c: ManualCallView) => {
    setBusy(c.callId);
    setError(null);
    try {
      await readJson(await fetch(`/api/calls/admin/manual/${encodeURIComponent(c.callId)}`, { method: 'DELETE' }));
      setConfirmDelete(null);
      load();
    } catch (e) {
      setError(apiErrorText(e));
    } finally {
      setBusy(null);
    }
  };

  const statusLabel: Record<ReviewStatus, string> = { to_validate: t`to validate`, validated: t`validated`, rejected: t`rejected` };
  const statusStyle: Record<ReviewStatus, string> = {
    to_validate: 'bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200',
    validated: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200',
    rejected: 'bg-white/60 text-muted dark:bg-white/10 dark:text-[#c3beb0]',
  };
  const filters: [ReviewStatus | 'all', string][] = [
    ['to_validate', `${t`To validate`} (${counts.to_validate})`], ['validated', `${t`Validated`} (${counts.validated})`],
    ['rejected', `${t`Rejected`} (${counts.rejected})`], ['all', t`All`],
  ];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-semibold text-ink dark:text-[#f5f2ea]"><Trans>Calls added by hand</Trans></h3>
          <p className="text-[13px] text-muted dark:text-[#c3beb0] leading-relaxed max-w-3xl">
            <Trans>
              Calls of the funders that no collector reads (Region, foundations, other France 2030 operators, internal calls…). A call
              waits « to validate » until someone of the institution validates it; only validated calls appear in the « Calls for
              proposals » tab. The matching to the researchers runs apart, programme by programme, like for the collected calls.
            </Trans>
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className={primaryBtn} onClick={() => { setCatalogue(false); setEditor({ form: null, key: Date.now() }); }}><Plus className="w-3.5 h-3.5" /> <Trans>Add a call</Trans></button>
          <button type="button" className={secondaryBtn} onClick={() => { setEditor(null); setCatalogue(true); }}><Upload className="w-3.5 h-3.5" /> <Trans>Import a catalogue</Trans></button>
        </div>
      </div>
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-2xl bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 text-[13px]"><AlertCircle className="w-4 h-4" /> {error}</div>
      )}
      {editor && (
        <CallEditor key={editor.key} initial={editor.form} funders={funders} programmes={programmes} canExtract={canExtract}
          onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setFilter('all'); load(); }} />
      )}
      {catalogue && <CatalogueImport onClose={() => setCatalogue(false)} onImported={load} />}

      {items === null ? (
        <div className="flex items-center gap-2 text-[13px] text-muted dark:text-[#c3beb0]"><Loader2 className="w-4 h-4 animate-spin" /> <Trans>Loading the calls…</Trans></div>
      ) : items.length === 0 ? (
        <p className="text-[13px] text-muted dark:text-[#c3beb0]"><Trans>No call added by hand yet.</Trans></p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {filters.map(([key, label]) => (
              <button key={key} type="button" onClick={() => setFilter(key)}
                className={`pill px-3 py-1 text-[12px] ${filter === key ? 'bg-ink text-white dark:bg-[#f5f2ea] dark:text-[#1c1a14]' : 'bg-white/60 dark:bg-white/10 text-ink dark:text-[#f5f2ea]'}`}>
                {label}
              </button>
            ))}
          </div>
          <div className="overflow-x-auto rounded-2xl bg-white/70 dark:bg-white/10 border border-white/80 dark:border-white/15 shadow-soft">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted dark:text-[#c3beb0]">
                  <th className="px-4 py-2 font-semibold"><Trans>Call</Trans></th>
                  <th className="px-3 py-2 font-semibold"><Trans>Funder › programme</Trans></th>
                  <th className="px-3 py-2 font-semibold"><Trans>Deadline</Trans></th>
                  <th className="px-3 py-2 font-semibold"><Trans>Review</Trans></th>
                  <th className="px-3 py-2 font-semibold text-right"><Trans>Matches</Trans></th>
                  <th className="px-3 py-2 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.callId} className="border-t border-white/80 dark:border-white/10 align-top">
                    <td className="px-4 py-2">
                      <div className="font-semibold text-ink dark:text-[#f5f2ea]">{c.title}</div>
                      <div className="text-[11px] text-muted dark:text-[#c3beb0] inline-flex flex-wrap items-center gap-2">
                        <span>{c.callId}</span>
                        {c.url && <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline"><ExternalLink className="w-3 h-3" /> <Trans>page</Trans></a>}
                        {c.addedBy && <span><Trans>added by {c.addedBy}</Trans></span>}
                        {c.taxonomy.source && <span className="pill px-1.5 py-0 bg-white/60 dark:bg-white/10">{c.taxonomy.source === 'researchconnect' ? 'ResearchConnect' : c.taxonomy.source}</span>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-muted dark:text-[#c3beb0]">{c.funderName} › {c.programmeName}</td>
                    <td className="px-3 py-2 whitespace-nowrap tabular-nums text-ink dark:text-[#f5f2ea]">{c.deadlines.length ? c.deadlines.map(fmtDate).join(', ') : '—'}</td>
                    <td className="px-3 py-2">
                      <span className={`pill px-2 py-0.5 text-[11px] font-semibold ${statusStyle[c.reviewStatus]}`} title={c.reviewedBy ? t`by ${c.reviewedBy}` : undefined}>{statusLabel[c.reviewStatus]}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.matches.toLocaleString(numberLocale())}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <button type="button" className={secondaryBtn} disabled={busy === c.callId} onClick={() => { setCatalogue(false); setEditor({ form: formOfCall(c), key: Date.now() }); }}>
                          <Pencil className="w-3.5 h-3.5" /> <Trans>Edit</Trans>
                        </button>
                        {c.reviewStatus !== 'validated' && (
                          <button type="button" className={secondaryBtn} disabled={busy === c.callId} onClick={() => review(c, 'validated')}><CheckCircle2 className="w-3.5 h-3.5" /> <Trans>Validate</Trans></button>
                        )}
                        {c.reviewStatus !== 'rejected' && (
                          <button type="button" className={secondaryBtn} disabled={busy === c.callId} onClick={() => review(c, 'rejected')}><X className="w-3.5 h-3.5" /> <Trans>Reject</Trans></button>
                        )}
                        {c.matches === 0 && (confirmDelete === c.callId ? (
                          <button type="button" className={`${secondaryBtn} text-[#b23b3b] dark:text-[#f08c8c]`} disabled={busy === c.callId} onClick={() => remove(c)}>
                            <Trash2 className="w-3.5 h-3.5" /> <Trans>Confirm the deletion</Trans>
                          </button>
                        ) : (
                          <button type="button" className={secondaryBtn} disabled={busy === c.callId} onClick={() => setConfirmDelete(c.callId)} aria-label={t`Delete`}><Trash2 className="w-3.5 h-3.5" /></button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
};
