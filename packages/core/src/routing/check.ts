// Checking a surface's routes before they are kept (spec 0043, AC-1605,
// AC-1608): every booking page a form's rule sends to goes through the
// access door like After someone sends it, hosts only on a round robin page,
// and every host named must be in that page's rotations. A team page's rules
// may read only the record fields their writer can see.
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  isHiddenFact,
  namedHosts,
  NUMBER_OPS,
  requiredSkills,
  type RouteHosts,
  type RoutingRule,
} from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import type { EngineScope } from '../access/mint.ts';
import type { Access } from '../access/policy.ts';
import { workspaceAddressProblem } from '../booking/workspace-addresses.ts';
import { bookingTargetProblem } from '../booking/pages.ts';
import { refuseOn } from '../engine/refusals.ts';
import { fieldsSeen, ruleFields } from './seen.ts';

const { bookingPageRotations, bookingPages, rotationRoster, rotations, routingSkills } = schema;

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
    .select({ memberId: rotationRoster.memberId })
    .from(bookingPageRotations)
    .innerJoin(
      rotations,
      and(
        eq(rotations.workspaceId, bookingPageRotations.workspaceId),
        eq(rotations.id, bookingPageRotations.rotationId),
      ),
    )
    .innerJoin(
      rotationRoster,
      and(
        eq(rotationRoster.workspaceId, bookingPageRotations.workspaceId),
        eq(rotationRoster.rotationId, bookingPageRotations.rotationId),
      ),
    )
    .where(and(eq(bookingPageRotations.pageId, pageId), isNull(rotations.deletedAt)));
  return { kind: page.kind, members: new Set(rows.map((row) => row.memberId)) };
}

/**
 * Refuses hosts that aren't a round robin page's, or aren't in its rotations; and required skills (spec 0037,
 * AC-1356) the workspace doesn't hold.
 */
async function checkHosts(tx: WorkspaceTx, pageId: string, routeHosts: RouteHosts, name: string): Promise<void> {
  const pool = await pageHostPool(tx, pageId);
  if (pool === undefined) return;
  if (pool.kind !== 'round_robin') {
    throw refuseOn(
      'CONFIG_INVALID',
      `${name} picks people on a personal page. Pick people only on a team page.`,
      'routing',
    );
  }
  const skills = requiredSkills(routeHosts);
  if (skills !== undefined) {
    const found = await tx
      .select({ id: routingSkills.id })
      .from(routingSkills)
      .where(inArray(routingSkills.id, [...skills]));
    if (found.length !== new Set(skills).size) {
      throw refuseOn('CONFIG_INVALID', `${name} needs a skill that was deleted. Pick other skills.`, 'routing');
    }
    return;
  }
  const hosts = namedHosts(routeHosts) ?? [];
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
  const routeKey = (pageId: string, hosts: RouteHosts | undefined) => {
    const skills = requiredSkills(hosts);
    return skills === undefined
      ? `${pageId}|${[...(namedHosts(hosts) ?? [])].sort().join(',')}`
      : `${pageId}|skills:${[...skills].sort().join(',')}`;
  };
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
    // Hosts checked when the route is new or changed, and on publish: a host who left the rotation after the rule was
    // saved blocked every later autosave of the form, a label edit included (late trap #83). Publish still says so.
    if (rule.then.hosts !== undefined && (check === 'live' || !known.has(routeKey(pageId, rule.then.hosts)))) {
      await checkHosts(tx, pageId, rule.then.hosts, name);
    }
  }
}

/**
 * The record fields a team page's new or changed rules read must be ones the writer can see (security review, 23
 * October 2026): a rule over a field hidden from them would tell them each visitor's value by who took the booking.
 * Refused in words that never say whether the field exists. Rules kept exactly as they were stay, so someone who
 * can't see a field can still edit a page another admin set up.
 */
