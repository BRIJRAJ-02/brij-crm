// Routing › Test (spec 0037, AC-1392): runs one surface's rules on typed answers and an email, and answers the
// decision it would make, for holders of `routing.manage`. A form's rules (its live version's, else its draft's) read
// the answers and hidden fields only, as at submit; a team page's also read what the CRM knows of the email, resolved
// under the caller's own scope: a field hidden from them reads as unreadable, so its rules are skipped.
// Nothing is stored and no slot is checked; a run that names an email writes one `routing.tested` audit row, since
// it shows what the CRM knows about that address.
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  FORM_ROUTES,
  FormAfter,
  isRecordFact,
  KNOWN_FACT,
  KNOWN_VALUES,
  PAGE_ROUTES,
  requiredSkills,
  RoutingRules,
  type RoutingFallback,
  type RoutingRule,
  type RoutingTestInput,
  type RoutingTestResult,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import type { EngineScope } from '../access/mint.ts';
import { isOpen } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { refuse } from '../engine/refusals.ts';
import { writeAudit } from '../members/audit.ts';
import { decideRoute, recordFactKeys } from './decide.ts';
import { recordFacts } from './facts.ts';
import { routeHostIds } from './hosts.ts';
import { fieldsSeen, ruleFields } from './seen.ts';

const { bookingPages, members, objects, routingSkills } = schema;

const SURFACE_MISSING = 'That form or page doesn’t exist any more.';

interface FormRow extends Record<string, unknown> {
  readonly routing: unknown;
  readonly after: unknown;
}

/** A form's rules and its After someone sends it: its live version's, else its draft's. */
async function formRules(tx: WorkspaceTx, formId: string) {
  const found = await tx.execute<FormRow>(sql`
    select v.document -> 'routing' as routing, v.document -> 'after' as after
    from forms f
    join form_versions v on v.workspace_id = f.workspace_id and v.id = coalesce(f.live_version_id, f.draft_version_id)
    where f.id = ${formId}::uuid and f.status <> 'archived'
  `);
  const [row] = found.rows;
  if (row === undefined) throw refuse('NOT_FOUND', SURFACE_MISSING);
  const rules: readonly RoutingRule[] = RoutingRules.safeParse(row.routing).data?.rules ?? [];
  return { rules, after: FormAfter.safeParse(row.after).data };
}

/** Names of members and skills, and of a page, in two short reads. */
async function namesOf(tx: WorkspaceTx, memberIds: readonly string[], skillIds: readonly string[]) {
  const people =
    memberIds.length === 0
      ? []
      : await tx
          .select({ id: members.id, name: members.name })
          .from(members)
          .where(inArray(members.id, [...memberIds]));
  const skills =
    skillIds.length === 0
      ? []
      : await tx
          .select({ id: routingSkills.id, name: routingSkills.name })
          .from(routingSkills)
          .where(inArray(routingSkills.id, [...skillIds]));
  return {
    people: memberIds.map((id) => ({ id, name: people.find((each) => each.id === id)?.name ?? '' })),
    skills: skillIds.map((id) => ({ id, name: skills.find((each) => each.id === id)?.name ?? '' })),
  };
}

async function pageName(tx: WorkspaceTx, pageId: string): Promise<{ readonly id: string; readonly name: string }> {
  const [page] = await tx.select({ title: bookingPages.title }).from(bookingPages).where(eq(bookingPages.id, pageId));
  return { id: pageId, name: page?.title ?? '' };
}

/**
 * The record facts of a team page's rules for `email`, as the caller may see them: fields hidden from them are
 * unreadable (their rules skipped, AC-1392).
 */
async function callerFacts(tx: WorkspaceTx, scope: EngineScope, rules: readonly RoutingRule[], email: string) {
  const keys = recordFactKeys(rules);
  const [people] = await tx.select({ id: objects.id }).from(objects).where(eq(objects.standardKey, 'people'));
  const [companies] = await tx.select({ id: objects.id }).from(objects).where(eq(objects.standardKey, 'companies'));
  if (people === undefined || companies === undefined) {
    return { facts: {}, unreadable: new Set(keys) };
  }
  // Fields first: one the caller can't see is never read.
  const unreadable = new Set<string>();
  if (!isOpen(scope.access)) {
    const read = rules.flatMap(ruleFields);
    const seen = await fieldsSeen(tx, scope.access, read);
    for (const key of keys) {
      const attributeId = key.split('.')[1];
      if (key !== KNOWN_FACT && attributeId !== undefined && !seen.has(attributeId)) unreadable.add(key);
    }
  }
  const found = await recordFacts(
    tx,
    { people: people.id, companies: companies.id },
    email,
    keys.filter((key) => !unreadable.has(key)),
  );
  return { facts: found.facts, unreadable: new Set([...unreadable, ...found.unreadable]) };
}

