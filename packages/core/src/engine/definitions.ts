// Defining objects and attributes (spec 0004). Standard objects come from the
// template through these same functions, so they are ordinary rows. Renames,
// archives and setting changes touch definition rows only, never records.
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import {
  API_SLUG_PATTERN,
  AttributeConfig,
  AttributeDefault,
  defaultKindsFor,
  HUES,
  isReservedSlug,
  OBJECT_ICONS,
  parseAttributeValue,
  type ApiSlugKind,
  type AttributeType,
  type ValidationRuleInput,
} from '@crm/contracts/values';
import { checkId, isUuid, isUuidV7, uuidArray } from './ids.ts';
import { checkAttributeRoom, limitsOf, lockAttributeParent, takeCustomObject, type AttributeParent } from './limits.ts';
import { checkHue, checkLabel, checkTarget, hasStageSettings, type OptionOutcome } from './option-rules.ts';
import { isRefusal, postgresError, refuse, refuseOn } from './refusals.ts';
import { actorRow, type EngineScope } from './scope.ts';
import { clearUniqueKeys, fillUniqueKeys, UNIQUE_TYPES } from './unique.ts';
import { ARCHIVED_BY, loadAttribute, type AttributeDef } from './values.ts';
import { runWrite, type AfterWrite, type WriteContext } from './write.ts';
import { writeRules } from '../validation/rules.ts';
import { seedDefaultView } from '../views/seed.ts';
import { inWorkspace } from '../access/run.ts';
import { requirePermission } from '../access/check.ts';
import { attributeVisible } from '../access/visibility.ts';
import { objectLevel, type Access } from '../access/policy.ts';

const { attributeOptions, attributes, members, objects, relationships, workspaceCounters } = schema;

/** The longest description an attribute may have (spec 0012). */
const MAX_DESCRIPTION = 500;

/** What a new object needs. Its primary attribute (the record's name) is created with it. */
export interface ObjectInput {
  /**
   * A UUID v7 the client minted (spec 0012, AC-244): the retry key. The same
   * create again answers the object already made and writes nothing.
   */
  readonly id?: string;
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
  /**
   * A UUID v7 the client minted (spec 0012, AC-244): the retry key. The same
   * create again (same parent, same actor) answers the attribute already made
   * and writes nothing; anyone else's attribute with that id is `ID_TAKEN`.
   */
  readonly id?: string;
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
  /**
   * A select's or status attribute's first options, in order, made in the
   * same write (spec 0012, AC-230), at most the options limit (AC-237).
   */
  readonly options?: readonly InitialOption[];
  /** Its first validation rules, in order (spec 0013, AC-252), made in the same write. */
  readonly rules?: readonly ValidationRuleInput[];
}

