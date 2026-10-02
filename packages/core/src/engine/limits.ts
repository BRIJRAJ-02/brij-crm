// The one limits module (spec 0004, AC-16; the house rules: limits live in one
// place and refuse clearly, never truncate). Counts are read and moved under a
// row lock, so two concurrent creates can't both pass the last free slot.
// #38 later reads the numbers from the workspace's plan.
import { and, count, eq, isNull, sql } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import { refuse } from './refusals.ts';
import type { EngineScope } from './scope.ts';

const { attributeOptions, attributes, objects, workspaceCounters } = schema;

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

/** Refuses a new attribute when its object is full. Locks the object row, so concurrent adds take turns. */
export async function checkAttributeRoom(tx: WorkspaceTx, scope: EngineScope, objectId: string): Promise<void> {
  await tx.select({ id: objects.id }).from(objects).where(eq(objects.id, objectId)).for('update');
  const [row] = await tx
    .select({ n: count() })
    .from(attributes)
    .where(and(eq(attributes.objectId, objectId), eq(attributes.isSystem, false)));
  const limit = limitsOf(scope).attributesPerParent;
  if ((row?.n ?? 0) + 1 > limit) {
    throw refuse('LIMIT_REACHED', `An object holds at most ${String(limit)} attributes.`);
  }
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
