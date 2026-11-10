/** How a save ended: handed to the viewer's downloads, or turned down by them. */
export type SaveOutcome = 'saved' | 'declined' | 'failed';

interface DownloadsNamespace { readonly save: (r: { readonly filename: string; readonly data: Blob | string }) => Promise<unknown> }
interface ClaudeHost { readonly use?: (name: string) => Promise<unknown> }

/** Saves a file the page made. Inside a Claude artifact it asks the viewer through the downloads capability (they confirm);
 *  anywhere else it is an ordinary browser download. Never throws: the outcome says what happened. */
export async function saveFile(filename: string, data: Blob | string): Promise<SaveOutcome> {
  const host = (window as unknown as { readonly claude?: ClaudeHost }).claude;
  const downloads = host?.use ? ((await host.use('downloads').catch(() => null)) as DownloadsNamespace | null) : null;
  if (downloads) {
    try { await downloads.save({ filename, data }); return 'saved'; } catch (e) {
      const code = (e as { readonly code?: string } | null)?.code;
      return code === 'declined' ? 'declined' : 'failed';
    }
  }
  try {
    const blob = typeof data === 'string' ? new Blob([data], { type: 'text/plain' }) : data;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.append(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    return 'saved';
  } catch { return 'failed'; }
}
