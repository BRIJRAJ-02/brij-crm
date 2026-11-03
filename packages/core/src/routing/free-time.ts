// The free time check at submit (spec 0037, AC-1358, AC-1380): before a form answers a `book` route, does the page,
// with the route's hosts, have a free time in the next 14 days for its first length? The same slots its visitor would
// see (spec 0029's union of every member's own slots on a team page, the host's on a personal one), from the cached
// busy times. Calendars are read outside any transaction, as the public slots read does; each database read is its
// own short transaction in the form's workspace. Answers `free`, `none`, or `unknown` when a calendar couldn't be read
// or the page is gone, in which case the form answers the route as it would have, unchecked.
import { FREE_TIME_DAYS } from '@crm/contracts';
import type { EngineScope } from '../access/mint.ts';
import { inWorkspace } from '../access/run.ts';
import type { BusyReader } from '../booking/calendar.ts';
import {
  BUSY_MARGIN_MS,
  bookedSpans,
  loadPage,
  membersBusy,
  membersClosed,
  membersOf,
  pageSlots,
  pickHost,
} from '../booking/slots.ts';
import { loadTeam, memberBusy, readTeam, teamMemberIds, teamSlots, type Team } from '../rotation/team.ts';
import { limitChecks } from '../scheduling/limits.ts';

const HOUR_MS = 3_600_000;

/** What the check found. */
export type FreeTime = 'free' | 'none' | 'unknown';

/** What the check reads besides the page: the cached busy times and the clock. */
export interface FreeTimeDeps {
  readonly busy: BusyReader;
  readonly now?: () => Date;
}

/** A round robin team cut to `hosts` in each rotation holding any of them (as a hand off narrows its slots). */
function narrowed(team: Team, hosts: readonly string[] | undefined): Team {
  if (hosts === undefined || team.kind !== 'round_robin') return team;
  const wanted = new Set(hosts);
  return {
    ...team,
    rotations: team.rotations.map((rotation) => {
      const kept = rotation.members.filter((member) => wanted.has(member.memberId));
      return kept.length === 0 ? rotation : { ...rotation, members: kept };
    }),
  };
}

/**
 * Whether `pageId` (with `hosts`, on a team page) has a free time in the next 14 days for its first length. Read
 * with the form's own scope: the page must be in the form's workspace, which row level security holds to.
 */
export async function pageFreeTime(
  scope: EngineScope,
  deps: FreeTimeDeps,
  input: { readonly pageId: string; readonly hosts?: readonly string[] },
  /** True once the caller stopped waiting (its time limit): no further transaction is opened. */
  isLate: () => boolean = () => false,
): Promise<FreeTime> {
  const now = deps.now?.() ?? new Date();
  const from = now;
  const to = new Date(now.getTime() + FREE_TIME_DAYS * 86_400_000);
  const read = await inWorkspace(scope, async (tx) => {
    const page = await loadPage(tx, input.pageId);
    if (page === undefined || page.isDeleted || page.status !== 'live') return undefined;
    const loaded = await loadTeam(tx, page);
    const team = loaded === undefined ? undefined : narrowed(loaded, input.hosts);
    return { page, team, memberIds: team === undefined ? await membersOf(tx, page) : teamMemberIds(team) };
  });
  if (read === undefined) return 'unknown';
  const { page, team, memberIds } = read;
  const duration = page.durations[0];
  if (duration === undefined || memberIds.length === 0) return 'none';
  // The busy range on an hour's grid, so submits within the busy cache's minute ask the same question and share its
  // answer (the cache keys on the exact range); the slots themselves are still cut at `now`.
  const hourStart = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  const busyFrom = new Date(hourStart - BUSY_MARGIN_MS);
  const busyTo = new Date(hourStart + FREE_TIME_DAYS * 86_400_000 + HOUR_MS + BUSY_MARGIN_MS);
  const range = { duration, from, to, now };
  if (team !== undefined) {
    const busy = await memberBusy(deps.busy, scope.workspaceId, memberIds, busyFrom, busyTo);
    if (isLate()) return 'unknown';
    const reads = await inWorkspace(scope, (tx) =>
      readTeam(tx, page, team, busy, { from, to, margin: BUSY_MARGIN_MS, now }),
    );
    // The slots worked out outside the transaction, as the public slots read does.
    const found = teamSlots(page, team, reads, range);
    if (found.slots.length > 0) return 'free';
    return found.blocked ? 'unknown' : 'none';
  }
  const busy = await membersBusy(deps.busy, scope.workspaceId, memberIds, busyFrom, busyTo);
  if (busy.blocked || isLate()) return 'unknown';
  const host = pickHost(page, memberIds);
  const held = await inWorkspace(scope, async (tx) => ({
    booked: await bookedSpans(tx, memberIds, page.id, from, to),
    closed: await membersClosed(tx, memberIds, page, busyFrom, busyTo),
    limits: await limitChecks(tx, [host], from, to),
  }));
  const slots = pageSlots(page, {
    ...range,
    busy,
    bookings: held.booked,
    closed: held.closed,
    underLimit: held.limits.get(host),
  });
  return slots.length > 0 ? 'free' : 'none';
}

/**
 * The check under a time limit (AC-1380): past `limitMs` it answers `timeout`, and whatever was still being read is
 * left to finish unheard. An unexpected error answers `unknown`, so a check never fails a submit.
 */
export async function pageFreeTimeWithin(
  check: (isLate: () => boolean) => Promise<FreeTime>,
  limitMs: number,
): Promise<FreeTime | 'timeout'> {
  if (limitMs <= 0) return 'timeout';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let isOver = false;
  const late = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      isOver = true;
      resolve('timeout');
    }, limitMs);
  });
  try {
    // Once the limit passes, the check opens no more transactions: only its calendar reads, which fill the cache,
    // may still finish.
    return await Promise.race([check(() => isOver).catch((): FreeTime => 'unknown'), late]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
