// When the booking page reads a chunk of slots: once per chunk, zone, length
// and reload, and never again on its own after a read failed.

/** What the page holds of its slot reads, as far as the next read cares. */
export interface SlotReads {
  readonly key: string;
  readonly loaded: ReadonlyMap<number, unknown>;
  readonly failed: boolean;
}

/**
 * Whether chunk `wanted` still needs reading under `readKey`. A failed read
 * waits for the visitor's Try again (a new reload, so a new key): asking again
 * on its own sent the same refused request without end and spent everyone's limit.
 */
export function needsRead(read: SlotReads, readKey: string, wanted: number): boolean {
  if (read.key !== readKey) return true;
  return !read.failed && !read.loaded.has(wanted);
}

/**
 * What a refused slot read says about the page itself, after it loaded: gone
 * (the page, or its workspace, was deleted) or closed (paused). The page then
 * shows that state instead of its times; Try again could never help. Any other
 * refusal is a failed read, which waits for Try again.
 */
export function pageEnded(code: string | undefined): 'gone' | 'closed' | undefined {
  if (code === 'NOT_FOUND') return 'gone';
  if (code === 'BOOKING_CLOSED') return 'closed';
  return undefined;
}
