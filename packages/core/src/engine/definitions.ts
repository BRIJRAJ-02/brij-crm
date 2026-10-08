// Defining objects and attributes (spec 0004). Standard objects come from the
// template through these same functions, so they are ordinary rows. Renames,
// archives and setting changes touch definition rows only, never records.
import { and, eq, isNull, sql } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import {
  AttributeConfig,
  AttributeDefault,
  defaultKindsFor,
  HUES,
  OBJECT_ICONS,
  parseAttributeValue,
  type AttributeType,
} from '@crm/contracts/values';
import { checkId, isUuid } from './ids.ts';
import { checkAttributeRoom, takeCustomObject, type AttributeParent } from './limits.ts';
import { postgresError, refuse } from './refusals.ts';
import { actorRow, type EngineScope } from './scope.ts';
import { clearUniqueKeys, fillUniqueKeys, UNIQUE_TYPES } from './unique.ts';
import { loadAttribute, type AttributeDef } from './values.ts';
import { runWrite, type AfterWrite, type WriteContext } from './write.ts';
import { inWorkspace } from '../access/run.ts';
import { requirePermission } from '../access/check.ts';
import { attributeVisible } from '../access/visibility.ts';
import { objectLevel, type Access } from '../access/policy.ts';

const { attributes, objects } = schema;

const SLUG = /^[a-z][a-z0-9_]{0,62}$/;

/** What a new object needs. Its primary attribute (the record's name) is created with it. */
export interface ObjectInput {
  readonly apiSlug: string;
  readonly singularName: string;
  readonly pluralName: string;
  readonly icon: string;
  readonly hue: string;
  /** The attribute a record's name comes from; text unless said otherwise (People use a personal name). */
  readonly primaryAttribute?: {
    readonly apiSlug: string;
    readonly title: string;
    readonly type: 'text' | 'personal_name';
    readonly isRequired?: boolean;
  };
  /** Set only by the standard template. */
  readonly standard?: { readonly key: string; readonly templateVersion: number };
}

/**
 * What a new attribute needs: its object, or its list (for an entry's own
 * values), exactly one. `config` and `defaultValue` are parsed by the type's schemas.
 */
export interface AttributeInput {
  readonly objectId?: string;
  readonly listId?: string;
  readonly apiSlug: string;
  readonly title: string;
  readonly type: AttributeType;
  readonly isMulti?: boolean;
  readonly isRequired?: boolean;
  readonly isUnique?: boolean;
  readonly description?: string;
  readonly config?: unknown;
  readonly defaultValue?: unknown;
}

/** What an attribute's settings may change to. Its type and multi setting change through #14. */
export interface AttributeUpdate {
  readonly attributeId: string;
  readonly title?: string;
  readonly description?: string | null;
  readonly isRequired?: boolean;
  readonly isUnique?: boolean;
  readonly config?: unknown;
  readonly defaultValue?: unknown;
}

/** What an object's names and look may change to. */
export interface ObjectUpdate {
  readonly objectId: string;
  readonly singularName?: string;
  readonly pluralName?: string;
  readonly icon?: string;
  readonly hue?: string;
}

/** The read only attributes every object has, each reading a `records` column. */
const SYSTEM_ATTRIBUTES = [
  { apiSlug: 'record_id', title: 'Record ID', type: 'text', systemColumn: 'id' },
  { apiSlug: 'created_at', title: 'Created at', type: 'timestamp', systemColumn: 'created_at' },
  { apiSlug: 'created_by', title: 'Created by', type: 'actor_reference', systemColumn: 'created_by' },
  { apiSlug: 'updated_at', title: 'Updated at', type: 'timestamp', systemColumn: 'updated_at' },
  { apiSlug: 'updated_by', title: 'Updated by', type: 'actor_reference', systemColumn: 'updated_by' },
] as const;

/** Refuses an API name that isn't lowercase letters, digits and underscores, starting with a letter. */
export function checkSlug(slug: string): void {
  if (!SLUG.test(slug)) {
    throw refuse('CONFIG_INVALID', 'Use lowercase letters, digits and underscores, starting with a letter.');
  }
}

