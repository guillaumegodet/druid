import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, CircleHelp, ExternalLink, Languages, LogOut, Moon, Settings, Sun, SunMoon } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { canSeeAdmin, getUserInfo, logout } from '../lib/auth';
import { currentLocale, setLocale, type Locale } from '../lib/i18n';
import { helpUrl } from '../lib/helpLinks';

// « My account » menu: the account-level functions (Administration, help centre, language, theme,
// logout) gathered behind one button. Same content in two shapes: a dropdown anchored to the
// account button (wide screens) and a section at the bottom of the navigation menu (narrow screens).

interface AccountPanelProps {
  isAdminActive: boolean;
  onOpenAdmin: () => void;
  isDarkMode: boolean;
  toggleTheme: () => void;
  /** Called after an action that leaves the menu (help link): lets the caller close it. */
  onDone?: () => void;
}

/** Initials avatar of the signed-in user. */
export const UserAvatar: React.FC<{ size?: 'sm' | 'md' }> = ({ size = 'sm' }) => {
  const userInfo = getUserInfo() as any;
  const initials = userInfo?.name?.substring(0, 2).toUpperCase() || '??';
  const dims = size === 'md' ? 'w-10 h-10 text-[14px]' : 'w-8 h-8 text-[13px]';
  return (
    <div className={`${dims} shrink-0 rounded-full bg-gradient-to-br from-[#3b5bdb] to-[#7048e8] text-white flex items-center justify-center font-disp font-bold`}>
      {initials}
    </div>
  );
};

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: React.ReactNode;
}

/** Two-way switch showing the current choice (rather than the next one, like the former « EN » button). */
function Segmented<T extends string>({ value, options, onChange, ariaLabel }: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (v: T) => void;
  ariaLabel: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className="flex shrink-0 p-0.5 rounded-full bg-ink/5 dark:bg-white/10">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => { if (!active) onChange(o.value); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full font-disp text-[12.5px] transition-colors ${
              active
                ? 'bg-white text-ink font-semibold shadow-pixel-sm dark:bg-accent dark:text-ink'
                : 'text-[#4b473e] dark:text-[#c9c4b6] font-medium hover:text-ink dark:hover:text-white'
            }`}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const rowCls = 'w-full flex items-center gap-3 px-4 py-3 rounded-2xl font-disp text-[15px] text-left transition-colors';
const rowIdleCls = 'text-ink dark:text-[#f5f2ea] font-medium hover:bg-accent/15';
const settingCls = 'flex items-center justify-between gap-3 pl-4 pr-1.5 py-1.5 font-disp text-[15px] font-medium text-ink dark:text-[#f5f2ea]';

/** Content of the « My account » menu: identity, Administration, help, language, theme, logout. */
export const AccountPanel: React.FC<AccountPanelProps> = ({ isAdminActive, onOpenAdmin, isDarkMode, toggleTheme, onDone }) => {
  const { t, i18n } = useLingui();
  const userInfo = getUserInfo() as any;
  const locale = currentLocale();

  return (
    <div>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <UserAvatar size="md" />
        <div className="flex-1 min-w-0 leading-[1.2]">
          <div className="text-[14px] font-semibold truncate text-ink dark:text-[#f5f2ea]">{userInfo?.name || t`Unknown`}</div>
          <div className="text-[12px] text-muted-lighter truncate">{userInfo?.email || ''}</div>
        </div>
      </div>

      <div className="my-1 border-t border-ink/5 dark:border-white/10" />

      {canSeeAdmin() && (
        <button
          onClick={onOpenAdmin}
          aria-current={isAdminActive ? 'page' : undefined}
          className={`${rowCls} ${isAdminActive ? 'bg-ink text-white font-semibold dark:bg-accent dark:text-ink' : rowIdleCls}`}
        >
          <Settings className="w-5 h-5" />
          <span><Trans>Administration</Trans></span>
        </button>
      )}

      <a
        href={helpUrl('/', i18n.locale)}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onDone}
        className={`${rowCls} ${rowIdleCls}`}
      >
        <CircleHelp className="w-5 h-5" />
        <span className="flex-1"><Trans>Help centre</Trans></span>
        <ExternalLink className="w-4 h-4 text-muted-lighter" aria-label={t`opens in a new tab`} />
      </a>

      <div className={settingCls}>
        <span className="flex items-center gap-3"><Languages className="w-5 h-5" /><Trans>Language</Trans></span>
        <Segmented<Locale>
          value={locale}
          ariaLabel={t`Language`}
          onChange={(l) => void setLocale(l)}
          // Language names are written in their own language: not translated.
          options={[{ value: 'fr', label: 'Français' }, { value: 'en', label: 'English' }]}
        />
      </div>

      <div className={settingCls}>
        <span className="flex items-center gap-3"><SunMoon className="w-5 h-5" /><Trans>Theme</Trans></span>
        <Segmented<'light' | 'dark'>
          value={isDarkMode ? 'dark' : 'light'}
          ariaLabel={t`Theme`}
          onChange={() => toggleTheme()}
          options={[
            { value: 'light', label: t`Light`, icon: <Sun className="w-3.5 h-3.5" /> },
            { value: 'dark', label: t`Dark`, icon: <Moon className="w-3.5 h-3.5" /> },
          ]}
        />
      </div>

      {/* Anonymous visitor (public read-only instance): no session to close. */}
      {!userInfo?.anonymous && (
        <>
          <div className="my-1 border-t border-ink/5 dark:border-white/10" />
          <button onClick={() => logout()} className={`${rowCls} font-medium text-[#b23b3b] dark:text-[#f08c8c] hover:bg-[rgba(214,69,69,.1)]`}>
            <LogOut className="w-5 h-5" />
            <span><Trans>Log out</Trans></span>
          </button>
        </>
      )}
    </div>
  );
};

/**
 * « My account » button of the top bar (wide screens) and its dropdown. Closed on a click outside,
 * on Escape (focus back on the button) and after opening Administration.
 */
export const AccountMenuButton: React.FC<Omit<AccountPanelProps, 'onDone'>> = ({ onOpenAdmin, ...rest }) => {
  const { t } = useLingui();
  const userInfo = getUserInfo() as any;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); buttonRef.current?.focus(); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={buttonRef}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="druid-account-menu"
        aria-label={t`My account`}
        title={t`My account`}
        className={`flex items-center gap-2.5 py-1 pl-1 pr-2.5 rounded-full border transition-colors ${
          open
            ? 'bg-white border-white dark:bg-white/15 dark:border-white/15'
            : 'bg-white/70 border-white/70 hover:bg-white dark:bg-white/10 dark:border-white/10 dark:hover:bg-white/15'
        }`}
      >
        <UserAvatar />
        {/* Name and email from 1536 px, avatar alone below. */}
        <div className="hidden 2xl:block max-w-[200px] text-left leading-[1.15] overflow-hidden">
          <div className="text-[13px] font-semibold truncate text-ink dark:text-[#f5f2ea]">{userInfo?.name || t`Unknown`}</div>
          <div className="text-[11px] text-muted-lighter truncate">{userInfo?.email || ''}</div>
        </div>
        <ChevronDown className={`w-4 h-4 text-[#4b473e] dark:text-[#c9c4b6] transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div id="druid-account-menu" className="absolute right-0 top-full mt-2 w-80 glass-card-strong rounded-3xl shadow-soft-lg p-2 z-50">
          <AccountPanel
            {...rest}
            onOpenAdmin={() => { setOpen(false); onOpenAdmin(); }}
            onDone={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
};
