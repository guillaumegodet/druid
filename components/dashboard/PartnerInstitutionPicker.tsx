import React, { useMemo, useState } from 'react';
import { Search, X, Building2 } from 'lucide-react';
import { PartnerCatalogEntry } from './collabAggregates';
import type { PartnerGroup } from './consortia';
import { Trans, Plural, useLingui } from '@lingui/react/macro';

/**
 * Search + manual selection of partner institutions (national or
 * international) actually found in the corpus — modeled on the
 * PeerGroupPicker of the Benchmark tab (BenchmarkTab.tsx), but sourced from
 * `buildPartnerCatalog` (collabAggregates.ts) rather than from the Leiden
 * Ranking Open Edition reference dataset: unlike bibliometric comparison
 * peers, a collaboration partner can be any co-signing organization
 * (hospital, company, institute…), not only a large university. Phase 2 of
 * the « sélecteur d'institutions » plan (cf.
 * work/druid/plan-action-collab-picker.md, 2026-09-03), mounted by
 * PartnerBilanSection. `predefinedGroups` (lot 1 of docs/archive/plan-collab-consortium.md,
 * 2026-09-15): consortium chips (consortia.ts) that replace the selection
 * in one click, like the predefined groups of the PeerGroupPicker.
 */
export const PartnerInstitutionPicker: React.FC<{
  catalog: PartnerCatalogEntry[];
  selected: string[];
  onChange: (keys: string[]) => void;
  predefinedGroups?: PartnerGroup[];
  label?: string;
  description?: string;
  placeholder?: string;
}> = ({
  catalog,
  selected,
  onChange,
  predefinedGroups = [],
  label: labelProp,
  description: descriptionProp,
  placeholder: placeholderProp,
}) => {
  const { t } = useLingui();
  const label = labelProp ?? t`Partner institutions`;
  const description =
    descriptionProp ??
    (predefinedGroups.length > 0
      ? t`Pick a predefined group, or search for an institution Nantes Université has co-published with to build your own group.`
      : t`Search for an institution Nantes Université has co-published with to build a group (e.g. several universities of the same consortium).`);
  const placeholder = placeholderProp ?? t`Search for a partner institution…`;
  const [query, setQuery] = useState('');
  const byKey = useMemo(() => new Map(catalog.map((c) => [c.key, c])), [catalog]);
  const selectedEntries = useMemo(
    () => selected.map((k) => byKey.get(k)).filter((c): c is PartnerCatalogEntry => c != null),
    [byKey, selected],
  );
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return catalog
      .filter(
        (c) =>
          !selected.includes(c.key) &&
          (c.name.toLowerCase().includes(q) || c.city?.toLowerCase().includes(q)),
      )
      .slice(0, 8);
  }, [catalog, query, selected]);

  return (
    <div className="glass-card p-4 flex flex-col gap-3">
      <div>
        <h3 className="font-disp font-semibold text-[15px] text-ink dark:text-[#f5f2ea] flex items-center gap-1.5">
          <Building2 className="w-4 h-4" /> {label}
        </h3>
        <p className="text-xs text-muted-light dark:text-[#8f897c] mt-0.5">{description}</p>
      </div>
      {predefinedGroups.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {predefinedGroups.map((g) => (
            <button
              key={g.key}
              type="button"
              onClick={() => onChange(g.keys)}
              title={t`Replaces the current selection with this predefined group`}
              className="pill inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-accent/20 dark:bg-accent/15 text-ink dark:text-[#f5f2ea] hover:bg-accent/35 dark:hover:bg-accent/25 cursor-pointer"
            >
              {g.label} · <Plural value={g.keys.length} one="# university" other="# universities" />
            </button>
          ))}
        </div>
      )}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-lighter" />
        <input
          className="input-soft !w-full !pl-8 py-1.5 text-sm"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {matches.length > 0 && (
          <div className="absolute z-10 mt-1 w-full glass-card-strong p-1 flex flex-col gap-0.5 max-h-64 overflow-y-auto">
            {matches.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => {
                  onChange([...selected, c.key]);
                  setQuery('');
                }}
                className="text-left px-2.5 py-1.5 rounded-md text-sm text-ink dark:text-[#f5f2ea] hover:bg-accent/20 dark:hover:bg-accent/15 cursor-pointer flex items-center justify-between gap-2"
              >
                <span>
                  {c.name}
                  {c.city && (
                    <span className="text-xs text-muted-light dark:text-[#8f897c] ml-1.5">{c.city}</span>
                  )}
                </span>
                <span className="text-xs text-muted-lighter shrink-0"><Plural value={c.count} one="# pub" other="# pubs" /></span>
              </button>
            ))}
          </div>
        )}
      </div>
      {selectedEntries.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {selectedEntries.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => onChange(selected.filter((k) => k !== c.key))}
              title={t`Remove this institution`}
              className="pill inline-flex items-center gap-1 pl-3 pr-2 py-1 text-xs bg-accent/20 dark:bg-accent/15 text-ink dark:text-[#f5f2ea] hover:bg-accent/35 dark:hover:bg-accent/25 cursor-pointer"
            >
              {c.name}
              <X className="w-3 h-3 opacity-60" />
            </button>
          ))}
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-xs text-muted-light dark:text-[#8f897c] hover:underline ml-1 cursor-pointer"
          >
            <Trans>Clear all</Trans>
          </button>
        </div>
      )}
    </div>
  );
};