/** One option an attribute is created with: a client id (UUID v7), its label and hue, and for a status stage its outcome and target time. */
export interface InitialOption {
  readonly id?: string;
  readonly label: string;
  readonly hue: string;
  readonly outcome?: OptionOutcome;
  readonly targetTimeInStage?: string | null;
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
  /** Its validation rules, in order (spec 0013, AC-252): the list replaces the attribute's own rules. */
  readonly rules?: readonly ValidationRuleInput[];
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

/** A refusal on `field` of the input when one is named, else a plain one. */
const refuseAt = (code: 'CONFIG_INVALID', message: string, field: string | undefined) =>
  field === undefined ? refuse(code, message) : refuseOn(code, message, field);

/**
 * Refuses an API name that isn't lowercase letters, digits and underscores,
 * starting with a letter, and an object API name on the reserved list
 * (`RESERVED_SLUGS`, route segments beside `$object`; spec 0012, AC-245),
 * on `field` of the input when one is named.
 */
export function checkSlug(slug: string, kind: ApiSlugKind = 'attribute', field?: string): void {
  if (!API_SLUG_PATTERN.test(slug)) {
    throw refuseAt('CONFIG_INVALID', 'Use lowercase letters, digits and underscores, starting with a letter.', field);
  }
  if (kind === 'object' && isReservedSlug(slug)) {
    throw refuseAt('CONFIG_INVALID', 'That API name is reserved. Pick another.', field);
  }
}

/** Refuses a name that is empty or longer than 100 characters, on `field` of the input when one is named. */
export function checkName(name: string, what: string, field?: string): void {
  if (name.trim() === '' || name.length > 100)
    throw refuseAt('CONFIG_INVALID', `Give the ${what} in 1 to 100 characters.`, field);
}

/** Refuses a description longer than 500 characters (spec 0012). */
export function checkDescription(description: string | null | undefined): void {
  if (typeof description === 'string' && description.length > MAX_DESCRIPTION) {
    throw refuseOn('CONFIG_INVALID', `Keep the description to ${String(MAX_DESCRIPTION)} characters.`, 'description');
  }
}

function checkLook(icon: string | undefined, hue: string | undefined): void {
  if (icon !== undefined && !(OBJECT_ICONS as readonly string[]).includes(icon)) {
    throw refuseOn('CONFIG_INVALID', 'Pick an icon from the object icon set.', 'icon');
  }
  if (hue !== undefined && !(HUES as readonly string[]).includes(hue)) {
    throw refuseOn('CONFIG_INVALID', `Pick one of the hues: ${HUES.join(', ')}.`, 'hue');
  }
}

/**
 * `definitionGuard` for an object's own row: a taken API name refuses on
 * `apiSlug`, a name another object holds (ignoring case, archived ones
 * included) `NAME_TAKEN` on the name it names (spec 0012, AC-224), and an id
 * another object holds `ID_TAKEN`.
 */
async function objectGuard<T>(
  names: { readonly singularName?: string | undefined; readonly pluralName?: string | undefined },
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await definitionGuard(work);
  } catch (error) {
    if (isRefusal(error) && error.refusal.code === 'SLUG_TAKEN' && error.refusal.field === undefined) {
      throw refuseOn('SLUG_TAKEN', 'An object already uses this API name. Pick another.', 'apiSlug');
    }
    const pg = postgresError(error);
    if (pg?.code === '23505' && pg.constraint === 'objects_singular_name') {
      throw refuseOn(
        'NAME_TAKEN',
        `An object called ${names.singularName?.trim() ?? 'that'} already exists.`,
        'singularName',
      );
    }
    if (pg?.code === '23505' && pg.constraint === 'objects_plural_name') {
      throw refuseOn(
        'NAME_TAKEN',
        `An object called ${names.pluralName?.trim() ?? 'that'} already exists.`,
        'pluralName',
      );
    }
    if (pg?.code === '23505' && pg.constraint === 'objects_pkey') {
      throw refuse('ID_TAKEN', 'An object with that id already exists.');
    }
    throw error;
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

/** A default, parsed and checked against the type, or `CONFIG_INVALID` on `defaultValue`. Null clears it. */
function parseDefault(type: AttributeType, isMulti: boolean, input: unknown): AttributeDefault | null {
  if (input === null || input === undefined) return null;
  const result = AttributeDefault.safeParse(input);
  if (!result.success) {
    throw refuseOn('CONFIG_INVALID', result.error.issues[0]?.message ?? 'That default is not valid.', 'defaultValue');
  }
  if (!defaultKindsFor(type).includes(result.data.kind)) {
    throw refuseOn(
      'CONFIG_INVALID',
      `A ${type.replaceAll('_', ' ')} attribute can't have that kind of default.`,
      'defaultValue',
    );
  }
  if (result.data.kind === 'static') {
    const value = parseAttributeValue(type, result.data.value, { allowMultiple: isMulti });
    if (!value.ok) throw refuseOn('CONFIG_INVALID', value.error.message, 'defaultValue');
    return { kind: 'static', value: value.value };
  }
  if (result.data.kind === 'offset' && offsetDays(result.data.duration) > MAX_OFFSET_DAYS) {
    // Past this, "now plus the offset" can leave the dates Postgres holds, and every record create would fail.
    throw refuseOn('CONFIG_INVALID', 'Keep the offset within 3,650 days (10 years).', 'defaultValue');
  }
  return result.data;
}

/** The furthest an offset default reaches (spec 0012, AC-234: "Today + N days", N up to 3,650). */
const MAX_OFFSET_DAYS = 3650;

/** An ISO 8601 duration's length in days, counting a year as 366 and a month as 31 (an upper bound). */
function offsetDays(duration: string): number {
  const part = (unit: string, inTime = false) => {
    const pattern = inTime ? new RegExp(`T.*?(\\d+)${unit}`) : new RegExp(`^P[^T]*?(\\d+)${unit}`);
    return Number(pattern.exec(duration)?.[1] ?? 0);
  };
  return part('Y') * 366 + part('M') * 31 + part('W') * 7 + part('D') + part('H', true) / 24 + part('M', true) / 1440;
}

/**
 * Refuses a static Member default naming anyone but an active member of this
 * workspace (on `defaultValue`), so a record create that leaves the attribute
 * out never fails on its default.
 */
async function checkDefaultMembers(tx: WorkspaceTx, type: AttributeType, fallback: AttributeDefault | null) {
  if (type !== 'actor_reference' || fallback?.kind !== 'static') return;
  const named: readonly unknown[] = Array.isArray(fallback.value)
    ? (fallback.value as readonly unknown[])
    : [fallback.value];
  const ids = named.flatMap((each) =>
    typeof each === 'object' && each !== null && 'id' in each && typeof each.id === 'string' && isUuid(each.id)
      ? [each.id.toLowerCase()]
      : [],
  );
  const unique = [...new Set(ids)];
  const found =
    unique.length === 0
      ? []
      : await tx
          .select({ id: members.id })
          .from(members)
          .where(and(inArray(members.id, unique), eq(members.status, 'active')));
  if (found.length < unique.length || ids.length < named.length) {
    throw refuseOn('CONFIG_INVALID', 'Pick a member of this workspace as the default.', 'defaultValue');
  }
}

/** Takes the workspace counters row's lock for the rest of the write: object creates and moves take turns on it. */
async function lockCounters(tx: WorkspaceTx, scope: EngineScope): Promise<void> {
  const [locked] = await tx
    .select({ workspaceId: workspaceCounters.workspaceId })
    .from(workspaceCounters)
    .where(eq(workspaceCounters.workspaceId, scope.workspaceId))
    .for('update');
  if (locked === undefined) throw new Error('The workspace has no counters row.');
}

/**
 * The position after the workspace's last object, read under the workspace
 * counters row's lock (taken here, held to the end of the write), so
 * concurrent creates queue and each lands at the end.
 */
async function nextObjectPosition(tx: WorkspaceTx, scope: EngineScope): Promise<number> {
  await lockCounters(tx, scope);
  const [next] = await tx
    .execute<{ position: number }>(
      sql`select coalesce(max(${objects.position}) + 1, 0)::int as position from ${objects} where ${objects.workspaceId} = ${scope.workspaceId}`,
    )
    .then((result) => result.rows);
  return next?.position ?? 0;
}

/** What inserting an object made: its id and primary attribute, and whether it was already made by an earlier try. */
export interface InsertedObject {
  readonly objectId: string;
  readonly primaryAttributeId: string;
  /** The same create came again after a lost answer: nothing was written this time. */
  readonly replayed: boolean;
}

/**
 * The object an earlier try of the same create made (spec 0012, AC-244):
 * undefined when no object holds the id, the object when this actor made it,
 * else `ID_TAKEN`. Read under the counters row's lock, so a concurrent try
 * with the same id has committed or not started.
 */
async function earlierObject(tx: WorkspaceTx, scope: EngineScope, id: string): Promise<InsertedObject | undefined> {
  const [row] = await tx
    .select({
      id: objects.id,
      primaryAttributeId: objects.primaryAttributeId,
      createdByType: objects.createdByType,
      createdById: objects.createdById,
    })
    .from(objects)
    .where(eq(objects.id, id));
  if (row === undefined) return undefined;
  const isOwnTry = row.createdByType === scope.actor.type && row.createdById === scope.actor.id;
  if (!isOwnTry || row.primaryAttributeId === null) throw refuse('ID_TAKEN', 'An object with that id already exists.');
  return { objectId: row.id, primaryAttributeId: row.primaryAttributeId, replayed: true };
}

/** Inserts an object, its system attributes and its primary attribute, inside a write. */
export async function insertObject(context: WriteContext, input: ObjectInput): Promise<InsertedObject> {
  const { tx, scope } = context;
  if (input.id !== undefined && !isUuidV7(input.id)) {
    throw refuse('CONFIG_INVALID', 'The object id must be a UUID v7.');
  }
  checkSlug(input.apiSlug, 'object', 'apiSlug');
  checkName(input.singularName, 'singular name', 'singularName');
  checkName(input.pluralName, 'plural name', 'pluralName');
  checkLook(input.icon, input.hue);
  const primary = input.primaryAttribute ?? { apiSlug: 'name', title: 'Name', type: 'text' };
  checkSlug(primary.apiSlug);
  // The workspace counters row first, as every object create takes it in the same order: the new object's place
  // (the end of the workspace's order) is read under it, so two creates never take one position (spec 0012).
  const position = await nextObjectPosition(tx, scope);
  const id = input.id?.toLowerCase();
  if (id !== undefined) {
    const earlier = await earlierObject(tx, scope, id);
    if (earlier !== undefined) return earlier;
  }
  const created = await objectGuard(input, async () => {
    const [object] = await tx
      .insert(objects)
      .values({
        ...(id === undefined ? {} : { id }),
        position,
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
    const system = await tx
      .insert(attributes)
      .values(
        SYSTEM_ATTRIBUTES.map((attribute, position) => ({
          workspaceId: scope.workspaceId,
          objectId: object.id,
          ...attribute,
          isSystem: true,
          position,
          ...audit(scope),
        })),
      )
      .returning({ id: attributes.id, systemColumn: attributes.systemColumn });
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
    // Its default view, in the same write (spec 0020, AC-462).
    await seedDefaultView(context, {
      objectId: object.id,
      pluralName: input.pluralName,
      createdAtId: system.find((attribute) => attribute.systemColumn === 'created_at')?.id,
    });
    return { objectId: object.id, primaryAttributeId: name.id, replayed: false };
  });
  // The custom object slot (the counters row is already held): a full workspace refuses here and the refusal
  // rolls the object back.
  if (input.standard === undefined) await takeCustomObject(tx, scope);
  // The object itself is new: screens read the workspace's objects again (spec 0007, AC-81).
  context.record({ definitions: [{ objectId: created.objectId, attributeIds: [] }] });
  return created;
}

/** The parent an attribute input names, refusing none or both. */
function parentOf(input: AttributeInput): AttributeParent {
  if (input.objectId !== undefined && input.listId === undefined) return { objectId: input.objectId };
  if (input.listId !== undefined && input.objectId === undefined) return { listId: input.listId };
  throw refuse('CONFIG_INVALID', 'Put the attribute on one object or one list.');
}

/** What inserting an attribute made: its id, and whether an earlier try of the same create already made it. */
export interface InsertedAttribute {
  readonly attributeId: string;
  /** The same create came again after a lost answer: nothing was written this time. */
  readonly replayed: boolean;
}

/**
 * The attribute an earlier try of the same create made (spec 0012, AC-244):
 * undefined when no attribute holds the id, the attribute when this actor
 * made it on the same parent, else `ID_TAKEN`. Read under the parent row's
 * lock, so a concurrent try with the same id has committed or not started.
 */
async function earlierAttribute(
  tx: WorkspaceTx,
  scope: EngineScope,
  id: string,
  parent: AttributeParent,
): Promise<InsertedAttribute | undefined> {
  const [row] = await tx
    .select({
      id: attributes.id,
      objectId: attributes.objectId,
      listId: attributes.listId,
      createdByType: attributes.createdByType,
      createdById: attributes.createdById,
    })
    .from(attributes)
    .where(eq(attributes.id, id));
  if (row === undefined) return undefined;
  const sameParent = 'objectId' in parent ? row.objectId === parent.objectId : row.listId === parent.listId;
  const isOwnTry = row.createdByType === scope.actor.type && row.createdById === scope.actor.id;
  if (!sameParent || !isOwnTry) throw refuse('ID_TAKEN', 'An attribute with that id already exists.');
  return { attributeId: row.id, replayed: true };
}

/**
 * Inserts an attribute at the end of its object or list, inside a write.
 * Record references are made only through a relationship, which passes
 * `reference`. With a client `id`, the same create again answers the
 * attribute already made and writes nothing (spec 0012, AC-244).
 */
export async function insertAttribute(
  context: WriteContext,
  input: AttributeInput,
  internal: { readonly reference?: boolean } = {},
): Promise<InsertedAttribute> {
  const { tx, scope } = context;
  const parent = parentOf(input);
  if (input.id !== undefined && !isUuidV7(input.id)) {
    throw refuse('CONFIG_INVALID', 'The attribute id must be a UUID v7.');
  }
  checkSlug(input.apiSlug, 'attribute', 'apiSlug');
  checkName(input.title, 'title', 'title');
  checkDescription(input.description);
  if (input.type === 'record_reference' && (internal.reference !== true || 'listId' in parent)) {
    throw refuse('CONFIG_INVALID', 'Add a record reference by defining a relationship.');
  }
  const config = parseConfig(input.type, input.config);
  const defaultValue = parseDefault(input.type, input.isMulti ?? false, input.defaultValue);
  const options = checkInitialOptions(scope, input);
  // The parent's row lock first: a replay is found under it, before the room check would count it twice.
  await lockAttributeParent(tx, parent);
  const id = input.id?.toLowerCase();
  if (id !== undefined) {
    const earlier = await earlierAttribute(tx, scope, id, parent);
    if (earlier !== undefined) return earlier;
  }
  await checkAttributeRoom(tx, scope, parent);
  await checkDefaultMembers(tx, input.type, defaultValue);
  const parentColumn =
    'objectId' in parent
      ? sql`${attributes.objectId} = ${parent.objectId}`
      : sql`${attributes.listId} = ${parent.listId}`;
  return attributeGuard(async () => {
    const [next] = await tx
      .execute<{ position: number }>(
        sql`select coalesce(max(${attributes.position}) + 1, 0)::int as position from ${attributes} where ${parentColumn}`,
      )
      .then((result) => result.rows);
    const [row] = await tx
      .insert(attributes)
      .values({
        ...(id === undefined ? {} : { id }),
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
    if (options.length > 0) await insertInitialOptions(tx, scope, row.id, input.type, options);
    // Its first rules (spec 0013): the row is new to this write, so nobody else holds it yet.
    const ruled =
      input.rules === undefined || input.rules.length === 0
        ? { attributeIds: [] }
        : await writeRules(context, await loadAttribute(tx, row.id), input.rules);
    context.record({ definitions: [{ ...parent, attributeIds: [...new Set([row.id, ...ruled.attributeIds])] }] });
    return { attributeId: row.id, replayed: false };
  });
}

/**
 * Checks the options an attribute is created with (spec 0012, AC-230): only a
 * select or status takes them, at most the options limit (AC-237), each with
 * a label, a hue and (a status stage only) an outcome and target time, no two
 * labels the same ignoring case, ids UUID v7. Refusals land on `options`.
 */
function checkInitialOptions(scope: EngineScope, input: AttributeInput): readonly InitialOption[] {
  const options = input.options ?? [];
  if (options.length === 0) return [];
  if (input.type !== 'select' && input.type !== 'status') {
    throw refuseOn('CONFIG_INVALID', 'Only select and status attributes have options.', 'options');
  }
  const limit = limitsOf(scope).optionsPerAttribute;
  if (options.length > limit) {
    throw refuse('LIMIT_REACHED', `An attribute holds at most ${String(limit)} options.`);
  }
  const labels = new Set<string>();
  for (const option of options) {
    checkLabel(option.label, 'options');
    checkHue(option.hue, 'options');
    checkTarget(option.targetTimeInStage, 'options');
    if (option.id !== undefined && !isUuidV7(option.id)) {
      throw refuseOn('CONFIG_INVALID', 'Each option id must be a UUID v7.', 'options');
    }
    if (input.type !== 'status' && hasStageSettings(option)) {
      throw refuseOn('CONFIG_INVALID', 'Only status stages have an outcome and a target time.', 'options');
    }
    const key = option.label.trim().toLowerCase();
    if (labels.has(key)) {
      throw refuseOn(
        'CONFIG_INVALID',
        `Two options are called ${option.label.trim()}. Give each its own label.`,
        'options',
      );
    }
    labels.add(key);
  }
  return options;
}

/** Inserts a new attribute's first options in one statement, in the order given; a status stage is open unless said otherwise. */
async function insertInitialOptions(
  tx: WorkspaceTx,
  scope: EngineScope,
  attributeId: string,
  type: AttributeType,
  options: readonly InitialOption[],
): Promise<void> {
  try {
    await tx.insert(attributeOptions).values(
      options.map((option, position) => ({
        ...(option.id === undefined ? {} : { id: option.id.toLowerCase() }),
        workspaceId: scope.workspaceId,
        attributeId,
        label: option.label.trim(),
        hue: option.hue,
        position,
        outcome: type === 'status' ? (option.outcome ?? 'open') : null,
        targetTimeInStage: option.targetTimeInStage ?? null,
        ...audit(scope),
      })),
    );
  } catch (error) {
    const pg = postgresError(error);
    if (pg?.code === '23505' && pg.constraint === 'attribute_options_pkey') {
      throw refuse('ID_TAKEN', 'An option with that id already exists.');
    }
    // Postgres' lower() and JavaScript's may differ on some letter: two labels alike after all.
    if (pg?.code === '23505' && pg.constraint === 'attribute_options_label') {
      throw refuseOn('CONFIG_INVALID', 'Two options share a label. Give each its own label.', 'options');
    }
    throw error;
  }
}

/**
 * `definitionGuard` for an attribute's own row: a taken API name refuses on
 * `apiSlug` (the dialog's field), and an id another attribute holds `ID_TAKEN`.
 */
async function attributeGuard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await definitionGuard(work);
  } catch (error) {
    if (isRefusal(error) && error.refusal.code === 'SLUG_TAKEN' && error.refusal.field === undefined) {
      throw refuseOn('SLUG_TAKEN', 'An attribute here already uses this API name. Pick another.', 'apiSlug');
    }
    const pg = postgresError(error);
    if (pg?.code === '23505' && pg.constraint === 'attributes_pkey') {
      throw refuse('ID_TAKEN', 'An attribute with that id already exists.');
    }
    throw error;
  }
}

/** Notes an attribute's change for the hooks: on its object, or on its list (spec 0007, AC-81). */
export function recordDefinition(
  context: Pick<WriteContext, 'record'>,
  attribute: Pick<AttributeDef, 'id' | 'objectId' | 'listId'>,
  /** Others of the same object the write changed too (a rule's count on the attributes its condition names). */
  alsoChanged: readonly string[] = [],
): void {
  const attributeIds = [...new Set([attribute.id, ...alsoChanged])];
  if (attribute.objectId !== null) {
    context.record({ definitions: [{ objectId: attribute.objectId, attributeIds }] });
  } else if (attribute.listId !== null) {
    context.record({ definitions: [{ listId: attribute.listId, attributeIds }] });
  }
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

/** One attribute a definition write changed, and where it sits: what a service reads back to answer. */
export interface AttributeRef {
  readonly attributeId: string;
  readonly objectId: string | null;
  readonly listId: string | null;
}

const refOf = (attribute: Pick<AttributeDef, 'id' | 'objectId' | 'listId'>): AttributeRef => ({
  attributeId: attribute.id,
  objectId: attribute.objectId,
  listId: attribute.listId,
});

/** Changes an attribute's title, description, required, unique, settings or default (AC-10, AC-11). */
export async function updateAttribute(
  scope: EngineScope,
  input: AttributeUpdate,
  hooks: readonly AfterWrite[] = [],
): Promise<AttributeRef> {
  requirePermission(scope, 'schema.manage');
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const attribute = await editable(tx, context.scope.access, input.attributeId);
      if (input.title !== undefined) checkName(input.title, 'title', 'title');
      checkDescription(input.description);
      if (input.isUnique === true && !UNIQUE_TYPES.includes(attribute.type)) {
        throw refuseOn(
          'CONFIG_INVALID',
          'Only text, email, domain, URL, phone and number attributes can be unique.',
          'isUnique',
        );
      }
      const defaultValue =
        input.defaultValue === undefined
          ? undefined
          : parseDefault(attribute.type, attribute.isMulti, input.defaultValue);
      if (defaultValue !== undefined) await checkDefaultMembers(tx, attribute.type, defaultValue);
      const turningOn = input.isUnique === true && !attribute.isUnique && attribute.archivedAt === null;
      const turningOff = input.isUnique === false && attribute.isUnique;
      if (turningOn) await fillUniqueKeys(tx, attribute, context.scope.access);
      if (turningOff) await clearUniqueKeys(tx, attribute.id);
      // Its rules (spec 0013), replaced as sent, under the row lock `editable` took.
      const ruled =
        input.rules === undefined ? { attributeIds: [] } : await writeRules(context, attribute, input.rules);
      await tx
        .update(attributes)
        .set({
          ...(input.title === undefined ? {} : { title: input.title.trim() }),
          ...(input.description === undefined
            ? {}
            : {
                description: input.description === null || input.description.trim() === '' ? null : input.description,
              }),
          ...(input.isRequired === undefined ? {} : { isRequired: input.isRequired }),
          ...(input.isUnique === undefined ? {} : { isUnique: input.isUnique }),
          ...(input.config === undefined ? {} : { config: parseConfig(attribute.type, input.config) }),
          ...(defaultValue === undefined ? {} : { defaultValue }),
          ...touched(scope),
        })
        .where(eq(attributes.id, attribute.id));
      recordDefinition(context, attribute, ruled.attributeIds);
      return refOf(attribute);
    },
    hooks,
  );
  return result;
}

/**
 * The other end of a record reference's relationship (spec 0012, AC-233),
 * locked for the rest of the write; none for a one way reference or any
 * other attribute.
 */
async function farEnd(tx: WorkspaceTx, attribute: AttributeDef): Promise<AttributeDef | undefined> {
  if (attribute.relationshipId === null) return undefined;
  const [relationship] = await tx
    .select({ fromAttributeId: relationships.fromAttributeId, toAttributeId: relationships.toAttributeId })
    .from(relationships)
    .where(eq(relationships.id, attribute.relationshipId));
  const farId =
    relationship === undefined
      ? null
      : relationship.fromAttributeId === attribute.id
        ? relationship.toAttributeId
        : relationship.fromAttributeId;
  return farId === null ? undefined : loadAttribute(tx, farId, true);
}

/**
 * Archives an attribute (spec 0012, AC-233): its values stay, it stops taking
 * writes, and a unique one frees its keys. A relationship's two ends archive
 * together, in the same write, each recording its own object's change.
 * Answers every end, archived now or already. The primary attribute and
 * system attributes never archive.
 */
export async function archiveAttribute(
  scope: EngineScope,
  attributeId: string,
  hooks: readonly AfterWrite[] = [],
): Promise<readonly AttributeRef[]> {
  requirePermission(scope, 'schema.manage');
  const { result } = await runWrite(
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
      const far = await farEnd(tx, attribute);
      const ends = far === undefined ? [attribute] : [attribute, far];
      const live = ends.filter((end) => end.archivedAt === null);
      for (const end of live) if (end.isUnique) await clearUniqueKeys(tx, end.id);
      if (live.length > 0) {
        await tx
          .update(attributes)
          .set({ archivedAt: sql`now()`, ...touched(scope) })
          .where(
            inArray(
              attributes.id,
              live.map((end) => end.id),
            ),
          );
      }
      for (const end of live) recordDefinition(context, end);
      return ends.map(refOf);
    },
    hooks,
  );
  return result;
}

/** The plural name of an object, for "Restore <Plural> first." */
async function pluralOf(tx: WorkspaceTx, objectId: string): Promise<string | undefined> {
  const [row] = await tx.select({ pluralName: objects.pluralName }).from(objects).where(eq(objects.id, objectId));
  return row?.pluralName;
}

/**
 * Restores an archived attribute (spec 0012, AC-233) at its old position; a
 * unique one takes its keys back, refusing `UNIQUE_HAS_DUPLICATES` if
 * duplicates appeared meanwhile. A relationship's two ends restore together.
 * Refuses `NOT_FOUND` ("Restore <Plural> first.") while the far end's object
 * is archived (for a one way reference, every object it points to). Answers
 * every end.
 */
export async function restoreAttribute(
  scope: EngineScope,
  attributeId: string,
  hooks: readonly AfterWrite[] = [],
): Promise<readonly AttributeRef[]> {
  requirePermission(scope, 'schema.manage');
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const attribute = await editable(tx, context.scope.access, attributeId);
      if (attribute.archivedBy !== null) {
        // Named only to someone who may see that object; anyone else hears it in general words.
        const plural =
          objectLevel(context.scope.access, attribute.archivedBy) === 'none'
            ? undefined
            : await pluralOf(tx, attribute.archivedBy);
        throw refuse(
          'NOT_FOUND',
          plural === undefined
            ? 'This links to an archived object. Restore that object first.'
            : `Restore ${plural} first.`,
          attribute.id,
        );
      }
      const far = await farEnd(tx, attribute);
      const ends = far === undefined ? [attribute] : [attribute, far];
      const archived = ends.filter((end) => end.archivedAt !== null);
      for (const end of archived) if (end.isUnique) await fillUniqueKeys(tx, end, context.scope.access);
      if (archived.length > 0) {
        await tx
          .update(attributes)
          .set({ archivedAt: null, ...touched(scope) })
          .where(
            inArray(
              attributes.id,
              archived.map((end) => end.id),
            ),
          );
      }
      for (const end of archived) recordDefinition(context, end);
      return ends.map(refOf);
    },
    hooks,
  );
  return result;
}

