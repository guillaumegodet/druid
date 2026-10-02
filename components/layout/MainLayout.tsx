import React from 'react';
import { getEnvironment, hasCapability, isProductionEnvironment } from '../../lib/auth';
import { EnvironmentBanner } from './EnvironmentBanner';
import { ReadOnlyBanner } from './ReadOnlyBanner';

interface MainLayoutProps {
  children: React.ReactNode;
  sidebar: React.ReactNode;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (open: boolean) => void;
  error?: string;
  onErrorDismiss?: () => void;
}

/**
 * Main layout component for Druid.
 * 2026 redesign (variant 1A): « soft glass » navigation bar at the top
 * (passed through the `sidebar` prop, name kept for compatibility) and content below.
 */
export const MainLayout: React.FC<MainLayoutProps> = ({
  children,
  sidebar,
  error,
  onErrorDismiss
}) => {
  return (
    <div className="flex flex-col h-screen w-full text-ink dark:text-[#f5f2ea] font-sans overflow-hidden transition-colors duration-200">
      {/* Decorative yellow halo */}
      <div
        aria-hidden
        className="pointer-events-none fixed -top-32 -right-16 w-[420px] h-[420px] rounded-full blur-[10px]"
        style={{ background: 'radial-gradient(circle, rgba(243,205,74,.45), rgba(243,205,74,0) 70%)' }}
      />

      {sidebar}

      {!isProductionEnvironment() && <EnvironmentBanner environment={getEnvironment()} />}
      {hasCapability('READ_ONLY') && <ReadOnlyBanner />}

      <main className="flex-1 overflow-hidden relative" id="main-content">
        {error && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 flex items-center rounded-full bg-[rgba(214,69,69,.12)] backdrop-blur-xl border border-[rgba(214,69,69,.35)] text-[#b23b3b] px-5 py-2.5 shadow-soft">
            <span className="text-[13px] font-semibold">{error}</span>
            <button onClick={onErrorDismiss} className="ml-4 font-bold hover:text-[#8c2626]">×</button>
          </div>
        )}
        {children}
      </main>
    </div>
  );
};