/** Refuses a name that is empty or longer than 100 characters. */
export function checkName(name: string, what: string): void {
  if (name.trim() === '' || name.length > 100)
    throw refuse('CONFIG_INVALID', `Give the ${what} in 1 to 100 characters.`);
}

function checkLook(icon: string | undefined, hue: string | undefined): void {
  if (icon !== undefined && !(OBJECT_ICONS as readonly string[]).includes(icon)) {
    throw refuse('CONFIG_INVALID', 'Pick an icon from the object icon set.');
  }
  if (hue !== undefined && !(HUES as readonly string[]).includes(hue)) {
    throw refuse('CONFIG_INVALID', `Pick one of the hues: ${HUES.join(', ')}.`);
  }
}

/** The audit columns for a new row, from the scope's actor. */
export function audit(scope: EngineScope) {
  const by = actorRow(scope.actor);
  return {
    createdByType: by.type,
    createdById: by.id,
    createdByMemberId: by.memberId,
    updatedByType: by.type,
    updatedById: by.id,
    updatedByMemberId: by.memberId,
  };
}

/** The audit columns for an update. */
export function touched(scope: EngineScope) {
  const by = actorRow(scope.actor);
  return { updatedAt: sql`now()`, updatedByType: by.type, updatedById: by.id, updatedByMemberId: by.memberId };
}

/** Turns a slug clash into `SLUG_TAKEN`, and a setting the type can't take into `CONFIG_INVALID`. */
export async function definitionGuard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const pg = postgresError(error);
    if (pg?.code === '23505' && (pg.constraint?.endsWith('_slug') ?? false)) {
      throw refuse('SLUG_TAKEN', 'That API name is already in use here. Pick another.');
    }
    if (pg?.code === '23514' && pg.constraint === 'attributes_multi') {
      throw refuse('CONFIG_INVALID', 'This type holds one value only.');
    }
    if (pg?.code === '23514' && pg.constraint === 'attributes_unique') {
      throw refuse('CONFIG_INVALID', 'Only text, email, domain, URL, phone and number attributes can be unique.');
    }
    throw error;
  }
}

/** A type's settings, parsed, or `CONFIG_INVALID`. */
function parseConfig(type: AttributeType, input: unknown): unknown {
  const result = AttributeConfig[type].safeParse(input ?? {});
  if (!result.success)
    throw refuse('CONFIG_INVALID', result.error.issues[0]?.message ?? 'Those settings do not fit this type.');
  return result.data;
}

/** A default, parsed and checked against the type, or `CONFIG_INVALID`. Null clears it. */
function parseDefault(type: AttributeType, isMulti: boolean, input: unknown): AttributeDefault | null {
  if (input === null || input === undefined) return null;
  const result = AttributeDefault.safeParse(input);
  if (!result.success) throw refuse('CONFIG_INVALID', result.error.issues[0]?.message ?? 'That default is not valid.');
  if (!defaultKindsFor(type).includes(result.data.kind)) {
    throw refuse('CONFIG_INVALID', `A ${type.replaceAll('_', ' ')} attribute can't have that kind of default.`);
  }
  if (result.data.kind === 'static') {
    const value = parseAttributeValue(type, result.data.value, { allowMultiple: isMulti });
    if (!value.ok) throw refuse('CONFIG_INVALID', value.error.message);
    return { kind: 'static', value: value.value };
  }
  return result.data;
}

