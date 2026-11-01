// Who gets the next assignment (spec 0029, AC-738, AC-739; spec 0037,
// AC-1320, AC-1321, AC-1325, AC-1328): pure. The candidates are the members
// free for the work (at the slot, for a booking), each with their live count
// in the window, the count credited when they joined, their weight and
// priority, and when they were last assigned.
//
//   Fair:     the lowest (count + calibration) ÷ weight; ties to the higher
//             priority, then the longest since their last assignment (never
//             assigned first), then member id.
//   Priority: the highest priority; ties by Fair's order.
//   Even:     as Fair, among those less than the gap ahead of the lowest
//             (the rest wait: `evenWaiting`, applied before slots and picks).
//   Returning guests: their owner, or the host they met last, when free,
//             whatever the counts.
//
// A round robin page fills one seat per rotation (up to 3), never giving one
// person two seats: a time is offered only when the rotations' candidate sets
// pass Hall's condition, and the picks go in rotation order, each skipping
// anyone whose choice would leave a later rotation with nobody.
//
// This is the seam spec 0037's routing and learned ranking plug into: they
// order or narrow the candidates before the pick, and the ledger row's detail
// records what was compared. Spec 0037's smart ranking (AC-1361 to AC-1364)
// plugs in as a seat's `smart`: `smart.ts` turns a load, a fit and a learned
// lift into one ranking key, and this file only ever orders by that key.
import { rankingKey, tilts, withinAllowance, type SmartRanking } from './smart.ts';

/** One member who could take the work. */
export interface Candidate {
  readonly memberId: string;
  /** Live ledger units in the rotation's window. */
  readonly count: number;
  /** The count credited when they joined (AC-730). */
  readonly calibration: number;
  /** 1 to 100. */
  readonly weight: number;
  /** 0 lowest to 4 highest. */
  readonly priority: number;
  /** Their newest live assignment in the rotation, if any. */
  readonly lastAssignedAt?: Date;
}

/** How a rotation picks. */
export interface PickRules {
  readonly strategy: 'fair' | 'priority' | 'even';
  /** Where a returning guest goes (AC-1328). */
  readonly returning: 'owner' | 'last_host' | 'none';
}

/** Who a returning guest goes to, when they are free: the person's owner, and the host they met last. */
export interface Returning {
  readonly ownerId?: string | undefined;
  readonly lastHostId?: string | undefined;
  /**
   * The stand in of whichever of them is away then (spec 0037, AC-1284): they get it, with reason `standin`, when
   * free, whether or not they are in the rotation; the caller puts them among the candidates only when free.
   */
  readonly standinId?: string | undefined;
}

/** Why a member got the work, as the ledger stores it. `routed` is the smart ranking moving the pick (AC-1363). */
export type PickReason = 'fair' | 'priority' | 'even' | 'owner' | 'last_host' | 'standin' | 'only_free' | 'routed';

/** One candidate as the ledger row's detail records them. */
export interface ComparedMember {
  readonly memberId: string;
  /** Count plus calibration: what the load divides. */
  readonly count: number;
  readonly weight: number;
  readonly priority: number;
}

/** What the ledger row keeps of a pick: the strategy and everyone compared. */
export interface PickDetail {
  readonly strategy: PickRules['strategy'];
  readonly compared: readonly ComparedMember[];
}

/** The pick: who, why, and what was compared. */
export interface Picked {
  readonly memberId: string;
  readonly reason: PickReason;
  readonly detail: PickDetail;
}

/** A candidate's load: their count (calibration included) for each unit of their weight. */
export function loadOf(candidate: Pick<Candidate, 'count' | 'calibration' | 'weight'>): number {
  return (candidate.count + candidate.calibration) / Math.max(1, candidate.weight);
}

/**
 * Even's waiting members (AC-1325): those whose load is at least `gap`
 * meetings (at weight 100) above the lowest load among `members`, the
 * rotation's switched on members. They are left out of slots and picks.
 */
export function evenWaiting(members: readonly Candidate[], gap: number): ReadonlySet<string> {
  if (members.length === 0) return new Set();
  const loads = members.map((member) => ({ id: member.memberId, load: loadOf(member) * 100 }));
  const lowest = Math.min(...loads.map((each) => each.load));
  // A hair under the gap for float error: 3 meetings ahead at weight 100 is exactly the gap.
  return new Set(loads.filter((each) => each.load - lowest >= gap - 1e-9).map((each) => each.id));
}

/**
 * Fair's order: lowest ranking key, higher priority, longest since last
 * assigned (never first), member id. Without a smart ranking the key is the
 * load, so this is exactly spec 0029's order (AC-739); with one it is the
 * load less the seat's slack times the candidate's preference (AC-1363),
 * which only ever reorders people the rules already allowed.
 */
function fairOrder(a: Candidate, b: Candidate, smart: SmartRanking | undefined): number {
  return (
    rankingKey(a, smart) - rankingKey(b, smart) ||
    b.priority - a.priority ||
    (a.lastAssignedAt?.getTime() ?? -Infinity) - (b.lastAssignedAt?.getTime() ?? -Infinity) ||
    (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0)
  );
}

/** The candidates best first, by the strategy (AC-738) and, when it is given, the smart ranking (AC-1361). */
export function rankCandidates(
  candidates: readonly Candidate[],
  strategy: PickRules['strategy'],
  smart?: SmartRanking,
): readonly Candidate[] {
  return [...candidates].sort(
    (a, b) => (strategy === 'priority' ? b.priority - a.priority : 0) || fairOrder(a, b, smart),
  );
}

