// What a purge job left in the trash (spec 0022, AC-538 as amended 21
// October 2026): Empty trash and Delete forever past 500 skip the records of
// objects their starter may only read, and the job's `result` says, per
// object, how many stay (`left`, `PurgeLeft` in the contract). Read here by
// hand, since the first load carries no Zod: an entry of any other shape is
// left out, never guessed at.
import type { JobView } from '@crm/contracts';

/** How many records of one object a purge job left in the trash, because its starter may only read them. */
export interface PurgeLeftEntry {
  readonly objectId: string;
  readonly count: number;
}

/**
 * What a purge job left in the trash, per object (none when the job says
 * nothing of it, or isn't a purge), for its finish toast: "12 People records
 * stay in the trash because you can view People but not change them."
 */
export function purgeLeftOf(job: Pick<JobView, 'result'>): readonly PurgeLeftEntry[] {
  const left: unknown = job.result?.left;
  if (!Array.isArray(left)) return [];
  return left.flatMap((entry: unknown): readonly PurgeLeftEntry[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const { objectId, count } = entry as { readonly objectId?: unknown; readonly count?: unknown };
    return typeof objectId === 'string' && typeof count === 'number' && Number.isInteger(count) && count >= 1
      ? [{ objectId, count }]
      : [];
  });
}
