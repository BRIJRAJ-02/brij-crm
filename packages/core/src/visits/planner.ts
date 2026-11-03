// The visit planner (spec 0066, AC-6603, AC-6604; the cross check's engine performance rules): one pure function,
// `planVisit`, that never reads the database. The place's hours, each staff member's shifts and busy time, each
// resource's busy time, the services asked for (as items), the party, notice, window, step and pacing go in; the
// offered starts come out, each with its allocation (which staff member and which resources each item holds, and the
// holds themselves). A chosen start (`at`) answers that start alone, and `narrow` keeps a recheck to the allocation a
// visitor was offered.
//
// How it searches, per request:
// - Each staff member's free time is worked out once for the asked days: their shifts at the place, inside its opening
//   hours unless their shifts may run outside, minus their busy time. Each resource's free time is the complement of
//   its busy time. A check is then a binary search, never a scan.
// - Starts step through each opening range on the place's own wall clock (a clock change never moves them), from the
//   range's opening, and the whole visit must end by the range's close: the last start is the close less the visit's
//   length (checklabs' "last seating = close − turn").
// - Per start, items are allocated greedily, the item with the fewest qualified staff first (among those whose start
//   is known: an item whose earlier items have staff dependent lengths waits for them), with a backtrack of at most 3.
//   "Any staff" tries the qualified staff with the fewest booked minutes that day first, then the business's order.
//   A party is seated best fit: the smallest resource that takes it, then joins of up to 3 joinable resources.
// - At most 500 tries per start (a start past it is dropped as not offered) and 20,000 per request (the rest of the
//   range is dropped); either cap reports itself in `stats`, which the caller logs with the place and service.
// - Pacing (checklabs' covers cap): a start is offered only while the parties overlapping the visit, plus this one,
//   stay within the cap.
import {
  holdForParty,
  spanOf,
  VISIT_LIMITS,
  type CapacityMode,
  type HoldBySize,
  type PlaceHoursShape,
  type ResourceKind,
} from '@crm/contracts';
import { addDays, placeDateOf, rangesOn, wallToInstant } from '../hospitality/hours.ts';

const MINUTE = 60_000;
const DAY = 86_400_000;

/** A span of time in epoch milliseconds, the end exclusive. */
export interface Interval {
  readonly start: number;
  readonly end: number;
}

/** A staff member as the planner reads them. */
export interface PlannerStaff {
  readonly id: string;
  /** The order the business set (ties in "any staff" go to the lower). */
  readonly order: number;
  /** Their weekly shifts at this place. */
  readonly shifts: PlaceHoursShape;
  /** Shifts may run outside the place's opening hours. */
  readonly outsideHours?: boolean;
  /** Everything that blocks them: holds, meetings, calendar busy, time off, blocks. */
  readonly busy: readonly Interval[];
  /** Minutes already booked per place date, for "any staff" fairness. */
  readonly bookedMinutes?: ReadonlyMap<string, number>;
}

/** A resource as the planner reads it. */
export interface PlannerResource {
  readonly id: string;
  readonly kind: ResourceKind;
  readonly minCapacity: number;
  readonly maxCapacity: number;
  /** The resources it joins with (read both ways). */
  readonly joins: readonly string[];
  readonly order: number;
  /** Bookable online; a guest's plan leaves the others out (`onlineOnly`). */
  readonly online?: boolean;
  readonly busy: readonly Interval[];
}

/** What an item needs besides staff: `count` resources of a kind, or one named resource. */
export type ResourceNeed = { readonly kind: ResourceKind; readonly count: number } | { readonly resourceId: string };

/** Who an item needs: nobody (a table), or one of the qualified staff (`chosen` when the client picked one). */
export type StaffNeed = 'none' | { readonly qualified: readonly string[]; readonly chosen?: string | undefined };

