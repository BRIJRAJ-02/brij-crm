// Routing on a team booking page (spec 0043, AC-1609 to AC-1611): the hosts
// a form's hand off chose, else the page's own rules over the visitor's record
// facts and that form's answers, narrow the page's rotations to some of their
// members. Narrowing only ever chooses among hosts; when none of them is free
// the whole rotation picks, so a rule never refuses a booking.
import { and, eq, isNull } from 'drizzle-orm';
import { PAGE_ROUTES } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import type { PageRecord } from '../booking/slots.ts';
import { handoffAnswers } from '../forms/public.ts';
import type { Team } from '../rotation/team.ts';
import { decideRoute, recordFactKeys } from './decide.ts';
import { recordFacts, type RecordFactObjects } from './facts.ts';
import { submissionDecision } from './forms.ts';

const { routingDecisions } = schema;

type RoundRobin = Extract<Team, { kind: 'round_robin' }>;

/**
 * The team with each rotation that holds any of `hosts` cut to those members
 * (AC-1609); a rotation holding none of them stays whole, so a seat in it can
 * still be filled. `narrowed` is false when no rotation held any.
 */
export function narrowTeam(team: RoundRobin, hosts: ReadonlySet<string>): { team: RoundRobin; narrowed: boolean } {
  const kept = team.rotations.map((rotation) => rotation.members.filter((member) => hosts.has(member.memberId)));
  const narrowed = kept.some((members) => members.length > 0);
  if (!narrowed) return { team, narrowed };
  const rotations = team.rotations.map((rotation, index) => {
    const members = kept[index] ?? [];
    return members.length === 0 ? rotation : { ...rotation, members };
  });
  return { team: { ...team, rotations }, narrowed };
}

/** Who a seat may go to when a route narrows it: only the routed hosts in a rotation holding any of them. */
export function allowFor(
  team: RoundRobin,
  hosts: ReadonlySet<string>,
): (rotationId: string, memberId: string) => boolean {
  const held = new Set(
    team.rotations
      .filter((rotation) => rotation.members.some((member) => hosts.has(member.memberId)))
      .map((rotation) => rotation.rules.id),
  );
  return (rotationId, memberId) => !held.has(rotationId) || hosts.has(memberId);
}

/** The hosts a form's hand off chose for this page (AC-1609), or undefined. */
export async function handoffHosts(
  tx: WorkspaceTx,
  submissionId: string,
  pageId: string,
): Promise<{ readonly decisionId: string; readonly hosts?: ReadonlySet<string> } | undefined> {
  const decision = await submissionDecision(tx, submissionId);
  if (decision?.routedPageId !== pageId) return undefined;
  return {
    decisionId: decision.id,
    ...(decision.hosts === null ? {} : { hosts: new Set(decision.hosts) }),
  };
}

/** What routing chose for one team booking, before the hosts are picked. */
export interface BookingRouting {
  /** The hosts to pick among, when a hand off or a rule chose some. */
  readonly hosts?: ReadonlySet<string>;
  /** The form's decision this booking follows (its booking is filled in), when it came through a hand off. */
  readonly handoffDecisionId?: string;
  /** The page's own decision, recorded with the booking, when the page has rules and no hand off chose. */
  readonly page?: { readonly ruleId?: string; readonly qualified?: boolean; readonly skipped: readonly string[] };
}

/**
 * Routes one team booking (AC-1609, AC-1610): a hand off's hosts first;
 * else the page's rules over the guest's record facts (by email) and the hand
 * off's answers. Read in the booking's transaction, under the rotation locks.
 */
export async function routeBooking(
  tx: WorkspaceTx,
  input: {
    readonly page: PageRecord;
    readonly objects: RecordFactObjects;
    readonly email: string;
    readonly submissionId?: string;
  },
): Promise<BookingRouting> {
  const handoff =
    input.submissionId === undefined ? undefined : await handoffHosts(tx, input.submissionId, input.page.id);
  if (handoff?.hosts !== undefined) return { hosts: handoff.hosts, handoffDecisionId: handoff.decisionId };
  const handed = handoff === undefined ? {} : { handoffDecisionId: handoff.decisionId };
  const rules = input.page.routingRules ?? [];
  if (rules.length === 0) return handed;
  const answers = input.submissionId === undefined ? {} : await handoffAnswers(tx, input.submissionId, input.page.id);
  const read = await recordFacts(tx, input.objects, input.email, recordFactKeys(rules));
  const decision = decideRoute(
    rules,
    { ...answers, ...read.facts },
    { routes: PAGE_ROUTES, unreadable: read.unreadable },
  );
  const page = {
    ...(decision.rule === undefined ? {} : { ruleId: decision.rule.id }),
    ...(decision.qualified === undefined ? {} : { qualified: decision.qualified }),
    skipped: decision.skipped,
  };
  return {
    ...handed,
    ...(decision.route?.kind === 'hosts' ? { hosts: new Set(decision.route.hosts) } : {}),
    page,
  };
}

/**
 * Records what routing did for a booking (AC-1607, AC-1611): the form's
 * decision gets its booking; the page's own decision is stored with it,
 * `hosts` null when the routed hosts weren't free and the rotation picked.
 */
export async function recordBookingRouting(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly pageId: string;
    readonly bookingId: string;
    readonly routing: BookingRouting;
    readonly narrowed: boolean;
  },
): Promise<void> {
  const { routing } = input;
  if (routing.handoffDecisionId !== undefined) {
    await tx
      .update(routingDecisions)
      .set({ bookingId: input.bookingId })
      .where(and(eq(routingDecisions.id, routing.handoffDecisionId), isNull(routingDecisions.bookingId)));
  }
  if (routing.page === undefined) return;
  await tx.insert(routingDecisions).values({
    workspaceId: input.workspaceId,
    surfaceKind: 'booking_page',
    surfaceId: input.pageId,
    ruleId: routing.page.ruleId ?? null,
    qualified: routing.page.qualified ?? null,
    skipped: [...routing.page.skipped],
    hosts: input.narrowed && routing.hosts !== undefined ? [...routing.hosts] : null,
    bookingId: input.bookingId,
  });
}
