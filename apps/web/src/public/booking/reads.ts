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
