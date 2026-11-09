import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { Trans } from '@lingui/react/macro';
import { getImpersonator, getUserInfo } from '../../lib/auth';

/** A session the DirlaData console opened as a member (druid-internal docs/plan-druid-saas.md, lot 6 c): always said. */
export const ImpersonationBanner: React.FC = () => {
  const by = getImpersonator();
  if (!by) return null;
  const as = getUserInfo().email;
  return (
    <div role="status" className="mb-3 flex flex-wrap items-center justify-center gap-2 px-4 py-1.5 rounded-full text-[12px] font-semibold bg-[rgba(224,158,42,.25)] text-ink dark:text-[#f0c266]">
      <ShieldAlert className="w-3.5 h-3.5" />
      <Trans>Support session opened by {by} as {as} — traced, ends within two hours.</Trans>
      <a href="/auth/logout" className="underline underline-offset-2 hover:no-underline"><Trans>End it</Trans></a>
    </div>
  );
};
