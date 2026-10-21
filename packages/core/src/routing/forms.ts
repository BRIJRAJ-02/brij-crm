// A form's routing at submit (spec 0043, AC-1604, AC-1606, AC-1607): the
// live version's rules tried over the checked answers, one decision row
// stored in the submission's own transaction, and the route the visitor's
// next step follows. A form's rules read answers only, so record facts are
// unreadable here and a rule reading one is skipped.
import { and, eq } from 'drizzle-orm';
import { FORM_ROUTES, isRecordFact, type FormDocument, type Route } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { decideRoute } from './decide.ts';

const { routingDecisions } = schema;

/** What a submission's routing needs: where it is, the live document, and the stored submission's answers. */
export interface SubmissionRouting {
  readonly workspaceId: string;
  readonly formId: string;
  readonly submissionId: string;
  readonly document: Pick<FormDocument, 'routing'>;
  readonly answers: Readonly<Record<string, unknown>>;
}

/**
 * Decides a stored submission's route and records the decision (AC-1607).
 * Answers the matching rule's route, or undefined for the fallback (the
 * form's After someone sends it). A form with no rules records nothing.
 */
export async function routeSubmission(tx: WorkspaceTx, input: SubmissionRouting): Promise<Route | undefined> {
  const { rules } = input.document.routing;
  if (rules.length === 0) return undefined;
  const unreadable = new Set(rules.flatMap((rule) => rule.when.rules.map((each) => each.key)).filter(isRecordFact));
  const decision = decideRoute(rules, input.answers, { routes: FORM_ROUTES, unreadable });
  const route = decision.route;
  await tx.insert(routingDecisions).values({
    workspaceId: input.workspaceId,
    surfaceKind: 'form',
    surfaceId: input.formId,
    ruleId: decision.rule?.id ?? null,
    qualified: decision.qualified ?? null,
    skipped: [...decision.skipped],
    submissionId: input.submissionId,
    routedPageId: route?.kind === 'book' ? route.bookingPageId : null,
    hosts: route?.kind === 'book' && route.hosts !== undefined ? [...route.hosts] : null,
  });
  return route;
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
