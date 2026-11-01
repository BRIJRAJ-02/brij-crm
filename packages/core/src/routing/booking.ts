// Routing on a team booking page (spec 0043, AC-1609 to AC-1611): the hosts
// a form's hand off chose, else the page's own rules over the visitor's record
// facts and that form's answers and hidden fields (UTM tags, page, referrer),
// narrow the page's rotations to some of their members. Narrowing only ever
// chooses among hosts; when none of them is free the whole rotation picks, so
// a rule never refuses a booking.
import { and, eq, isNull } from 'drizzle-orm';
import { PAGE_ROUTES } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import type { PageRecord } from '../booking/slots.ts';
import { handoffFacts } from '../forms/public.ts';
import type { Team } from '../rotation/team.ts';
import { decideRoute, recordFactKeys } from './decide.ts';
import { recordFacts, type RecordFactObjects } from './facts.ts';
import { submissionDecision } from './forms.ts';
import { routeHostIds } from './hosts.ts';
import { readFit, NO_FIT, type Fit, type RankingFact } from './fit.ts';
import { readSmartSettings, type SmartSettings } from './settings.ts';

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

/**
 * What the smart ranking needs for this booking (spec 0037, AC-1361 to
 * AC-1363), read before the locks: the workspace's settings, each candidate's
 * fit, and the facts behind it, which the decision keeps.
 */
export interface BookingSmart {
  readonly settings: SmartSettings;
  readonly fit: Fit;
  readonly facts: readonly RankingFact[];
}

/** What routing chose for one team booking, before the hosts are picked. */
export interface BookingRouting {
  /** The hosts to pick among, when a hand off or a rule chose some. */
  readonly hosts?: ReadonlySet<string>;
  /** The form's decision this booking follows (its booking is filled in), when it came through a hand off. */
  readonly handoffDecisionId?: string;
  /** The page's own decision, recorded with the booking, when the page has rules and no hand off chose. */
  readonly page?: { readonly ruleId?: string; readonly qualified?: boolean; readonly skipped: readonly string[] };
  /** The smart ranking's inputs (AC-1361); absent when nobody could be ranked. */
  readonly smart?: BookingSmart;
}

/**
 * Routes one team booking (AC-1609, AC-1610): a hand off's hosts first;
 * else the page's rules over the guest's record facts (by the email they
 * typed, unchecked: an accepted risk, spec 0043 rationale) and the hand off's
 * answers and hidden fields. Read in the page's own workspace, before the
 * booking's locks.
 */
export async function routeBooking(
  tx: WorkspaceTx,
  input: {
    readonly page: PageRecord;
    readonly objects: RecordFactObjects;
    readonly email: string;
    readonly submissionId?: string;
    /** The booking's own answers to the page's questions (spec 0057), by question key (spec 0037, AC-1352). */
    readonly answers?: Readonly<Record<string, unknown>>;
    /** Everyone who could take a seat at this slot, for the smart ranking's fit (spec 0037, AC-1362). */
    readonly memberIds?: readonly string[];
  },
): Promise<BookingRouting> {
  const smart = await readBookingSmart(tx, input);
  const handoff =
    input.submissionId === undefined ? undefined : await handoffHosts(tx, input.submissionId, input.page.id);
  if (handoff?.hosts !== undefined) {
    return { hosts: handoff.hosts, handoffDecisionId: handoff.decisionId, ...(smart === undefined ? {} : { smart }) };
  }
  const handed = {
    ...(handoff === undefined ? {} : { handoffDecisionId: handoff.decisionId }),
    ...(smart === undefined ? {} : { smart }),
  };
  const rules = input.page.routingRules ?? [];
  // Both doors write a decision (spec 0037, AC-1357): a page with no rules records its fallback, the whole rotation.
  if (rules.length === 0) return { ...handed, page: { skipped: [] } };
  const fromForm = input.submissionId === undefined ? {} : await handoffFacts(tx, input.submissionId, input.page.id);
  const read = await recordFacts(tx, input.objects, input.email, recordFactKeys(rules));
  // The page's own answers after the form's: asked the same key, the page's answer wins, since it was given last.
  const decision = decideRoute(
    rules,
    { ...fromForm, ...(input.answers ?? {}), ...read.facts },
    { routes: PAGE_ROUTES, unreadable: read.unreadable },
  );
  const page = {
    ...(decision.rule === undefined ? {} : { ruleId: decision.rule.id }),
    ...(decision.qualified === undefined ? {} : { qualified: decision.qualified }),
    skipped: decision.skipped,
  };
  // Named hosts, or the members holding the required skills (spec 0037, AC-1356): none holding them, none narrowed.
  const hosts =
    decision.route?.kind === 'hosts' ? await routeHostIds(tx, input.page.id, decision.route.hosts) : undefined;
  return {
    ...handed,
    ...(hosts === undefined ? {} : { hosts: new Set(hosts) }),
    page,
  };
}

