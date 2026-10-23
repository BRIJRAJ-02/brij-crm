// What a member sees of a team page's routing rules (spec 0043, AC-1608;
// spec 0009, hidden means absent). A rule that reads a person's or company's
// field hidden from the reader is absent from every answer they get: the page,
// the page list, a save's answer and the rule report. Their save keeps it as
// it was, in its place, since they never saw it to change, move or remove.
// Routing itself reads every rule on the server, so a page decides the same
// whoever saved it last. No public answer carries a rule at all.
import { inArray } from 'drizzle-orm';
import { RECORD_FACT, type RoutingRule } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { isOpen, type Access } from '../access/policy.ts';
import { attributeVisible } from '../access/visibility.ts';

const { attributes } = schema;

/** The fields a rule reads: the attribute id of each `person.<id>` and `company.<id>` condition. */
export function ruleFields(rule: RoutingRule): readonly string[] {
  return rule.when.rules.flatMap((condition) => {
    const attributeId = RECORD_FACT.exec(condition.key)?.[2];
    return attributeId === undefined ? [] : [attributeId];
  });
}

/**
 * Of `attributeIds`, the fields `access` may see: those row level security finds in this workspace and the
 * reader's policy shows. One query; an id found nowhere is never seen (fail closed).
 */
export async function fieldsSeen(
  tx: WorkspaceTx,
  access: Access,
  attributeIds: readonly string[],
): Promise<ReadonlySet<string>> {
  const ids = [...new Set(attributeIds)];
  if (ids.length === 0) return new Set();
  const found = await tx
    .select({ id: attributes.id, objectId: attributes.objectId, listId: attributes.listId })
    .from(attributes)
    .where(inArray(attributes.id, ids));
  return new Set(found.filter((attribute) => attributeVisible(access, attribute)).map((attribute) => attribute.id));
}

/** Whether a rule is hidden from a reader. */
export type UnseenRule = (rule: RoutingRule) => boolean;

/** No rule is hidden: a reader nothing restricts, or rules that read no field. */
export const NONE_UNSEEN: UnseenRule = () => false;

/**
 * Which of `rules` (one page's, or every page of a list) read a field hidden from `access`. A reader nothing
 * restricts sees every rule with no query, so a rule over a field another workspace's id names stays theirs to
 * remove; anyone else reads one query for every field the rules name.
 */
export async function unseenRules(tx: WorkspaceTx, access: Access, rules: readonly RoutingRule[]): Promise<UnseenRule> {
  if (isOpen(access)) return NONE_UNSEEN;
  const read = rules.flatMap(ruleFields);
  if (read.length === 0) return NONE_UNSEEN;
  const seen = await fieldsSeen(tx, access, read);
  return (rule) => ruleFields(rule).some((attributeId) => !seen.has(attributeId));
}

/** The rules a reader sees, in order. */
export function rulesSeen(rules: readonly RoutingRule[], unseen: UnseenRule): readonly RoutingRule[] {
  return rules.filter((rule) => !unseen(rule));
}

/**
 * A save's rules with the stored rules hidden from its writer put back, unchanged: each just after the rule it
 * followed, or after the nearest rule before that one the save keeps, else at the top, so it decides before and
 * after the same rules as far as the save allows. A rule sent under a hidden rule's id (a screen opened before rules
 * were hidden still holds it) stands as sent, through the same checks as any other.
 */
export function withUnseenRules(
  stored: readonly RoutingRule[],
  sent: readonly RoutingRule[],
  unseen: UnseenRule,
): readonly RoutingRule[] {
  const sentIds = new Set(sent.map((rule) => rule.id));
  const top: RoutingRule[] = [];
  const after = new Map<string, RoutingRule[]>();
  let anchor: string | undefined;
  for (const rule of stored) {
    if (sentIds.has(rule.id)) {
      anchor = rule.id;
    } else if (unseen(rule)) {
      const held = anchor === undefined ? top : (after.get(anchor) ?? []);
      held.push(rule);
      if (anchor !== undefined) after.set(anchor, held);
    }
  }
  return [...top, ...sent.flatMap((rule) => [rule, ...(after.get(rule.id) ?? [])])];
}
