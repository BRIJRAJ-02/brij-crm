// Choosing a round robin booking's hosts (spec 0029, AC-738 to AC-741, with
// spec 0037's lock order and seats, AC-1319 to AC-1321, AC-1328): inside the
// booking's transaction, take every rotation's lock in id order, then the host
// lock of every fixed host and of every member who was free at the slot when
// it was read, all in id order (so no two writers can deadlock, and nothing
// that holds a host lock asks for a rotation lock); recheck each against what
// the database holds now; then fill one seat per rotation in position order
// by its strategy over its ledger, a returning guest going to their owner or
// last host when free. Nobody left for a seat: SLOT_TAKEN. The caller writes
// the booking, its `booking_hosts` rows and one ledger row per rotation in
// the same transaction, so the next writer under the locks sees them all.
import type { WorkspaceTx } from '@crm/db';
import { hostLockKey, lockKey } from '../booking/locks.ts';
import { BUSY_MARGIN_MS, type MembersBusy, type PageRecord } from '../booking/slots.ts';
import { refuse } from '../engine/refusals.ts';
import { lockRotation } from './ledger.ts';
import { candidatesOf, memberSlots, readTeam, slotCandidates, type Team } from './team.ts';
import { fillSeats, type SeatPick } from './pick.ts';
import { lastHostOf, ownerOfEmail } from './returning.ts';

/** The words a visitor sees when the time went while they were booking (AC-740). */
export const SLOT_TAKEN_MESSAGE = 'That time was just taken. Pick another.';

/** Takes the host lock of each member, in id order. */
export async function lockHosts(tx: WorkspaceTx, workspaceId: string, memberIds: readonly string[]): Promise<void> {
  for (const memberId of [...new Set(memberIds)].sort()) await lockKey(tx, hostLockKey(workspaceId, memberId));
}

/** Takes every rotation's lock, in id order (always before any host lock). */
export async function lockRotations(
  tx: WorkspaceTx,
  workspaceId: string,
  rotationIds: readonly string[],
): Promise<void> {
  for (const rotationId of [...new Set(rotationIds)].sort()) await lockRotation(tx, workspaceId, rotationId);
}

/** What choosing hosts needs: the slot, who was free at it, their calendars (read outside the locks), the guest, the clock. */
export interface HostChoice {
  readonly workspaceId: string;
  readonly start: Date;
  readonly duration: number;
  /** Each rotation's members free at the slot when it was read, before any lock. */
  readonly candidates: readonly (readonly string[])[];
  readonly busy: ReadonlyMap<string, MembersBusy>;
  /** The day around the slot the recheck reads. */
  readonly from: Date;
  readonly to: Date;
  readonly now: Date;
  /** The guest, for returning guests (AC-1328): their email, and the People object their person would be on. */
  readonly guest?: { readonly email: string; readonly peopleObjectId: string };
}

/** The booking's hosts: the organiser (first fixed host, else the first rotation's pick), everyone, and the picks. */
export interface ChosenHosts {
  readonly organiser: string;
  readonly hosts: readonly string[];
  readonly picks: readonly SeatPick[];
}

/**
 * The hosts of a round robin booking at the slot, under every lock
 * (AC-1321). Takes the locks itself; the rotation locks may already be held
 * (they stack within a transaction).
 */
export async function chooseHosts(
  tx: WorkspaceTx,
  page: PageRecord,
  team: Extract<Team, { kind: 'round_robin' }>,
  choice: HostChoice,
): Promise<ChosenHosts> {
  if (team.rotations.length === 0) throw refuse('SLOT_TAKEN', SLOT_TAKEN_MESSAGE);
  await lockRotations(
    tx,
    choice.workspaceId,
    team.rotations.map((rotation) => rotation.rules.id),
  );
  const locked = new Set([...team.fixed, ...choice.candidates.flat()]);
  await lockHosts(tx, choice.workspaceId, [...locked]);
  const reads = await readTeam(tx, page, team, choice.busy, {
    from: choice.from,
    to: choice.to,
    margin: BUSY_MARGIN_MS,
    now: choice.now,
    only: [...locked],
  });
  const range = { duration: choice.duration, from: choice.from, to: choice.to, now: choice.now };
  const freeAt = (memberId: string) =>
    locked.has(memberId) &&
    reads.busy.get(memberId)?.blocked !== true &&
    memberSlots(page, memberId, reads, range).some((slot) => slot.start.getTime() === choice.start.getTime());
  if (!team.fixed.every(freeAt)) throw refuse('SLOT_TAKEN', SLOT_TAKEN_MESSAGE);
  const sets = slotCandidates(team, reads, freeAt, choice.start);
  const ownerId =
    choice.guest !== undefined && team.rotations.some((rotation) => rotation.rules.returning === 'owner')
      ? await ownerOfEmail(tx, choice.guest.peopleObjectId, choice.guest.email)
      : undefined;
  const seats = [];
  for (const [index, rotation] of team.rotations.entries()) {
    const free = new Set(sets[index] ?? []);
    const lastHostId =
      choice.guest !== undefined && rotation.rules.returning === 'last_host'
        ? await lastHostOf(tx, rotation.rules.id, choice.guest.email, choice.now)
        : undefined;
    seats.push({
      rotationId: rotation.rules.id,
      rules: rotation.rules,
      candidates: candidatesOf(rotation, reads.standing.get(rotation.rules.id)).filter((each) =>
        free.has(each.memberId),
      ),
      known: { ownerId, lastHostId },
    });
  }
  const picks = fillSeats(seats);
  const first = picks?.[0];
  if (picks === undefined || first === undefined) throw refuse('SLOT_TAKEN', SLOT_TAKEN_MESSAGE);
  const hosts = [...team.fixed, ...picks.map((pick) => pick.memberId)];
  return { organiser: team.fixed[0] ?? first.memberId, hosts, picks };
}