/** Inserts an object, its system attributes and its primary attribute, inside a write. */
export async function insertObject(
  context: WriteContext,
  input: ObjectInput,
): Promise<{ objectId: string; primaryAttributeId: string }> {
  const { tx, scope } = context;
  checkSlug(input.apiSlug);
  checkName(input.singularName, 'singular name');
  checkName(input.pluralName, 'plural name');
  checkLook(input.icon, input.hue);
  const primary = input.primaryAttribute ?? { apiSlug: 'name', title: 'Name', type: 'text' };
  checkSlug(primary.apiSlug);
  const created = await definitionGuard(async () => {
    const [object] = await tx
      .insert(objects)
      .values({
        workspaceId: scope.workspaceId,
        apiSlug: input.apiSlug,
        singularName: input.singularName.trim(),
        pluralName: input.pluralName.trim(),
        icon: input.icon,
        hue: input.hue,
        isStandard: input.standard !== undefined,
        standardKey: input.standard?.key ?? null,
        templateVersion: input.standard?.templateVersion ?? null,
        ...audit(scope),
      })
      .returning({ id: objects.id });
    if (object === undefined) throw new Error('The object was not created.');
    await tx.insert(attributes).values(
      SYSTEM_ATTRIBUTES.map((attribute, position) => ({
        workspaceId: scope.workspaceId,
        objectId: object.id,
        ...attribute,
        isSystem: true,
        position,
        ...audit(scope),
      })),
    );
    const [name] = await tx
      .insert(attributes)
      .values({
        workspaceId: scope.workspaceId,
        objectId: object.id,
        apiSlug: primary.apiSlug,
        title: primary.title,
        type: primary.type,
        isRequired: primary.isRequired ?? false,
        position: SYSTEM_ATTRIBUTES.length,
        ...audit(scope),
      })
      .returning({ id: attributes.id });
    if (name === undefined) throw new Error('The primary attribute was not created.');
    await tx.update(objects).set({ primaryAttributeId: name.id }).where(eq(objects.id, object.id));
    return { objectId: object.id, primaryAttributeId: name.id };
  });
  // The custom object slot last, as every write takes the workspace counter row: a full workspace refuses
  // here and the refusal rolls the object back, and the row is never held while the slug's index waits.
  if (input.standard === undefined) await takeCustomObject(tx, scope);
  return created;
}

/** The parent an attribute input names, refusing none or both. */
function parentOf(input: AttributeInput): AttributeParent {
  if (input.objectId !== undefined && input.listId === undefined) return { objectId: input.objectId };
  if (input.listId !== undefined && input.objectId === undefined) return { listId: input.listId };
  throw refuse('CONFIG_INVALID', 'Put the attribute on one object or one list.');
}

/**
 * Inserts an attribute at the end of its object or list, inside a write.
 * Record references are made only through a relationship, which passes `reference`.
 */
export async function insertAttribute(
  context: WriteContext,
  input: AttributeInput,
  internal: { readonly reference?: boolean } = {},
): Promise<{ attributeId: string }> {
  const { tx, scope } = context;
  const parent = parentOf(input);
  checkSlug(input.apiSlug);
  checkName(input.title, 'title');
  if (input.type === 'record_reference' && (internal.reference !== true || 'listId' in parent)) {
    throw refuse('CONFIG_INVALID', 'Add a record reference by defining a relationship.');
  }
  const config = parseConfig(input.type, input.config);
  const defaultValue = parseDefault(input.type, input.isMulti ?? false, input.defaultValue);
  await checkAttributeRoom(tx, scope, parent);
  const parentColumn =
    'objectId' in parent
      ? sql`${attributes.objectId} = ${parent.objectId}`
      : sql`${attributes.listId} = ${parent.listId}`;
  return definitionGuard(async () => {
    const [next] = await tx
      .execute<{ position: number }>(
        sql`select coalesce(max(${attributes.position}) + 1, 0)::int as position from ${attributes} where ${parentColumn}`,
      )
      .then((result) => result.rows);
    const [row] = await tx
      .insert(attributes)
      .values({
        workspaceId: scope.workspaceId,
        objectId: 'objectId' in parent ? parent.objectId : null,
        listId: 'listId' in parent ? parent.listId : null,
        apiSlug: input.apiSlug,
        title: input.title.trim(),
        type: input.type,
        isMulti: input.isMulti ?? false,
        isRequired: input.isRequired ?? false,
        isUnique: input.isUnique ?? false,
        description: input.description ?? null,
        config,
        defaultValue,
        position: next?.position ?? 0,
        ...audit(scope),
      })
      .returning({ id: attributes.id });
    if (row === undefined) throw new Error('The attribute was not created.');
    if ('objectId' in parent) context.record({ definitions: [{ objectId: parent.objectId, attributeIds: [row.id] }] });
    return { attributeId: row.id };
  });
}

