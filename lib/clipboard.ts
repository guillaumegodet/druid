/**
 * Copies `text` to the clipboard and resolves to true when the copy succeeded.
 *
 * The `navigator.clipboard` API only exists in a secure context (HTTPS or
 * localhost) — but Druid is served over HTTP on the internal network, where it
 * is `undefined`: the « Copier » buttons then did nothing. Fallback to the
 * legacy `document.execCommand('copy')` mechanism (off-screen textarea),
 * which also works over HTTP.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied → try the fallback below
    }
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}
