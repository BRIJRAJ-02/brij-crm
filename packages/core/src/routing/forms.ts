// A form's routing at submit (spec 0043, AC-1604, AC-1606, AC-1607): the
// live version's rules tried over the checked answers and the visit's hidden
// fields (UTM tags, page, referrer), one decision row stored in the
// submission's own transaction, and the route the visitor's next step
// follows. A form's rules never read the CRM, so record facts are unreadable
// here and a rule reading one is skipped.
import { and, eq } from 'drizzle-orm';
import {
  FORM_ROUTES,
  hiddenFacts,
  isRecordFact,
  type FormDocument,
  type Route,
  type RoutingStep,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { decideRoute } from './decide.ts';

const { routingDecisions } = schema;

/** What a submission's routing needs: where it is, the live document, and the stored submission's answers and hidden fields. */
export interface SubmissionRouting {
  readonly workspaceId: string;
  readonly formId: string;
  readonly submissionId: string;
  readonly document: Pick<FormDocument, 'routing'>;
  readonly answers: Readonly<Record<string, unknown>>;
  /**
   * Where the visit came from, as the submission keeps it: its context (`SubmissionContext`), then its older hidden
   * fields (`SubmitHidden`). Rules read the UTM tags, the page and the referrer as `hidden.<name>`.
   */
  readonly hidden?: unknown;
  readonly context?: unknown;
}

/**
 * Decides a stored submission's route and records the decision (AC-1607).
 * Answers the matching rule's route, or undefined for the fallback (the
 * form's After someone sends it). A form with no rules records nothing. One
 * decision per submission (migration 0088): when one is stored already, it
 * stands and its route is answered, so a submission never decides twice.
 */
export async function routeSubmission(tx: WorkspaceTx, input: SubmissionRouting): Promise<Route | undefined> {
  const { rules } = input.document.routing;
  if (rules.length === 0) return undefined;
  const unreadable = new Set(rules.flatMap((rule) => rule.when.rules.map((each) => each.key)).filter(isRecordFact));
  const decision = decideRoute(
    rules,
    { ...input.answers, ...hiddenFacts(input.hidden, input.context) },
    { routes: FORM_ROUTES, unreadable },
  );
  const route = decision.route;
  const stored = await tx
    .insert(routingDecisions)
    .values({
      workspaceId: input.workspaceId,
      surfaceKind: 'form',
      surfaceId: input.formId,
      ruleId: decision.rule?.id ?? null,
      qualified: decision.qualified ?? null,
      skipped: [...decision.skipped],
      submissionId: input.submissionId,
      routedPageId: route?.kind === 'book' ? route.bookingPageId : null,
      hosts: route?.kind === 'book' && route.hosts !== undefined ? [...route.hosts] : null,
    })
    .onConflictDoNothing()
    .returning({ id: routingDecisions.id });
  return stored.length > 0 ? route : storedRoute(tx, input.document, input.submissionId);
}

/** The decision stored for a submission, if any: its rule, page and hosts. */
export async function submissionDecision(
  tx: WorkspaceTx,
  submissionId: string,
): Promise<
  | {
      readonly id: string;
      readonly ruleId: string | null;
      readonly routedPageId: string | null;
      readonly hosts: readonly string[] | null;
      readonly qualified: boolean | null;
      readonly steps: unknown;
    }
  | undefined
> {
  const [row] = await tx
    .select({
      id: routingDecisions.id,
      ruleId: routingDecisions.ruleId,
      routedPageId: routingDecisions.routedPageId,
      hosts: routingDecisions.hosts,
      qualified: routingDecisions.qualified,
      steps: routingDecisions.steps,
    })
    .from(routingDecisions)
    .where(and(eq(routingDecisions.surfaceKind, 'form'), eq(routingDecisions.submissionId, submissionId)))
    .limit(1);
  return row;
}

/** The route a stored submission was given (a retry answers the same next step), from its decision and the live rules. */
export async function storedRoute(
  tx: WorkspaceTx,
  document: Pick<FormDocument, 'routing'>,
  submissionId: string,
): Promise<Route | undefined> {
  const decision = await submissionDecision(tx, submissionId);
  if (decision?.ruleId === null || decision === undefined) return undefined;
  return document.routing.rules.find((rule) => rule.id === decision.ruleId)?.then;
}

/**
 * Records what the free time check did (spec 0037, AC-1358) on a submission's decision: its steps, and the page the
 * visitor was sent to in the end (null when none: they read "someone will contact you"), its hosts kept only when
 * that is still the page the rule chose. A form with no rules has no decision yet, so one is written here, rule null,
 * so every step shows in Decisions.
 */
export async function recordSteps(
  tx: WorkspaceTx,
  input: {
    readonly workspaceId: string;
    readonly formId: string;
    readonly submissionId: string;
    readonly steps: readonly RoutingStep[];
    readonly routedPageId: string | null;
    readonly keepHosts: boolean;
  },
): Promise<void> {
  const steps = input.steps.map((step) => ({ ...step }));
  const updated = await tx
    .update(routingDecisions)
    .set({
      steps,
      routedPageId: input.routedPageId,
      ...(input.keepHosts ? {} : { hosts: null }),
    })
    .where(and(eq(routingDecisions.surfaceKind, 'form'), eq(routingDecisions.submissionId, input.submissionId)))
    .returning({ id: routingDecisions.id });
  if (updated.length > 0) return;
  await tx
    .insert(routingDecisions)
    .values({
      workspaceId: input.workspaceId,
      surfaceKind: 'form',
      surfaceId: input.formId,
      ruleId: null,
      submissionId: input.submissionId,
      routedPageId: input.routedPageId,
      steps,
    })
    .onConflictDoNothing();
}
