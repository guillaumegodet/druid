import React, { useEffect, useRef, useState } from 'react';
import { Users, Building2, Layers, Moon, Sun, LogOut, UserSearch, Wrench, ChevronDown, BarChart3, Languages, Library, Settings, Sparkles, CircleHelp } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { ViewState } from '../types';
import { canSeeAdmin, canUseEstablishmentTools, getUserInfo, isSuperAdmin, logout, hasCapability } from '../lib/auth';
import { currentLocale, setLocale, type Locale } from '../lib/i18n';
import { helpUrl } from '../lib/helpLinks';

// 2026 redesign (variant 1A « barre supérieure soft glass »): this component now
// renders the horizontal navigation bar. The `Sidebar` name is kept
// so as not to change the App/MainLayout wiring.
interface SidebarProps {
  currentView: ViewState;
  onChangeView: (view: ViewState) => void;
  isOpen: boolean;
  onClose: () => void;
  isDarkMode: boolean;
  toggleTheme: () => void;
}

interface NavPillProps {
  active: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  label: string;
}

const NavPill: React.FC<NavPillProps> = ({ active, onClick, icon, label }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-4 py-2 rounded-full font-disp text-sm whitespace-nowrap transition-all ${
      active
        ? 'bg-ink text-white font-semibold dark:bg-accent dark:text-ink'
        : 'text-[#3d3a33] dark:text-[#c9c4b6] font-medium hover:bg-white/70 dark:hover:bg-white/10'
    }`}
  >
    {icon}
    <span>{label}</span>
  </button>
);

interface AlignToolsDropdownProps {
            isUnified: boolean;
  isLdapCandidates: boolean;
  onNavigate: (view: ViewState) => void;
}

/** « Outils d'alignement » dropdown menu (merged IdRef + LDAP entries), closed on outside click. */
const AlignToolsDropdown: React.FC<AlignToolsDropdownProps> = ({ isUnified, isLdapCandidates, onNavigate }) => {
  const isActive = isUnified || isLdapCandidates;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const itemCls = (active: boolean) =>
    `w-full text-left px-4 py-3 text-[13px] font-disp font-semibold flex items-center gap-2.5 transition-colors ${
      active
        ? 'bg-ink text-white dark:bg-accent dark:text-ink'
        : 'text-ink dark:text-[#f5f2ea] hover:bg-accent/15'
    }`;

  const navigate = (view: ViewState) => {
    setOpen(false);
    onNavigate(view);
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`flex items-center gap-2 px-4 py-2 rounded-full font-disp text-sm whitespace-nowrap transition-all ${
          isActive
            ? 'bg-ink text-white font-semibold dark:bg-accent dark:text-ink'
            : 'text-[#3d3a33] dark:text-[#c9c4b6] font-medium hover:bg-white/70 dark:hover:bg-white/10'
        }`}
      >
        <Wrench className="w-4 h-4 md:hidden" />
        <span><Trans>Alignment tools</Trans></span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-2 w-56 glass-card-strong rounded-card shadow-soft-lg overflow-hidden z-50">
          <button onClick={() => navigate(ViewState.UNIFIED_ALIGN)} className={`${itemCls(isUnified)} border-b border-ink/5 dark:border-white/5`}>
            <Sparkles className="w-4 h-4" /> <Trans>Researcher identifier alignment</Trans>
          </button>
          {/* Instances without a directory (Centrale, Cloudflare): no LDAP alignment. */}
          {hasCapability('HAS_LDAP') && (
            <button onClick={() => navigate(ViewState.LDAP_ALIGN)} className={itemCls(isLdapCandidates)}>
              <UserSearch className="w-4 h-4" /> <Trans>LDAP alignment</Trans>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * FR/EN toggle. `setLocale` loads the catalog then calls `i18n.activate`,
 * which re-renders every component subscribed through `I18nProvider`.
 */
const LocaleToggle: React.FC = () => {
  const { t } = useLingui();
  const locale = currentLocale();
  const next: Locale = locale === 'fr' ? 'en' : 'fr';
  return (
    <button
      onClick={() => void setLocale(next)}
      title={next === 'en' ? t`Switch to English` : t`Passer en français`}
      aria-label={t`Change language`}
      className="h-10 px-3 rounded-full bg-white/70 dark:bg-white/10 border border-white/70 dark:border-white/10 flex items-center gap-1.5 text-[#4b473e] dark:text-[#c9c4b6] hover:bg-white dark:hover:bg-white/15 transition-colors font-disp font-semibold text-[12px] uppercase"
    >
      <Languages className="w-4 h-4" />
      {next}
    </button>
  );
};

export const Sidebar: React.FC<SidebarProps> = ({ currentView, onChangeView, isOpen, onClose, isDarkMode, toggleTheme }) => {
  const { t, i18n } = useLingui();
  const userInfo = getUserInfo() as any;
  const isResearchers = currentView === ViewState.RESEARCHERS_LIST || currentView === ViewState.RESEARCHER_DETAIL;
  const isStructures = currentView === ViewState.STRUCTURES_LIST || currentView === ViewState.STRUCTURE_DETAIL;
  const isGroups = currentView === ViewState.GROUPS_LIST;
  const isDashboard = currentView === ViewState.DASHBOARD;
  const isUnified = currentView === ViewState.UNIFIED_ALIGN;
  const isLdapCandidates = currentView === ViewState.LDAP_ALIGN;
  const isAdmin = currentView === ViewState.ADMIN;

  const handleNavClick = (view: ViewState) => {
    onChangeView(view);
    onClose(); // Close the mobile dropdown menu after a click
  };

  // Alignment tools: institution-wide synchronizations
  // (LDAP, IdRef…), not views to restrict per lab — reserved to institution-level
  // rights (admins, central services), see lib/auth.canUseEstablishmentTools.
  // Groups: super admin.
  const alignToolsDropdown = canUseEstablishmentTools() ? (
    <AlignToolsDropdown isUnified={isUnified} isLdapCandidates={isLdapCandidates} onNavigate={handleNavClick} />
  ) : null;

  const navItems = (
    <>
      <NavPill active={isResearchers} onClick={() => handleNavClick(ViewState.RESEARCHERS_LIST)} label={t`People`} icon={<Users className="w-4 h-4 md:hidden" />} />
      {/* Structures: hidden for lab-level rights (director/manager), who only get « Personnel » + « Tableau de bord ». */}
      {canUseEstablishmentTools() && (
        <NavPill active={isStructures} onClick={() => handleNavClick(ViewState.STRUCTURES_LIST)} label={t`Structures`} icon={<Building2 className="w-4 h-4 md:hidden" />} />
      )}
      {isSuperAdmin() && (
        <NavPill active={isGroups} onClick={() => handleNavClick(ViewState.GROUPS_LIST)} label={t`Groups`} icon={<Layers className="w-4 h-4 md:hidden" />} />
      )}
      <NavPill active={isDashboard} onClick={() => handleNavClick(ViewState.DASHBOARD)} label={t`Dashboard`} icon={<BarChart3 className="w-4 h-4 md:hidden" />} />
      {/* Administration: ETL console (admin), rights (super admin), media sources (media admin). */}
      {canSeeAdmin() && (
        <NavPill active={isAdmin} onClick={() => handleNavClick(ViewState.ADMIN)} label={t`Administration`} icon={<Settings className="w-4 h-4 md:hidden" />} />
      )}
    </>
  );

  return (
    <header className="relative z-30 shrink-0 px-4 md:px-7 pt-5 pb-2">
      <div className="flex items-center justify-between gap-3">
        {/* Logo */}
        <div className="flex items-center gap-3 shrink-0">
          <img src="/druid-logo.png" alt={t`Druid logo`} className="w-[38px] h-[38px] object-contain" />
          <div className="font-disp font-bold text-[19px] text-ink dark:text-[#f5f2ea] tracking-tight">Druid</div>
        </div>

        {/* Pill navigation (desktop) */}
        <nav className="hidden md:flex items-center gap-1 bg-white/70 dark:bg-white/5 backdrop-blur-xl border border-white/70 dark:border-white/10 p-1.5 rounded-full shadow-pixel-sm">
          {navItems}
          {alignToolsDropdown}
        </nav>

        {/* Right area: theme + user + mobile burger */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={toggleTheme}
            title={isDarkMode ? t`Light mode` : t`Dark mode`}
            className="w-10 h-10 rounded-full bg-white/70 dark:bg-white/10 border border-white/70 dark:border-white/10 flex items-center justify-center text-[#4b473e] dark:text-[#c9c4b6] hover:bg-white dark:hover:bg-white/15 transition-colors"
          >
            {isDarkMode ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
          </button>

          <a
            href={helpUrl('/', i18n.locale)}
            target="_blank"
            rel="noopener noreferrer"
            title={t`Help centre (new tab)`}
            aria-label={t`Help centre (new tab)`}
            className="w-10 h-10 rounded-full bg-white/70 dark:bg-white/10 border border-white/70 dark:border-white/10 flex items-center justify-center text-[#4b473e] dark:text-[#c9c4b6] hover:bg-white dark:hover:bg-white/15 transition-colors"
          >
            <CircleHelp className="w-[18px] h-[18px]" />
          </a>

          <LocaleToggle />

          <div className="hidden sm:flex items-center gap-2.5 bg-white/70 dark:bg-white/10 border border-white/70 dark:border-white/10 py-1 pl-1 pr-3.5 rounded-full">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#3b5bdb] to-[#7048e8] text-white flex items-center justify-center font-disp font-bold text-[13px]">
              {userInfo?.name?.substring(0, 2).toUpperCase() || '??'}
            </div>
            <div className="leading-[1.15] overflow-hidden">
              <div className="text-[13px] font-semibold truncate text-ink dark:text-[#f5f2ea]">{userInfo?.name || t`Unknown`}</div>
              <div className="text-[11px] text-muted-lighter truncate">{userInfo?.email || ''}</div>
            </div>
          </div>

          {/* Anonymous visitor (public read-only instance): no session to close. */}
          {!userInfo?.anonymous && (
            <button
              onClick={() => logout()}
              title={t`Log out`}
              className="hidden sm:flex w-10 h-10 rounded-full bg-[rgba(214,69,69,.1)] text-[#b23b3b] hover:bg-[rgba(214,69,69,.18)] items-center justify-center transition-colors"
            >
              <LogOut className="w-[17px] h-[17px]" />
            </button>
          )}

        </div>
      </div>

      {/* Mobile navigation: pills (multi-line to keep the dropdown menu visible) */}
      <nav className="md:hidden mt-3 flex flex-wrap items-center gap-1 bg-white/70 dark:bg-white/5 backdrop-blur-xl border border-white/70 dark:border-white/10 p-1.5 rounded-3xl">
        {navItems}
        {alignToolsDropdown}
      </nav>
    </header>
  );
};
