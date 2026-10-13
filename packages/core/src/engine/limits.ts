// The one limits module (spec 0004, AC-16; the house rules: limits live in one
// place and refuse clearly, never truncate). Counts are read and moved under a
// row lock, so two concurrent creates can't both pass the last free slot.
// #38 later reads the numbers from the workspace's plan.
import { and, count, eq, isNull, sql } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import { checkId } from './ids.ts';
import { refuse, refuseAll } from './refusals.ts';
import type { EngineScope } from './scope.ts';

const { attributeOptions, attributes, lists, objects, validationRules, workspaceCounters } = schema;

/** The limits every workspace has today. */
export const LIMITS = {
  customObjects: 50,
  attributesPerParent: 250,
  optionsPerAttribute: 500,
  liveRecords: 1_000_000,
  lists: 500,
  entriesPerList: 1_000_000,
  /** Unfinished jobs members started, of kinds that count (spec 0008, AC-116). System jobs never count. */
  unfinishedJobs: 20,
  /** Items in one job (AC-116). */
  jobItems: 1_000_000,
  /** Rules on one attribute, its own only: rules elsewhere whose condition names it don't count (spec 0013, AC-252). */
  rulesPerAttribute: 20,
} as const;

/** One set of limits. */
export type Limits = { readonly [K in keyof typeof LIMITS]: number };

/** How long a deleted record can be restored before the purge removes it. */
export const RESTORE_WINDOW = '30 days';

/** The scope's limits: the defaults, lowered by the scope's own (tests; later the workspace's plan). */
export function limitsOf(scope: EngineScope): Limits {
  return { ...LIMITS, ...scope.limits };
}

/** Takes `amount` live record slots (or gives them back, when negative). */
export async function takeRecordSlots(tx: WorkspaceTx, scope: EngineScope, amount: number): Promise<void> {
  const [row] = await tx
    .select({ liveRecords: workspaceCounters.liveRecords })
    .from(workspaceCounters)
    .where(eq(workspaceCounters.workspaceId, scope.workspaceId))
    .for('update');
  if (row === undefined) throw new Error('The workspace has no counters row.');
  const limit = limitsOf(scope).liveRecords;
  if (amount > 0 && row.liveRecords + amount > limit) {
    throw refuse('LIMIT_REACHED', `This workspace holds at most ${limit.toLocaleString('en')} records.`);
  }
  await tx
    .update(workspaceCounters)
    .set({ liveRecords: sql`${workspaceCounters.liveRecords} + ${amount}` })
    .where(eq(workspaceCounters.workspaceId, scope.workspaceId));
}

/** Takes one custom object slot. */
export async function takeCustomObject(tx: WorkspaceTx, scope: EngineScope): Promise<void> {
  const [row] = await tx
    .select({ customObjects: workspaceCounters.customObjects })
    .from(workspaceCounters)
    .where(eq(workspaceCounters.workspaceId, scope.workspaceId))
    .for('update');
  if (row === undefined) throw new Error('The workspace has no counters row.');
  const limit = limitsOf(scope).customObjects;
  if (row.customObjects + 1 > limit) {
    throw refuse('LIMIT_REACHED', `This workspace holds at most ${String(limit)} custom objects.`);
  }
  await tx
    .update(workspaceCounters)
    .set({ customObjects: sql`${workspaceCounters.customObjects} + 1` })
    .where(eq(workspaceCounters.workspaceId, scope.workspaceId));
}

/** An attribute's parent: an object, or a list. */
export type AttributeParent = { readonly objectId: string } | { readonly listId: string };

/**
 * Locks an attribute's parent row (its object or list) for the rest of the
 * write, so attribute creates and moves on it take turns. Refuses
 * `NOT_FOUND` for a parent that doesn't exist or is archived, checked under
 * that lock, so an archive that commits first is seen.
 */
export async function lockAttributeParent(tx: WorkspaceTx, parent: AttributeParent): Promise<void> {
  const isObject = 'objectId' in parent;
  const missing = `That ${isObject ? 'object' : 'list'} does not exist.`;
  checkId(isObject ? parent.objectId : parent.listId, missing);
  const [locked] = isObject
    ? await tx
        .select({ archivedAt: objects.archivedAt })
        .from(objects)
        .where(eq(objects.id, parent.objectId))
        .for('update')
    : await tx.select({ archivedAt: lists.archivedAt }).from(lists).where(eq(lists.id, parent.listId)).for('update');
  if (locked === undefined || locked.archivedAt !== null) throw refuse('NOT_FOUND', missing);
}

/**
 * Refuses a new attribute when its object or list is full. Locks the parent
 * row, so concurrent adds take turns. Refuses `NOT_FOUND` for a parent that
 * doesn't exist or is archived (as reading its attributes does), checked
 * under that lock, so an archive that commits first is seen.
 */
export async function checkAttributeRoom(tx: WorkspaceTx, scope: EngineScope, parent: AttributeParent): Promise<void> {
  const isObject = 'objectId' in parent;
  await lockAttributeParent(tx, parent);
  const [row] = await tx
    .select({ n: count() })
    .from(attributes)
    .where(
      and(
        isObject ? eq(attributes.objectId, parent.objectId) : eq(attributes.listId, parent.listId),
        eq(attributes.isSystem, false),
      ),
    );
  const limit = limitsOf(scope).attributesPerParent;
  if ((row?.n ?? 0) + 1 > limit) {
    throw refuse('LIMIT_REACHED', `${isObject ? 'An object' : 'A list'} holds at most ${String(limit)} attributes.`);
  }
}

