// Relationships as the dialog makes and renames them (spec 0014, milestone
// 1): each side's API name derived from its title (`toApiSlug`), refusals on
// the side they are about, and both sides' definitions read back through the
// same access filter as `attributes.list`.
import { eq } from 'drizzle-orm';
import type { AttributeDefinition, Cardinality } from '@crm/contracts';
import { toApiSlug } from '@crm/contracts/values';
import { schema } from '@crm/db';
import { readOne } from '../attributes/attributes.ts';
import { checkId } from '../engine/ids.ts';
import { isRefusal, refuseOn } from '../engine/refusals.ts';
import { defineRelationship, updateRelationship } from '../engine/relationships.ts';
import type { EngineScope } from '../engine/scope.ts';
import type { AfterWrite } from '../engine/write.ts';
import { requirePermission } from '../access/check.ts';
import { inWorkspace } from '../access/run.ts';

const { objects } = schema;

/** One side of a new relationship: the object it sits on and its attribute's name there. */
export interface NewSide {
  readonly objectId: string;
  readonly title: string;
}

/** A new two way relationship, as the dialog sends it (spec 0014, AC-282). */
export interface CreateRelationshipInput {
  /** The UUID v7 the dialog minted when it opened: the retry key (AC-284). */
  readonly id: string;
  readonly cardinality: Cardinality;
  readonly from: NewSide;
  readonly to: NewSide;
}

/** A relationship as a write answers it: both sides' definitions, as the caller sees them. */
export interface RelationshipAnswer {
  readonly relationshipId: string;
  readonly cardinality: Cardinality;
  readonly from: AttributeDefinition;
  readonly to: AttributeDefinition;
}

/**
 * A refusal on a side's API name, moved to its name: the dialog never shows
 * API names, since they come from the name. A taken one says which object
 * already uses it.
 */
async function onSideName(scope: EngineScope, input: CreateRelationshipInput, error: unknown): Promise<never> {
  if (!isRefusal(error)) throw error;
  const { field, code, message } = error.refusal;
  const side = field?.split('.')[0];
  if ((side !== 'from' && side !== 'to') || field !== `${side}.apiSlug`) throw error;
  const objectId = input[side].objectId;
  if (code !== 'SLUG_TAKEN') throw refuseOn(code, message, `${side}.title`);
  const [object] = await inWorkspace(scope, (tx) =>
    tx.select({ pluralName: objects.pluralName }).from(objects).where(eq(objects.id, objectId)),
  );
  throw refuseOn(
    'SLUG_TAKEN',
    object === undefined
      ? 'That name is already used there. Pick another.'
      : `${object.pluralName} already has an attribute with this name. Pick another.`,
    `${side}.title`,
  );
}

/**
 * Creates a two way relationship (spec 0014, AC-282 to AC-284), both sides in
 * one write, each side's API name `toApiSlug(title, 'attribute')`, and
 * answers both definitions. The same create again (same id, same actor,
 * same ends) answers the relationship already made and writes nothing.
 * Refuses `FORBIDDEN` without `schema.manage`; `NOT_FOUND` for an object
 * missing, hidden or archived; `SLUG_TAKEN` and `CONFIG_INVALID` on the
 * side's name (`from.title`, `to.title`); `LIMIT_REACHED` naming the full
 * object; `ID_TAKEN`. A refused create leaves neither side behind.
 */
export async function createRelationship(
  scope: EngineScope,
  input: CreateRelationshipInput,
  hooks: readonly AfterWrite[] = [],
): Promise<RelationshipAnswer> {
  requirePermission(scope, 'schema.manage');
  const fromObjectId = checkId(input.from.objectId, 'That object does not exist.');
  const toObjectId = checkId(input.to.objectId, 'That object does not exist.');
  const fromTitle = input.from.title.trim();
  const toTitle = input.to.title.trim();
  const made = await defineRelationship(
    scope,
    {
      id: input.id,
      cardinality: input.cardinality,
      from: { objectId: fromObjectId, title: fromTitle, apiSlug: toApiSlug(fromTitle, 'attribute') },
      to: { objectId: toObjectId, title: toTitle, apiSlug: toApiSlug(toTitle, 'attribute') },
    },
    hooks,
  ).catch((error: unknown) => onSideName(scope, input, error));
  const toAttributeId = made.toAttributeId;
  if (toAttributeId === undefined) throw new Error('A two way relationship was made with one side.');
  const [from, to] = await Promise.all([
    readOne(scope, { attributeId: made.fromAttributeId, objectId: fromObjectId, listId: null }),
    readOne(scope, { attributeId: toAttributeId, objectId: toObjectId, listId: null }),
  ]);
  return { relationshipId: made.relationshipId, cardinality: input.cardinality, from, to };
}

/** New names for a relationship's sides (spec 0014, AC-307). */
export interface RenameRelationshipInput {
  readonly relationshipId: string;
  readonly fromTitle?: string | undefined;
  readonly toTitle?: string | undefined;
}

/**
 * Renames one or both sides of a relationship in one write (spec 0014,
 * AC-307) and answers both definitions. API names, objects and cardinality
 * never change. Refuses `FORBIDDEN` without `schema.manage`, `NOT_FOUND` for
 * one that is unknown, hidden or archived, and `CONFIG_INVALID` on the side
 * it names (empty, too long, or equal names on a self relationship).
 */
export async function renameRelationship(
  scope: EngineScope,
  input: RenameRelationshipInput,
  hooks: readonly AfterWrite[] = [],
): Promise<RelationshipAnswer> {
  requirePermission(scope, 'schema.manage');
  const ends = await updateRelationship(
    scope,
    { relationshipId: input.relationshipId, fromTitle: input.fromTitle, toTitle: input.toTitle },
    hooks,
  );
  const [from, to] = await Promise.all([
    readOne(scope, { attributeId: ends.from.attributeId, objectId: ends.from.objectId, listId: null }),
    readOne(scope, { attributeId: ends.to.attributeId, objectId: ends.to.objectId, listId: null }),
  ]);
  return { relationshipId: ends.relationshipId, cardinality: ends.cardinality, from, to };
}
