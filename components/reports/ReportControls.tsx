// Context controls shared by the report creation dialog and the editor: structure, period
// (relative « last N complete years » or fixed), corpus scope.

import React, { useEffect, useState } from 'react';
import { useLingui } from '@lingui/react/macro';
import { fetchDashboardStructures } from '../../lib/dashboardSource';
import type { ReportPeriod } from '../dashboard/report/definition';

export const selectCls = 'input-soft !w-auto py-1.5 pr-7 text-sm font-semibold cursor-pointer disabled:cursor-default';

/** Dashboards the user can open (same list as the dashboard selector). */
export function useStructureSlugs(): { slugs: string[]; groups: string[] } {
  const [state, setState] = useState<{ slugs: string[]; groups: string[] }>({ slugs: [], groups: [] });
  useEffect(() => {
    fetchDashboardStructures()
      .then(({ slugs, groups }) => setState({ slugs, groups }))
      .catch(() => setState({ slugs: [], groups: [] }));
  }, []);
  return state;
}

export const StructureSelect: React.FC<{
  value: string;
  onChange: (slug: string) => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled }) => {
  const { t } = useLingui();
  const { slugs, groups } = useStructureSlugs();
  const structures = slugs.filter((s) => !groups.includes(s));
  const known = slugs.includes(value);
  return (
    <select
      className={selectCls}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      title={t`Structure or group`}
    >
      {!known && <option value={value}>{value || '—'}</option>}
      <optgroup label={t`Structures`}>
        {structures.map((s) => <option key={s} value={s}>{s}</option>)}
      </optgroup>
      {groups.length > 0 && (
        <optgroup label={t`Groups`}>
          {groups.map((s) => <option key={s} value={s}>{s.replace(/^groupe-/, '')}</option>)}
        </optgroup>
      )}
    </select>
  );
};

const RELATIVE_YEARS = [1, 2, 3, 4, 5, 6, 8, 10];
const THIS_YEAR = new Date().getFullYear();

export const PeriodInput: React.FC<{
  value: ReportPeriod;
  onChange: (p: ReportPeriod) => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled }) => {
  const { t } = useLingui();
  const years: number[] = [];
  for (let y = THIS_YEAR; y >= 1990; y--) years.push(y);
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <select
        className={selectCls}
        value={value.kind}
        disabled={disabled}
        onChange={(e) =>
          onChange(
            e.target.value === 'fixed'
              ? { kind: 'fixed', start: THIS_YEAR - 5, end: THIS_YEAR - 1 }
              : { kind: 'relative', lastYears: 5, includeCurrent: false },
          )
        }
        title={t`Period`}
      >
        <option value="relative">{t`Last years`}</option>
        <option value="fixed">{t`Fixed years`}</option>
      </select>
      {value.kind === 'relative' ? (
        <>
          <select
            className={selectCls}
            value={value.lastYears}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, lastYears: Number(e.target.value) })}
          >
            {RELATIVE_YEARS.map((n) => <option key={n} value={n}>{t`${n} years`}</option>)}
          </select>
          <label className="inline-flex items-center gap-1 text-xs text-muted dark:text-[#c3beb0]">
            <input
              type="checkbox"
              checked={value.includeCurrent}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, includeCurrent: e.target.checked })}
            />
            {t`incl. current year`}
          </label>
        </>
      ) : (
        <>
          <select
            className={selectCls}
            value={value.start}
            disabled={disabled}
            onChange={(e) => {
              const start = Number(e.target.value);
              onChange({ ...value, start, end: Math.max(start, value.end) });
            }}
          >
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <span className="text-muted-light">→</span>
          <select
            className={selectCls}
            value={value.end}
            disabled={disabled}
            onChange={(e) => {
              const end = Number(e.target.value);
              onChange({ ...value, end, start: Math.min(end, value.start) });
            }}
          >
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </>
      )}
    </span>
  );
};

export const PerimetreSelect: React.FC<{
  value: 'affiliation' | 'effectifs';
  onChange: (p: 'affiliation' | 'effectifs') => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled }) => {
  const { t } = useLingui();
  return (
    <select
      className={selectCls}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === 'effectifs' ? 'effectifs' : 'affiliation')}
      title={t({ message: `Scope`, context: "perimeter" })}
    >
      <option value="affiliation">{t`Affiliation`}</option>
      <option value="effectifs">{t`Headcount`}</option>
    </select>
  );
};