/** One service of the visit (a variant), in visit order. */
export interface PlannerItem {
  readonly minutes: number;
  readonly bufferBefore?: number;
  readonly bufferAfter?: number;
  /** A processing window inside the item: the staff member is free, the resources stay held. */
  readonly processing?: { readonly after: number; readonly minutes: number } | undefined;
  /** Minutes after the previous item ends (back to back when absent). */
  readonly gapBefore?: number;
  readonly staff: StaffNeed;
  /** A staff member's own length for this variant (senior versus junior). */
  readonly staffMinutes?: ReadonlyMap<string, number>;
  readonly needs: readonly ResourceNeed[];
  readonly capacityMode?: CapacityMode;
  /** Parties of a size or more hold longer (party mode). */
  readonly holdBySize?: readonly HoldBySize[];
}

/** A party already booked, for pacing. */
export interface BookedParty extends Interval {
  readonly party: number;
}

/** Everything `planVisit` reads. */
export interface PlanInput {
  /** The place's IANA zone; hours and shifts are on its wall clock. */
  readonly zone: string;
  readonly hours: PlaceHoursShape;
  readonly staff: readonly PlannerStaff[];
  readonly resources: readonly PlannerResource[];
  readonly items: readonly PlannerItem[];
  readonly party: number;
  readonly now: Date;
  /** Starts at or after `from` and before `to`. */
  readonly from: Date;
  readonly to: Date;
  readonly noticeMinutes?: number;
  /** Nothing starts later than now plus this many days. */
  readonly windowDays?: number;
  /** How often a start is offered, in minutes (default 15). */
  readonly stepMinutes?: number;
  /** A covers cap (checklabs' maxCoversPerSlot) and the parties booked. */
  readonly pacing?: { readonly coversCap: number; readonly booked: readonly BookedParty[] } | undefined;
  /** Only resources marked online (a guest's plan). */
  readonly onlineOnly?: boolean;
  /** One chosen start: only it is planned. */
  readonly at?: Date | undefined;
  /** A recheck keeps to this allocation: each item's staff member and resources. */
  readonly narrow?: readonly NarrowItem[] | undefined;
  /** Stop at the first start offered (the earliest free day search). */
  readonly firstOnly?: boolean;
  /** The caps, for tests; VISIT_LIMITS otherwise. */
  readonly caps?: { readonly perStart?: number; readonly perRequest?: number; readonly backtracks?: number };
}

/** The allocation a recheck keeps to, per item. */
export interface NarrowItem {
  readonly staffId?: string | undefined;
  readonly resourceIds: readonly string[];
}

/** One hold the visit makes: one holder's time for one item. */
export interface PlannedHold {
  readonly item: number;
  readonly staffId?: string;
  readonly resourceId?: string;
  readonly start: Date;
  readonly end: Date;
}

/** One item as planned. */
export interface PlannedItem {
  readonly start: Date;
  readonly end: Date;
  readonly staffId?: string;
  readonly resourceIds: readonly string[];
}

/** One offered start, with its allocation. */
export interface PlannedStart {
  readonly start: Date;
  readonly end: Date;
  readonly items: readonly PlannedItem[];
  readonly holds: readonly PlannedHold[];
}

/** Why a plan was refused outright: past a bound. */
export type PlanRefusal = 'items' | 'staff' | 'resources' | 'party';

/** What the search did, for the caller's log. */
export interface PlanStats {
  readonly tries: number;
  /** Starts dropped for passing the per start cap. */
  readonly startsCapped: number;
  /** The request cap was hit: later starts were not looked at. */
  readonly requestCapped: boolean;
}

/** The planner's answer. */
export interface PlanResult {
  readonly starts: readonly PlannedStart[];
  readonly stats: PlanStats;
  readonly refused?: PlanRefusal;
}

// ---- interval helpers ------------------------------------------------------------------------------------------

/** Sorted and merged where they touch or overlap. */
export function mergeIntervals(spans: readonly Interval[]): readonly Interval[] {
  const sorted = spans.filter((span) => span.end > span.start).toSorted((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const span of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && span.start <= last.end)
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, span.end) };
    else merged.push(span);
  }
  return merged;
}