/** Takes one list slot. */
export async function takeList(tx: WorkspaceTx, scope: EngineScope): Promise<void> {
  const [row] = await tx
    .select({ lists: workspaceCounters.lists })
    .from(workspaceCounters)
    .where(eq(workspaceCounters.workspaceId, scope.workspaceId))
    .for('update');
  if (row === undefined) throw new Error('The workspace has no counters row.');
  const limit = limitsOf(scope).lists;
  if (row.lists + 1 > limit) throw refuse('LIMIT_REACHED', `This workspace holds at most ${String(limit)} lists.`);
  await tx
    .update(workspaceCounters)
    .set({ lists: sql`${workspaceCounters.lists} + 1` })
    .where(eq(workspaceCounters.workspaceId, scope.workspaceId));
}

/**
 * Takes `amount` entry slots in a list (or gives them back, when negative).
 * The list row stays locked for the rest of the transaction, so adds to one
 * list take turns. An entry whose record is in the trash keeps its slot until
 * the purge removes it, so a restore never finds its list full.
 */
export async function takeEntrySlots(
  tx: WorkspaceTx,
  scope: EngineScope,
  listId: string,
  amount: number,
): Promise<void> {
  const [row] = await tx.select({ entryCount: lists.entryCount }).from(lists).where(eq(lists.id, listId)).for('update');
  if (row === undefined) throw refuse('NOT_FOUND', 'That list does not exist.');
  const limit = limitsOf(scope).entriesPerList;
  if (amount > 0 && row.entryCount + amount > limit) {
    throw refuse('LIMIT_REACHED', `A list holds at most ${limit.toLocaleString('en')} entries.`);
  }
  await tx
    .update(lists)
    .set({ entryCount: sql`${lists.entryCount} + ${amount}` })
    .where(eq(lists.id, listId));
}

/**
 * Refuses a new option when its attribute is full. Locks the attribute row
 * (`no key update`, so value writes' foreign key checks never wait on it), so
 * concurrent adds and restores take turns.
 */
export async function checkOptionRoom(tx: WorkspaceTx, scope: EngineScope, attributeId: string): Promise<void> {
  await tx.select({ id: attributes.id }).from(attributes).where(eq(attributes.id, attributeId)).for('no key update');
  const [row] = await tx
    .select({ n: count() })
    .from(attributeOptions)
    .where(and(eq(attributeOptions.attributeId, attributeId), isNull(attributeOptions.archivedAt)));
  const limit = limitsOf(scope).optionsPerAttribute;
  if ((row?.n ?? 0) + 1 > limit) {
    throw refuse('LIMIT_REACHED', `An attribute holds at most ${String(limit)} options.`);
  }
}

/**
 * The workspace's custom objects as the limit counts them (archived ones keep
 * their slot), read from the counters row `takeCustomObject` moves, so a
 * meter shows exactly what the next create is checked against (spec 0012,
 * AC-243).
 */
export async function countCustomObjects(tx: WorkspaceTx, scope: EngineScope): Promise<number> {
  const [row] = await tx
    .select({ customObjects: workspaceCounters.customObjects })
    .from(workspaceCounters)
    .where(eq(workspaceCounters.workspaceId, scope.workspaceId));
  return row?.customObjects ?? 0;
}

/**
 * Each object's attributes as `checkAttributeRoom` counts them (non system,
 * archived included), counted by Postgres, for a principal who sees every
 * attribute (the open policy).
 */
export async function countAttributesByObject(
  tx: WorkspaceTx,
  scope: EngineScope,
): Promise<ReadonlyMap<string, number>> {
  const rows = await tx
    .select({ objectId: attributes.objectId, n: count() })
    .from(attributes)
    .where(
      and(
        eq(attributes.workspaceId, scope.workspaceId),
        sql`${attributes.objectId} is not null`,
        eq(attributes.isSystem, false),
      ),
    )
    .groupBy(attributes.objectId);
  return new Map(rows.flatMap((row) => (row.objectId === null ? [] : [[row.objectId, row.n] as const])));
}

/**
 * Each object's attributes as `checkAttributeRoom` counts them (non system,
 * archived included), one row per attribute, so a caller under field rules
 * can count only the ones its principal may see (spec 0012, AC-243).
 */
export function objectAttributeRows(
  tx: WorkspaceTx,
  scope: EngineScope,
): Promise<{ readonly id: string; readonly objectId: string | null }[]> {
  return tx
    .select({ id: attributes.id, objectId: attributes.objectId })
    .from(attributes)
    .where(
      and(
        eq(attributes.workspaceId, scope.workspaceId),
        sql`${attributes.objectId} is not null`,
        eq(attributes.isSystem, false),
      ),
    );
}

/**
 * Refuses `LIMIT_REACHED` on `rules` when an attribute holds more than its
 * limit of rules after a rule write (spec 0013, AC-252): `count(*)` of its own
 * rules, never `rule_count`, which also counts rules naming it. Runs after the
 * write, inside it, so the refusal rolls the rules back.
 */
export async function checkRuleRoom(
  tx: WorkspaceTx,
  scope: EngineScope,
  objectId: string,
  attributeId: string,
): Promise<void> {
  const [row] = await tx
    .select({ held: count() })
    .from(validationRules)
    .where(and(eq(validationRules.objectId, objectId), eq(validationRules.attributeId, attributeId)));
  const limit = limitsOf(scope).rulesPerAttribute;
  if ((row?.held ?? 0) > limit) {
    throw refuseAll([
      { code: 'LIMIT_REACHED', message: `An attribute holds at most ${String(limit)} rules.`, field: 'rules' },
    ]);
  }
}
