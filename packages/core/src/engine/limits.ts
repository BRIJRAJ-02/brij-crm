// The one limits module (spec 0004, AC-16; the house rules: limits live in one
// place and refuse clearly, never truncate). Counts are read and moved under a
// row lock, so two concurrent creates can't both pass the last free slot.
// #38 later reads the numbers from the workspace's plan.
import { and, count, eq, isNull, sql } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import { checkId } from './ids.ts';
import { refuse } from './refusals.ts';
import type { EngineScope } from './scope.ts';

const { attributeOptions, attributes, lists, objects, workspaceCounters } = schema;

/** The limits every workspace has today. */
export const LIMITS = {
  customObjects: 50,
  attributesPerParent: 250,
  optionsPerAttribute: 500,
  liveRecords: 1_000_000,
  lists: 500,
  entriesPerList: 1_000_000,
} as const;

/** One set of limits. */
export type Limits = { readonly [K in keyof typeof LIMITS]: number };

/** How long a deleted record can be restored before the purge removes it. */
export const RESTORE_WINDOW = '30 days';

function limitsOf(scope: EngineScope): Limits {
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
 * Refuses a new attribute when its object or list is full. Locks the parent
 * row, so concurrent adds take turns. Refuses a parent that doesn't exist.
 */
export async function checkAttributeRoom(tx: WorkspaceTx, scope: EngineScope, parent: AttributeParent): Promise<void> {
  const isObject = 'objectId' in parent;
  checkId(isObject ? parent.objectId : parent.listId, `That ${isObject ? 'object' : 'list'} does not exist.`);
  const locked = isObject
    ? await tx.select({ id: objects.id }).from(objects).where(eq(objects.id, parent.objectId)).for('update')
    : await tx.select({ id: lists.id }).from(lists).where(eq(lists.id, parent.listId)).for('update');
  if (locked.length === 0) throw refuse('NOT_FOUND', `That ${isObject ? 'object' : 'list'} does not exist.`);
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

/** Refuses a new option when its attribute is full. Locks the attribute row, so concurrent adds take turns. */
export async function checkOptionRoom(tx: WorkspaceTx, scope: EngineScope, attributeId: string): Promise<void> {
  await tx.select({ id: attributes.id }).from(attributes).where(eq(attributes.id, attributeId)).for('update');
  const [row] = await tx
    .select({ n: count() })
    .from(attributeOptions)
    .where(and(eq(attributeOptions.attributeId, attributeId), isNull(attributeOptions.archivedAt)));
  const limit = limitsOf(scope).optionsPerAttribute;
  if ((row?.n ?? 0) + 1 > limit) {
    throw refuse('LIMIT_REACHED', `An attribute holds at most ${String(limit)} options.`);
  }
}
