// The visit engine's advisory locks (spec 0066, AC-6605; Rules settled: Locks). One global order everywhere:
// rotation locks, then the place lock (`visits:place:<ws>:<place>`), then person locks sorted, where a person lock is
// the member's host key (`booking:host:<ws>:<member>`, the one meetings take) for a staff member linked to a member,
// and `visits:staff:<ws>:<staff>` for one who isn't. So a meeting and an appointment for one person serialise on one
// key, and two visits at one place on another. `locks.test.ts` holds every path to this order.
import type { WorkspaceTx } from '@crm/db';
import { hostLockKey, lockKey } from '../booking/locks.ts';

/** The lock on one place's visits: every visit write at the place takes it first. */
export const placeLockKey = (workspaceId: string, placeId: string): string => `visits:place:${workspaceId}:${placeId}`;

/** The lock on an unlinked staff member's time (a linked one's is their member's host key). */
export const staffLockKey = (workspaceId: string, staffId: string): string => `visits:staff:${workspaceId}:${staffId}`;

/** A staff member as a lock names them: their linked member, if any. */
export interface LockedStaff {
  readonly id: string;
  readonly memberId?: string | null | undefined;
}

/** The person lock keys of `people`, deduplicated and sorted (the order every writer takes them in). */
export function personLockKeys(workspaceId: string, people: readonly LockedStaff[]): readonly string[] {
  const keys = new Set(
    people.map((person) =>
      person.memberId === undefined || person.memberId === null
        ? staffLockKey(workspaceId, person.id)
        : hostLockKey(workspaceId, person.memberId),
    ),
  );
  return [...keys].sort();
}

/**
 * Takes a visit write's locks in the global order: the place, then each person sorted (AC-6605). A rotation lock, if
 * a caller ever holds one, is taken before this; nothing that holds these asks for a rotation lock.
 */
export async function lockVisit(
  tx: WorkspaceTx,
  workspaceId: string,
  placeId: string,
  people: readonly LockedStaff[],
): Promise<void> {
  await lockKey(tx, placeLockKey(workspaceId, placeId));
  for (const key of personLockKeys(workspaceId, people)) await lockKey(tx, key);
}
