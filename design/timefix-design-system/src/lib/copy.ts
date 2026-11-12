/** Copies text to the clipboard. Resolves false when the browser or the artifact frame refuses, so the page never says "copied" when it wasn't. */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