/** `open` less `blocked` (both merged). */
export function subtractIntervals(open: readonly Interval[], blocked: readonly Interval[]): readonly Interval[] {
  const out: Interval[] = [];
  let index = 0;
  for (const span of open) {
    let cursor = span.start;
    while (index < blocked.length && (blocked[index]?.end ?? 0) <= cursor) index += 1;
    let scan = index;
    for (; scan < blocked.length; scan += 1) {
      const block = blocked[scan];
      if (block === undefined || block.start >= span.end) break;
      if (block.start > cursor) out.push({ start: cursor, end: block.start });
      cursor = Math.max(cursor, block.end);
    }
    if (cursor < span.end) out.push({ start: cursor, end: span.end });
  }
  return out;
}

/** `a` intersected with `b` (both merged). */
export function intersectIntervals(a: readonly Interval[], b: readonly Interval[]): readonly Interval[] {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a[i];
    const y = b[j];
    if (x === undefined || y === undefined) break;
    const start = Math.max(x.start, y.start);
    const end = Math.min(x.end, y.end);
    if (end > start) out.push({ start, end });
    if (x.end < y.end) i += 1;
    else j += 1;
  }
  return out;
}

/** Whether [start, end) lies inside one of the merged, sorted `free` spans (binary search). */
export function containsSpan(free: readonly Interval[], start: number, end: number): boolean {
  let low = 0;
  let high = free.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if ((free[mid]?.start ?? Infinity) <= start) {
      found = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  const span = found < 0 ? undefined : free[found];
  return span !== undefined && span.end >= end;
}

// ---- hours -----------------------------------------------------------------------------------------------------

/** The opening ranges that start on dates `first` to `last`, as instants (a range past midnight runs into the next day). */
function openRanges(hours: PlaceHoursShape, zone: string, first: string, last: string): readonly Interval[] {
  const spans: Interval[] = [];
  for (let date = first; date <= last; date = addDays(date, 1)) {
    for (const range of rangesOn(hours, date)) {
      const span = spanOf(range);
      if (span === undefined) continue;
      spans.push({
        start: wallToInstant(date, span.start, zone).getTime(),
        end: wallToInstant(date, span.end, zone).getTime(),
      });
    }
  }
  return spans;
}

/** The candidate starts in each opening range: stepped on the wall clock from its opening, each with its range's close. */
function candidateStarts(
  hours: PlaceHoursShape,
  zone: string,
  first: string,
  last: string,
  step: number,
): readonly { readonly start: number; readonly close: number }[] {
  const out = new Map<number, number>();
  for (let date = first; date <= last; date = addDays(date, 1)) {
    for (const range of rangesOn(hours, date)) {
      const span = spanOf(range);
      if (span === undefined) continue;
      const close = wallToInstant(date, span.end, zone).getTime();
      for (let minute = span.start; minute < span.end; minute += step) {
        const start = wallToInstant(date, minute, zone).getTime();
        // A wall time a clock change skips reads forward, onto the next step's: kept once.
        if (start < close && !out.has(start)) out.set(start, close);
      }
    }
  }
  return [...out.entries()].map(([start, close]) => ({ start, close })).sort((a, b) => a.start - b.start);
}

// ---- the search ------------------------------------------------------------------------------------------------

/** One resource set an item may take: resource indexes, best first. */
type Group = readonly number[];

interface Prepared {
  readonly staffFree: ReadonlyMap<string, readonly Interval[]>;
  readonly staffById: ReadonlyMap<string, PlannerStaff>;
  readonly resources: readonly PlannerResource[];
  readonly resourceFree: readonly (readonly Interval[])[];
  readonly resourceIndex: ReadonlyMap<string, number>;
  /** Per item: its need lists, each a list of groups in preference order. */
  readonly needGroups: readonly (readonly (readonly Group[])[])[];
  readonly lengths: readonly number[];
}

/** Whether two resources join (either names the other). */
function joined(a: PlannerResource, b: PlannerResource): boolean {
  return a.joins.includes(b.id) || b.joins.includes(a.id);
}

/**
 * The resource groups that seat `party` of `kind` (AC-6604): single resources whose capacity takes it, smallest first;
 * then pairs and triples of joined resources (each joined to another in the group) whose capacities together take
 * it, smallest total first. Ties go to the business's order.
 */
export function partyGroups(
  resources: readonly PlannerResource[],
  kind: ResourceKind,
  party: number,
): readonly Group[] {
  const of = resources.flatMap((resource, index) => (resource.kind === kind ? [index] : []));
  const fits = (group: readonly number[]) => {
    let min = 0;
    let max = 0;
    for (const index of group) {
      const resource = resources[index];
      if (resource === undefined) return false;
      min += resource.minCapacity;
      max += resource.maxCapacity;
    }
    return group.length === 1 ? min <= party && party <= max : party <= max && party > 0;
  };
  const total = (group: readonly number[]) =>
    group.reduce((sum, index) => sum + (resources[index]?.maxCapacity ?? 0), 0);
  const orderOf = (group: readonly number[]) => Math.min(...group.map((index) => resources[index]?.order ?? 0));
  const byFit = (a: readonly number[], b: readonly number[]) => total(a) - total(b) || orderOf(a) - orderOf(b);
  const singles = of
    .filter((index) => fits([index]))
    .map((index) => [index])
    .sort(byFit);
  const neighbours = new Map<number, number[]>(of.map((index) => [index, []]));
  for (const a of of) {
    for (const b of of) {
      const x = resources[a];
      const y = resources[b];
      if (a < b && x !== undefined && y !== undefined && joined(x, y)) {
        neighbours.get(a)?.push(b);
        neighbours.get(b)?.push(a);
      }
    }
  }
  const pairs: number[][] = [];
  const triples = new Map<string, number[]>();
  for (const [a, near] of neighbours) {
    for (const b of near) {
      if (a >= b) continue;
      const pair = [a, b];
      // A pair joins a party a single resource can't seat: one that seats it alone is offered first anyway.
      if (fits(pair)) pairs.push(pair);
      for (const c of [...(neighbours.get(a) ?? []), ...(neighbours.get(b) ?? [])]) {
        if (c === a || c === b) continue;
        const triple = [a, b, c].sort((x, y) => x - y);
        const key = triple.join(',');
        if (!triples.has(key) && fits(triple)) triples.set(key, triple);
      }
    }
  }
  return [...singles, ...pairs.sort(byFit), ...[...triples.values()].sort(byFit)];
}

/** The groups one need can take, in preference order. */
function groupsFor(
  need: ResourceNeed,
  item: PlannerItem,
  resources: readonly PlannerResource[],
  resourceIndex: ReadonlyMap<string, number>,
  party: number,
): readonly Group[] {
  if ('resourceId' in need) {
    const index = resourceIndex.get(need.resourceId);
    return index === undefined ? [] : [[index]];
  }
  if (item.capacityMode === 'party') return partyGroups(resources, need.kind, party);
  // `count` of a kind: each resource alone, in the business's order; the item takes `count` distinct ones.
  return resources
    .flatMap((resource, index) => (resource.kind === need.kind ? [index] : []))
    .sort((a, b) => (resources[a]?.order ?? 0) - (resources[b]?.order ?? 0))
    .map((index) => [index]);
}

/** The holds of one item for one holder: the item widened by its buffers, a staff member's split around processing. */
function holdPieces(item: PlannerItem, start: number, end: number, staff: boolean): readonly Interval[] {
  const before = (item.bufferBefore ?? 0) * MINUTE;
  const after = (item.bufferAfter ?? 0) * MINUTE;
  if (staff && item.processing !== undefined) {
    const pause = start + item.processing.after * MINUTE;
    const resume = pause + item.processing.minutes * MINUTE;
    return [
      { start: start - before, end: pause },
      { start: resume, end: end + after },
    ].filter((piece) => piece.end > piece.start);
  }
  return [{ start: start - before, end: end + after }];
}

/** An item's length with `staffId` doing it: their own length, else the variant's (a party's by its size). */
function lengthOf(item: PlannerItem, party: number, staffId: string | undefined): number {
  const own = staffId === undefined ? undefined : item.staffMinutes?.get(staffId);
  if (own !== undefined) return own;
  return item.capacityMode === 'party' ? holdForParty(item.minutes, item.holdBySize ?? [], party) : item.minutes;
}

/** An item's length when it doesn't depend on who does it, else undefined. */
function fixedLength(item: PlannerItem, party: number): number | undefined {
  if (item.staff === 'none') return lengthOf(item, party, undefined);
  if (item.staff.chosen !== undefined) return lengthOf(item, party, item.staff.chosen);
  if (item.staffMinutes === undefined || item.staffMinutes.size === 0) return lengthOf(item, party, undefined);
  return undefined;
}

/** What one item was given in the search. */
interface Pick {
  readonly start: number;
  readonly end: number;
  readonly staffId: string | undefined;
  readonly resources: readonly number[];
}

/** A counter shared by a request's search. */
interface Budget {
  tries: number;
}

/**
 * Allocates every item of a visit starting at `visitStart` (AC-6604), or undefined. Greedy per item, the fewest
 * qualified staff first among items whose start is known, with at most `backtracks` returns to an earlier choice
 * and at most `perStart` tries; `budget` counts tries across the request.
 */
function allocate(
  input: PlanInput,
  prepared: Prepared,
  visitStart: number,
  close: number,
  caps: { readonly perStart: number; readonly perRequest: number; readonly backtracks: number },
  budget: Budget,
): { readonly picks: readonly Pick[] } | 'capped' | undefined {
  const { items, party, zone } = input;
  const picks: (Pick | undefined)[] = items.map(() => undefined);
  const fixed = items.map((item) => fixedLength(item, party));
  let tries = 0;
  let backtracks = 0;
  const state = { capped: false };

  /** The start of item `index`, when every item before it has a known length. */
  const startOf = (index: number): number | undefined => {
    let at = visitStart;
    for (let earlier = 0; earlier < index; earlier += 1) {
      const pick = picks[earlier];
      const length = pick === undefined ? fixed[earlier] : (pick.end - pick.start) / MINUTE;
      if (length === undefined) return undefined;
      at += length * MINUTE + (items[earlier + 1]?.gapBefore ?? 0) * MINUTE;
    }
    return at;
  };
  const qualifiedCount = (item: PlannerItem) =>
    item.staff === 'none' ? 0 : item.staff.chosen !== undefined ? 1 : item.staff.qualified.length;

  /** The next item to allocate: ready (its start known), fewest qualified staff, then visit order. */
  const nextItem = (): number | undefined => {
    let best: number | undefined;
    for (const [index, item] of items.entries()) {
      if (picks[index] !== undefined || startOf(index) === undefined) continue;
      if (best === undefined || qualifiedCount(item) < qualifiedCount(items[best] ?? item)) best = index;
    }
    return best;
  };

  /** Minutes a staff member already holds on the date: booked, plus this visit's picks. */
  const loadOf = (staffId: string, date: string): number => {
    let minutes = prepared.staffById.get(staffId)?.bookedMinutes?.get(date) ?? 0;
    for (const pick of picks) if (pick?.staffId === staffId) minutes += (pick.end - pick.start) / MINUTE;
    return minutes;
  };

  /** Each option for an item at `start`, in preference order, as a lazy list. */
  function* options(index: number, start: number): Generator<Pick> {
    const item = items[index];
    if (item === undefined) return;
    const narrow = input.narrow?.[index];
    let candidates: readonly (string | undefined)[];
    if (item.staff === 'none') candidates = [undefined];
    else if (narrow?.staffId !== undefined) candidates = [narrow.staffId];
    else if (item.staff.chosen !== undefined) candidates = [item.staff.chosen];
    else {
      const date = placeDateOf(start, zone);
      candidates = item.staff.qualified
        .filter((id) => prepared.staffById.has(id))
        .toSorted(
          (a, b) =>
            loadOf(a, date) - loadOf(b, date) ||
            (prepared.staffById.get(a)?.order ?? 0) - (prepared.staffById.get(b)?.order ?? 0),
        );
    }
    for (const staffId of candidates) {
      if (item.staff !== 'none' && staffId !== undefined && !item.staff.qualified.includes(staffId)) continue;
      const end = start + lengthOf(item, party, staffId) * MINUTE;
      tries += 1;
      budget.tries += 1;
      if (tries > caps.perStart || budget.tries > caps.perRequest) {
        state.capped = true;
        return;
      }
      if (staffId !== undefined) {
        const free = prepared.staffFree.get(staffId) ?? [];
        if (!holdPieces(item, start, end, true).every((piece) => containsSpan(free, piece.start, piece.end))) continue;
      }
      // Resources: each need takes a group free over the item's holds, none taken twice in this item; greedy per need
      // in preference order, each fitting set one option (party groups are the alternatives worth trying).
      const [hold] = holdPieces(item, start, end, false);
      if (hold === undefined) continue;
      const needs = prepared.needGroups[index] ?? [];
      const freeGroup = (group: Group, taken: ReadonlySet<number>) =>
        group.every(
          (resource) =>
            !taken.has(resource) &&
            (!(input.onlineOnly ?? false) || prepared.resources[resource]?.online !== false) &&
            (narrow === undefined || narrow.resourceIds.includes(prepared.resources[resource]?.id ?? '')) &&
            containsSpan(prepared.resourceFree[resource] ?? [], hold.start, hold.end),
        );
      /** Every way to meet the needs from `from`, best first, with `taken` already held. */
      function* meet(from: number, taken: ReadonlySet<number>): Generator<readonly number[]> {
        if (from >= needs.length) {
          yield [];
          return;
        }
        const need = item?.needs[from];
        const groups = needs[from] ?? [];
        const count = need !== undefined && 'count' in need && item?.capacityMode !== 'party' ? need.count : 1;
        // `count` distinct resources of a kind: the first `count` free ones, in order (any set is as good as another).
        if (count > 1) {
          const chosen: number[] = [];
          for (const group of groups) {
            tries += 1;
            budget.tries += 1;
            if (freeGroup(group, new Set([...taken, ...chosen]))) chosen.push(...group);
            if (chosen.length === count) break;
          }
          if (chosen.length < count) return;
          for (const rest of meet(from + 1, new Set([...taken, ...chosen]))) yield [...chosen, ...rest];
          return;
        }
        for (const group of groups) {
          tries += 1;
          budget.tries += 1;
          if (tries > caps.perStart || budget.tries > caps.perRequest) {
            state.capped = true;
            return;
          }
          if (!freeGroup(group, taken)) continue;
          for (const rest of meet(from + 1, new Set([...taken, ...group]))) yield [...group, ...rest];
        }
      }
      for (const resources of meet(0, new Set())) {
        yield { start, end, staffId, resources };
        if (state.capped) return;
      }
    }
  }

  /** Depth first over the items, counting backtracks. */
  const search = (): boolean => {
    const index = nextItem();
    if (index === undefined) return picks.every((pick) => pick !== undefined);
    const start = startOf(index);
    if (start === undefined) return false;
    let tried = 0;
    for (const option of options(index, start)) {
      if (tried > 0) {
        backtracks += 1;
        if (backtracks > caps.backtracks) return false;
      }
      tried += 1;
      picks[index] = option;
      // The whole visit must end by its opening range's close.
      if (option.end > close) {
        picks[index] = undefined;
        continue;
      }
      if (search()) return true;
      picks[index] = undefined;
      if (state.capped) return false;
    }
    return false;
  };

  const found = search();
  if (state.capped) return 'capped';
  if (!found) return undefined;
  const done = picks.filter((pick): pick is Pick => pick !== undefined);
  return done.length === items.length ? { picks: done } : undefined;
}

/**
 * The holds a visit makes from its picks: each item's staff member and resources over the item widened by its
 * buffers (the staff member's split around processing), then, for one holder over consecutive items of the same
 * visit, the buffers between them clipped so the holds never overlap (the exclusion constraints would refuse it).
 */
function holdsOf(
  items: readonly PlannerItem[],
  picks: readonly Pick[],
  resources: readonly PlannerResource[],
): readonly PlannedHold[] {
  const raw: {
    item: number;
    staffId?: string;
    resourceId?: string;
    start: number;
    end: number;
    itemStart: number;
    itemEnd: number;
  }[] = [];
  for (const [index, pick] of picks.entries()) {
    const item = items[index];
    if (item === undefined) continue;
    if (pick.staffId !== undefined) {
      for (const piece of holdPieces(item, pick.start, pick.end, true)) {
        raw.push({ item: index, staffId: pick.staffId, ...piece, itemStart: pick.start, itemEnd: pick.end });
      }
    }
    for (const resource of pick.resources) {
      const id = resources[resource]?.id;
      if (id === undefined) continue;
      for (const piece of holdPieces(item, pick.start, pick.end, false)) {
        raw.push({ item: index, resourceId: id, ...piece, itemStart: pick.start, itemEnd: pick.end });
      }
    }
  }
  const byHolder = new Map<string, typeof raw>();
  for (const hold of raw) {
    const key = hold.staffId !== undefined ? `s:${hold.staffId}` : `r:${hold.resourceId ?? ''}`;
    byHolder.set(key, [...(byHolder.get(key) ?? []), hold]);
  }
  const out: PlannedHold[] = [];
  for (const holds of byHolder.values()) {
    const sorted = holds.toSorted((a, b) => a.start - b.start);
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1];
      const next = sorted[index];
      if (previous === undefined || next === undefined || previous.end <= next.start) continue;
      const boundary = Math.max(previous.itemEnd, Math.min(previous.end, next.start));
      sorted[index - 1] = { ...previous, end: boundary };
      sorted[index] = { ...next, start: Math.max(next.start, boundary) };
    }
    for (const hold of sorted) {
      if (hold.end <= hold.start) continue;
      out.push({
        item: hold.item,
        ...(hold.staffId === undefined ? {} : { staffId: hold.staffId }),
        ...(hold.resourceId === undefined ? {} : { resourceId: hold.resourceId }),
        start: new Date(hold.start),
        end: new Date(hold.end),
      });
    }
  }
  return out.sort((a, b) => a.item - b.item || a.start.getTime() - b.start.getTime());
}

