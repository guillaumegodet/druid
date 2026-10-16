import React, { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { hasCapability } from '../../lib/auth';
import { phdOf, thesisPageUrl, type ThesisStatus } from '../../lib/thesis';

interface ThesisView {
  nnt: string;
  title: string;
  defendedOn: string | null;
  status: ThesisStatus;
  institution: string;
  discipline: string;
  source: 'theses.fr' | 'manual';
}
interface ThesesAnswer {
  theses: ThesisView[];
  check: { checkedAt: string; found: number; error: string } | null;
}

/** Fuzzy date as read: 2016-12-10 → 10/12/2016, 2016 → 2016. */
const fmtFuzzy = (d: string): string => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('/') : /^\d{4}-\d{2}$/.test(d) ? d.split('-').reverse().join('/') : d);

/**
 * Doctoral thesis of the record, read from theses.fr by the weekly sync (druid-internal docs/plan-funding-calls.md,
 * lot 5): the PhD (date, institution, discipline, link) or the thesis in progress, « not found » once checked without
 * result, nothing before the first check. Read-only; PostgreSQL instances only (capability HAS_CALLS). A record
 * without uid is looked up by its directory row.
 */
export const ThesisInfo: React.FC<{ uid: string; rowId?: number; labelClassName: string }> = ({ uid, rowId, labelClassName }) => {
  const { t } = useLingui();
  const [data, setData] = useState<ThesesAnswer | null>(null);
  const url = uid ? `/api/researchers/${encodeURIComponent(uid)}/theses` : rowId ? `/api/researchers/by-row/${rowId}/theses` : '';
  const enabled = hasCapability('HAS_CALLS') && !!url;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setData(null);
    fetch(url, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, [url, enabled]);

  if (!enabled || !data || (!data.check && !data.theses.length)) return null;
  const phd = phdOf(data.theses);
  const current = phd ?? data.theses.find((x) => x.status === 'in_progress') ?? null;
  return (
    <div className="md:col-span-2">
      <span className={labelClassName}><Trans>Doctoral thesis</Trans></span>
      {current ? (
        <p className="text-[13px] text-[#4b473e] dark:text-[#e7e2d6] leading-relaxed">
          {current.status === 'defended'
            ? <Trans>Defended {current.defendedOn ? fmtFuzzy(current.defendedOn) : ''}</Trans>
            : <Trans>In progress</Trans>}
          {current.institution && <> · {current.institution}</>}
          {current.discipline && <> · {current.discipline}</>}
          {current.title && <span className="block text-muted dark:text-[#c3beb0] italic">{current.title}</span>}
          {current.source === 'theses.fr' && (
            <a href={thesisPageUrl(current.nnt)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-ink dark:text-[#f5f2ea] hover:underline" title={t`Open the thesis on theses.fr`}>
              <ExternalLink className="w-3.5 h-3.5" /> theses.fr
            </a>
          )}
        </p>
      ) : (
        <p className="text-[13px] text-muted dark:text-[#c3beb0]">
          {data.check?.error ? <Trans>theses.fr could not be read at the last check.</Trans> : <Trans>No thesis found on theses.fr for the IdRef of the record.</Trans>}
        </p>
      )}
    </div>
  );
};
