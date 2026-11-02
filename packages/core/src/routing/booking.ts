// Routing on a team booking page (spec 0043, AC-1609 to AC-1611): the hosts
// a form's hand off chose, else the page's own rules over the visitor's record
// facts and that form's answers and hidden fields (UTM tags, page, referrer),
// narrow the page's rotations to some of their members. Narrowing only ever
// chooses among hosts; when none of them is free the whole rotation picks, so
// a rule never refuses a booking.
import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { isHoldout, objectiveOf, PAGE_ROUTES, type RoutingObjective } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import type { PageRecord } from '../booking/slots.ts';
import { handoffFacts } from '../forms/public.ts';
import type { Team } from '../rotation/team.ts';
import { decideRoute, recordFactKeys } from './decide.ts';
import { recordFacts, type RecordFactObjects } from './facts.ts';
import { submissionDecision } from './forms.ts';
import { routeHostIds } from './hosts.ts';
import { readFit, NO_FIT, type Fit, type RankingFact } from './fit.ts';
import { readSegmentKey } from './segment.ts';
import { readSmartSettings, type SmartSettings } from './settings.ts';
import { NO_LIFT, readPageLift, type PageLift } from './stats.ts';

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
  /**
   * The cell this booking's learning counts in (spec 0037, AC-1370): `*` with
   * no segment attributes, `?` when the lead was missing a value.
   */
  readonly segmentKey: string;
  /** This decision was drawn into the holdout, so every seat picks plain fair (AC-1389). */
  readonly holdout: boolean;
  /** Each rotation's learned lift at the live model, by rotation id (AC-1369); empty while every cell is cold. */
  readonly lift: PageLift;
  /** The page's learning objective, which decides which cells were read (AC-1354). */
  readonly objective: RoutingObjective;
}