/**
 * Moves an attribute to `position` among its object's (or list's) own
 * attributes (spec 0012, AC-232): the others close up around it, archived
 * ones included, so a restore lands where it was, all numbered after the
 * system attributes, which never move. Renumbers in one statement under the
 * parent row's lock, the one every attribute create takes, so a create and a
 * move never interleave. Refuses `ATTRIBUTE_READ_ONLY` for a system
 * attribute. Records only the moved attribute's change.
 */
export async function reorderAttribute(
  scope: EngineScope,
  input: { readonly attributeId: string; readonly position: number },
  hooks: readonly AfterWrite[] = [],
): Promise<AttributeRef> {
  requirePermission(scope, 'schema.manage');
  if (!Number.isInteger(input.position) || input.position < 0) {
    throw refuseOn('CONFIG_INVALID', 'Give the position as a whole number from 0.', 'position');
  }
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const attribute = await editable(tx, context.scope.access, input.attributeId);
      const parent: AttributeParent =
        attribute.objectId !== null ? { objectId: attribute.objectId } : { listId: attribute.listId ?? '' };
      await lockAttributeParent(tx, parent);
      const ofParent =
        'objectId' in parent ? eq(attributes.objectId, parent.objectId) : eq(attributes.listId, parent.listId);
      const order = await tx
        .select({ id: attributes.id, isSystem: attributes.isSystem })
        .from(attributes)
        .where(ofParent)
        .orderBy(asc(attributes.position), asc(attributes.createdAt), asc(attributes.id));
      const system = order.filter((row) => row.isSystem).length;
      const rest = order.filter((row) => !row.isSystem && row.id !== attribute.id).map((row) => row.id);
      const to = Math.min(input.position, rest.length);
      const next = [...rest.slice(0, to), attribute.id, ...rest.slice(to)];
      const list = uuidArray(next);
      await tx.execute(sql`
        update ${attributes} set position = array_position(${list}, id) - 1 + ${system}::int
        where id = any(${list}) and position is distinct from array_position(${list}, id) - 1 + ${system}::int
      `);
      recordDefinition(context, attribute);
      return refOf(attribute);
    },
    hooks,
  );
  return result;
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
    async ({ tx, ...context }) => {
      if (input.singularName !== undefined) checkName(input.singularName, 'singular name', 'singularName');
      if (input.pluralName !== undefined) checkName(input.pluralName, 'plural name', 'pluralName');
      checkLook(input.icon, input.hue);
      const updated = await objectGuard(input, () =>
        tx
          .update(objects)
          .set({
            ...(input.singularName === undefined ? {} : { singularName: input.singularName.trim() }),
            ...(input.pluralName === undefined ? {} : { pluralName: input.pluralName.trim() }),
            ...(input.icon === undefined ? {} : { icon: input.icon }),
            ...(input.hue === undefined ? {} : { hue: input.hue }),
            ...touched(scope),
          })
          .where(eq(objects.id, input.objectId))
          .returning({ id: objects.id }),
      );
      const [object] = updated;
      if (object === undefined) throw refuse('NOT_FOUND', 'That object does not exist.');
      context.record({ definitions: [{ objectId: object.id, attributeIds: [] }] });
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
    async ({ tx, ...context }) => {
      const updated = await tx
        .update(objects)
        .set({ archivedAt: input.archived ? sql`coalesce(${objects.archivedAt}, now())` : null, ...touched(scope) })
        .where(eq(objects.id, input.objectId))
        .returning({ id: objects.id });
      const [object] = updated;
      if (object === undefined) throw refuse('NOT_FOUND', 'That object does not exist.');
      context.record({ definitions: [{ objectId: object.id, attributeIds: [] }] });
    },
    hooks,
  );
}