/** Notes an object attribute's change for the hooks (a list's attributes aren't published yet). */
function recordDefinition(context: WriteContext, attribute: AttributeDef): void {
  if (attribute.objectId === null) return;
  context.record({ definitions: [{ objectId: attribute.objectId, attributeIds: [attribute.id] }] });
}

/** Defines a custom object (AC-1, AC-16). */
export async function defineObject(
  scope: EngineScope,
  input: Omit<ObjectInput, 'standard'>,
  hooks: readonly AfterWrite[] = [],
) {
  requirePermission(scope, 'schema.manage');
  const { result } = await runWrite(scope, (context) => insertObject(context, input), hooks);
  return result;
}

/** Defines an attribute on an object, or on a list for its entries (AC-1, AC-2, AC-6, AC-16). */
export async function defineAttribute(scope: EngineScope, input: AttributeInput, hooks: readonly AfterWrite[] = []) {
  requirePermission(scope, 'schema.manage');
  const { result } = await runWrite(scope, (context) => insertAttribute(context, input), hooks);
  return result;
}

async function editable(tx: WorkspaceTx, access: Access, attributeId: string): Promise<AttributeDef> {
  const attribute = await loadAttribute(tx, attributeId, true);
  // One the actor can't see answers as an unknown attribute (spec 0009, AC-141).
  if (!attributeVisible(access, attribute)) throw refuse('NOT_FOUND', 'That attribute does not exist.', attribute.id);
  if (attribute.isSystem)
    throw refuse('ATTRIBUTE_READ_ONLY', `${attribute.title} is a system attribute.`, attribute.id);
  return attribute;
}

/** Changes an attribute's title, description, required, unique, settings or default (AC-10, AC-11). */
export async function updateAttribute(scope: EngineScope, input: AttributeUpdate, hooks: readonly AfterWrite[] = []) {
  requirePermission(scope, 'schema.manage');
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const attribute = await editable(tx, context.scope.access, input.attributeId);
      if (input.title !== undefined) checkName(input.title, 'title');
      if (input.isUnique === true && !UNIQUE_TYPES.includes(attribute.type)) {
        throw refuse('CONFIG_INVALID', 'Only text, email, domain, URL, phone and number attributes can be unique.');
      }
      const turningOn = input.isUnique === true && !attribute.isUnique && attribute.archivedAt === null;
      const turningOff = input.isUnique === false && attribute.isUnique;
      if (turningOn) await fillUniqueKeys(tx, attribute, context.scope.access);
      if (turningOff) await clearUniqueKeys(tx, attribute.id);
      await tx
        .update(attributes)
        .set({
          ...(input.title === undefined ? {} : { title: input.title.trim() }),
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.isRequired === undefined ? {} : { isRequired: input.isRequired }),
          ...(input.isUnique === undefined ? {} : { isUnique: input.isUnique }),
          ...(input.config === undefined ? {} : { config: parseConfig(attribute.type, input.config) }),
          ...(input.defaultValue === undefined
            ? {}
            : { defaultValue: parseDefault(attribute.type, attribute.isMulti, input.defaultValue) }),
          ...touched(scope),
        })
        .where(eq(attributes.id, attribute.id));
      recordDefinition(context, attribute);
      return { attributeId: attribute.id };
    },
    hooks,
  );
  return result;
}

/** Archives an attribute: its values stay, it stops taking writes, and a unique one frees its keys. */
export async function archiveAttribute(scope: EngineScope, attributeId: string, hooks: readonly AfterWrite[] = []) {
  requirePermission(scope, 'schema.manage');
  await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const attribute = await editable(tx, context.scope.access, attributeId);
      const [primary] = await tx
        .select({ id: objects.id })
        .from(objects)
        .where(eq(objects.primaryAttributeId, attribute.id));
      if (primary !== undefined)
        throw refuse('CONFIG_INVALID', "A record's name attribute can't be archived.", attribute.id);
      if (attribute.archivedAt !== null) return;
      if (attribute.isUnique) await clearUniqueKeys(tx, attribute.id);
      await tx
        .update(attributes)
        .set({ archivedAt: sql`now()`, ...touched(scope) })
        .where(eq(attributes.id, attribute.id));
      recordDefinition(context, attribute);
    },
    hooks,
  );
}

