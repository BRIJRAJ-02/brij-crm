// An object's attributes as the tables and settings read them (spec 0005;
// spec 0012 widens them): the definitions behind the columns, with options
// inline, and the settings that create, edit, move, archive and restore
// them. Reads and writes go through the scope the access door made.
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { AttributeDefinition, AttributeOption, PickerAttributeType } from '@crm/contracts';
import { AttributeDefault, HUES, toApiSlug, type Hue } from '@crm/contracts/values';
import { schema, type WorkspaceTx } from '@crm/db';
import {
  archiveAttribute,
  defineAttribute,
  reorderAttribute,
  restoreAttribute,
  updateAttribute,
  type AttributeRef,
} from '../engine/definitions.ts';
import { checkId } from '../engine/ids.ts';
import { refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { ARCHIVED_BY } from '../engine/values.ts';
import type { AfterWrite } from '../engine/write.ts';
import { requirePermission } from '../access/check.ts';
import { inWorkspace } from '../access/run.ts';
import { objectLevel, readOnlyReason, visibleAttributes } from '../access/policy.ts';

const { attributeOptions, attributes, objects } = schema;

type AttributeRow = typeof attributes.$inferSelect & { readonly archivedBy: string | null };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const isHue = (hue: string): hue is Hue => (HUES as readonly string[]).includes(hue);

/** The types whose definitions carry their options inline. */
const OPTION_TYPES: readonly string[] = ['select', 'status'];

/** What one attribute's definition needs besides its row: the object it is on, and its options. */
interface DefinitionContext {
  readonly primaryAttributeId: string | null;
  readonly options: ReadonlyMap<string, readonly AttributeOption[]>;
  /** The far objects the caller may see, for `archivedBy`. */
  readonly canSeeObject: (objectId: string) => boolean;
}

function definitionOf(row: AttributeRow, context: DefinitionContext, readOnly?: string): AttributeDefinition {
  const parsedDefault = row.defaultValue === null ? undefined : AttributeDefault.safeParse(row.defaultValue);
  return {
    id: row.id,
    objectId: row.objectId ?? '',
    apiSlug: row.apiSlug,
    title: row.title,
    ...(row.description === null || row.description === '' ? {} : { description: row.description }),
    type: row.type,
    isMulti: row.isMulti,
    isRequired: row.isRequired,
    isUnique: row.isUnique,
    isSystem: row.isSystem,
    isPrimary: row.id === context.primaryAttributeId,
    config: isPlainObject(row.config) ? row.config : {},
    ...(parsedDefault?.success === true ? { defaultValue: parsedDefault.data } : {}),
    position: row.position,
    isArchived: row.archivedAt !== null || row.archivedBy !== null,
    // The far object is named only to a caller who may see it; to anyone else it is just archived.
    ...(row.archivedBy !== null && row.archivedAt === null && context.canSeeObject(row.archivedBy)
      ? { archivedBy: { objectId: row.archivedBy } }
      : {}),
    ...(OPTION_TYPES.includes(row.type) ? { options: [...(context.options.get(row.id) ?? [])] } : {}),
    ...(readOnly === undefined ? {} : { readOnly: { reason: readOnly } }),
  };
}

/**
 * The options of some select and status attributes, by attribute, in each
 * attribute's order, archived ones included (marked). A status stage's target
 * time comes back as whole days (`P<N>D`), the one unit settings offer.
 */
async function optionsOf(
  tx: WorkspaceTx,
  attributeIds: readonly string[],
): Promise<ReadonlyMap<string, readonly AttributeOption[]>> {
  if (attributeIds.length === 0) return new Map();
  const rows = await tx
    .select({
      id: attributeOptions.id,
      attributeId: attributeOptions.attributeId,
      label: attributeOptions.label,
      hue: attributeOptions.hue,
      position: attributeOptions.position,
      outcome: attributeOptions.outcome,
      targetDays: sql<
        number | null
      >`case when ${attributeOptions.targetTimeInStage} is null then null else floor(extract(epoch from ${attributeOptions.targetTimeInStage}) / 86400)::int end`,
      isArchived: sql<boolean>`${attributeOptions.archivedAt} is not null`,
    })
    .from(attributeOptions)
    .where(inArray(attributeOptions.attributeId, [...attributeIds]))
    .orderBy(asc(attributeOptions.attributeId), asc(attributeOptions.position), asc(attributeOptions.id));
  const byAttribute = new Map<string, AttributeOption[]>();
  for (const row of rows) {
    // The engine checks an option's hue when it is written; one outside the set is a broken invariant.
    if (!isHue(row.hue)) throw new Error(`Option ${row.id} has a hue outside the curated set.`);
    const option: AttributeOption = {
      id: row.id,
      label: row.label,
      hue: row.hue,
      position: row.position,
      isArchived: row.isArchived,
      ...(row.outcome === null ? {} : { outcome: row.outcome }),
      ...(row.targetDays === null ? {} : { targetTimeInStage: `P${String(row.targetDays)}D` }),
    };
    const list = byAttribute.get(row.attributeId);
    if (list === undefined) byAttribute.set(row.attributeId, [option]);
    else list.push(option);
  }
  return byAttribute;
}

const OBJECT_NOT_FOUND = 'That object does not exist.';
const ATTRIBUTE_NOT_FOUND = 'That attribute does not exist.';

/**
 * Refuses `NOT_FOUND` unless the object is live (not archived) in this
 * workspace and the caller may see it (spec 0009, AC-140); answers its plural
 * name and primary attribute, for a read only object's reason. Settings read
 * an archived object's attributes too (`includeArchived`).
 */
async function checkObjectFor(
  tx: WorkspaceTx,
  scope: EngineScope,
  objectId: string,
  includeArchived: boolean,
): Promise<{ readonly id: string; readonly pluralName: string; readonly primaryAttributeId: string | null }> {
  const [object] = await tx
    .select({ id: objects.id, pluralName: objects.pluralName, primaryAttributeId: objects.primaryAttributeId })
    .from(objects)
    .where(
      includeArchived
        ? and(eq(objects.workspaceId, scope.workspaceId), eq(objects.id, objectId))
        : and(eq(objects.workspaceId, scope.workspaceId), eq(objects.id, objectId), isNull(objects.archivedAt)),
    );
  if (object === undefined || objectLevel(scope.access, object.id) === 'none') {
    throw refuse('NOT_FOUND', OBJECT_NOT_FOUND);
  }
  return object;
}

/**
 * An object's live attributes, system ones included (marked `isSystem`), by
 * position, then when they were made, with select and status options inline.
 * Refuses `NOT_FOUND` for an object that doesn't exist here, is archived or
 * is hidden from the caller. Only the attributes the caller may see are
 * listed (spec 0009, AC-141), each with `readOnly` when they can't change it
 * (AC-142): the object's reason, else the field rule's, else the system's.
 * With `includeArchived` (settings, spec 0012) an archived object's
 * attributes are read too, and archived attributes are listed, marked
 * `isArchived`; a record reference whose far object is archived counts as
 * archived (`archivedBy`), everywhere.
 */
export async function listObjectAttributes(
  scope: EngineScope,
  objectId: string,
  options: { readonly includeArchived?: boolean } = {},
): Promise<AttributeDefinition[]> {
  const id = checkId(objectId, OBJECT_NOT_FOUND);
  const includeArchived = options.includeArchived === true;
  return inWorkspace(scope, async (tx) => {
    const object = await checkObjectFor(tx, scope, id, includeArchived);
    const rows = await tx
      .select({ attribute: attributes, archivedBy: ARCHIVED_BY })
      .from(attributes)
      // Row level security keeps the read to this workspace; the filter says so too (house style).
      .where(
        includeArchived
          ? and(eq(attributes.workspaceId, scope.workspaceId), eq(attributes.objectId, id))
          : and(
              eq(attributes.workspaceId, scope.workspaceId),
              eq(attributes.objectId, id),
              isNull(attributes.archivedAt),
            ),
      )
      .orderBy(asc(attributes.position), asc(attributes.createdAt), asc(attributes.id));
    const listed = visibleAttributes(
      scope.access,
      rows.flatMap(({ attribute, archivedBy }) =>
        includeArchived || archivedBy === null ? [{ ...attribute, archivedBy, objectId: id }] : [],
      ),
    );
    const context: DefinitionContext = {
      primaryAttributeId: object.primaryAttributeId,
      options: await optionsOf(
        tx,
        listed.filter((row) => OPTION_TYPES.includes(row.type)).map((row) => row.id),
      ),
      canSeeObject: (far) => objectLevel(scope.access, far) !== 'none',
    };
    return listed.map((row) =>
      definitionOf(
        row,
        context,
        readOnlyReason(scope.access, row, object) ?? (row.isSystem ? `${row.title} is set by the system.` : undefined),
      ),
    );
  });
}

/**
 * Some attributes' definitions, as the caller sees them, archived ones too,
 * in the order asked: one read per object they sit on. An attribute the
 * caller can't see (or one on a list) is left out.
 */
async function readDefinitions(scope: EngineScope, refs: readonly AttributeRef[]): Promise<AttributeDefinition[]> {
  // An end on an object the caller can't see is left out, object and all (spec 0009, AC-140).
  const objectIds = [
    ...new Set(
      refs.flatMap((ref) =>
        ref.objectId === null || objectLevel(scope.access, ref.objectId) === 'none' ? [] : [ref.objectId],
      ),
    ),
  ];
  const listed = await Promise.all(
    objectIds.map((objectId) => listObjectAttributes(scope, objectId, { includeArchived: true })),
  );
  const byId = new Map(listed.flat().map((definition) => [definition.id, definition]));
  return refs.flatMap((ref) => {
    const definition = byId.get(ref.attributeId);
    return definition === undefined ? [] : [definition];
  });
}

/** The one attribute a write changed, read back, or an error: a write answers what it made. */
async function readOne(scope: EngineScope, ref: AttributeRef): Promise<AttributeDefinition> {
  const [made] = await readDefinitions(scope, [ref]);
  // Hidden from the caller since it was made (a replay under new rules): unknown to them.
  if (made === undefined) throw refuse('NOT_FOUND', ATTRIBUTE_NOT_FOUND);
  return made;
}

/** A new attribute, as settings and the table's "+" send it (spec 0012, AC-229). */
export interface CreateAttributeInput {
  readonly objectId: string;
  /** The UUID v7 the browser minted: the retry key (AC-244). */
  readonly id: string;
  readonly title: string;
  readonly type: PickerAttributeType;
  /** Derived from the title (`toApiSlug`) when absent. */
  readonly apiSlug?: string | undefined;
  readonly description?: string | undefined;
  readonly isMulti?: boolean | undefined;
  readonly isRequired?: boolean | undefined;
  readonly isUnique?: boolean | undefined;
  readonly config?: Readonly<Record<string, unknown>> | undefined;
  readonly defaultValue?: AttributeDefault | undefined;
}

/**
 * Creates an attribute at the end of a live object's attributes (AC-229),
 * and answers it. Its API name is the one given, else `toApiSlug` of the
 * title. The same create again (same id, same object, same actor) answers
 * the attribute already made and writes nothing (AC-244). Refuses
 * `FORBIDDEN` without `schema.manage`, `NOT_FOUND` for an object that is
 * missing, archived or hidden, `SLUG_TAKEN` and `CONFIG_INVALID` on their
 * field, `LIMIT_REACHED` and `ID_TAKEN`.
 */
export async function createAttribute(
  scope: EngineScope,
  input: CreateAttributeInput,
  hooks: readonly AfterWrite[] = [],
): Promise<AttributeDefinition> {
  requirePermission(scope, 'schema.manage');
  const objectId = checkId(input.objectId, OBJECT_NOT_FOUND);
  // An object the caller can't see answers as an unknown one (spec 0009, AC-140).
  if (objectLevel(scope.access, objectId) === 'none') throw refuse('NOT_FOUND', OBJECT_NOT_FOUND);
  const title = input.title.trim();
  const apiSlug =
    input.apiSlug === undefined || input.apiSlug.trim() === '' ? toApiSlug(title, 'attribute') : input.apiSlug.trim();
  const made = await defineAttribute(
    scope,
    {
      id: input.id,
      objectId,
      apiSlug,
      title,
      type: input.type,
      ...(input.description === undefined || input.description.trim() === '' ? {} : { description: input.description }),
      ...(input.isMulti === undefined ? {} : { isMulti: input.isMulti }),
      ...(input.isRequired === undefined ? {} : { isRequired: input.isRequired }),
      ...(input.isUnique === undefined ? {} : { isUnique: input.isUnique }),
      ...(input.config === undefined ? {} : { config: input.config }),
      ...(input.defaultValue === undefined ? {} : { defaultValue: input.defaultValue }),
    },
    hooks,
  );
  return readOne(scope, { attributeId: made.attributeId, objectId, listId: null });
}

/** What settings may change on an attribute (AC-231): never its type, multiple setting or API name. */
export interface EditAttributeInput {
  readonly attributeId: string;
  readonly title?: string | undefined;
  readonly description?: string | null | undefined;
  readonly isRequired?: boolean | undefined;
  readonly isUnique?: boolean | undefined;
  readonly config?: Readonly<Record<string, unknown>> | undefined;
  readonly defaultValue?: AttributeDefault | null | undefined;
}

/**
 * Changes an attribute's title, description, Required, Unique, settings or
 * default (AC-231, AC-234, AC-235), standard objects' included, and answers
 * it. Refuses `FORBIDDEN`, `NOT_FOUND`, `ATTRIBUTE_READ_ONLY` (a system
 * attribute), `UNIQUE_HAS_DUPLICATES` and `CONFIG_INVALID` on its field.
 */
export async function editAttribute(
  scope: EngineScope,
  input: EditAttributeInput,
  hooks: readonly AfterWrite[] = [],
): Promise<AttributeDefinition> {
  requirePermission(scope, 'schema.manage');
  const attributeId = checkId(input.attributeId, ATTRIBUTE_NOT_FOUND);
  const changed = await updateAttribute(
    scope,
    {
      attributeId,
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.isRequired === undefined ? {} : { isRequired: input.isRequired }),
      ...(input.isUnique === undefined ? {} : { isUnique: input.isUnique }),
      ...(input.config === undefined ? {} : { config: input.config }),
      ...(input.defaultValue === undefined ? {} : { defaultValue: input.defaultValue }),
    },
    hooks,
  );
  return readOne(scope, changed);
}