/** What routing chose for one team booking, before the hosts are picked. */
export interface BookingRouting {
  /** The hosts to pick among, when a hand off or a rule chose some. */
  readonly hosts?: ReadonlySet<string>;
  /** The form's decision this booking follows (its booking is filled in), when it came through a hand off. */
  readonly handoffDecisionId?: string;
  /** The page's own decision, recorded with the booking, when the page has rules and no hand off chose. */
  readonly page?: { readonly ruleId?: string; readonly qualified?: boolean; readonly skipped: readonly string[] };
  /**
   * The id the page's own decision row will take, minted here so the holdout
   * draw can hash it before the ranking runs (AC-1389) and a replay of the
   * same booking draws the same way.
   */
  readonly pageDecisionId?: string;
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
    /** The page's rotations, for the lift each seat reads (spec 0037, AC-1369). */
    readonly rotationIds?: readonly string[];
  },
): Promise<BookingRouting> {
  // Minted before anything is read, so the holdout draw can hash the id of the very row that will carry the
  // snapshot (AC-1389): the hand off's row when its hosts win, else this page's own row.
  const pageDecisionId = randomUUID();
  const handoff =
    input.submissionId === undefined ? undefined : await handoffHosts(tx, input.submissionId, input.page.id);
  const handoffWins = handoff?.hosts !== undefined;
  const smart = await readBookingSmart(tx, {
    ...input,
    decisionId: handoffWins ? handoff.decisionId : pageDecisionId,
  });
  if (handoffWins) {
    return { hosts: handoff.hosts, handoffDecisionId: handoff.decisionId, ...(smart === undefined ? {} : { smart }) };
  }
  const handed = {
    pageDecisionId,
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
 * The smart ranking's inputs for one booking (AC-1361 to AC-1363, AC-1369,
 * AC-1370, AC-1389), read before any lock. A question the page files onto a
 * fit link's field counts as the lead's answer (AC-1362); a handing form's
 * answer was already filed onto that field at submit, so the record read
 * picks it up. Mode `off` reads the segment and stops, so a workspace that
 * turns Learn on later already has cells; a holdout skips the lift read, and
 * so does a workspace whose model is still 0.
 */
async function readBookingSmart(
  tx: WorkspaceTx,
  input: {
    readonly page: PageRecord;
    readonly objects: RecordFactObjects;
    readonly email: string;
    readonly answers?: Readonly<Record<string, unknown>>;
    readonly memberIds?: readonly string[];
    readonly rotationIds?: readonly string[];
    /** The decision whose id the holdout draw hashes (AC-1389). */
    readonly decisionId: string;
  },
): Promise<BookingSmart | undefined> {
  const memberIds = input.memberIds ?? [];
  if (memberIds.length < 2) return undefined;
  const settings = await readSmartSettings(tx);
  const objective = objectiveOf(input.page.routingObjective);
  // Drawn once, before anything else is read, so the draw can never depend on who happened to be free (AC-1389),
  // and only in Learn: a holdout exists to keep **learning** honest, and Fit makes no learned claim to check, so
  // drawing there would cost a tenth of the fit preference for a comparison nothing reads. Noted for /architect:
  // AC-1389 words the holdout as a share of every ranked decision.
  const holdout = settings.mode === 'learn' && isHoldout(input.decisionId, settings.holdoutPercent);
  const filedOn = new Map(
    input.page.questions.flatMap((question) =>
      question.filedOn === undefined ? [] : [[question.key, question.filedOn.attributeId] as const],
    ),
  );
  const answers = input.answers ?? {};
  // The segment is stamped on every ranked decision, whatever the mode (AC-1370): a workspace that turns Learn on
  // later then already has cells to warm, rather than starting from nothing.
  const segmentKey = await readSegmentKey(tx, {
    attributeIds: settings.segmentAttributeIds,
    objects: input.objects,
    email: input.email,
    answers,
    filedOn,
  });
  if (settings.mode === 'off') {
    return { settings, fit: NO_FIT, facts: [], segmentKey, holdout, lift: NO_LIFT, objective };
  }
  const fit =
    settings.fit.length === 0
      ? NO_FIT
      : await readFit(tx, {
          links: settings.fit,
          objects: input.objects,
          email: input.email,
          answers,
          filedOn,
          memberIds,
        });
  // The lift only matters in Learn, and only when a model has been trained; a holdout picks plain fair anyway.
  const lift =
    settings.mode !== 'learn' || holdout
      ? NO_LIFT
      : await readPageLift(tx, {
          pageId: input.page.id,
          rotationIds: input.rotationIds ?? [],
          segmentKey,
          objective,
          modelVersion: settings.modelVersion,
        });
  return { settings, fit, facts: fit.facts, segmentKey, holdout, lift, objective };
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
  // The holdout draw and the cell (AC-1389, AC-1370), kept only on the row that carries the snapshot: the nightly
  // run reads them through the partial index, so a row with no snapshot was never ranked and never counts.
  const drawn = routing.smart === undefined ? null : routing.smart.holdout;
  const segmentKey = routing.smart?.segmentKey ?? null;
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
        ...(routing.page === undefined && snapshot !== null ? { snapshot, holdout: drawn, segmentKey } : {}),
      })
      .where(and(eq(routingDecisions.id, routing.handoffDecisionId), isNull(routingDecisions.bookingId)));
  }
  if (routing.page === undefined) return;
  await tx
    .insert(routingDecisions)
    .values({
      workspaceId: input.workspaceId,
      // The id the holdout draw hashed (AC-1389): a replay of this booking hashes the same one.
      ...(routing.pageDecisionId === undefined ? {} : { id: routing.pageDecisionId }),
      surfaceKind: 'booking_page',
      surfaceId: input.pageId,
      ruleId: routing.page.ruleId ?? null,
      qualified: routing.page.qualified ?? null,
      skipped: [...routing.page.skipped],
      hosts: input.narrowed && routing.hosts !== undefined ? [...routing.hosts] : null,
      bookingId: input.bookingId,
      facts: facts.length === 0 ? null : facts,
      snapshot,
      ...(snapshot === null ? {} : { holdout: drawn, segmentKey }),
    })
    .onConflictDoNothing();
}
