import React, { useEffect, useMemo, useState } from 'react';
import { Download, Search, SlidersHorizontal, X } from 'lucide-react';
import { DashboardDataset, DashboardPublication } from './types';
import { YearRange } from './overviewAggregates';
import { languageLabel, oaLabel } from './labels';
import { accessLabel } from './phase4Aggregates';
import {
  PubFilters,
  buildFilterContext,
  buildFilterOptions,
  countActiveFilters,
  describeFilters,
  matchesFilters,
} from './publicationFilters';
import { numberLocale } from '../../lib/i18n';
import { doiUrl } from '../../lib/doi';
import { Trans, Plural, useLingui } from '@lingui/react/macro';

const PAGE_SIZE = 50;
const JOURNAL_DATALIST_MAX = 400;

function csvEscape(v: string | number | null | undefined): string {
  const s = (v ?? '').toString();
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Compact select of the filter panel (hidden if no option). */
const FilterSelect: React.FC<{
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}> = ({ label, value, options, onChange }) => {
  const { t } = useLingui();
  if (options.length === 0) return null;
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold text-muted dark:text-[#c3beb0]">
      {label}
      <select
        className="input-soft py-1.5 text-sm font-normal cursor-pointer"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{t({ message: `All`, context: "feminine" })}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
};

const FilterCheckbox: React.FC<{
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}> = ({ label, checked, onChange }) => (
  <label className="flex items-center gap-2 text-[13px] text-ink dark:text-[#f5f2ea] cursor-pointer select-none">
    <input
      type="checkbox"
      className="accent-current w-3.5 h-3.5"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
    {label}
  </label>
);

/**
 * « Liste des publications » tab: search, multi-criteria filters
 * (drivable from the other tabs via onOpenList → PubFilters),
 * sort by year, pagination, CSV export of the filtered results.
 */
export const PublicationsListTab: React.FC<{
  dataset: DashboardDataset;
  range: YearRange;
  filters: PubFilters;
  onFiltersChange: (filters: PubFilters) => void;
}> = ({ dataset, range, filters, onFiltersChange }) => {
  const { t, i18n } = useLingui();
  const [page, setPage] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);

  const ctx = useMemo(() => buildFilterContext(dataset), [dataset]);
  // i18n.locale: labels produced outside the component (labels.ts, publicationFilters.ts).
  const options = useMemo(() => buildFilterOptions(dataset, ctx), [dataset, ctx, i18n.locale]);
  const chips = useMemo(() => describeFilters(filters, ctx), [filters, ctx, i18n.locale]);
  const activeCount = countActiveFilters(filters);

  useEffect(() => {
    setPage(0);
  }, [filters, range]);

  const patch = (p: Partial<PubFilters>) => {
    const next = { ...filters, ...p };
    // charteSeuil only makes sense together with charterCompliant — without this cleanup, unchecking
    // then re-checking the Charter filter silently reused a threshold left by an earlier
    // drill-down instead of the export default (review lot 9a).
    if (!next.charterCompliant) delete next.charteSeuil;
    for (const k of Object.keys(next) as (keyof PubFilters)[]) {
      if (next[k] == null || next[k] === '' || next[k] === false) delete next[k];
    }
    onFiltersChange(next);
  };

  const rows = useMemo(
    () =>
      dataset.publications
        .filter((p) => typeof p.year === 'number' && p.year >= range.start && p.year <= range.end)
        .filter((p) => matchesFilters(p, filters, ctx))
        .sort(
          (a, b) => (b.year ?? 0) - (a.year ?? 0) || (a.title ?? '').localeCompare(b.title ?? ''),
        ),
    [dataset.publications, range, filters, ctx],
  );

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  // Exhaustive CSV export: every dimension of the DashboardPublication contract,
  // multi-values joined by « | » (allows finding in a spreadsheet what the tab's
  // filters do not cover — Nantes partners, FNEGE rank…).
  const downloadCsv = () => {
    const bool = (v: boolean | null | undefined) => (v == null ? '' : v ? 'oui' : 'non');
    const list = (v: (string | null | undefined)[] | null | undefined) =>
      (v ?? []).filter(Boolean).join(' | ');
    const cols: [string, (p: DashboardPublication) => string | number | null | undefined][] = [
      ['year', (p) => p.year],
      ['title', (p) => p.title],
      ['journal', (p) => p.journal],
      ['pub_type', (p) => p.pubType],
      ['oa_status', (p) => p.oaStatus],
      ['doi', (p) => p.doi],
      ['issn', (p) => p.issn],
      ['journal_publisher', (p) => p.journalPublisher],
      ['journal_access', (p) => (p.journalAccess ? accessLabel(p.journalAccess) : '')],
      ['licence_nationale', (p) => bool(p.licenceNationale)],
      ['sjr_quartile', (p) => p.sjrQuartile],
      ['fnege_rank', (p) => p.fnegeRank],
      ['language', (p) => (p.language ? languageLabel(p.language) : '')],
      ['authors', (p) => list((p.authorIds ?? []).map((id) => ctx.authorLabelById.get(id)))],
      ['author_count', (p) => p.authorCount],
      ['teams', (p) => list(p.teams)],
      ['sous_structures', (p) => list(p.sousStructures)],
      ['has_phd', (p) => bool(p.hasPhd)],
      ['cited_by_count', (p) => p.citedByCount],
      ['fwci', (p) => p.fwci],
      ['top_10_percent', (p) => bool(p.isTop10Percent)],
      ['top_1_percent', (p) => bool(p.isTop1Percent)],
      ['is_international', (p) => bool(p.isInternational)],
      ['collab_types', (p) => list(p.collabTypes)],
      ['nantes_partners', (p) => list(p.nantesPartners)],
      [
        'national_partners',
        (p) => list((p.nationalPartners ?? []).map((x) => (x.city ? `${x.name} (${x.city})` : x.name))),
      ],
      [
        'partner_institutions',
        (p) => list((p.partnerInstitutions ?? []).map((x) => (x.cc ? `${x.name} (${x.cc})` : x.name))),
      ],
      ['partner_countries', (p) => list((p.countries ?? []).map((cc) => ctx.countryLabel(cc)))],
      ['domains', (p) => list(p.domains)],
      ['subfields', (p) => list(p.subfields)],
      ['topics', (p) => list(p.topics)],
      ['strategic_axe', (p) => p.chosenAxe],
      ['axe_motivation', (p) => p.axeMotivation],
      ['has_apc', (p) => bool(p.hasApc)],
      ['apc_paid_usd', (p) => p.apcDetail?.paidUsd],
      ['apc_list_usd', (p) => p.apcDetail?.listUsd],
      ['corresponding_authors', (p) => list(p.apcDetail?.correspondingAuthors)],
      ['corresponding_institutions', (p) => list(p.apcDetail?.correspondingInstitutions)],
      ['charte_score', (p) => p.charte?.score],
      ['charte_conforme', (p) => bool(p.charte?.conforme)],
      ['charte_modele', (p) => p.charte?.modele],
      ['charte_signature', (p) => p.charte?.signature],
      [
        'charte_criteres',
        (p) =>
          Object.entries(p.charte?.criteres ?? {})
            .map(([k, v]) => `${k}=${v == null ? '?' : v ? 'oui' : 'non'}`)
            .join(' | '),
      ],
      ['source_db', (p) => p.sourceDb],
      ['sources', (p) => list(p.sources)],
      ['crisalid_harvesters', (p) => list(p.crisalidHarvesters)],
      ['openalex_lookup', (p) => p.openalexLookup],
    ];
    const header = cols.map(([name]) => name).join(',');
    const lines = rows.map((p) => cols.map(([, get]) => csvEscape(get(p))).join(','));
    // UTF-8 BOM: Excel (fr) does not interpret accents without it.
    const blob = new Blob(['\ufeff', [header, ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `publications_${range.start}-${range.end}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="glass-card flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
        <div>
          <h3 className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea]">
            <Trans>Publication list</Trans>
          </h3>
          <p className="text-xs text-muted-light dark:text-[#8f897c] mt-0.5">
            <Plural value={rows.length} one="# publication over the period" other="# publications over the period" />
            {activeCount > 0 && <> (<Plural value={activeCount} one="# filter" other="# filters" />)</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-lighter" />
            <input
              className="input-soft !w-64 !pl-8 py-1.5 text-sm"
              placeholder={t`Title, journal or DOI…`}
              value={filters.q ?? ''}
              onChange={(e) => patch({ q: e.target.value })}
            />
          </div>
          <button
            type="button"
            onClick={() => setPanelOpen((o) => !o)}
            title={t`Show filters`}
            className={`btn-pill px-3 py-1.5 text-[13px] ${panelOpen ? '!bg-ink !text-white dark:!bg-accent dark:!text-ink' : ''}`}
          >
            <SlidersHorizontal className="w-4 h-4" /> <Trans>Filters</Trans>
            {activeCount > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-ink text-[11px] font-bold">
                {activeCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={downloadCsv}
            title={t`Export as CSV (filtered results)`}
            className="btn-pill px-3 py-1.5 text-[13px]"
          >
            <Download className="w-4 h-4" /> CSV
          </button>
        </div>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 px-5 pb-3">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => patch({ [c.key]: undefined })}
              title={t`Remove this filter`}
              className="pill inline-flex items-center gap-1 pl-3 pr-2 py-1 text-xs bg-accent/20 dark:bg-accent/15 text-ink dark:text-[#f5f2ea] hover:bg-accent/35 dark:hover:bg-accent/25 cursor-pointer"
            >
              {c.label}
              <X className="w-3 h-3 opacity-60" />
            </button>
          ))}
          <button
            type="button"
            onClick={() => onFiltersChange({})}
            className="text-xs text-muted-light dark:text-[#8f897c] hover:underline ml-1 cursor-pointer"
          >
            <Trans>Clear all</Trans>
          </button>
        </div>
      )}

      {panelOpen && (
        <div className="mx-5 mb-3 p-4 rounded-panel bg-white/50 dark:bg-white/5 border border-ink/5 dark:border-white/10">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            <FilterSelect
              label={t`Year`}
              value={filters.year != null ? String(filters.year) : ''}
              options={options.years.map((y) => ({ value: String(y), label: String(y) }))}
              onChange={(v) => patch({ year: v ? Number(v) : undefined })}
            />
            <FilterSelect
              label={t`Document type`}
              value={filters.pubType ?? ''}
              options={options.pubTypes.map((v) => ({ value: v, label: v }))}
              onChange={(v) => patch({ pubType: v || undefined })}
            />
            <FilterSelect
              label={t`Open access`}
              value={filters.oaStatus ?? ''}
              options={options.oaStatuses.map((v) => ({ value: v, label: oaLabel(v) }))}
              onChange={(v) => patch({ oaStatus: v || undefined })}
            />
            <FilterSelect
              label={t`Language`}
              value={filters.language ?? ''}
              options={options.languages.map((v) => ({ value: v, label: languageLabel(v) }))}
              onChange={(v) => patch({ language: v || undefined })}
            />
            {options.journals.length > 0 && (
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted dark:text-[#c3beb0]">
                <Trans>Journal (exact name)</Trans>
                <input
                  className="input-soft py-1.5 text-sm font-normal"
                  list="pubfilter-journals"
                  placeholder={t({ message: `All`, context: "feminine" })}
                  value={filters.journal ?? ''}
                  onChange={(e) => patch({ journal: e.target.value || undefined })}
                />
                <datalist id="pubfilter-journals">
                  {options.journals.slice(0, JOURNAL_DATALIST_MAX).map((j) => (
                    <option key={j} value={j} />
                  ))}
                </datalist>
              </label>
            )}
            <FilterSelect
              label={t`SJR quartile`}
              value={filters.quartile ?? ''}
              options={options.quartiles.map((v) => ({ value: v, label: v }))}
              onChange={(v) => patch({ quartile: v || undefined })}
            />
            <FilterSelect
              label={t`NU access (journal)`}
              value={filters.journalAccess ?? ''}
              options={options.journalAccesses.map((v) => ({ value: v, label: accessLabel(v) }))}
              onChange={(v) => patch({ journalAccess: v || undefined })}
            />
            <FilterSelect
              label={dataset.teamLabel || t`Team`}
              value={filters.team ?? ''}
              options={options.teams.map((v) => ({ value: v, label: v }))}
              onChange={(v) => patch({ team: v || undefined })}
            />
            <FilterSelect
              label={t({ message: `Lab`, context: "long form" })}
              value={filters.sousStructure ?? ''}
              options={options.sousStructures.map((v) => ({ value: v, label: v }))}
              onChange={(v) => patch({ sousStructure: v || undefined })}
            />
            <FilterSelect
              label={t`Employment type`}
              value={filters.memberType ?? ''}
              options={options.memberTypes.map((v) => ({ value: v, label: v }))}
              onChange={(v) => patch({ memberType: v || undefined })}
            />
            <FilterSelect
              label={t`Collaboration`}
              value={filters.collabType ?? ''}
              options={options.collabTypes.map((v) => ({ value: v, label: v }))}
              onChange={(v) => patch({ collabType: v || undefined })}
            />
            <FilterSelect
              label={t`Partner country`}
              value={filters.country ?? ''}
              options={options.countries.map((c) => ({ value: c.cc, label: c.label }))}
              onChange={(v) => patch({ country: v || undefined })}
            />
            <FilterSelect
              label={t`Domain`}
              value={filters.domain ?? ''}
              options={options.domains.map((v) => ({ value: v, label: v }))}
              onChange={(v) => patch({ domain: v || undefined })}
            />
            <FilterSelect
              label={t`Subfield`}
              value={filters.subfield ?? ''}
              options={options.subfields.map((v) => ({ value: v, label: v }))}
              onChange={(v) => patch({ subfield: v || undefined })}
            />
            <FilterSelect
              label={t`Strategic axis`}
              value={filters.theme ?? ''}
              options={options.themes.map((v) => ({ value: v, label: v }))}
              onChange={(v) => patch({ theme: v || undefined })}
            />
            <FilterSelect
              label={t`Sources (provenance)`}
              value={filters.sourceCombo ?? ''}
              options={options.sourceCombos.map((v) => ({ value: v, label: v }))}
              onChange={(v) => patch({ sourceCombo: v || undefined })}
            />
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-4">
            <FilterCheckbox
              label={t`PhD student involved`}
              checked={!!filters.hasPhd}
              onChange={(c) => patch({ hasPhd: c || undefined })}
            />
            <FilterCheckbox
              label={t`International collaboration`}
              checked={!!filters.international}
              onChange={(c) => patch({ international: c || undefined })}
            />
            <FilterCheckbox
              label={t`APC paid`}
              checked={!!filters.hasApc}
              onChange={(c) => patch({ hasApc: c || undefined })}
            />
            <FilterCheckbox
              label={t`Top 10% citations`}
              checked={!!filters.top10}
              onChange={(c) => patch({ top10: c || undefined })}
            />
            <FilterCheckbox
              label={t`Top 1% citations`}
              checked={!!filters.top1}
              onChange={(c) => patch({ top1: c || undefined })}
            />
            <FilterCheckbox
              label={t`National licence`}
              checked={!!filters.licenceNationale}
              onChange={(c) => patch({ licenceNationale: c || undefined })}
            />
            {options.hasCharter && (
              <FilterCheckbox
                label={t`Compliant with the charter`}
                checked={!!filters.charterCompliant}
                onChange={(c) => patch({ charterCompliant: c || undefined })}
              />
            )}
          </div>
        </div>
      )}

      <div className="overflow-x-auto px-2 pb-2">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted-light dark:text-[#8f897c]">
              <th className="px-3 py-2 w-16"><Trans>Year</Trans></th>
              <th className="px-3 py-2"><Trans>Title</Trans></th>
              <th className="px-3 py-2 w-64"><Trans>Journal</Trans></th>
              <th className="px-3 py-2 w-40"><Trans>Type</Trans></th>
              <th className="px-3 py-2 w-28"><Trans>Access</Trans></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((p, i) => (
              <tr
                key={`${p.doi ?? p.title}-${i}`}
                className="border-t border-ink/5 dark:border-white/5 align-top"
              >
                <td className="px-3 py-2 font-semibold text-ink dark:text-[#f5f2ea]">{p.year}</td>
                <td className="px-3 py-2 text-ink dark:text-[#f5f2ea]">
                  {p.doi ? (
                    <a
                      href={doiUrl(p.doi) ?? undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:underline"
                    >
                      {p.title ?? p.doi}
                    </a>
                  ) : (
                    p.title ?? '—'
                  )}
                </td>
                <td className="px-3 py-2 text-muted dark:text-[#c3beb0]">{p.journal ?? '—'}</td>
                <td className="px-3 py-2 text-muted dark:text-[#c3beb0]">{p.pubType ?? '—'}</td>
                <td className="px-3 py-2 text-muted dark:text-[#c3beb0]">
                  {p.oaStatus ? oaLabel(p.oaStatus) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-ink/5 dark:border-white/5 text-sm text-muted dark:text-[#c3beb0]">
          <button
            type="button"
            className="btn-pill px-3 py-1 text-[13px] disabled:opacity-40"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            ← <Trans>Previous</Trans>
          </button>
          <span>
            <Trans>Page {currentPage + 1} / {pageCount}</Trans>
          </span>
          <button
            type="button"
            className="btn-pill px-3 py-1 text-[13px] disabled:opacity-40"
            disabled={currentPage >= pageCount - 1}
            onClick={() => setPage(currentPage + 1)}
          >
            <Trans>Next</Trans> →
          </button>
        </div>
      )}
    </div>
  );
};
