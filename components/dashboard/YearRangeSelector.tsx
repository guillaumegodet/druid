import React from 'react';
import { YearRange } from './overviewAggregates';
import { Trans } from '@lingui/react/macro';

interface Props {
  bounds: { min: number; max: number };
  range: YearRange;
  onChange: (range: YearRange) => void;
}

/** Year range selector (two lists, each bounded by the other). */
export const YearRangeSelector: React.FC<Props> = ({ bounds, range, onChange }) => {
  const years: number[] = [];
  for (let y = bounds.min; y <= bounds.max; y++) years.push(y);

  const selectClass =
    'input-soft !w-auto py-1.5 pr-7 text-sm font-semibold cursor-pointer';

  return (
    <div className="flex items-center gap-2 text-sm text-muted dark:text-[#c3beb0]">
      <span><Trans>From</Trans></span>
      <select
        className={selectClass}
        value={range.start}
        onChange={(e) => onChange({ ...range, start: Math.min(Number(e.target.value), range.end) })}
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
      <span><Trans>to</Trans></span>
      <select
        className={selectClass}
        value={range.end}
        onChange={(e) => onChange({ ...range, end: Math.max(Number(e.target.value), range.start) })}
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </div>
  );
};
