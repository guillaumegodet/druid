import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { useLingui } from '@lingui/react/macro';

interface MultiSelectFilterProps {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (values: string[]) => void;
  /** Tooltip of the pill (e.g. what the filter applies to). */
  title?: string;
}

/** Multiple-choice filter as a compact dropdown pill: the label alone when empty,
 * « Label · value » once something is selected — extracted from ResearcherList.tsx (lot 3 of the
 * multi-instance architecture plan, refactor sub-lot ResearcherList). */
export const MultiSelectFilter: React.FC<MultiSelectFilterProps> = ({ label, options, selected, onChange, title }) => {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = (val: string) => {
    if (selected.includes(val)) onChange(selected.filter(v => v !== val));
    else onChange([...selected, val]);
  };

  const active = selected.length > 0;
  const valueLabel = selected.length === 1
    ? (options.find(o => o.value === selected[0])?.label ?? selected[0])
    : t`${selected.length} selected`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        title={title}
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full font-disp font-semibold text-[12.5px] transition-colors ${
          active
            ? 'bg-accent border border-accent-strong text-ink'
            : 'bg-white/75 dark:bg-white/10 border border-white/80 dark:border-white/15 text-ink dark:text-[#f5f2ea] hover:bg-white dark:hover:bg-white/15'
        }`}
      >
        <span className={active ? 'text-ink/60' : ''}>{label}</span>
        {active && <span className="truncate max-w-[140px]">· {valueLabel}</span>}
        <ChevronDown className={`w-3.5 h-3.5 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''} ${active ? 'text-ink/60' : 'text-muted-light dark:text-[#8f897c]'}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1.5 rounded-2xl bg-cream-100 dark:bg-[#201e1a] border border-white/60 dark:border-white/10 shadow-soft-lg z-30 min-w-[220px] max-h-[300px] overflow-y-auto p-1.5">
          {options.map(opt => (
            <label key={opt.value} className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl cursor-pointer hover:bg-accent/10 transition-colors">
              <input type="checkbox" checked={selected.includes(opt.value)} onChange={() => toggle(opt.value)} className="w-4 h-4 rounded accent-ink dark:accent-accent" />
              <span className="text-[12.5px] font-semibold text-ink dark:text-[#f5f2ea] truncate">{opt.label}</span>
            </label>
          ))}
          {active && (
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full mt-1 pt-2 pb-1 px-3 border-t border-ink/5 dark:border-white/5 text-left text-[12px] font-semibold text-muted dark:text-[#8f897c] hover:text-ink dark:hover:text-[#f5f2ea]"
            >
              {t`Clear selection`}
            </button>
          )}
        </div>
      )}
    </div>
  );
};