/** What a request works out once: each holder's free time, and each need's resource groups. */
function prepare(input: PlanInput, first: string, last: string): Prepared {
  const open = mergeIntervals(openRanges(input.hours, input.zone, first, last));
  const staffFree = new Map<string, readonly Interval[]>();
  const staffById = new Map<string, PlannerStaff>();
  for (const member of input.staff) {
    staffById.set(member.id, member);
    const shifts = mergeIntervals(openRanges(member.shifts, input.zone, first, last));
    const working = member.outsideHours === true ? shifts : intersectIntervals(shifts, open);
    staffFree.set(member.id, subtractIntervals(working, mergeIntervals(member.busy)));
  }
  const everything: readonly Interval[] = [{ start: -8.64e15, end: 8.64e15 }];
  const resourceFree = input.resources.map((resource) => subtractIntervals(everything, mergeIntervals(resource.busy)));
  const resourceIndex = new Map(input.resources.map((resource, index) => [resource.id, index]));
  const needGroups = input.items.map((item) =>
    item.needs.map((need) => groupsFor(need, item, input.resources, resourceIndex, input.party)),
  );
  return {
    staffFree,
    staffById,
    resources: input.resources,
    resourceFree,
    resourceIndex,
    needGroups,
    lengths: input.items.map((item) => fixedLength(item, input.party) ?? item.minutes),
  };
}

