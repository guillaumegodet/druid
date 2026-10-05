import React, { useEffect, useRef, useState } from 'react';
import { Users, Building2, Layers, UserSearch, Wrench, ChevronDown, BarChart3, Sparkles, FileText, Menu, X } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react/macro';
import { ViewState } from '../types';
import { canUseEstablishmentTools, isSuperAdmin, hasCapability } from '../lib/auth';
import { AccountMenuButton, AccountPanel } from './AccountMenu';
import { versionDetails, versionLabel } from '../lib/buildInfo';

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

// Pills of the top bar (from 1180 px wide, tighter below 1536 px); the icon is only shown in the
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

/** Entry of the menu of narrow screens (< 1180 px): icon + label, full width. */
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

export const Sidebar: React.FC<SidebarProps> = ({ currentView, onChangeView, isOpen, onClose, isDarkMode, toggleTheme }) => {
  const { t } = useLingui();
  const isResearchers = currentView === ViewState.RESEARCHERS_LIST || currentView === ViewState.RESEARCHER_DETAIL;
  const isStructures = currentView === ViewState.STRUCTURES_LIST || currentView === ViewState.STRUCTURE_DETAIL;
  const isGroups = currentView === ViewState.GROUPS_LIST;
  const isDashboard = currentView === ViewState.DASHBOARD;
  const isReports = currentView === ViewState.REPORTS;
  const isUnified = currentView === ViewState.UNIFIED_ALIGN;
  const isLdapCandidates = currentView === ViewState.LDAP_ALIGN;
  const isAdmin = currentView === ViewState.ADMIN;

  // Menu of narrow screens (< 1180 px, where the pill bar no longer fits): closed on a click
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
  // who only get « Personnel » + « Tableau de bord ». Groups: super admin. Administration is in the
  // « My account » menu (AccountMenu).
  const entries: { view: ViewState; active: boolean; label: string; icon: React.ReactNode }[] = [
    { view: ViewState.RESEARCHERS_LIST, active: isResearchers, label: t`People`, icon: <Users className="w-5 h-5" /> },
    ...(canUseEstablishmentTools() ? [{ view: ViewState.STRUCTURES_LIST, active: isStructures, label: t`Structures`, icon: <Building2 className="w-5 h-5" /> }] : []),
    ...(isSuperAdmin() ? [{ view: ViewState.GROUPS_LIST, active: isGroups, label: t`Groups`, icon: <Layers className="w-5 h-5" /> }] : []),
    { view: ViewState.DASHBOARD, active: isDashboard, label: t`Dashboard`, icon: <BarChart3 className="w-5 h-5" /> },
    { view: ViewState.REPORTS, active: isReports, label: t`My reports`, icon: <FileText className="w-5 h-5" /> },
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
  const roundBtn = 'w-10 h-10 rounded-full bg-white/70 dark:bg-white/10 border border-white/70 dark:border-white/10 flex items-center justify-center text-[#4b473e] dark:text-[#c9c4b6] hover:bg-white dark:hover:bg-white/15 transition-colors';

  return (
    <header ref={headerRef} className="relative z-30 shrink-0 px-4 md:px-7 pt-5 pb-2">
      <div className="flex items-center justify-between gap-3">
        {/* Logo */}
        <div className="flex items-center gap-3 shrink-0">
          <img src="/druid-logo.png" alt={t`Druid logo`} className="w-[38px] h-[38px] object-contain" />
          <div className="leading-none">
            <div className="font-disp font-bold text-[19px] text-ink dark:text-[#f5f2ea] tracking-tight">Druid</div>
            {/* Release in use (lib/buildInfo.ts): what a user quotes when reporting a problem. */}
            <div className="mt-0.5 text-[10.5px] font-medium text-muted-lighter dark:text-[#8f897c] tabular-nums" title={versionDetails()}>
              {versionLabel()}
            </div>
          </div>
        </div>

        {/* Pill navigation (wide screens: 1180 px and more, measured on the French labels of a super admin) */}
        <nav className="hidden min-[1180px]:flex items-center gap-1 bg-white/70 dark:bg-white/5 backdrop-blur-xl border border-white/70 dark:border-white/10 p-1.5 rounded-full shadow-pixel-sm">
          {entries.map((e) => <NavPill key={e.view} active={e.active} onClick={() => handleNavClick(e.view)} label={e.label} />)}
          {alignTools.length > 0 && <AlignToolsDropdown isUnified={isUnified} isLdapCandidates={isLdapCandidates} onNavigate={handleNavClick} />}
        </nav>

        {/* Right area: « My account » menu (wide screens) or the menu button (narrow screens) */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="hidden min-[1180px]:block">
            <AccountMenuButton isAdminActive={isAdmin} onOpenAdmin={() => handleNavClick(ViewState.ADMIN)} isDarkMode={isDarkMode} toggleTheme={toggleTheme} />
          </div>

          <button
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            aria-controls="druid-nav-menu"
            title={menuOpen ? t`Close the menu` : t`Menu`}
            aria-label={menuOpen ? t`Close the menu` : t`Menu`}
            className={`min-[1180px]:hidden ${roundBtn} ${menuOpen ? '!bg-ink !text-white dark:!bg-accent dark:!text-ink' : ''}`}
          >
            {menuOpen ? <X className="w-[18px] h-[18px]" /> : <Menu className="w-[18px] h-[18px]" />}
          </button>
        </div>
      </div>

      {/* Menu of narrow screens: the sections, the alignment tools, then the « My account » section. */}
      {menuOpen && (
        <nav id="druid-nav-menu" className="min-[1180px]:hidden absolute left-4 right-4 md:left-auto md:right-7 md:w-96 top-full mt-1 max-h-[calc(100vh-6rem)] overflow-auto glass-card-strong rounded-3xl shadow-soft-lg p-2 z-50">
          {entries.map((e) => <MenuItem key={e.view} active={e.active} onClick={() => handleNavClick(e.view)} label={e.label} icon={e.icon} />)}
          {alignTools.length > 0 && (
            <>
              <div className="flex items-center gap-2 px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-[.09em] text-muted-lighter dark:text-[#8f897c]">
                <Wrench className="w-3.5 h-3.5" /> <Trans>Alignment tools</Trans>
              </div>
              {alignTools.map((e) => <MenuItem key={e.view} active={e.active} onClick={() => handleNavClick(e.view)} label={e.label} icon={e.icon} />)}
            </>
          )}
          <div className="mt-2 pt-1 border-t border-ink/5 dark:border-white/10">
            <AccountPanel
              isAdminActive={isAdmin}
              onOpenAdmin={() => handleNavClick(ViewState.ADMIN)}
              isDarkMode={isDarkMode}
              toggleTheme={toggleTheme}
              onDone={() => setMenuOpen(false)}
            />
          </div>
        </nav>
      )}
    </header>
  );
};
