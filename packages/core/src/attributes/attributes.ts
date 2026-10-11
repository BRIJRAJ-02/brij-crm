// An object's attributes as the tables and settings read them (spec 0005;
// spec 0012 widens them): the definitions behind the columns, with options
// inline, and "Add attribute", whose API name is derived from the title here,
// on the server. Reads and writes go through the scope the access door made.
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  attributeSlugFrom,
  type AttributeDefinition,
  type AttributeOption,
  type CreatableAttributeType,
} from '@crm/contracts';
import { AttributeDefault, HUES, type Hue } from '@crm/contracts/values';
import { schema, type WorkspaceTx } from '@crm/db';
import { checkSlug, defineAttribute } from '../engine/definitions.ts';
import { checkId } from '../engine/ids.ts';
import { isRefusal, refuse } from '../engine/refusals.ts';
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
    byAttribute.set(row.attributeId, [...(byAttribute.get(row.attributeId) ?? []), option]);
  }
  return byAttribute;
}

const OBJECT_NOT_FOUND = 'That object does not exist.';

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

/** What "Add attribute" gives: the object, the title, and one of the core loop's types. */
export interface AddAttributeInput {
  readonly objectId: string;
  readonly title: string;
  readonly type: CreatableAttributeType;
}

/** The message when the derived API name is taken: said about the name, since people never see API names. */
const NAME_TAKEN = "There's already an attribute with that name here. Pick another name.";

/**
 * Adds an attribute to a live object (spec 0005, AC-37). Its API name comes
 * from the title (`attributeSlugFrom`, then the engine's `checkSlug`). A taken
 * name refuses `SLUG_TAKEN`, unless it is this request's own earlier try: a
 * live attribute with that API name, the same title and type, made by the
 * same actor answers as made (a retry after a lost response). The hooks run in
 * the write's transaction.
 */
export async function addAttribute(
  scope: EngineScope,
  input: AddAttributeInput,
  hooks: readonly AfterWrite[] = [],
): Promise<AttributeDefinition> {
  requirePermission(scope, 'schema.manage');
  const objectId = checkId(input.objectId, OBJECT_NOT_FOUND);
  const title = input.title.trim();
  const apiSlug = attributeSlugFrom(title);
  checkSlug(apiSlug);
  let attributeId: string;
  try {
    ({ attributeId } = await defineAttribute(scope, { objectId, apiSlug, title, type: input.type }, hooks));
  } catch (error) {
    if (!isRefusal(error) || error.refusal.code !== 'SLUG_TAKEN') throw error;
    const earlier = await earlierTry(scope, { objectId, apiSlug, title, type: input.type });
    if (earlier === undefined) throw refuse('SLUG_TAKEN', NAME_TAKEN);
    return earlier;
  }
  const made = await readDefinition(scope, objectId, attributeId);
  if (made === undefined) throw new Error('The attribute just made could not be read.');
  return made;
}

/** One attribute's definition by id, archived or not, as the caller sees it. */
async function readDefinition(
  scope: EngineScope,
  objectId: string,
  attributeId: string,
): Promise<AttributeDefinition | undefined> {
  const listed = await listObjectAttributes(scope, objectId, { includeArchived: true });
  return listed.find((definition) => definition.id === attributeId);
}

/** The live attribute an earlier try of the same "Add attribute" made, if that is what holds the API name. */
async function earlierTry(
  scope: EngineScope,
  wanted: { readonly objectId: string; readonly apiSlug: string; readonly title: string; readonly type: string },
): Promise<AttributeDefinition | undefined> {
  const [row] = await inWorkspace(scope, (tx) =>
    tx
      .select()
      .from(attributes)
      .where(
        and(
          eq(attributes.workspaceId, scope.workspaceId),
          eq(attributes.objectId, wanted.objectId),
          eq(attributes.apiSlug, wanted.apiSlug),
          isNull(attributes.archivedAt),
        ),
      ),
  );
  if (row === undefined) return undefined;
  const sameAttribute = row.title === wanted.title && row.type === wanted.type && !row.isSystem;
  const sameActor = row.createdByType === scope.actor.type && row.createdById === scope.actor.id;
  return sameAttribute && sameActor ? readDefinition(scope, wanted.objectId, row.id) : undefined;
}