/**
 * The offered starts of a visit (AC-6603, AC-6604), each with its allocation and holds, in time order. Pure: see the
 * header for how it searches. Refuses (`refused`) a request past a bound: more than 5 items, 60 staff or 300
 * resources, or a party outside 1 to 100.
 */
export function planVisit(input: PlanInput): PlanResult {
  const empty = (refused?: PlanRefusal): PlanResult => ({
    starts: [],
    stats: { tries: 0, startsCapped: 0, requestCapped: false },
    ...(refused === undefined ? {} : { refused }),
  });
  if (input.items.length === 0 || input.items.length > VISIT_LIMITS.items) return empty('items');
  if (input.staff.length > VISIT_LIMITS.staffPerPlace) return empty('staff');
  if (input.resources.length > VISIT_LIMITS.resourcesPerPlace) return empty('resources');
  if (!Number.isInteger(input.party) || input.party < VISIT_LIMITS.partyMin || input.party > VISIT_LIMITS.partyMax) {
    return empty('party');
  }
  const caps = {
    perStart: input.caps?.perStart ?? VISIT_LIMITS.triesPerStart,
    perRequest: input.caps?.perRequest ?? VISIT_LIMITS.triesPerRequest,
    backtracks: input.caps?.backtracks ?? VISIT_LIMITS.backtracks,
  };
  const step = Math.max(5, input.stepMinutes ?? 15);
  const now = input.now.getTime();
  const earliest = Math.max(input.from.getTime(), now + (input.noticeMinutes ?? 0) * MINUTE);
  const latest = Math.min(input.to.getTime(), input.windowDays === undefined ? Infinity : now + input.windowDays * DAY);
  if (!(latest > earliest)) return empty();
  // A day either side: a range from the evening before runs past midnight, and shifts with it.
  const first = addDays(placeDateOf(earliest, input.zone), -1);
  const last = addDays(placeDateOf(latest, input.zone), 1);
  const prepared = prepare(input, first, last);
  const shortest = prepared.lengths.reduce((sum, minutes) => sum + minutes, 0) * MINUTE;
  const at = input.at?.getTime();
  const budget: Budget = { tries: 0 };
  const starts: PlannedStart[] = [];
  let startsCapped = 0;
  let requestCapped = false;
  for (const candidate of candidateStarts(input.hours, input.zone, first, last, step)) {
    if (candidate.start < earliest || candidate.start >= latest) continue;
    if (at !== undefined && candidate.start !== at) continue;
    if (candidate.start + shortest > candidate.close) continue;
    if (budget.tries >= caps.perRequest) {
      requestCapped = true;
      break;
    }
    const found = allocate(input, prepared, candidate.start, candidate.close, caps, budget);
    if (found === 'capped') {
      if (budget.tries >= caps.perRequest) {
        requestCapped = true;
        break;
      }
      startsCapped += 1;
      continue;
    }
    if (found === undefined) continue;
    const end = Math.max(...found.picks.map((pick) => pick.end));
    // Pacing: the parties overlapping the visit, and this one, stay within the covers cap.
    if (input.pacing !== undefined) {
      const covers = input.pacing.booked.reduce(
        (sum, booked) => (booked.start < end && candidate.start < booked.end ? sum + booked.party : sum),
        0,
      );
      if (covers + input.party > input.pacing.coversCap) continue;
    }
    starts.push({
      start: new Date(candidate.start),
      end: new Date(end),
      items: found.picks.map((pick) => ({
        start: new Date(pick.start),
        end: new Date(pick.end),
        ...(pick.staffId === undefined ? {} : { staffId: pick.staffId }),
        resourceIds: pick.resources.map((index) => input.resources[index]?.id ?? ''),
      })),
      holds: holdsOf(input.items, found.picks, input.resources),
    });
    if (input.firstOnly === true || at !== undefined) break;
  }
  return { starts, stats: { tries: budget.tries, startsCapped, requestCapped } };
}

/**
 * The first start offered in the next `days` days (default 14, the cross check's earliest free day search), or
 * undefined: the booking flow preselects its day.
 */
export function earliestStart(input: PlanInput, days: number = VISIT_LIMITS.earliestDays): PlannedStart | undefined {
  const to = new Date(Math.min(input.to.getTime(), input.from.getTime() + days * DAY));
  return planVisit({ ...input, to, firstOnly: true }).starts[0];
}
