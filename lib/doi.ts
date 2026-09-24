/**
 * Clickable URL of a DOI as exported by druid-biblio: depending on the source, the
 * `doi` column holds either the bare DOI (« 10.1140/… ») or the full URL
 * (« https://doi.org/10.1140/… », the Nantes Université export case) — blindly
 * prefixing with https://doi.org/ breaks the second case.
 */
export function doiUrl(doi: string | null | undefined): string | null {
  if (!doi) return null;
  const d = doi.trim();
  if (!d) return null;
  if (/^https?:\/\//i.test(d)) return d;
  return `https://doi.org/${d.replace(/^doi:/i, '')}`;
}