async function checkRuleFields(
  tx: WorkspaceTx,
  access: Access,
  rules: readonly RoutingRule[],
  before: readonly RoutingRule[],
): Promise<void> {
  const kept = new Set(before.map((rule) => JSON.stringify(rule)));
  // Each field read, with the first new or changed rule reading it.
  const read = new Map<string, number>();
  for (const [index, rule] of rules.entries()) {
    if (kept.has(JSON.stringify(rule))) continue;
    for (const attributeId of ruleFields(rule)) {
      if (!read.has(attributeId)) read.set(attributeId, index);
    }
  }
  if (read.size === 0) return;
  // Even for a reader nothing restricts: a field this workspace doesn't hold is never one they can use.
  const visible = await fieldsSeen(tx, access, [...read.keys()]);
  for (const [attributeId, index] of read) {
    const rule = rules[index];
    if (!visible.has(attributeId) && rule !== undefined) {
      throw refuseOn(
        'CONFIG_INVALID',
        `${ruleName(rule, index)} reads a field you can’t use. Pick another field.`,
        'routing',
      );
    }
  }
}

/**
 * A team page's routes (AC-1608): only on a round robin page, each naming members of its rotations, comparing the
 * visit's hidden fields as text, and reading only record fields the writer can see (`fields`, the rules before).
 */
export async function checkPageRoutes(
  tx: WorkspaceTx,
  pageId: string,
  rules: readonly RoutingRule[],
  fields: { readonly access: Access; readonly before: readonly RoutingRule[] },
): Promise<void> {
  // Always given, so no write path (a copy, an import) can keep a rule over a field its writer can't see.
  await checkRuleFields(tx, fields.access, rules, fields.before);
  const kept = new Set(fields.before.map((rule) => JSON.stringify(rule)));
  for (const [index, rule] of rules.entries()) {
    const name = ruleName(rule, index);
    if (rule.then.kind !== 'hosts') {
      throw refuseOn(
        'CONFIG_INVALID',
        `${name} needs people to pick from. A team page’s rules only choose hosts.`,
        'routing',
      );
    }
    // A visit's hidden fields hold text, as a form's publish check says too.
    if (rule.when.rules.some((condition) => isHiddenFact(condition.key) && NUMBER_OPS.includes(condition.op))) {
      throw refuseOn('CONFIG_INVALID', `${name} compares a hidden field as a number, but it holds text.`, 'routing');
    }
    // Only a new or changed rule's hosts: one a host has since left stays, as it is, for the page's other edits
    // (late trap #83); at booking time a host who left is passed over, the rotation's others taking the visit.
    if (!kept.has(JSON.stringify(rule))) await checkHosts(tx, pageId, rule.then.hosts, name);
  }
}

/**
 * A form's redirects (spec 0056, AC-5610 to AC-5612): the `after` redirect and every routing rule's redirect may only
 * hold an address of our own that resolves inside this workspace; an address on any other site is not checked. The
 * first one that names a page of another workspace, or of none, is `CONFIG_INVALID`, on the field it came from.
 */
export async function checkFormAddresses(
  tx: WorkspaceTx,
  workspaceId: string,
  document: {
    readonly after: { readonly kind: string; readonly url?: string };
    readonly routing: { readonly rules: readonly RoutingRule[] };
  },
  origins: readonly string[],
): Promise<void> {
  if (document.after.kind === 'redirect' && document.after.url !== undefined) {
    const problem = await workspaceAddressProblem(tx, workspaceId, document.after.url, origins);
    if (problem !== undefined) throw refuseOn('CONFIG_INVALID', problem, 'after');
  }
  for (const [index, rule] of document.routing.rules.entries()) {
    if (rule.then.kind !== 'redirect') continue;
    const problem = await workspaceAddressProblem(tx, workspaceId, rule.then.url, origins);
    if (problem !== undefined)
      throw refuseOn('CONFIG_INVALID', `${ruleName(rule, index)} ${problem.toLowerCase()}`, 'routing');
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
