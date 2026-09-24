import React, { useEffect, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { useLingui } from '@lingui/react/macro';
import { normalizeFuzzyDate } from '../../lib/dates';

interface FuzzyDateInputProps {
  /** Canonical fuzzy date (`YYYY`, `YYYY-MM`, `YYYY-MM-DD`) or `''`. */
  value: string;
  /** Called with a canonical fuzzy date (or `''`), never with an unparseable string. */
  onChange: (value: string) => void;
  /** Classes of the text input (the caller's field style). */
  className?: string;
  /** Classes of the wrapping element (width, margins). */
  wrapperClassName?: string;
  title?: string;
  disabled?: boolean;
  /** Dark variant (ink card): calendar button colors. */
  dark?: boolean;
  id?: string;
}

/**
 * Text input for a reduced-precision date (lib/dates.ts): the user types `2026`, `2026-06`
 * or `2026-06-15` (French `15/06/2026` and `06/2026` are accepted and normalized on blur).
 * A calendar button opens the native date picker for a full date. The value is propagated as
 * soon as the text is a canonical fuzzy date, and on blur after normalization; an unreadable
 * text is kept on screen, flagged in red, and not propagated.
 */
export const FuzzyDateInput: React.FC<FuzzyDateInputProps> = ({
  value, onChange, className = '', wrapperClassName = '', title, disabled, dark, id,
}) => {
  const { t } = useLingui();
  const [text, setText] = useState(value || '');
  const [invalid, setInvalid] = useState(false);
  const focused = useRef(false);
  const pickerRef = useRef<HTMLInputElement>(null);

  // External change (record reload, "copy as employment end" button) while not editing.
  useEffect(() => {
    if (!focused.current) { setText(value || ''); setInvalid(false); }
  }, [value]);

  const commit = (raw: string) => {
    const n = normalizeFuzzyDate(raw);
    if (n === null) { setInvalid(true); return; }
    setInvalid(false);
    setText(n);
    if (n !== value) onChange(n);
  };

  const handleChange = (raw: string) => {
    setText(raw);
    const n = normalizeFuzzyDate(raw);
    // Canonical as typed (or cleared) → live propagation; other forms wait for blur.
    if (n !== null && (n === raw.trim())) { setInvalid(false); if (n !== value) onChange(n); }
  };

  const openPicker = () => {
    const el = pickerRef.current;
    if (!el || disabled) return;
    try { (el as any).showPicker ? (el as any).showPicker() : el.click(); } catch { el.click(); }
  };

  const invalidTitle = t`Unrecognized date: enter YYYY-MM-DD, YYYY-MM or YYYY`;
  return (
    <span className={`relative inline-flex items-center ${wrapperClassName}`}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={text}
        disabled={disabled}
        placeholder={t`YYYY-MM-DD, YYYY-MM or YYYY`}
        title={invalid ? invalidTitle : title}
        aria-invalid={invalid || undefined}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; commit(text); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(text); } }}
        className={`${className} w-full pr-8${invalid ? ' !border-[#e05a5a] !text-[#e05a5a]' : ''}`}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onClick={openPicker}
        title={t`Pick a full date from the calendar`}
        className={`absolute right-1.5 p-0.5 rounded transition-colors ${dark ? 'text-white/45 hover:text-accent' : 'text-muted-faint hover:text-ink dark:text-[#8f897c] dark:hover:text-[#f5f2ea]'} disabled:opacity-40`}
      >
        <CalendarDays className="w-3.5 h-3.5" />
      </button>
      {/* Native picker, kept rendered (zero size) so showPicker() is allowed. */}
      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ''}
        onChange={(e) => { if (e.target.value) { setText(e.target.value); setInvalid(false); onChange(e.target.value); } }}
        className="absolute right-0 bottom-0 w-0 h-0 opacity-0 pointer-events-none"
      />
    </span>
  );
};
