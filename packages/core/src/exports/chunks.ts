// What every CSV export shares (spec 0040, beside spec 0023's submissions
// export): writing its text to `export_chunks` (the header as part 0, then
// one chunk a page), and the
// check that a records export's object is still one its starter may read.
import { eq } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import { checkObject } from '../access/visibility.ts';
import { refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';

const { exportChunks, objects } = schema;

/** Where a file's chunks got to: the next part, and the bytes in the last data chunk (`part - 1`). */
export interface ChunkCursor {
  readonly part: number;
  readonly tail: number;
}

/** Writes (or writes again, on a retried batch) a file's header as part 0. Answers the cursor after it. */
export async function writeHeader(
  tx: WorkspaceTx,
  workspaceId: string,
  exportId: string,
  header: string,
): Promise<ChunkCursor> {
  await tx
    .insert(exportChunks)
    .values({ workspaceId, exportId, part: 0, body: header })
    .onConflictDoUpdate({
      target: [exportChunks.workspaceId, exportChunks.exportId, exportChunks.part],
      set: { body: header },
    });
  return { part: 1, tail: 0 };
}

/**
 * Writes a page's text as the file's next chunk (written again on a retried
 * batch). One chunk a page, never appended to: growing a stored text copies
 * it whole each time, so a chunk built from many pages would cost its size
 * many times over. The download reads the parts in order.
 */
export async function appendChunk(
  tx: WorkspaceTx,
  workspaceId: string,
  exportId: string,
  at: ChunkCursor,
  text: string,
): Promise<ChunkCursor> {
  if (text === '') return at;
  await tx
    .insert(exportChunks)
    .values({ workspaceId, exportId, part: at.part, body: text })
    .onConflictDoUpdate({
      target: [exportChunks.workspaceId, exportChunks.exportId, exportChunks.part],
      set: { body: text },
    });
  return { part: at.part + 1, tail: Buffer.byteLength(text) };
}

/** What a records export's refusal says when its object is gone or out of sight: the same as a missing export. */
export const UNKNOWN_RECORDS_EXPORT = 'That export doesn’t exist, or it has expired. Export the view again.';

/** Refuses NOT_FOUND unless the object is live and one the scope may read. */
export async function checkRecordsSource(tx: WorkspaceTx, scope: EngineScope, objectId: string): Promise<void> {
  await checkObject(tx, scope.access, objectId, 'read', UNKNOWN_RECORDS_EXPORT);
  const [row] = await tx.select({ archivedAt: objects.archivedAt }).from(objects).where(eq(objects.id, objectId));
  if (row === undefined || row.archivedAt !== null) throw refuse('NOT_FOUND', UNKNOWN_RECORDS_EXPORT);
}
