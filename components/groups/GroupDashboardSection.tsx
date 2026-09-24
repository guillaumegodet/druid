import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BarChart3, Loader2, RefreshCw, Trash2, AlertCircle, CheckCircle } from 'lucide-react';
import { Researcher } from '../../types';
import {
  EtlStatus,
  GroupDashboardApi,
  GroupDashboardInfo,
  groupSlug,
  isHarvestable,
  toMemberPayload,
} from './groupDashboardApi';
import { Trans, Plural, useLingui } from '@lingui/react/macro';
import { apiErrorText, translateApiError } from '../../lib/apiErrors';

const POLL_MS = 4000;
const currentYear = new Date().getFullYear();

/**
 * @component GroupDashboardSection
 * @description « Tableau de bord bibliométrique » block of a group: runs
 * the by-author ETL (druid-biblio factory via server.cjs), tracks its
 * progress, opens the generated dashboard. Open to any logged-in user.
 */
export const GroupDashboardSection: React.FC<{
  groupName: string;
  members: Researcher[];
  onOpenDashboard: (slug: string) => void;
}> = ({ groupName, members, onOpenDashboard }) => {
  const { t, i18n } = useLingui();
  const slug = groupSlug(groupName);
  const [info, setInfo] = useState<GroupDashboardInfo | null>(null);
  const [status, setStatus] = useState<EtlStatus | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [yearFrom, setYearFrom] = useState(2020);
  const [yearTo, setYearTo] = useState(currentYear);
  const pollRef = useRef<number | null>(null);

  const harvestable = members.filter(isHarvestable);
  const harvestableCount = harvestable.length;

  const refreshInfo = useCallback(async () => {
    try {
      const groups = await GroupDashboardApi.list();
      setInfo(groups.find((g) => g.slug === slug) ?? null);
    } catch {
      // API unavailable (biblio profile stopped…): the section remains usable read-only.
    }
  }, [slug]);

  const stopPolling = () => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = window.setInterval(async () => {
      try {
        const s = await GroupDashboardApi.status(slug);
        setStatus(s);
        if (s.state !== 'running') {
          stopPolling();
          setGenerating(false);
          void refreshInfo();
        }
      } catch {
        // transient poll error: retry on the next tick
      }
    }, POLL_MS);
  }, [slug, refreshInfo]);

  useEffect(() => {
    void refreshInfo();
    return stopPolling;
  }, [refreshInfo]);

  // ETL already running for this group on mount (started by a colleague) → track it.
  useEffect(() => {
    if (info?.state === 'running' && pollRef.current === null) {
      setGenerating(true);
      startPolling();
    }
  }, [info, startPolling]);

  const generate = async () => {
    setError(null);
    if (harvestable.length === 0) {
      setError(t`No harvestable member: enter ORCIDs or identify the OpenAlex authors.`);
      return;
    }
    setGenerating(true);
    setStatus({ state: 'running', log: [] });
    try {
      const r = await GroupDashboardApi.generate(
        slug, groupName, members.map(toMemberPayload), yearFrom, yearTo,
      );
      if (r.warning) {
        setError(r.warning);
        setGenerating(false);
        return;
      }
      startPolling();
    } catch (e) {
      setError(e instanceof Error ? apiErrorText(e) : t`Error at launch`);
      setGenerating(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(t`Delete the dashboard of the group “${groupName}”?`)) return;
    setError(null);
    try {
      await GroupDashboardApi.remove(slug);
      setInfo(null);
      setStatus(null);
    } catch (e) {
      setError(e instanceof Error ? apiErrorText(e) : t`Deletion error`);
    }
  };

  const lastLog = status?.log?.length ? status.log[status.log.length - 1] : null;
  const running = generating || status?.state === 'running';

  return (
    <div className="mt-6 pt-4 border-t border-ink/10 dark:border-white/10">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <h4 className="section-label flex items-center gap-2">
            <BarChart3 className="w-4 h-4" /> <Trans>Bibliometric dashboard</Trans>
          </h4>
          <p className="text-[12.5px] text-muted-light dark:text-[#8f897c] mt-1">
            <Plural
              value={members.length}
              one={`{harvestableCount}/# harvestable member (ORCID or identified OpenAlex author)`}
              other={`{harvestableCount}/# harvestable members (ORCID or identified OpenAlex author)`}
            />
            {harvestable.length < members.length && <Trans> — the others will be excluded from the corpus</Trans>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-[12.5px] font-semibold text-muted dark:text-[#c3beb0]">
            <Trans>Period</Trans>
            <input
              type="number"
              className="input-soft !w-20 ml-2 py-1 text-sm"
              value={yearFrom}
              min={1950}
              max={yearTo}
              onChange={(e) => setYearFrom(Number(e.target.value))}
              disabled={running}
            />
          </label>
          <span className="text-muted-light">–</span>
          <input
            type="number"
            className="input-soft !w-20 py-1 text-sm"
            value={yearTo}
            min={yearFrom}
            max={currentYear + 1}
            onChange={(e) => setYearTo(Number(e.target.value))}
            disabled={running}
          />
          <button
            type="button"
            className="btn-pill-dark"
            onClick={() => void generate()}
            disabled={running || members.length === 0}
          >
            {running ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            {info?.hasDashboard ? t`Regenerate` : t`Generate the dashboard`}
          </button>
          {info?.hasDashboard && !running && (
            <>
              <button type="button" className="btn-pill" onClick={() => onOpenDashboard(slug)}>
                <BarChart3 className="w-4 h-4" /> <Trans>View the dashboard</Trans>
              </button>
              <button
                type="button"
                onClick={() => void remove()}
                title={t`Delete the dashboard`}
                className="text-muted-faint hover:text-[#d64545] transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {running && (
        <p className="flex items-center gap-2 text-[13px] text-muted dark:text-[#c3beb0]">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          <span className="truncate">
            {lastLog ? t`Harvesting in progress — ${lastLog}` : t`Harvesting in progress…`}
          </span>
        </p>
      )}
      {!running && status?.state === 'error' && (
        <p className="flex items-center gap-2 text-[13px] text-[#d64545]">
          <AlertCircle className="w-4 h-4 shrink-0" /> <Trans>ETL failed: {translateApiError(status.error)}</Trans>
        </p>
      )}
      {!running && status?.state === 'done' && (
        <p className="flex items-center gap-2 text-[13px] text-[#1f7a4d] dark:text-[#5fd39a]">
          <CheckCircle className="w-4 h-4 shrink-0" />
          {lastLog ? t`Dashboard generated — ${lastLog}` : t`Dashboard generated`}
        </p>
      )}
      {!running && !status && info?.hasDashboard && info.endedAt && (
        <p className="text-[12.5px] text-muted-light dark:text-[#8f897c]">
          <Trans>Last generation: {new Date(info.endedAt).toLocaleString(i18n.locale)}</Trans>
        </p>
      )}
      {error && <p className="text-[13px] text-[#d64545] mt-1">{error}</p>}
    </div>
  );
};