/** Runs a surface's rules on typed answers and an email (AC-1392), storing nothing but the audit row. */
export async function routingTest(
  scope: EngineScope,
  input: Pick<RoutingTestInput, 'surface' | 'answers' | 'email'>,
): Promise<RoutingTestResult> {
  requirePermission(scope, 'routing.manage');
  const email = input.email?.trim().toLowerCase();
  return inWorkspace(scope, async (tx) => {
    let rules: readonly RoutingRule[];
    let fallback: RoutingFallback;
    let pageId: string | undefined;
    let facts: Readonly<Record<string, unknown>> = input.answers;
    let unreadable: ReadonlySet<string>;
    let known: RoutingTestResult['known'];
    if (input.surface.kind === 'form') {
      const form = await formRules(tx, input.surface.formId);
      rules = form.rules;
      unreadable = new Set(rules.flatMap((rule) => rule.when.rules.map((each) => each.key)).filter(isRecordFact));
      fallback =
        form.after?.kind === 'booking'
          ? {
              kind: 'page',
              pageId: form.after.bookingPageId,
              name: (await pageName(tx, form.after.bookingPageId)).name,
            }
          : { kind: form.after?.kind === 'redirect' ? 'redirect' : 'message' };
    } else {
      const [page] = await tx
        .select({ id: bookingPages.id, routing: bookingPages.routing, kind: bookingPages.kind })
        .from(bookingPages)
        .where(and(eq(bookingPages.id, input.surface.pageId), isNull(bookingPages.deletedAt)));
      if (page === undefined) throw refuse('NOT_FOUND', SURFACE_MISSING);
      pageId = page.id;
      rules = RoutingRules.safeParse(page.routing).data?.rules ?? [];
      fallback = { kind: 'rotation' };
      if (email === undefined || email === '') {
        unreadable = new Set();
      } else {
        const read = await callerFacts(tx, scope, rules, email);
        // The page's own answers, then what the CRM knows: as at booking, a record fact is never typed over.
        facts = { ...input.answers, ...read.facts };
        unreadable = read.unreadable;
        const value = read.facts[KNOWN_FACT];
        known = KNOWN_VALUES.find((each) => each === value);
      }
    }
    const decision = decideRoute(rules, facts, {
      routes: input.surface.kind === 'form' ? FORM_ROUTES : PAGE_ROUTES,
      unreadable,
    });
    const place = (id: string) => rules.findIndex((rule) => rule.id === id) + 1;
    const route = decision.route;
    let routeView: RoutingTestResult['route'];
    if (route !== undefined) {
      const target = route.kind === 'book' ? route.bookingPageId : route.kind === 'hosts' ? pageId : undefined;
      const hosts =
        target === undefined || (route.kind !== 'book' && route.kind !== 'hosts')
          ? undefined
          : await routeHostIds(tx, target, route.hosts);
      const skillIds = route.kind === 'book' || route.kind === 'hosts' ? [...(requiredSkills(route.hosts) ?? [])] : [];
      const names = await namesOf(tx, hosts ?? [], skillIds);
      routeView = {
        kind: route.kind,
        ...(route.kind === 'book' ? { page: await pageName(tx, route.bookingPageId) } : {}),
        ...(route.kind === 'book' || route.kind === 'message' ? { message: route.message } : {}),
        ...(route.kind === 'redirect' ? { url: route.url } : {}),
        hosts: names.people,
        skills: names.skills,
        wholeRotation: skillIds.length > 0 && hosts === undefined,
      };
    }
    if (email !== undefined && email !== '') {
      await writeAudit(tx, scope.workspaceId, scope.actor, {
        action: 'routing.tested',
        targetType: 'workspace',
        targetId: scope.workspaceId,
        after: {
          surface: input.surface.kind,
          surfaceId: input.surface.kind === 'form' ? input.surface.formId : input.surface.pageId,
          email,
        },
      });
    }
    return {
      ...(decision.rule === undefined
        ? {}
        : {
            rule: {
              id: decision.rule.id,
              position: place(decision.rule.id),
              ...(decision.rule.name === undefined ? {} : { name: decision.rule.name }),
            },
          }),
      ...(decision.qualified === undefined ? {} : { qualified: decision.qualified }),
      skipped: decision.skipped.map((id) => `Rule ${String(place(id))}`),
      ...(routeView === undefined ? {} : { route: routeView }),
      ...(decision.rule === undefined ? { fallback } : {}),
      ...(known === undefined ? {} : { known }),
    };
  });
}
