import React, { useEffect, useRef, useState } from 'react';
import { Users, Building2, Layers, Moon, Sun, LogOut, UserSearch, Wrench, ChevronDown, BarChart3, Languages, Library, Settings, Sparkles, CircleHelp, FileText, Menu, X } from 'lucide-react';
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

// Pills of the top bar (from 1320 px wide, tighter below 1536 px); the icon is only shown in the
// menu of narrower screens (MenuItem).
const NavPill: React.FC<NavPillProps> = ({ active, onClick, label }) => (
  <button
    onClick={onClick}
    aria-current={active ? 'page' : undefined}
    className={`flex items-center gap-2 px-3 2xl:px-4 py-2 rounded-full font-disp text-sm whitespace-nowrap transition-all ${
      active
        ? 'bg-ink text-white font-semibold dark:bg-accent dark:text-ink'
        : 'text-[#3d3a33] dark:text-[#c9c4b6] font-medium hover:bg-white/70 dark:hover:bg-white/10'
    }`}
  >
    <span>{label}</span>
  </button>
);

/** Entry of the menu of narrow screens (< 1320 px): icon + label, full width. */
const MenuItem: React.FC<NavPillProps> = ({ active, onClick, icon, label }) => (
  <button
    onClick={onClick}
    aria-current={active ? 'page' : undefined}
    className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl font-disp text-[15px] text-left transition-colors ${
      active
        ? 'bg-ink text-white font-semibold dark:bg-accent dark:text-ink'
        : 'text-ink dark:text-[#f5f2ea] font-medium hover:bg-accent/15'
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
  const isReports = currentView === ViewState.REPORTS;
  const isUnified = currentView === ViewState.UNIFIED_ALIGN;
  const isLdapCandidates = currentView === ViewState.LDAP_ALIGN;
  const isAdmin = currentView === ViewState.ADMIN;

  // Menu of narrow screens (< 1320 px, where the pill bar no longer fits): closed on a click
  // outside, on Escape and after a navigation.
  const [menuOpen, setMenuOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => { if (headerRef.current && !headerRef.current.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  const handleNavClick = (view: ViewState) => {
    onChangeView(view);
    setMenuOpen(false);
    onClose();
  };

  // Entries visible to the current user. Structures: hidden for lab-level rights (director/manager),
  // who only get « Personnel » + « Tableau de bord ». Groups: super admin. Administration: ETL console
  // (admin), rights (super admin), media sources (media admin).
  const entries: { view: ViewState; active: boolean; label: string; icon: React.ReactNode }[] = [
    { view: ViewState.RESEARCHERS_LIST, active: isResearchers, label: t`People`, icon: <Users className="w-5 h-5" /> },
    ...(canUseEstablishmentTools() ? [{ view: ViewState.STRUCTURES_LIST, active: isStructures, label: t`Structures`, icon: <Building2 className="w-5 h-5" /> }] : []),
    ...(isSuperAdmin() ? [{ view: ViewState.GROUPS_LIST, active: isGroups, label: t`Groups`, icon: <Layers className="w-5 h-5" /> }] : []),
    { view: ViewState.DASHBOARD, active: isDashboard, label: t`Dashboard`, icon: <BarChart3 className="w-5 h-5" /> },
    { view: ViewState.REPORTS, active: isReports, label: t`My reports`, icon: <FileText className="w-5 h-5" /> },
    ...(canSeeAdmin() ? [{ view: ViewState.ADMIN, active: isAdmin, label: t`Administration`, icon: <Settings className="w-5 h-5" /> }] : []),
  ];
  // Alignment tools: institution-wide synchronizations (LDAP, IdRef…), not views to restrict per lab —
  // reserved to institution-level rights (admins, central services), see lib/auth.canUseEstablishmentTools.
  const alignTools = canUseEstablishmentTools()
    ? [
      { view: ViewState.UNIFIED_ALIGN, active: isUnified, label: t`Researcher identifier alignment`, icon: <Sparkles className="w-5 h-5" /> },
      // Instances without a directory (Centrale, Cloudflare): no LDAP alignment.
      ...(hasCapability('HAS_LDAP') ? [{ view: ViewState.LDAP_ALIGN, active: isLdapCandidates, label: t`LDAP alignment`, icon: <UserSearch className="w-5 h-5" /> }] : []),
    ]
    : [];
  const initials = userInfo?.name?.substring(0, 2).toUpperCase() || '??';
  const avatar = (
    <div className="w-8 h-8 shrink-0 rounded-full bg-gradient-to-br from-[#3b5bdb] to-[#7048e8] text-white flex items-center justify-center font-disp font-bold text-[13px]">
      {initials}
    </div>
  );
  const roundBtn = 'w-10 h-10 rounded-full bg-white/70 dark:bg-white/10 border border-white/70 dark:border-white/10 flex items-center justify-center text-[#4b473e] dark:text-[#c9c4b6] hover:bg-white dark:hover:bg-white/15 transition-colors';

  return (
    <header ref={headerRef} className="relative z-30 shrink-0 px-4 md:px-7 pt-5 pb-2">
      <div className="flex items-center justify-between gap-3">
        {/* Logo */}
        <div className="flex items-center gap-3 shrink-0">
          <img src="/druid-logo.png" alt={t`Druid logo`} className="w-[38px] h-[38px] object-contain" />
          <div className="font-disp font-bold text-[19px] text-ink dark:text-[#f5f2ea] tracking-tight">Druid</div>
        </div>

        {/* Pill navigation (wide screens: 1320 px and more, measured on the French labels) */}
        <nav className="hidden min-[1320px]:flex items-center gap-1 bg-white/70 dark:bg-white/5 backdrop-blur-xl border border-white/70 dark:border-white/10 p-1.5 rounded-full shadow-pixel-sm">
          {entries.map((e) => <NavPill key={e.view} active={e.active} onClick={() => handleNavClick(e.view)} label={e.label} />)}
          {alignTools.length > 0 && <AlignToolsDropdown isUnified={isUnified} isLdapCandidates={isLdapCandidates} onNavigate={handleNavClick} />}
        </nav>

        {/* Right area: theme, help, language, user (name from 1536 px, avatar alone below), menu button */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button onClick={toggleTheme} title={isDarkMode ? t`Light mode` : t`Dark mode`} aria-label={isDarkMode ? t`Light mode` : t`Dark mode`} className={roundBtn}>
            {isDarkMode ? <Sun className="w-[18px] h-[18px]" /> : <Moon className="w-[18px] h-[18px]" />}
          </button>

          <a href={helpUrl('/', i18n.locale)} target="_blank" rel="noopener noreferrer" title={t`Help centre (new tab)`} aria-label={t`Help centre (new tab)`} className={roundBtn}>
            <CircleHelp className="w-[18px] h-[18px]" />
          </a>

          <LocaleToggle />

          <div className="hidden 2xl:flex items-center gap-2.5 bg-white/70 dark:bg-white/10 border border-white/70 dark:border-white/10 py-1 pl-1 pr-3.5 rounded-full">
            {avatar}
            <div className="leading-[1.15] overflow-hidden">
              <div className="text-[13px] font-semibold truncate text-ink dark:text-[#f5f2ea]">{userInfo?.name || t`Unknown`}</div>
              <div className="text-[11px] text-muted-lighter truncate">{userInfo?.email || ''}</div>
            </div>
          </div>
          <div className="hidden min-[1320px]:flex 2xl:hidden" title={[userInfo?.name, userInfo?.email].filter(Boolean).join(' · ')}>{avatar}</div>

          {/* Anonymous visitor (public read-only instance): no session to close. */}
          {!userInfo?.anonymous && (
            <button
              onClick={() => logout()}
              title={t`Log out`}
              aria-label={t`Log out`}
              className="hidden min-[1320px]:flex w-10 h-10 rounded-full bg-[rgba(214,69,69,.1)] text-[#b23b3b] hover:bg-[rgba(214,69,69,.18)] items-center justify-center transition-colors"
            >
              <LogOut className="w-[17px] h-[17px]" />
            </button>
          )}

          <button
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            aria-controls="druid-nav-menu"
            title={menuOpen ? t`Close the menu` : t`Menu`}
            aria-label={menuOpen ? t`Close the menu` : t`Menu`}
            className={`min-[1320px]:hidden ${roundBtn} ${menuOpen ? '!bg-ink !text-white dark:!bg-accent dark:!text-ink' : ''}`}
          >
            {menuOpen ? <X className="w-[18px] h-[18px]" /> : <Menu className="w-[18px] h-[18px]" />}
          </button>
        </div>
      </div>

      {/* Menu of narrow screens: the sections, the alignment tools, then the user and the logout. */}
      {menuOpen && (
        <nav id="druid-nav-menu" className="min-[1320px]:hidden absolute left-4 right-4 md:left-auto md:right-7 md:w-80 top-full mt-1 max-h-[80vh] overflow-auto glass-card-strong rounded-3xl shadow-soft-lg p-2 z-50">
          {entries.map((e) => <MenuItem key={e.view} active={e.active} onClick={() => handleNavClick(e.view)} label={e.label} icon={e.icon} />)}
          {alignTools.length > 0 && (
            <>
              <div className="flex items-center gap-2 px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-[.09em] text-muted-lighter dark:text-[#8f897c]">
                <Wrench className="w-3.5 h-3.5" /> <Trans>Alignment tools</Trans>
              </div>
              {alignTools.map((e) => <MenuItem key={e.view} active={e.active} onClick={() => handleNavClick(e.view)} label={e.label} icon={e.icon} />)}
            </>
          )}
          <div className="mt-2 pt-2 border-t border-ink/5 dark:border-white/10 flex items-center gap-3 px-3 py-2">
            {avatar}
            <div className="flex-1 min-w-0 leading-[1.15]">
              <div className="text-[13px] font-semibold truncate text-ink dark:text-[#f5f2ea]">{userInfo?.name || t`Unknown`}</div>
              <div className="text-[11px] text-muted-lighter truncate">{userInfo?.email || ''}</div>
            </div>
            {!userInfo?.anonymous && (
              <button onClick={() => logout()} title={t`Log out`} aria-label={t`Log out`}
                className="w-10 h-10 shrink-0 rounded-full bg-[rgba(214,69,69,.1)] text-[#b23b3b] hover:bg-[rgba(214,69,69,.18)] flex items-center justify-center transition-colors">
                <LogOut className="w-[17px] h-[17px]" />
              </button>
            )}
          </div>
        </nav>
      )}
    </header>
  );
};