/**
 * Moves an attribute to `position` among its object's own attributes
 * (AC-232), every table's default column order, and answers the object's
 * attributes, archived ones included, in the new order.
 */
export async function moveAttribute(
  scope: EngineScope,
  input: { readonly attributeId: string; readonly position: number },
  hooks: readonly AfterWrite[] = [],
): Promise<AttributeDefinition[]> {
  requirePermission(scope, 'schema.manage');
  const attributeId = checkId(input.attributeId, ATTRIBUTE_NOT_FOUND);
  const moved = await reorderAttribute(scope, { attributeId, position: input.position }, hooks);
  if (moved.objectId === null) return [];
  return listObjectAttributes(scope, moved.objectId, { includeArchived: true });
}

/**
 * Archives an attribute, standard ones included (AC-233): it leaves every
 * table, dialog and filter; its values and history stay. A relationship's
 * two ends archive together. Answers every definition it changed that the
 * caller may see (one, or both ends).
 */
export async function archiveAttributes(
  scope: EngineScope,
  input: { readonly attributeId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<AttributeDefinition[]> {
  requirePermission(scope, 'schema.manage');
  const attributeId = checkId(input.attributeId, ATTRIBUTE_NOT_FOUND);
  return readDefinitions(scope, await archiveAttribute(scope, attributeId, hooks));
}

/**
 * Restores an archived attribute at its old position (AC-233), both ends of
 * a relationship together. Refuses `NOT_FOUND` ("Restore <Plural> first.")
 * while the far end's object is archived, and `UNIQUE_HAS_DUPLICATES` when a
 * unique attribute's values now repeat. Answers every definition it changed
 * that the caller may see.
 */
export async function restoreAttributes(
  scope: EngineScope,
  input: { readonly attributeId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<AttributeDefinition[]> {
  requirePermission(scope, 'schema.manage');
  const attributeId = checkId(input.attributeId, ATTRIBUTE_NOT_FOUND);
  return readDefinitions(scope, await restoreAttribute(scope, attributeId, hooks));
}