/**
 * The live attributes of an object, as definitions, in position order: only
 * those the principal may see (spec 0009, AC-141), so none for an object they
 * can't see. None for a malformed id. A record reference whose far object is
 * archived is archived too (spec 0012): left out unless `includeArchived`,
 * as the ones archived themselves are; `archivedBy` names that object.
 */
export async function listAttributes(
  scope: EngineScope,
  objectId: string,
  options: { readonly includeArchived?: boolean } = {},
) {
  if (!isUuid(objectId)) return [];
  const rows = await inWorkspace(scope, (tx) =>
    tx
      .select({ attribute: attributes, archivedBy: ARCHIVED_BY })
      .from(attributes)
      .where(
        options.includeArchived === true
          ? eq(attributes.objectId, objectId)
          : and(eq(attributes.objectId, objectId), isNull(attributes.archivedAt)),
      )
      .orderBy(attributes.position),
  );
  return rows.flatMap(({ attribute, archivedBy }) =>
    attributeVisible(scope.access, attribute) && (options.includeArchived === true || archivedBy === null)
      ? // The far object is named only to a principal who may see it; to anyone else the attribute is just archived.
        [
          {
            ...attribute,
            archivedBy: archivedBy !== null && objectLevel(scope.access, archivedBy) === 'none' ? null : archivedBy,
            isArchivedByObject: archivedBy !== null,
          },
        ]
      : [],
  );
}

