import { useCallback, useState } from 'react';

/**
 * Page banner that shrinks on scroll (like orcid.org: large title and logo at the top of the
 * page, reduced as soon as you scroll down, to give the work area more room).
 *
 * Druid pages are built `flex flex-col h-full`: the `<header>` sits outside the scrolling area
 * (`flex-1 overflow-auto`), hence the "title stuck at the top" effect. The hook listens to scroll
 * events in the capture phase on the page root (`onScrollCapture`), so it also catches those of a
 * nested child container (LDAP: embedded panels), and only honours the area marked
 * `data-page-scroll` (not the small `max-h-32 overflow-auto` lists).
 *
 * Usage: `const { compact, onScrollCapture } = useCompactHeader();`
 *   <div className="flex flex-col h-full" onScrollCapture={onScrollCapture}>
 *     <header className="page-header …" data-compact={compact || undefined}>
 *       … <p className="page-header-sub">…</p> (see index.css, "Collapsible page banner")
 *     <div className="flex-1 overflow-auto" data-page-scroll>
 *
 * Hysteresis (compact beyond 72 px, back below 8 px) and a guard on the scrollable height:
 * shrinking the banner enlarges the work area, which may re-clamp scrollTop — without these
 * guards, a page barely taller than the screen would oscillate.
 */
export function useCompactHeader() {
  const [compact, setCompact] = useState(false);
  const onScrollCapture = useCallback((e: React.UIEvent<HTMLElement>) => {
    const el = e.target as HTMLElement | null;
    if (!el || !(el instanceof HTMLElement) || el.dataset.pageScroll === undefined) return;
    const top = el.scrollTop;
    const range = el.scrollHeight - el.clientHeight;
    setCompact((c) => {
      if (range < 200) return false;
      if (!c && top > 72) return true;
      if (c && top < 8) return false;
      return c;
    });
  }, []);
  return { compact, onScrollCapture };
}
