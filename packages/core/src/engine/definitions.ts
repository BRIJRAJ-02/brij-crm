// Defining objects and attributes (spec 0004). Standard objects come from the
// template through these same functions, so they are ordinary rows.
import { eq, sql } from 'drizzle-orm';
import { schema } from '@crm/db';
import type { AttributeType } from '@crm/contracts/values';
import { postgresError, refuse } from './refusals.ts';
import { actorRow, type EngineScope } from './scope.ts';
import { runWrite, type AfterWrite, type WriteContext } from './write.ts';

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
  };
  /** Set only by the standard template. */
  readonly standard?: { readonly key: string; readonly templateVersion: number };
}

/** What a new attribute needs. */
export interface AttributeInput {
  readonly objectId: string;
  readonly apiSlug: string;
  readonly title: string;
  readonly type: AttributeType;
  readonly isMulti?: boolean;
  readonly isRequired?: boolean;
  readonly isUnique?: boolean;
  readonly description?: string;
}

/** The read only attributes every object has, each reading a `records` column. */
const SYSTEM_ATTRIBUTES = [
  { apiSlug: 'record_id', title: 'Record ID', type: 'text', systemColumn: 'id' },
  { apiSlug: 'created_at', title: 'Created at', type: 'timestamp', systemColumn: 'created_at' },
  { apiSlug: 'created_by', title: 'Created by', type: 'actor_reference', systemColumn: 'created_by' },
  { apiSlug: 'updated_at', title: 'Updated at', type: 'timestamp', systemColumn: 'updated_at' },
  { apiSlug: 'updated_by', title: 'Updated by', type: 'actor_reference', systemColumn: 'updated_by' },
] as const;

function checkSlug(slug: string): void {
  if (!SLUG.test(slug)) {
    throw refuse('CONFIG_INVALID', 'Use lowercase letters, digits and underscores, starting with a letter.');
  }
}

function checkName(name: string, what: string): void {
  if (name.trim() === '' || name.length > 100)
    throw refuse('CONFIG_INVALID', `Give the ${what} in 1 to 100 characters.`);
}

/** Inserts the audit columns for a new row, from the scope's actor. */
function audit(scope: EngineScope) {
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

/** Turns a slug clash into `SLUG_TAKEN`, and a setting the type can't take into `CONFIG_INVALID`. */
async function slugGuard<T>(work: () => Promise<T>): Promise<T> {
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

/** Inserts an object, its system attributes and its primary attribute, inside a write. */
export async function insertObject(
  context: WriteContext,
  input: ObjectInput,
): Promise<{ objectId: string; primaryAttributeId: string }> {
  const { tx, scope } = context;
  checkSlug(input.apiSlug);
  checkName(input.singularName, 'singular name');
  checkName(input.pluralName, 'plural name');
  const primary = input.primaryAttribute ?? { apiSlug: 'name', title: 'Name', type: 'text' };
  checkSlug(primary.apiSlug);
  return slugGuard(async () => {
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
        position: SYSTEM_ATTRIBUTES.length,
        ...audit(scope),
      })
      .returning({ id: attributes.id });
    if (name === undefined) throw new Error('The primary attribute was not created.');
    await tx.update(objects).set({ primaryAttributeId: name.id }).where(eq(objects.id, object.id));
    return { objectId: object.id, primaryAttributeId: name.id };
  });
}

/** Inserts an attribute at the end of its object, inside a write. */
export async function insertAttribute(context: WriteContext, input: AttributeInput): Promise<{ attributeId: string }> {
  const { tx, scope } = context;
  checkSlug(input.apiSlug);
  checkName(input.title, 'title');
  if (input.type === 'record_reference') {
    throw refuse('CONFIG_INVALID', 'Add a record reference by defining a relationship.');
  }
  return slugGuard(async () => {
    const [next] = await tx
      .execute<{ position: number }>(
        sql`select coalesce(max(${attributes.position}) + 1, 0)::int as position from ${attributes} where ${attributes.objectId} = ${input.objectId}`,
      )
      .then((result) => result.rows);
    const [row] = await tx
      .insert(attributes)
      .values({
        workspaceId: scope.workspaceId,
        objectId: input.objectId,
        apiSlug: input.apiSlug,
        title: input.title.trim(),
        type: input.type,
        isMulti: input.isMulti ?? false,
        isRequired: input.isRequired ?? false,
        isUnique: input.isUnique ?? false,
        description: input.description ?? null,
        position: next?.position ?? 0,
        ...audit(scope),
      })
      .returning({ id: attributes.id });
    if (row === undefined) throw new Error('The attribute was not created.');
    return { attributeId: row.id };
  });
}

/** Defines a custom object (AC-1). */
export async function defineObject(
  scope: EngineScope,
  input: Omit<ObjectInput, 'standard'>,
  hooks: readonly AfterWrite[] = [],
) {
  const { result } = await runWrite(scope, (context) => insertObject(context, input), hooks);
  return result;
}

/** Defines an attribute on an object (AC-1, AC-2). */
export async function defineAttribute(scope: EngineScope, input: AttributeInput, hooks: readonly AfterWrite[] = []) {
  const { result } = await runWrite(scope, (context) => insertAttribute(context, input), hooks);
  return result;
}
