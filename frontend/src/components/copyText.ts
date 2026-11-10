/**
 * Copies text to the clipboard. The Clipboard API needs a secure context (HTTPS or localhost); on a
 * plain-http LAN address it falls back to a hidden textarea + execCommand('copy'). Nothing is stored.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    // navigator.clipboard is undefined outside a secure context (the DOM types say otherwise).
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (window.isSecureContext && clipboard !== undefined) {
      await clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall back below
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.className = 'copy-scratch';
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    // Deprecated, but the only way without a secure context; harmless where unsupported.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}