/**
 * The smart ranking's inputs for one booking (AC-1361 to AC-1363), read
 * before any lock: nothing at all for a workspace with no fit links and mode
 * `off`, so the plain path costs one small read. A question the page files
 * onto a fit link's field counts as the lead's answer (AC-1362); a handing
 * form's answer was already filed onto that field at submit, so the record
 * read picks it up.
 */
async function readBookingSmart(
  tx: WorkspaceTx,
  input: {
    readonly page: PageRecord;
    readonly objects: RecordFactObjects;
    readonly email: string;
    readonly answers?: Readonly<Record<string, unknown>>;
    readonly memberIds?: readonly string[];
  },
): Promise<BookingSmart | undefined> {
  const memberIds = input.memberIds ?? [];
  if (memberIds.length < 2) return undefined;
  const settings = await readSmartSettings(tx);
  if (settings.mode === 'off' || settings.fit.length === 0) {
    return { settings, fit: NO_FIT, facts: [] };
  }
  const filedOn = new Map(
    input.page.questions.flatMap((question) =>
      question.filedOn === undefined ? [] : [[question.key, question.filedOn.attributeId] as const],
    ),
  );
  const fit = await readFit(tx, {
    links: settings.fit,
    objects: input.objects,
    email: input.email,
    answers: input.answers ?? {},
    filedOn,
    memberIds,
  });
  return { settings, fit, facts: fit.facts };
}

/**
 * Records what routing did for a booking (AC-1607, AC-1611): the form's
 * decision gets its booking; the page's own decision is stored with it, one
 * per booking (migration 0088), `hosts` null when the routed hosts weren't
 * free and the rotation picked.
 */
export async function recordBookingRouting(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly pageId: string;
    readonly bookingId: string;
    readonly routing: BookingRouting;
    readonly narrowed: boolean;
    /** Every ranked seat's frozen numbers (AC-1373); absent when nothing was ranked. */
    readonly snapshot?: unknown;
  },
): Promise<void> {
  const { routing } = input;
  // The facts the ranking read (AC-1362): option ids only, each marked where it came from, never free text.
  const facts = (routing.smart?.facts ?? []).map((fact) => ({ ...fact }));
  const snapshot = input.snapshot ?? null;
  if (routing.handoffDecisionId !== undefined) {
    await tx
      .update(routingDecisions)
      .set({
        bookingId: input.bookingId,
        // A hand off's hosts win over the page's rules, so the page writes no decision of its own: the seat that
        // was ranked is explained from the form's row instead, which would otherwise have nothing to explain.
        ...(routing.page === undefined && facts.length > 0 ? { facts } : {}),
        ...(routing.page === undefined && snapshot !== null ? { snapshot } : {}),
      })
      .where(and(eq(routingDecisions.id, routing.handoffDecisionId), isNull(routingDecisions.bookingId)));
  }
  if (routing.page === undefined) return;
  await tx
    .insert(routingDecisions)
    .values({
      workspaceId: input.workspaceId,
      surfaceKind: 'booking_page',
      surfaceId: input.pageId,
      ruleId: routing.page.ruleId ?? null,
      qualified: routing.page.qualified ?? null,
      skipped: [...routing.page.skipped],
      hosts: input.narrowed && routing.hosts !== undefined ? [...routing.hosts] : null,
      bookingId: input.bookingId,
      facts: facts.length === 0 ? null : facts,
      snapshot,
    })
    .onConflictDoNothing();
}
