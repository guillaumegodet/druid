import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { useLingui } from '@lingui/react/macro';
import { byCountryName, searchCountryOptions, type CountryOption } from './countryAggregates';
import type { CountryName } from './types';
import { numberLocale } from '../../lib/i18n';

/**
 * Partner country selector of the « Pays » sub-tab: the countries in alphabetical order, with a
 * search field (accents ignored, French or English name) — a plain <select> sorted by volume made
 * the 150-odd countries hard to browse.
 */
export const CountryPicker: React.FC<{
  options: CountryOption[];
  value: string;
  /** Label of the current country when it is not among the options (no co-publication over the period). */
  valueLabel?: string;
  /** Shown while no country is chosen (`value` empty). */
  placeholder?: string;
  disabled?: boolean;
  countryNames: Record<string, CountryName>;
  onChange: (cc: string) => void;
}> = ({ options, value, valueLabel, placeholder, disabled, countryNames, onChange }) => {
  const { t, i18n } = useLingui();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);

  const sorted = useMemo(() => byCountryName(options, i18n.locale), [options, i18n.locale]);
  const matches = useMemo(() => searchCountryOptions(sorted, query, countryNames), [sorted, query, countryNames]);
  const current = options.find((o) => o.cc === value);
  const fmt = (n: number) => n.toLocaleString(numberLocale());

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Opening: empty search, the current country highlighted and in view.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(Math.max(0, sorted.findIndex((o) => o.cc === value)));
  }, [open, sorted, value]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const pick = (cc: string) => {
    onChange(cc);
    setOpen(false);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(matches.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (matches[active]) pick(matches[active].cc);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        className="input-soft !w-auto py-1.5 pl-3 pr-2 text-sm cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-default"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        {current ? `${current.label} (${fmt(current.count)})` : value ? `${valueLabel ?? value} (0)` : placeholder}
        <ChevronDown className="w-4 h-4 opacity-60" />
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-72 glass-card-strong p-1.5 flex flex-col gap-1 bg-white/95 dark:bg-[#33312c]">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-lighter" />
            <input
              autoFocus
              className="input-soft !w-full !pl-8 py-1.5 text-sm"
              placeholder={t`Search for a country…`}
              aria-label={t`Search for a country`}
              role="combobox"
              aria-expanded
              aria-controls="country-picker-list"
              aria-activedescendant={matches[active] ? `country-option-${matches[active].cc}` : undefined}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKey}
            />
          </div>
          <ul ref={list} id="country-picker-list" role="listbox" className="max-h-72 overflow-y-auto flex flex-col gap-0.5">
            {matches.map((o, i) => (
              <li
                key={o.cc}
                id={`country-option-${o.cc}`}
                data-index={i}
                role="option"
                aria-selected={o.cc === value}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o.cc)}
                className={`px-2.5 py-1.5 rounded-md text-sm text-ink dark:text-[#f5f2ea] cursor-pointer flex items-center justify-between gap-2 ${
                  i === active ? 'bg-accent/20 dark:bg-accent/15' : ''
                } ${o.cc === value ? 'font-semibold' : ''}`}
              >
                <span>{o.label}</span>
                <span className="text-xs text-muted-lighter shrink-0">{fmt(o.count)}</span>
              </li>
            ))}
            {!matches.length && (
              <li className="px-2.5 py-1.5 text-sm text-muted-light dark:text-[#8f897c]">{t`No partner country matches.`}</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
};
