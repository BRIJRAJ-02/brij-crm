// Checking a surface's routes before they are kept (spec 0043, AC-1605,
// AC-1608): every booking page a form's rule sends to goes through the
// access door like After someone sends it, hosts only on a round robin page,
// and every host named must be in that page's rotations.
import { and, eq, isNull } from 'drizzle-orm';
import type { RoutingRule } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import type { EngineScope } from '../access/mint.ts';
import { bookingTargetProblem } from '../booking/pages.ts';
import { refuseOn } from '../engine/refusals.ts';

const { bookingPageRotations, bookingPages, rotationMembers, rotations } = schema;

/** A rule's name in a sentence: "Rule 2" or "Rule 2, “Enterprise”,". */
export function ruleName(rule: RoutingRule, index: number): string {
  return rule.name === undefined || rule.name === ''
    ? `Rule ${String(index + 1)}`
    : `Rule ${String(index + 1)}, “${rule.name}”,`;
}

/** The members of a page's live rotations (the hosts a route may narrow to), with the page's kind. */
export async function pageHostPool(
  tx: WorkspaceTx,
  pageId: string,
): Promise<{ readonly kind: string; readonly members: ReadonlySet<string> } | undefined> {
  const [page] = await tx
    .select({ kind: bookingPages.kind })
    .from(bookingPages)
    .where(and(eq(bookingPages.id, pageId), isNull(bookingPages.deletedAt)));
  if (page === undefined) return undefined;
  const rows = await tx
    .select({ memberId: rotationMembers.memberId })
    .from(bookingPageRotations)
    .innerJoin(
      rotations,
      and(
        eq(rotations.workspaceId, bookingPageRotations.workspaceId),
        eq(rotations.id, bookingPageRotations.rotationId),
      ),
    )
    .innerJoin(
      rotationMembers,
      and(
        eq(rotationMembers.workspaceId, bookingPageRotations.workspaceId),
        eq(rotationMembers.rotationId, bookingPageRotations.rotationId),
      ),
    )
    .where(and(eq(bookingPageRotations.pageId, pageId), isNull(rotations.deletedAt)));
  return { kind: page.kind, members: new Set(rows.map((row) => row.memberId)) };
}

/** Refuses hosts that aren't a round robin page's, or aren't in its rotations. */
async function checkHosts(tx: WorkspaceTx, pageId: string, hosts: readonly string[], name: string): Promise<void> {
  const pool = await pageHostPool(tx, pageId);
  if (pool === undefined) return;
  if (pool.kind !== 'round_robin') {
    throw refuseOn(
      'CONFIG_INVALID',
      `${name} picks people on a personal page. Pick people only on a team page.`,
      'routing',
    );
  }
  if (hosts.some((host) => !pool.members.has(host))) {
    throw refuseOn(
      'CONFIG_INVALID',
      `${name} picks someone who isn’t in the page’s rotation. Pick people from the rotation.`,
      'routing',
    );
  }
}

/**
 * A form's routes (AC-1605): `seen` on save (only pages newly named go
 * through the door, so others can still edit a form someone else set up),
 * `live` on publish (every page must take bookings now).
 */
export async function checkFormRoutes(
  tx: WorkspaceTx,
  scope: EngineScope,
  rules: readonly RoutingRule[],
  check: 'seen' | 'live',
  before: readonly RoutingRule[] = [],
): Promise<void> {
  // A route already set (its page and its hosts) stays for others to edit; a new page, or new hosts on a page, goes
  // through the door, so only someone who may use the page decides whose leads it gets.
  const routeKey = (pageId: string, hosts: readonly string[] | undefined) =>
    `${pageId}|${[...(hosts ?? [])].sort().join(',')}`;
  const known = new Set(
    before.flatMap((rule) => (rule.then.kind === 'book' ? [routeKey(rule.then.bookingPageId, rule.then.hosts)] : [])),
  );
  for (const [index, rule] of rules.entries()) {
    if (rule.then.kind !== 'book') continue;
    const name = ruleName(rule, index);
    const pageId = rule.then.bookingPageId;
    if (check === 'live' || !known.has(routeKey(pageId, rule.then.hosts))) {
      const problem = await bookingTargetProblem(tx, scope, pageId, check);
      if (problem !== undefined) {
        throw refuseOn(
          'CONFIG_INVALID',
          check === 'seen'
            ? `${name} sends visitors to a booking page you can’t use. Pick one you can see that is taking bookings.`
            : `${name} sends visitors to a booking page that is paused or gone. Pick another in Routing.`,
          'routing',
        );
      }
    }
    if (rule.then.hosts !== undefined) await checkHosts(tx, pageId, rule.then.hosts, name);
  }
}

/** A team page's routes (AC-1608): only on a round robin page, each naming members of its rotations. */
export async function checkPageRoutes(tx: WorkspaceTx, pageId: string, rules: readonly RoutingRule[]): Promise<void> {
  for (const [index, rule] of rules.entries()) {
    const name = ruleName(rule, index);
    if (rule.then.kind !== 'hosts') {
      throw refuseOn(
        'CONFIG_INVALID',
        `${name} needs people to pick from. A team page’s rules only choose hosts.`,
        'routing',
      );
    }
    await checkHosts(tx, pageId, rule.then.hosts, name);
  }
}

/** True when two rule lists differ (what an audit row is written for). */
export function rulesChanged(before: readonly RoutingRule[], after: readonly RoutingRule[]): boolean {
  return JSON.stringify(before) !== JSON.stringify(after);
}

/** The ids of rules added, changed or removed between two lists, for the audit row (spec 0043, AC-1616). */
export function changedRuleIds(before: readonly RoutingRule[], after: readonly RoutingRule[]): readonly string[] {
  const was = new Map(before.map((rule) => [rule.id, JSON.stringify(rule)]));
  const now = new Map(after.map((rule) => [rule.id, JSON.stringify(rule)]));
  return [...new Set([...was.keys(), ...now.keys()])].filter((id) => was.get(id) !== now.get(id));
}
