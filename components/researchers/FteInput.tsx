import React, { useEffect, useState } from 'react';
import { useLingui } from '@lingui/react/macro';
import { parseFteInput } from '../../lib/fte';

/**
 * FTE field (0-1) of the « Employment & contract » card. Keeps the typed text so that « 0, » or
 * « 0.» can be entered; the record receives null (empty), a number, or nothing while the text is
 * invalid (red border). Empty ≠ 0: see lib/fte.ts.
 */
export const FteInput: React.FC<{
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  className: string;
}> = ({ value, onChange, className }) => {
  const { t } = useLingui();
  const [text, setText] = useState(value == null ? '' : String(value));
  // Record reloaded or changed from outside: resync unless the text already means that value.
  useEffect(() => {
    const parsed = parseFteInput(text);
    if (parsed === 'invalid' || parsed !== (value ?? null)) setText(value == null ? '' : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const invalid = parseFteInput(text) === 'invalid';
  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      placeholder={t`Not provided`}
      aria-invalid={invalid || undefined}
      title={invalid ? t`Enter a value between 0 and 1 (e.g. 0.5), or leave empty` : undefined}
      onChange={(e) => {
        setText(e.target.value);
        const parsed = parseFteInput(e.target.value);
        if (parsed !== 'invalid') onChange(parsed);
      }}
      className={`${className}${invalid ? ' !border-status-external' : ''}`}
    />
  );
};
