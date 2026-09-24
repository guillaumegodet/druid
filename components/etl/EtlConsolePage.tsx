import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, AlertTriangle, BarChart3, CheckCircle, Loader2, Plus, RefreshCw, Save, Users,
} from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  ConsoleMeta, EtlConsoleApi, EtlStatus, GristTeam, SousStructure, StructureConfig,
  StructureConfigPayload, StructureDetail, StructureSummary,
} from './etlConsoleApi';
import { CorrectionsPanel, EffectifsPanel } from './EtlMaintenancePanels';
import { apiErrorText, translateApiError } from '../../lib/apiErrors';

const POLL_MS = 3000;
const LOG_LINES = 25;
const currentYear = new Date().getFullYear();

/** Form state: lists as multi-line text (one value per line). */
interface FormState {
  name: string;
  acronym: string;
  openalex_id: string;
  year_from: number;
  year_to: number;
  etpr: number;
  mailto: string;
  team_label: string;
  bso_markers: string;
  bso_url: string;
  hal_collection: string;
  hal_year_from: number;
  crisalid_structure_uid: string;
  sous_structures: SousStructure[];
  druid_tabs_hidden: string[];
  filter_to_effectifs: boolean;
  grist_labo_acronyme: string;
  positifs: string;
  negatifs: string;
  charte_modele: string;
}

const EMPTY_FORM: FormState = {
  name: '', acronym: '', openalex_id: '', year_from: 2020, year_to: currentYear, etpr: 0,
  mailto: '', team_label: 'équipe', bso_markers: '', bso_url: '', hal_collection: '',
  hal_year_from: 0, crisalid_structure_uid: '', sous_structures: [], druid_tabs_hidden: [],
  filter_to_effectifs: false, grist_labo_acronyme: '', positifs: '', negatifs: '', charte_modele: '',
};

const fromConfig = (c: StructureConfig): FormState => ({
  name: c.name || '',
  acronym: c.acronym || '',
  openalex_id: c.openalex_id || '',
  year_from: Number(c.year_from) || 2020,
  year_to: Number(c.year_to) || currentYear,
  etpr: Number(c.etpr) || 0,
  mailto: c.mailto || '',
  team_label: c.team_label || 'équipe',
  bso_markers: (c.bso_markers || []).join('\n'),
  bso_url: c.bso_url || '',
  hal_collection: c.hal_collection || '',
  hal_year_from: Number(c.hal_year_from) || 0,
  crisalid_structure_uid: c.crisalid_structure_uid || '',
  sous_structures: (c.sous_structures || []).map((s) => ({ id: s.id || '', acronym: s.acronym || '', name: s.name || '' })),
  druid_tabs_hidden: c.druid_tabs_hidden || [],
  filter_to_effectifs: Boolean(c.filter_to_effectifs),
  grist_labo_acronyme: c.grist?.labo_acronyme || '',
  positifs: (c.affiliation_controle?.mots_cles_positifs || []).join('\n'),
  negatifs: (c.affiliation_controle?.mots_cles_negatifs || []).join('\n'),
  charte_modele: c.charte?.modele || '',
});

const toPayload = (f: FormState): StructureConfigPayload => ({
  name: f.name,
  acronym: f.acronym,
  openalex_id: f.openalex_id,
  year_from: f.year_from,
  year_to: f.year_to,
  etpr: f.etpr,
  mailto: f.mailto,
  team_label: f.team_label,
  bso_markers: f.bso_markers,
  bso_url: f.bso_url,
  hal_collection: f.hal_collection,
  hal_year_from: f.hal_year_from,
  crisalid_structure_uid: f.crisalid_structure_uid,
  sous_structures: f.sous_structures,
  druid_tabs_hidden: f.druid_tabs_hidden,
  filter_to_effectifs: f.filter_to_effectifs,
  grist: { labo_acronyme: f.grist_labo_acronyme },
  affiliation_controle: { mots_cles_positifs: f.positifs, mots_cles_negatifs: f.negatifs },
  charte: { modele: f.charte_modele },
});

