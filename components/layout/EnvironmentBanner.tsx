import React from 'react';
import { FlaskConical } from 'lucide-react';
import { Trans } from '@lingui/react/macro';

/**
 * Permanent notice of a non-production instance (server DRUID_ENV, e.g. `test` —
 * druid-internal/docs/plan-separation-test-prod-rssi.md, lot 1): the code there is not a release yet
 * and the data may be reset at any time, so nobody mistakes it for the production instance.
 */
export const EnvironmentBanner: React.FC<{ environment: string }> = ({ environment }) => {
  const name = environment.toUpperCase();
  return (
    <div
      role="note"
      className="relative z-10 mx-4 md:mx-7 mt-2 flex items-center justify-center gap-2 rounded-full bg-[rgba(112,72,232,.14)] border border-[rgba(112,72,232,.35)] px-4 py-1.5 text-center text-[12.5px] font-semibold text-[#4c2fa8] dark:bg-[rgba(151,117,250,.14)] dark:border-[rgba(151,117,250,.3)] dark:text-[#cbbcff]"
    >
      <FlaskConical className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />
      <span>
        <Trans>{name} instance — not the production version: the data may be reset at any time.</Trans>
      </span>
    </div>
  );
};
