// A ranked decision, explained (spec 0037, AC-1373), in two tiers plus the
// rates tier, and always from the decision's own frozen `snapshot`, never
// from `routing_stats`: the numbers a person reads are the numbers the pick
// was made on, whatever has changed since.
//
//   `rule`   anyone who may see the booking: the rule, the hosts it allowed,
//            the picked rep's matched skills, and "picked by fair share" or
//            "picked by track record".
//   `own`    the picked rep as well: their own numbers, with no rate.
//   `manage` holders of `routing.manage`: every candidate's numbers, rates
//            included.
//
// Pure: it is given the stored snapshot, the tier, and the names, and does no
// I/O of its own, so the same function serves the Decisions log and a
// booking's own read.
import * as z from 'zod';
import { SMART_MODES, type CandidateNumbers, type RoutingPick } from '@crm/contracts';

/** The reader's tier (AC-1373). */
export type ExplainTier = 'rule' | 'own' | 'manage';

/** One candidate as the snapshot stored them, read defensively: anything unknown is dropped. */
const StoredCandidate = z.object({
  memberId: z.uuid(),
  count: z.number().catch(0),
  load: z.number().catch(0),
  fairShare: z.number().catch(0),
  fit: z.number().catch(0),
  lift: z.number().catch(0),
  trials: z.number().int().min(0).catch(0),
  successes: z.number().int().min(0).catch(0),
  skillIds: z.array(z.uuid()).catch([]),
  isPicked: z.boolean().catch(false),
});

/** One ranked seat as the snapshot stored it. */
const StoredSeat = z.object({
  rotationId: z.uuid(),
  mode: z.enum(SMART_MODES).catch('off'),
  holdout: z.boolean().catch(false),
  tiltPercent: z.number().catch(0),
  slack: z.number().catch(0),
  modelVersion: z.number().int().min(0).catch(0),
  windowDays: z.number().int().min(1).catch(30),
  pickedMemberId: z.uuid(),
  by: z.enum(['fair_share', 'track_record']).catch('fair_share'),
  candidates: z.array(StoredCandidate),
});
/** One ranked seat as the snapshot stored it. */
export type StoredSeat = z.infer<typeof StoredSeat>;

/** The stored `snapshot` column read back: the seats that parse, in order; anything else is no snapshot at all. */
export function snapshotOf(stored: unknown): readonly StoredSeat[] {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((each) => {
    const parsed = StoredSeat.safeParse(each);
    return parsed.success ? [parsed.data] : [];
  });
}

/** The smoothed rate and the team's for one seat (AC-1363), from the snapshot's trials and successes. */
const PRIOR = 20;
function rates(seat: StoredSeat): { readonly team: number; readonly of: (memberId: string) => number } {
  const trials = seat.candidates.reduce((total, each) => total + each.trials, 0);
  const successes = seat.candidates.reduce((total, each) => total + each.successes, 0);
  const team = trials === 0 ? 0 : successes / trials;
  // One map, not a scan per candidate: a seat holds up to `SNAPSHOT_CANDIDATES_MAX` rows and a page holds 50 of them.
  const byMember = new Map(seat.candidates.map((each) => [each.memberId, each]));
  return {
    team,
    of: (memberId) => {
      const found = byMember.get(memberId);
      if (found === undefined) return team;
      return (found.successes + PRIOR * team) / (found.trials + PRIOR);
    },
  };
}

/** What the explanation needs besides the snapshot: the names, and who is reading. */
export interface ExplainInput {
  readonly tier: ExplainTier;
  /** The reader's own member id, so the picked rep reads their own numbers. */
  readonly memberId?: string;
  readonly memberNames: ReadonlyMap<string, string>;
  readonly skillNames: ReadonlyMap<string, string>;
}

/** The pick and the numbers at the reader's tier. */
export interface Explanation {
  readonly pick?: RoutingPick;
  readonly numbers: readonly CandidateNumbers[];
}

/** Nothing was ranked: the decision explains itself with its rule alone. */
export const NO_EXPLANATION: Explanation = { numbers: [] };

/**
 * One decision's explanation (AC-1373) from its stored snapshot. The first
 * ranked seat is the one explained: a page fills one seat per rotation, and
 * the lead's host is the seat routing narrowed. Every rate is left out below
 * the `manage` tier, and another candidate's numbers never leave it.
 */
export function explainDecision(stored: unknown, input: ExplainInput): Explanation {
  const seat = snapshotOf(stored)[0];
  if (seat === undefined) return NO_EXPLANATION;
  const picked = seat.candidates.find((each) => each.memberId === seat.pickedMemberId);
  const pick: RoutingPick = {
    memberId: seat.pickedMemberId,
    name: input.memberNames.get(seat.pickedMemberId) ?? '',
    skills: (picked?.skillIds ?? []).flatMap((id) => {
      const name = input.skillNames.get(id);
      return name === undefined ? [] : [name];
    }),
    by: seat.by,
    mode: seat.mode,
    holdout: seat.holdout,
    windowDays: seat.windowDays,
    modelVersion: seat.modelVersion,
    slack: seat.slack,
    tiltPercent: seat.tiltPercent,
  };
  if (input.tier === 'rule') return { pick, numbers: [] };
  const rate = rates(seat);
  // The rep themself reads only their own row, and no rate; `routing.manage` reads every row with its rates.
  const rows =
    input.tier === 'manage'
      ? seat.candidates
      : seat.candidates.filter((each) => each.memberId === input.memberId && each.memberId === seat.pickedMemberId);
  return {
    pick,
    numbers: rows.map((each) => ({
      memberId: each.memberId,
      name: input.memberNames.get(each.memberId) ?? '',
      count: each.count,
      load: each.load,
      fairShare: each.fairShare,
      fit: each.fit,
      lift: input.tier === 'manage' ? each.lift : 0,
      // Every rate shows only to `routing.manage`, and so do the trials and successes a rate is worked out from.
      trials: input.tier === 'manage' ? each.trials : 0,
      successes: input.tier === 'manage' ? each.successes : 0,
      ...(input.tier === 'manage' ? { rate: rate.of(each.memberId), teamRate: rate.team } : {}),
      isPicked: each.isPicked,
    })),
  };
}