const labelCls = 'flex flex-col gap-1 text-xs font-semibold text-muted dark:text-[#c3beb0]';
const inputCls = 'input-soft py-1.5 text-sm';
const cardCls = 'rounded-panel bg-white/70 dark:bg-white/[.06] border border-white/80 dark:border-white/10 shadow-soft p-4 flex flex-col gap-3';

const NewStructureIcon = Plus;

/**
 * @component EtlConsolePage
 * @description Native ETL console (admin role), replacing the former
 * Streamlit page in an iframe: configuration of a structure (druid-biblio
 * config.yaml), saving, full regeneration tracked live
 * (polled status), Grist teams and file state; maintenance blocks
 * (Grist staff, suspicious affiliations and corrections) in
 * EtlMaintenancePanels. Lots 2-3 of the plan docs/archive/plan-console-etl-native.md.
 */
export const EtlConsolePage: React.FC<{
  /** Structure of the current dashboard: preselected if it exists. */
  struct: string | null;
  /** After creation/save: the parent refreshes its slug list. */
  onStructureSaved?: (slug: string) => void;
  /** Opens the structure's dashboard (« Vue d'ensemble » tab). */
  onOpenDashboard?: (slug: string) => void;
}> = ({ struct, onStructureSaved, onOpenDashboard }) => {
  const { t, i18n } = useLingui();
  const [structures, setStructures] = useState<StructureSummary[]>([]);
  const [runningJob, setRunningJob] = useState<string | null>(null);
  const [meta, setMeta] = useState<ConsoleMeta | null>(null);
  // null = « nouvelle structure »; undefined = not chosen yet
  const [selected, setSelected] = useState<string | null | undefined>(undefined);
  const [detail, setDetail] = useState<StructureDetail | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [dirty, setDirty] = useState(false);
  const [teams, setTeams] = useState<GristTeam[] | null>(null);
  const [status, setStatus] = useState<EtlStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [redownloadBso, setRedownloadBso] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const logRef = useRef<HTMLPreElement | null>(null);

  const isNew = selected === null;
  const running = status?.state === 'running' || status?.running === true;
  const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleString(i18n.locale) : '—');

  const refreshList = useCallback(async () => {
    const r = await EtlConsoleApi.list();
    setStructures(r.structures);
    setRunningJob(r.runningJob);
    return r;
  }, []);

  const stopPolling = () => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const loadDetail = useCallback(async (slug: string) => {
    const d = await EtlConsoleApi.get(slug);
    setDetail(d);
    setStatus({ ...d.status, running: d.running });
    return d;
  }, []);

  const startPolling = useCallback((slug: string) => {
    stopPolling();
    pollRef.current = window.setInterval(async () => {
      try {
        const s = await EtlConsoleApi.status(slug);
        setStatus(s);
        if (!s.running && s.state !== 'running') {
          stopPolling();
          setLaunching(false);
          void loadDetail(slug);
          void refreshList();
          onStructureSaved?.(slug);
        }
      } catch {
        // transient polling error: retry on the next tick
      }
    }, POLL_MS);
  }, [loadDetail, refreshList, onStructureSaved]);

  // Initial load: list + meta, preselection of the current structure.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([refreshList(), EtlConsoleApi.meta()])
      .then(([r, m]) => {
        if (cancelled) return;
        setMeta(m);
        const slugs = r.structures.map((s) => s.slug);
        setSelected(struct && slugs.includes(struct) ? struct : slugs[0] ?? null);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? apiErrorText(e) : t`ETL API unreachable`))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Structure change: detail → form, Grist teams, tracking of an already running ETL.
  useEffect(() => {
    stopPolling();
    setError(null);
    setNotice(null);
    setTeams(null);
    setDirty(false);
    if (selected === undefined) return;
    if (selected === null) {
      setDetail(null);
      setStatus(null);
      setForm(EMPTY_FORM);
      return;
    }
    let cancelled = false;
    setLoading(true);
    loadDetail(selected)
      .then((d) => {
        if (cancelled) return;
        setForm(fromConfig(d.config));
        if (d.running) startPolling(selected);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? apiErrorText(e) : t`Structure could not be read`))
      .finally(() => !cancelled && setLoading(false));
    EtlConsoleApi.teams(selected)
      .then((r) => !cancelled && setTeams(r.teams.length ? r.teams : r.fallbackTeams))
      .catch(() => !cancelled && setTeams([]));
    return () => {
      cancelled = true;
    };
  }, [selected, loadDetail, startPolling]);

  // Log: auto-scroll to the last line.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [status?.log?.length]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };

  const save = async (): Promise<string | null> => {
    setError(null);
    setNotice(null);
    setSaving(true);
    try {
      const payload = toPayload(form);
      const d = isNew ? await EtlConsoleApi.create(payload) : await EtlConsoleApi.saveConfig(selected as string, payload);
      setDetail(d);
      setForm(fromConfig(d.config));
      setDirty(false);
      await refreshList();
      onStructureSaved?.(d.slug);
      if (isNew) setSelected(d.slug);
      setNotice(isNew
        ? t`Structure “${d.config.acronym}” created (data/${d.slug}/config.yaml). Run the regeneration to produce its data.`
        : t`Configuration saved. Hidden tabs and identity are picked up by the dashboard without regeneration.`);
      return d.slug;
    } catch (e) {
      setError(e instanceof Error ? apiErrorText(e) : t`Save error`);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const saveAndGenerate = async () => {
    const slug = await save();
    if (!slug) return;
    setLaunching(true);
    setError(null);
    try {
      await EtlConsoleApi.launch(slug, redownloadBso);
      setRedownloadBso(false);
      setStatus({ state: 'running', running: true, log: [], startedAt: new Date().toISOString() });
      setNotice(null);
      startPolling(slug);
      void refreshList();
    } catch (e) {
      setLaunching(false);
      setError(e instanceof Error ? apiErrorText(e) : t`Error at launch`);
    }
  };

  const setSousStructure = (i: number, key: keyof SousStructure, value: string) => {
    const rows = form.sous_structures.map((r, j) => (j === i ? { ...r, [key]: value } : r));
    update('sous_structures', rows);
  };
  const toggleTab = (key: string) => {
    const hidden = form.druid_tabs_hidden.includes(key)
      ? form.druid_tabs_hidden.filter((k) => k !== key)
      : [...form.druid_tabs_hidden, key];
    update('druid_tabs_hidden', hidden);
  };

  const busy = saving || launching || running;
  const otherJob = runningJob && runningJob !== selected ? runningJob : null;
  const logTail = useMemo(() => (status?.log || []).slice(-LOG_LINES), [status?.log]);
  const teamLabelOptions = meta?.teamLabels || ['équipe', 'axe', 'thème'];
  const files = detail?.files;

  return (
    <div className="flex flex-col gap-4">
      {/* Bar: structure choice, state, actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="input-soft !w-auto py-1.5 pr-7 text-sm font-semibold cursor-pointer"
            value={selected ?? '__new__'}
            onChange={(e) => setSelected(e.target.value === '__new__' ? null : e.target.value)}
            disabled={busy && !isNew}
            title={t`Structure to configure`}
          >
            <option value="__new__">{t`➕ New structure`}</option>
            {structures.map((s) => (
              <option key={s.slug} value={s.slug}>
                {`${s.acronym || s.slug} — ${s.name || ''}`}
              </option>
            ))}
          </select>
          {!isNew && detail && (
            <span className="text-[12.5px] text-muted-light dark:text-[#8f897c]">
              {files?.dashboard.exists
                ? t`Dashboard as of ${fmtDate(files.dashboard.updatedAt)}`
                : t`No dashboard generated yet`}
            </span>
          )}
          {!isNew && selected && files?.dashboard.exists && onOpenDashboard && (
            <button type="button" className="btn-pill !h-8 px-3 text-xs" onClick={() => onOpenDashboard(selected)}>
              <BarChart3 className="w-3.5 h-3.5" /> <Trans>View the dashboard</Trans>
            </button>
          )}
        </div>
        {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-light" />}
      </div>

      {otherJob && (
        <p className="flex items-center gap-2 text-[13px] text-[#9a6a12] dark:text-[#f0c266]">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <Trans>An ETL is already running for “{otherJob}” — one at a time; the regeneration will have to wait for it to finish.</Trans>
        </p>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Identity */}
        <section className={cardCls}>
          <h4 className="section-label"><Trans>1. Structure identity</Trans></h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className={labelCls}>
              <Trans>Full name</Trans>
              <input className={inputCls} value={form.name} onChange={(e) => update('name', e.target.value)}
                placeholder={t`Laboratoire de Psychologie des Pays de la Loire`} disabled={busy} />
            </label>
            <label className={labelCls}>
              <Trans>Acronym</Trans>
              <input className={inputCls} value={form.acronym} onChange={(e) => update('acronym', e.target.value)}
                placeholder="LPPL" disabled={busy} />
            </label>
            <label className={`${labelCls} md:col-span-2`}>
              <Trans>OpenAlex institution ID(s) — several IDs separated by “|” for a cluster</Trans>
              <input className={inputCls} value={form.openalex_id} onChange={(e) => update('openalex_id', e.target.value)}
                placeholder="I4210089331 ou I4210089331|I98765432" disabled={busy} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className={labelCls}>
                <Trans>Start year</Trans>
                <input type="number" className={inputCls} value={form.year_from} min={1990} max={2100}
                  onChange={(e) => update('year_from', Number(e.target.value))} disabled={busy} />
              </label>
              <label className={labelCls}>
                <Trans>End year</Trans>
                <input type="number" className={inputCls} value={form.year_to} min={1990} max={2100}
                  onChange={(e) => update('year_to', Number(e.target.value))} disabled={busy} />
              </label>
            </div>
            <label className={labelCls}>
              <Trans>Research FTE (0 = ratios hidden)</Trans>
              <input type="number" step={0.5} min={0} className={inputCls} value={form.etpr}
                onChange={(e) => update('etpr', Number(e.target.value))} disabled={busy} />
            </label>
            <label className={labelCls}>
              <Trans>Contact email (OpenAlex polite pool)</Trans>
              <input type="email" className={inputCls} value={form.mailto} onChange={(e) => update('mailto', e.target.value)} disabled={busy} />
            </label>
            <label className={labelCls}>
              <Trans>Term for internal groupings</Trans>
              <select className={inputCls} value={form.team_label} onChange={(e) => update('team_label', e.target.value)} disabled={busy}>
                {teamLabelOptions.map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
          </div>
        </section>

        {/* Sources */}
        <section className={cardCls}>
          <h4 className="section-label"><Trans>2. Data sources</Trans></h4>
          <label className={labelCls}>
            <Trans>BSO dump URL (downloaded automatically at generation)</Trans>
            <input className={inputCls} value={form.bso_url} onChange={(e) => update('bso_url', e.target.value)}
              placeholder="https://storage.gra.cloud.ovh.net/v1/AUTH_…/bso_dump/bso-publications-latest_<ID>_enriched.jsonl.gz" disabled={busy} />
          </label>
          <label className={labelCls}>
            <Trans>BSO affiliation markers (one per line: acronym, name, RNSR/UAI number…)</Trans>
            <textarea className={`${inputCls} h-20 resize-y`} value={form.bso_markers}
              onChange={(e) => update('bso_markers', e.target.value)} placeholder={'lppl\n201220071u'} disabled={busy} />
          </label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className={labelCls}>
              <Trans>HAL collection</Trans>
              <input className={inputCls} value={form.hal_collection} onChange={(e) => update('hal_collection', e.target.value)}
                placeholder="IREENA" disabled={busy} />
            </label>
            <label className={labelCls}>
              <Trans>HAL from year (0 = whole period)</Trans>
              <input type="number" className={inputCls} value={form.hal_year_from} min={0} max={2100}
                onChange={(e) => update('hal_year_from', Number(e.target.value))} disabled={busy} />
            </label>
            <label className={labelCls}>
              <Trans>CRISalid structure uid (graph)</Trans>
              <input className={inputCls} value={form.crisalid_structure_uid}
                onChange={(e) => update('crisalid_structure_uid', e.target.value)} placeholder="local-542" disabled={busy} />
            </label>
          </div>
          <p className="text-[12px] text-muted-light dark:text-[#8f897c]">
            <Trans>Staff (Grist directory, validated researchers), Scimago quartiles and journal access (Nantilus + ISTEX) are handled automatically at each generation.</Trans>
            {files && !files.hlmExport.exists && (
              <> <Trans>Nantilus HLM export missing: the “journal access” step will be skipped.</Trans></>
            )}
          </p>
        </section>

        {/* Grist & affiliations */}
        <section className={cardCls}>
          <h4 className="section-label"><Trans>3. Grist and affiliation checks</Trans></h4>
          <label className={labelCls}>
            <Trans>Acronym in the Grist directory (LABO field)</Trans>
            <input className={inputCls} value={form.grist_labo_acronyme}
              onChange={(e) => update('grist_labo_acronyme', e.target.value)} placeholder="LPPL" disabled={busy} />
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className={labelCls}>
              <Trans>Positive keywords (one per line, at least one expected in the raw affiliation)</Trans>
              <textarea className={`${inputCls} h-24 resize-y`} value={form.positifs}
                onChange={(e) => update('positifs', e.target.value)} placeholder={'Nantes\nLPPL'} disabled={busy} />
            </label>
            <label className={labelCls}>
              <Trans>Negative keywords (one per line, presence = wrong affiliation)</Trans>
              <textarea className={`${inputCls} h-24 resize-y`} value={form.negatifs}
                onChange={(e) => update('negatifs', e.target.value)} placeholder={'Paris Cité\nUMR 7219'} disabled={busy} />
            </label>
          </div>
          <div>
            <h5 className="text-xs font-semibold text-muted dark:text-[#c3beb0] flex items-center gap-1.5 mb-1">
              <Users className="w-3.5 h-3.5" />
              <Trans>Teams read from Grist (Structures table, read-only)</Trans>
            </h5>
            {teams === null && !isNew && <p className="text-[12px] text-muted-light"><Trans>Loading…</Trans></p>}
            {teams && teams.length === 0 && (
              <p className="text-[12px] text-muted-light dark:text-[#8f897c]">
                <Trans>No team found in Grist for this structure (auto-discovered from the staff list).</Trans>
              </p>
            )}
            {teams && teams.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {teams.map((tm) => (
                  <li key={`${tm.num}-${tm.acronym}`} className="pill px-2.5 py-0.5 text-[12px] bg-white/70 dark:bg-white/10 border border-ink/10 dark:border-white/15" title={tm.name}>
                    {tm.acronym}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Sub-structures + display */}
        <section className={cardCls}>
          <h4 className="section-label"><Trans>4. Sub-structures and display</Trans></h4>
          <div>
            <p className="text-[12px] text-muted-light dark:text-[#8f897c] mb-1.5">
              <Trans>Composite institution: one row per laboratory (OpenAlex ID starting with I) for the per-lab breakdown.</Trans>
            </p>
            {form.sous_structures.map((ss, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_2fr_auto] gap-2 mb-1.5 items-center">
                <input className={inputCls} value={ss.id} placeholder="I4210117005" onChange={(e) => setSousStructure(i, 'id', e.target.value)} disabled={busy} />
                <input className={inputCls} value={ss.acronym} placeholder="LS2N" onChange={(e) => setSousStructure(i, 'acronym', e.target.value)} disabled={busy} />
                <input className={inputCls} value={ss.name} placeholder={t`Full name`} onChange={(e) => setSousStructure(i, 'name', e.target.value)} disabled={busy} />
                <button type="button" className="text-muted-faint hover:text-[#d64545] text-lg leading-none px-1" title={t`Remove`}
                  onClick={() => update('sous_structures', form.sous_structures.filter((_, j) => j !== i))} disabled={busy}>
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="btn-pill !h-8 px-3 text-xs" disabled={busy}
              onClick={() => update('sous_structures', [...form.sous_structures, { id: '', acronym: '', name: '' }])}>
              <NewStructureIcon className="w-3.5 h-3.5" /> <Trans>Add a sub-structure</Trans>
            </button>
          </div>
          <div>
            <p className="text-xs font-semibold text-muted dark:text-[#c3beb0] mb-1.5">
              <Trans>Tabs hidden in the dashboard (applied without regeneration)</Trans>
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {(meta?.druidTabs || []).map((tb) => (
                <label key={tb.key} className="flex items-center gap-1.5 text-[12.5px] text-ink dark:text-[#f5f2ea]">
                  <input type="checkbox" checked={form.druid_tabs_hidden.includes(tb.key)} onChange={() => toggleTab(tb.key)} disabled={busy} />
                  {tb.label}
                </label>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-[12.5px] text-ink dark:text-[#f5f2ea]">
            <input type="checkbox" checked={form.filter_to_effectifs} onChange={(e) => update('filter_to_effectifs', e.target.checked)} disabled={busy} />
            <Trans>Restrict the corpus to publications with at least one author from the staff list</Trans>
          </label>
          <label className={labelCls}>
            <Trans>Signature charter template (empty = built-in template for the acronym)</Trans>
            <input className={inputCls} value={form.charte_modele} onChange={(e) => update('charte_modele', e.target.value)}
              placeholder={detail?.config.charte_modele_defaut || t`Nantes Université, …, ACRONYM, UMR XXXX, F-44000 Nantes, France`} disabled={busy} />
          </label>
        </section>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-pill" onClick={() => void save()} disabled={busy || (!dirty && !isNew)}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {isNew ? t`Create the structure` : t`Save the configuration`}
        </button>
        <button type="button" className="btn-pill-dark" onClick={() => void saveAndGenerate()} disabled={busy || Boolean(otherJob)}>
          {running || launching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          <Trans>Save and regenerate the data</Trans>
        </button>
        <label className="flex items-center gap-1.5 text-[12.5px] text-muted dark:text-[#c3beb0]">
          <input type="checkbox" checked={redownloadBso} onChange={(e) => setRedownloadBso(e.target.checked)} disabled={busy || !form.bso_url} />
          <Trans>Re-download the BSO dump</Trans>
        </label>
        {dirty && !busy && (
          <span className="text-[12px] text-[#9a6a12] dark:text-[#f0c266]"><Trans>Unsaved changes</Trans></span>
        )}
      </div>

      {error && (
        <p className="flex items-start gap-2 text-[13px] text-[#d64545]"><AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}</p>
      )}
      {notice && (
        <p className="flex items-start gap-2 text-[13px] text-[#1f7a4d] dark:text-[#5fd39a]"><CheckCircle className="w-4 h-4 shrink-0 mt-0.5" /> {notice}</p>
      )}

      {/* Generation log + files */}
      {!isNew && (
        <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-4">
          <section className={cardCls}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="section-label"><Trans>Log of the last generation</Trans></h4>
              <span className="text-[12px] text-muted-light dark:text-[#8f897c]">
                {running && <span className="inline-flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> <Trans>Running since {fmtDate(status?.startedAt)}</Trans></span>}
                {!running && status?.state === 'done' && <span className="inline-flex items-center gap-1.5 text-[#1f7a4d] dark:text-[#5fd39a]"><CheckCircle className="w-3.5 h-3.5" /> <Trans>Finished on {fmtDate(status?.endedAt)}</Trans></span>}
                {!running && status?.state === 'error' && <span className="inline-flex items-center gap-1.5 text-[#d64545]"><AlertCircle className="w-3.5 h-3.5" /> <Trans>Failed on {fmtDate(status?.endedAt)}</Trans></span>}
                {!running && (!status || status.state === 'never-run') && <Trans>Never run from this console</Trans>}
              </span>
            </div>
            {status?.error && !running && <p className="text-[13px] text-[#d64545]">{translateApiError(status.error)}</p>}
            {(status?.warnings?.length ?? 0) > 0 && !running && (
              <p className="text-[12px] text-[#9a6a12] dark:text-[#f0c266]">
                <Trans>{status?.warnings?.length} warning(s) — see the log.</Trans>
              </p>
            )}
            <pre ref={logRef} className="text-[12px] leading-relaxed font-mono whitespace-pre-wrap max-h-72 overflow-y-auto rounded-xl bg-ink/[.04] dark:bg-black/30 p-3 text-ink dark:text-[#e8e3d6]">
              {logTail.length ? logTail.join('\n') : t`— no log —`}
            </pre>
          </section>
          <section className={cardCls}>
            <h4 className="section-label"><Trans>Structure files</Trans></h4>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12.5px]">
              <dt className="font-semibold text-muted dark:text-[#c3beb0]">dashboard.json</dt>
              <dd className="text-ink dark:text-[#f5f2ea]">{files?.dashboard.exists ? fmtDate(files.dashboard.updatedAt) : t`missing`}</dd>
              <dt className="font-semibold text-muted dark:text-[#c3beb0]">data.parquet</dt>
              <dd className="text-ink dark:text-[#f5f2ea]">{files?.parquet.exists ? fmtDate(files.parquet.updatedAt) : t`missing`}</dd>
              <dt className="font-semibold text-muted dark:text-[#c3beb0]">effectifs.csv</dt>
              <dd className="text-ink dark:text-[#f5f2ea]">
                {files?.effectifs.exists ? t`${files.effectifs.rows ?? 0} members — ${fmtDate(files.effectifs.updatedAt)}` : t`missing`}
              </dd>
              <dt className="font-semibold text-muted dark:text-[#c3beb0]"><Trans>BSO dump</Trans></dt>
              <dd className="text-ink dark:text-[#f5f2ea]">{files?.bso.exists ? fmtDate(files.bso.updatedAt) : t`missing`}</dd>
              <dt className="font-semibold text-muted dark:text-[#c3beb0]">journals_access.csv</dt>
              <dd className="text-ink dark:text-[#f5f2ea]">{files?.journalsAccess.exists ? fmtDate(files.journalsAccess.updatedAt) : t`missing`}</dd>
            </dl>
          </section>
        </div>
      )}

      {/* Maintenance: Grist staff, suspicious affiliations and corrections */}
      {!isNew && selected && detail && (
        <div className="grid grid-cols-1 gap-4">
          <EffectifsPanel
            slug={selected}
            gristLabo={detail.config.grist?.labo_acronyme || ''}
            disabled={busy}
            onSynced={() => void loadDetail(selected)}
          />
          <CorrectionsPanel
            slug={selected}
            hasParquet={Boolean(files?.parquet.exists)}
            hasKeywords={Boolean(
              detail.config.affiliation_controle?.mots_cles_positifs?.length
              || detail.config.affiliation_controle?.mots_cles_negatifs?.length,
            )}
            disabled={busy}
          />
        </div>
      )}
    </div>
  );
};