/**
 * Moves an object to `position` in the workspace's order (spec 0012, AC-225):
 * the others close up around it, archived ones included, so a restored object
 * comes back where it was. Renumbers in one statement under the counters
 * row's lock, the one every object create takes, so a create and a move never
 * interleave. Records only the moved object's change.
 */
export async function reorderObject(
  scope: EngineScope,
  input: { readonly objectId: string; readonly position: number },
  hooks: readonly AfterWrite[] = [],
): Promise<void> {
  requirePermission(scope, 'schema.manage');
  const objectId = checkId(input.objectId, 'That object does not exist.');
  if (objectLevel(scope.access, objectId) === 'none') throw refuse('NOT_FOUND', 'That object does not exist.');
  if (!Number.isInteger(input.position) || input.position < 0) {
    throw refuseOn('CONFIG_INVALID', 'Give the position as a whole number from 0.', 'position');
  }
  await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      await lockCounters(tx, context.scope);
      const order = await tx
        .select({ id: objects.id })
        .from(objects)
        .where(eq(objects.workspaceId, context.scope.workspaceId))
        .orderBy(asc(objects.position), asc(objects.createdAt), asc(objects.id));
      const ids = order.map((row) => row.id);
      const from = ids.indexOf(objectId);
      if (from === -1) throw refuse('NOT_FOUND', 'That object does not exist.');
      const rest = ids.filter((id) => id !== objectId);
      const to = Math.min(input.position, rest.length);
      const next = [...rest.slice(0, to), objectId, ...rest.slice(to)];
      const list = uuidArray(next);
      await tx.execute(sql`
        update ${objects} set position = array_position(${list}, id) - 1
        where id = any(${list}) and position is distinct from array_position(${list}, id) - 1
      `);
      context.record({ definitions: [{ objectId, attributeIds: [] }] });
    },
    hooks,
  );
}
