import React from 'react';
import { CircleHelp } from 'lucide-react';
import { useLingui } from '@lingui/react/macro';
import { helpUrl } from '../lib/helpLinks';

/**
 * « ? » button of a page header: opens the matching page of the help centre in a new tab
 * (target taken from the tables of lib/helpLinks.ts). `pill` = same height as the header's
 * btn-pill actions; default = small round button placed next to a page title.
 */
export const HelpButton: React.FC<{ path: string; pill?: boolean }> = ({ path, pill }) => {
  const { t, i18n } = useLingui();
  const title = t`Help for this page (opens the help centre in a new tab)`;
  return (
    <a
      href={helpUrl(path, i18n.locale)}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      aria-label={title}
      className={
        pill
          ? 'btn-pill !px-3.5'
          : 'inline-flex items-center justify-center w-8 h-8 rounded-full shrink-0 text-muted hover:text-ink hover:bg-ink/5 dark:text-[#8f897c] dark:hover:text-[#f5f2ea] dark:hover:bg-white/10 transition-colors'
      }
    >
      <CircleHelp className={pill ? 'w-4 h-4' : 'w-5 h-5'} />
    </a>
  );
};