/** Restores an archived attribute; a unique one takes its keys back, refusing if duplicates appeared meanwhile. */
export async function restoreAttribute(scope: EngineScope, attributeId: string, hooks: readonly AfterWrite[] = []) {
  requirePermission(scope, 'schema.manage');
  await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const attribute = await editable(tx, context.scope.access, attributeId);
      if (attribute.archivedAt === null) return;
      if (attribute.isUnique) await fillUniqueKeys(tx, attribute, context.scope.access);
      await tx
        .update(attributes)
        .set({ archivedAt: null, ...touched(scope) })
        .where(eq(attributes.id, attribute.id));
      recordDefinition(context, attribute);
    },
    hooks,
  );
}

/** Changes an object's names, icon or hue. */
export async function updateObject(scope: EngineScope, input: ObjectUpdate, hooks: readonly AfterWrite[] = []) {
  requirePermission(scope, 'schema.manage');
  checkId(input.objectId, 'That object does not exist.');
  // An object the actor can't see answers as an unknown one (spec 0009, AC-140).
  if (objectLevel(scope.access, input.objectId.toLowerCase()) === 'none')
    throw refuse('NOT_FOUND', 'That object does not exist.');
  await runWrite(
    scope,
    async ({ tx }) => {
      if (input.singularName !== undefined) checkName(input.singularName, 'singular name');
      if (input.pluralName !== undefined) checkName(input.pluralName, 'plural name');
      checkLook(input.icon, input.hue);
      const updated = await tx
        .update(objects)
        .set({
          ...(input.singularName === undefined ? {} : { singularName: input.singularName.trim() }),
          ...(input.pluralName === undefined ? {} : { pluralName: input.pluralName.trim() }),
          ...(input.icon === undefined ? {} : { icon: input.icon }),
          ...(input.hue === undefined ? {} : { hue: input.hue }),
          ...touched(scope),
        })
        .where(eq(objects.id, input.objectId))
        .returning({ id: objects.id });
      if (updated.length === 0) throw refuse('NOT_FOUND', 'That object does not exist.');
    },
    hooks,
  );
}

/** Archives or restores an object. Its records stay; an archived object takes no new records. */
export async function setObjectArchived(
  scope: EngineScope,
  input: { readonly objectId: string; readonly archived: boolean },
  hooks: readonly AfterWrite[] = [],
) {
  requirePermission(scope, 'schema.manage');
  checkId(input.objectId, 'That object does not exist.');
  // An object the actor can't see answers as an unknown one (spec 0009, AC-140).
  if (objectLevel(scope.access, input.objectId.toLowerCase()) === 'none')
    throw refuse('NOT_FOUND', 'That object does not exist.');
  await runWrite(
    scope,
    async ({ tx }) => {
      const updated = await tx
        .update(objects)
        .set({ archivedAt: input.archived ? sql`coalesce(${objects.archivedAt}, now())` : null, ...touched(scope) })
        .where(eq(objects.id, input.objectId))
        .returning({ id: objects.id });
      if (updated.length === 0) throw refuse('NOT_FOUND', 'That object does not exist.');
    },
    hooks,
  );
}

/**
 * The live attributes of an object, as definitions, in position order: only
 * those the principal may see (spec 0009, AC-141), so none for an object they
 * can't see. None for a malformed id.
 */
export async function listAttributes(scope: EngineScope, objectId: string) {
  if (!isUuid(objectId)) return [];
  const rows = await inWorkspace(scope, (tx) =>
    tx
      .select()
      .from(attributes)
      .where(and(eq(attributes.objectId, objectId), isNull(attributes.archivedAt)))
      .orderBy(attributes.position),
  );
  return rows.filter((row) => attributeVisible(scope.access, row));
}
