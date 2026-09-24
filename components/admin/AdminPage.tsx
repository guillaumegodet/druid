import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { adminTabsFor, type AdminTab } from '../../lib/auth';
import { ViewState } from '../../types';
import { EtlConsolePage } from '../etl/EtlConsolePage';
import { RightsPage } from '../rights/RightsPage';
import { MediaSourcesAdmin } from '../dashboard/MediaSourcesAdmin';
import { HelpButton } from '../HelpButton';
import { ADMIN_TAB_HELP } from '../../lib/helpLinks';

export type { AdminTab };

/**
 * @component AdminPage
 * @description « Administration » section (navigation bar entry):
 * ETL console (admin role), rights management (super admin) and media sources
 * (super admin or media administrator). Gathers tools formerly
 * scattered across the dashboard tabs (console, rights) and the media
 * monitoring (sources). The current tab and the console's structure are in
 * the URL (?tab=console|rights|media&struct=<slug>) to remain shareable.
 */
export const AdminPage: React.FC<{
  /** Requested tab (URL or internal link); falls back to the first accessible one. */
  initialTab?: AdminTab | null;
  /** Structure to preselect in the ETL console. */
  struct?: string | null;
  /** Opens a structure's dashboard (from the console). */
  onOpenDashboard?: (slug: string) => void;
  /** Outgoing flow to SoVisu+: regenerates people.csv for cdb (former entry of the Synchroniser menu of
   *  Personnel — docs/archive/plan-reorganisation-sync-ldap.md, lot 4). Absent on an instance without server jobs. */
  onSyncToSovisu?: () => void;
  syncingSovisu?: boolean;
}> = ({ initialTab, struct, onOpenDashboard, onSyncToSovisu, syncingSovisu = false }) => {
  const { t } = useLingui();
  const tabs = useMemo(adminTabsFor, []);
  const [tab, setTab] = useState<AdminTab>(initialTab && tabs.includes(initialTab) ? initialTab : tabs[0] ?? 'console');

  useEffect(() => {
    if (initialTab && tabs.includes(initialTab)) setTab(initialTab);
  }, [initialTab, tabs]);

  // Shareable URL: ?page=ADMIN&tab=… (+ ?struct= set by the console itself).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    p.set('page', ViewState.ADMIN);
    p.delete('id');
    p.set('tab', tab);
    if (tab !== 'console') p.delete('struct');
    window.history.replaceState(null, '', `${window.location.pathname}?${p.toString()}`);
  }, [tab]);

  const labels: Record<AdminTab, React.ReactNode> = {
    console: <Trans>ETL console</Trans>,
    rights: <Trans>Access rights</Trans>,
    media: <Trans>Media sources</Trans>,
  };
  const tabBtn = (active: boolean) =>
    `pill px-4 py-1.5 text-[13px] transition-colors cursor-pointer ${
      active
        ? 'bg-ink text-white dark:bg-accent dark:text-ink shadow-nav-active'
        : 'bg-white/60 dark:bg-white/10 text-ink dark:text-[#f5f2ea] hover:bg-white dark:hover:bg-white/15'
    }`;

  if (tabs.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-sm font-semibold text-muted-light dark:text-[#8f897c]">
        <Trans>Section reserved for administrators.</Trans>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-4 p-6 overflow-y-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <h2 className="font-disp font-bold text-xl text-ink dark:text-[#f5f2ea] leading-tight">
            <Trans>Administration</Trans>
          </h2>
          <HelpButton path={ADMIN_TAB_HELP[tab]} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tabs.map((k) => (
            <button key={k} type="button" className={tabBtn(tab === k)} onClick={() => setTab(k)}>
              {labels[k]}
            </button>
          ))}
          {onSyncToSovisu && (
            <button type="button" onClick={onSyncToSovisu} disabled={syncingSovisu}
              title={t`Regenerates people.csv (staff + structures) for cdb / SoVisu+ — outbound flow, nothing written to the Directory`}
              className="ml-2 pill px-4 py-1.5 text-[13px] inline-flex items-center gap-2 bg-white/60 dark:bg-white/10 text-ink dark:text-[#f5f2ea] hover:bg-white dark:hover:bg-white/15 border border-[rgba(224,158,42,.45)] transition-colors disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 text-[#e09e2a] ${syncingSovisu ? 'animate-spin' : ''}`} />
              <Trans>Synchronise with SoVisu+</Trans>
            </button>
          )}
        </div>
      </div>

      {tab === 'console' && (
        <EtlConsolePage struct={struct ?? null} onOpenDashboard={onOpenDashboard} />
      )}
      {tab === 'rights' && <RightsPage />}
      {tab === 'media' && (
        <div className="max-w-5xl">
          <MediaSourcesAdmin />
        </div>
      )}
    </div>
  );
};
