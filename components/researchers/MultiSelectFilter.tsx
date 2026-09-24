import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { useLingui } from '@lingui/react/macro';

interface MultiSelectFilterProps {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (values: string[]) => void;
}

/** Multiple-choice filter as a dropdown pill — extracted from ResearcherList.tsx (lot 3 of the
 * multi-instance architecture plan, refactor sub-lot ResearcherList). */
export const MultiSelectFilter: React.FC<MultiSelectFilterProps> = ({ label, options, selected, onChange }) => {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = (val: string) => {
    if (selected.includes(val)) onChange(selected.filter(v => v !== val));
    else onChange([...selected, val]);
  };

  const buttonLabel = selected.length === 0
    ? t`ALL`
    : selected.length === 1
      ? (options.find(o => o.value === selected[0])?.label ?? selected[0])
      : t`${selected.length} selected`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`inline-flex items-center gap-2 h-10 px-4 rounded-full font-disp font-semibold text-[13px] transition-colors ${
          selected.length > 0
            ? 'bg-accent border border-accent-strong text-ink'
            : 'bg-white/75 dark:bg-white/10 border border-white/80 dark:border-white/15 text-ink dark:text-[#f5f2ea] hover:bg-white dark:hover:bg-white/15'
        }`}
      >
        <span className={`text-[10.5px] uppercase tracking-[.07em] font-bold ${selected.length > 0 ? 'text-ink/60' : 'text-muted-light dark:text-[#8f897c]'}`}>{label}</span>
        <span className="truncate max-w-[130px]">{buttonLabel}</span>
        <ChevronDown className={`w-3.5 h-3.5 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''} ${selected.length > 0 ? 'text-ink/60' : 'text-muted-light dark:text-[#8f897c]'}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-2 rounded-2xl bg-cream-100 dark:bg-[#201e1a] border border-white/60 dark:border-white/10 shadow-soft-lg z-30 min-w-[220px] max-h-[280px] overflow-y-auto p-1.5">
          <label className="flex items-center gap-2.5 px-3 py-2 rounded-xl cursor-pointer hover:bg-accent/10 transition-colors border-b border-ink/5 dark:border-white/5">
            <input type="checkbox" checked={selected.length === 0} onChange={() => onChange([])} className="w-4 h-4 rounded accent-ink dark:accent-accent" />
            <span className="text-[12.5px] font-semibold text-ink dark:text-[#f5f2ea]">{t`ALL`}</span>
          </label>
          {options.map(opt => (
            <label key={opt.value} className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl cursor-pointer hover:bg-accent/10 transition-colors">
              <input type="checkbox" checked={selected.includes(opt.value)} onChange={() => toggle(opt.value)} className="w-4 h-4 rounded accent-ink dark:accent-accent" />
              <span className="text-[12.5px] font-semibold text-ink dark:text-[#f5f2ea] truncate">{opt.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
};
