import { useEffect, useRef } from 'react';

/**
 * Calls `onEscape` when the Escape key is pressed anywhere in the window, while `active` (the dialog, panel or full
 * screen view is open). The latest `onEscape` is used without listening again, so an inline arrow is fine.
 *
 * Not for menus that also close on an outside click, nor for modals stacked over another Escape listener (they listen
 * in the capture phase and stop the propagation: PublicationsListModal, AffiliationHistorySection).
 */
export function useEscapeKey(onEscape: () => void, active = true): void {
  const handler = useRef(onEscape);
  handler.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') handler.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);
}
