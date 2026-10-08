// An object's attributes as the People table reads and adds them (spec 0005):
// the definitions behind its columns, and "Add attribute", whose API name is
// derived from the title here, on the server. Reads and writes go through the
// scope the access door made.
import { and, asc, eq, isNull } from 'drizzle-orm';
import { attributeSlugFrom, type AttributeDefinition, type CreatableAttributeType } from '@crm/contracts';
import { schema, type WorkspaceTx } from '@crm/db';
import { checkSlug, defineAttribute } from '../engine/definitions.ts';
import { checkId } from '../engine/ids.ts';
import { isRefusal, refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import type { AfterWrite } from '../engine/write.ts';
import { inWorkspace } from '../access/run.ts';

const { attributes, objects } = schema;

type AttributeRow = typeof attributes.$inferSelect;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function definitionOf(row: AttributeRow): AttributeDefinition {
  return {
    id: row.id,
    apiSlug: row.apiSlug,
    title: row.title,
    type: row.type,
    isMulti: row.isMulti,
    isRequired: row.isRequired,
    isUnique: row.isUnique,
    isSystem: row.isSystem,
    config: isPlainObject(row.config) ? row.config : {},
    position: row.position,
  };
}

const OBJECT_NOT_FOUND = 'That object does not exist.';

/** Refuses `NOT_FOUND` unless the object is live (not archived) in this workspace. */
async function checkLiveObject(tx: WorkspaceTx, scope: EngineScope, objectId: string): Promise<void> {
  const [object] = await tx
    .select({ id: objects.id })
    .from(objects)
    .where(and(eq(objects.workspaceId, scope.workspaceId), eq(objects.id, objectId), isNull(objects.archivedAt)));
  if (object === undefined) throw refuse('NOT_FOUND', OBJECT_NOT_FOUND);
}

/**
 * A live object's live attributes, system ones included (marked `isSystem`),
 * by position, then when they were made. Refuses `NOT_FOUND` for an object
 * that doesn't exist here or is archived.
 */
export async function listObjectAttributes(scope: EngineScope, objectId: string): Promise<AttributeDefinition[]> {
  const id = checkId(objectId, OBJECT_NOT_FOUND);
  return inWorkspace(scope, async (tx) => {
    await checkLiveObject(tx, scope, id);
    const rows = await tx
      .select()
      .from(attributes)
      // Row level security keeps the read to this workspace; the filter says so too (house style).
      .where(
        and(eq(attributes.workspaceId, scope.workspaceId), eq(attributes.objectId, id), isNull(attributes.archivedAt)),
      )
      .orderBy(asc(attributes.position), asc(attributes.createdAt), asc(attributes.id));
    return rows.map(definitionOf);
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
  const made = await readDefinition(scope, attributeId);
  if (made === undefined) throw new Error('The attribute just made could not be read.');
  return made;
}

/** One attribute's definition by id, archived or not. */
async function readDefinition(scope: EngineScope, attributeId: string): Promise<AttributeDefinition | undefined> {
  const [row] = await inWorkspace(scope, (tx) =>
    tx
      .select()
      .from(attributes)
      .where(and(eq(attributes.workspaceId, scope.workspaceId), eq(attributes.id, attributeId))),
  );
  return row === undefined ? undefined : definitionOf(row);
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
  return sameAttribute && sameActor ? definitionOf(row) : undefined;
}
