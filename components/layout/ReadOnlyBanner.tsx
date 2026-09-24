import React from 'react';
import { Eye } from 'lucide-react';
import { Trans } from '@lingui/react/macro';

/**
 * Permanent notice of a read-only instance (capability READ_ONLY, public demo —
 * docs/plan-instance-demo-cloudflare.md, lot A2): the data are fictitious and nothing is saved.
 */
export const ReadOnlyBanner: React.FC = () => (
  <div
    role="note"
    className="relative z-10 mx-4 md:mx-7 mt-2 flex items-center justify-center gap-2 rounded-full bg-[rgba(243,205,74,.22)] border border-[rgba(201,158,24,.35)] px-4 py-1.5 text-center text-[12.5px] font-semibold text-[#6b5210] dark:bg-[rgba(243,205,74,.12)] dark:border-[rgba(243,205,74,.25)] dark:text-[#f3d98a]"
  >
    <Eye className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />
    <span>
      <Trans>Demonstration instance — fictitious data, read-only: changes are not saved.</Trans>
    </span>
  </div>
);