/** The member a returning guest goes to among the open candidates, and why; undefined when neither is free. */
function returningTo(
  open: readonly Candidate[],
  rules: PickRules,
  known: Returning,
): { readonly memberId: string; readonly reason: 'owner' | 'last_host' | 'standin' } | undefined {
  if (rules.returning === 'none') return undefined;
  const wanted = rules.returning === 'owner' ? known.ownerId : known.lastHostId;
  if (wanted === undefined) return undefined;
  const found = open.find((each) => each.memberId === wanted);
  if (found !== undefined) return { memberId: found.memberId, reason: rules.returning };
  // Away, with a free stand in (AC-1284): the stand in takes it.
  const standin = known.standinId === undefined ? undefined : open.find((each) => each.memberId === known.standinId);
  return standin === undefined ? undefined : { memberId: standin.memberId, reason: 'standin' };
}

/**
 * The first of `ranked` that `allowed` admits, by the rules above. With a
 * smart ranking (AC-1361) the seat is ordered twice: once by the rotation
 * alone and once with the preference, and the reason is `routed` only when
 * the two disagree, so the ledger still says `fair`, `priority` or `even`
 * whenever the ranking changed nothing.
 */
function pickAmong(
  candidates: readonly Candidate[],
  rules: PickRules,
  known: Returning,
  allowed: (memberId: string) => boolean,
  smart?: SmartRanking,
): Picked | undefined {
  const plain = rankCandidates(candidates, rules.strategy);
  const open = plain.filter((each) => allowed(each.memberId));
  const first = open[0];
  if (first === undefined) return undefined;
  const detail: PickDetail = {
    strategy: rules.strategy,
    compared: plain.map((each) => ({
      memberId: each.memberId,
      count: each.count + each.calibration,
      weight: each.weight,
      priority: each.priority,
    })),
  };
  // A returning guest's owner, last host or stand in is never ranked and never a trial (AC-1365).
  const back = returningTo(open, rules, known);
  if (back !== undefined) return { ...back, detail };
  if (open.length === 1) return { memberId: first.memberId, reason: 'only_free', detail };
  // Two or more free candidates: the ranking orders them (AC-1361).
  const ranked =
    smart !== undefined &&
    tilts(
      smart,
      open.map((each) => each.memberId),
    )
      ? rankCandidates(candidates, rules.strategy, smart).filter((each) => allowed(each.memberId))
      : open;
  // The allowance is measured from the whole rotation's lowest load, not this slot's (AC-1364): the seat's own first
  // choice is always admitted, so a seat where everyone is over it still books, by the rotation's own order.
  const best =
    smart === undefined
      ? (ranked[0] ?? first)
      : (ranked.find((each) => each.memberId === first.memberId || withinAllowance(each, smart)) ?? first);
  const reason: PickReason = best.memberId === first.memberId ? rules.strategy : 'routed';
  return { memberId: best.memberId, reason, detail };
}

/**
 * The member who gets the work, or undefined when nobody is free. A free
 * returning guest's owner or last host wins (`owner`, `last_host`); one
 * candidate alone is `only_free`; otherwise the strategy's first.
 */
export function pickMember(
  candidates: readonly Candidate[],
  rules: PickRules,
  known: Returning = {},
  smart?: SmartRanking,
): Picked | undefined {
  return pickAmong(candidates, rules, known, () => true, smart);
}

/**
 * Whether each set can be given a different member (Hall's condition, exact
 * for up to 3 sets): each has someone, every two together have two people,
 * all three together have three.
 */
export function hallHolds(sets: readonly (readonly string[])[]): boolean {
  const size = (indexes: readonly number[]) => new Set(indexes.flatMap((index) => sets[index] ?? [])).size;
  const count = sets.length;
  for (let a = 0; a < count; a += 1) {
    if (size([a]) < 1) return false;
    for (let b = a + 1; b < count; b += 1) {
      if (size([a, b]) < 2) return false;
      for (let c = b + 1; c < count; c += 1) if (size([a, b, c]) < 3) return false;
    }
  }
  return true;
}

/** One seat to fill: a rotation's rules, its free candidates, where its returning guest goes, and its ranking. */
export interface Seat {
  readonly rotationId: string;
  readonly rules: PickRules;
  readonly candidates: readonly Candidate[];
  readonly known?: Returning;
  /** The smart ranking for this seat (AC-1361); absent, or off, leaves the pick exactly the rotation's. */
  readonly smart?: SmartRanking;
}

/** A seat's pick, naming its rotation. */
export type SeatPick = Picked & { readonly rotationId: string };

/**
 * One member per seat, in seat order (AC-1321): each seat's pick is its
 * strategy's first who isn't chosen yet and whose choice leaves the later
 * seats able to be filled. Undefined when the seats can't all be filled.
 */
export function fillSeats(seats: readonly Seat[]): readonly SeatPick[] | undefined {
  const ids = seats.map((seat) => seat.candidates.map((each) => each.memberId));
  if (!hallHolds(ids)) return undefined;
  const chosen: SeatPick[] = [];
  const taken = new Set<string>();
  for (const [index, seat] of seats.entries()) {
    const later = ids.slice(index + 1);
    const picked = pickAmong(
      seat.candidates,
      seat.rules,
      seat.known ?? {},
      (memberId) =>
        !taken.has(memberId) &&
        hallHolds(later.map((set) => set.filter((each) => each !== memberId && !taken.has(each)))),
      seat.smart,
    );
    if (picked === undefined) return undefined;
    taken.add(picked.memberId);
    chosen.push({ ...picked, rotationId: seat.rotationId });
  }
  return chosen;
}
