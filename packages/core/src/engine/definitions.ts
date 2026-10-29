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
  ANONYMOUS,
  isUnfillableRequired,
  OPTION_DEFAULT_TYPES,
  parseAttributeValue,
  REQUIRED_NEEDS_AN_OPTION,
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
import {
  breakageNames,
  filedBy,
  isPeopleObject,
  liveFormsOn,
  livePagesOn,
  livePagesWalledBy,
} from '../forms/dependencies.ts';
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
  // A member and nothing else: a write refuses any other actor it adds (`checkActors`), so a default naming one
  // would block every create that leaves the field out.
  const ids = named.flatMap((each) =>
    typeof each === 'object' &&
    each !== null &&
    'type' in each &&
    each.type === 'member' &&
    'id' in each &&
    typeof each.id === 'string' &&
    isUuid(each.id)
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

/**
 * Refuses a select or status attribute that would be required with nothing to
 * fill it (the owner, 27 October 2026). Such an attribute makes every create
 * with nobody at the keyboard fail — a form submission, a booking page's
 * answers, an import row — long after the field was made, and with the
 * visitor's whole form already typed in. The caller has already tried to give
 * it the first option as its default (`firstOptionDefault`); reaching here
 * means there was no option to take, so there is nothing to fall back on.
 * Refused on `isRequired`, the switch the writer just flicked.
 */
function checkRequiredHasAFallback(type: AttributeType, isRequired: boolean, hasDefault: boolean, options: number) {
  if (!isRequired || hasDefault || !OPTION_DEFAULT_TYPES.includes(type) || options > 0) return;
  throw refuseOn('CONFIG_INVALID', REQUIRED_NEEDS_AN_OPTION, 'isRequired');
}

/**
 * The default a required select or status attribute is given when it has
 * none: its first option, exactly as the standard template's Deal Stage
 * carries one (`defaultFirstOption`, `standard-v1.ts`). Undefined when the
 * attribute needs no help. Preferred over refusing the write: the owner meant
 * "every record has a stage", and the first stage is the one they would pick.
 */
function firstOptionDefault(
  type: AttributeType,
  isRequired: boolean,
  hasDefault: boolean,
  firstOptionId: string | undefined,
): { readonly kind: 'static'; readonly value: string } | undefined {
  if (!isRequired || hasDefault || !OPTION_DEFAULT_TYPES.includes(type) || firstOptionId === undefined)
    return undefined;
  return { kind: 'static', value: firstOptionId };
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
  internal: { readonly reference?: boolean; readonly optionsFollow?: boolean } = {},
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
  // Required with nothing to fall back on: refused here rather than at every submission (27 October 2026). The
  // standard template writes its options in a second step and sets its own default, and says so (`optionsFollow`).
  const optionCount = options.length + (internal.optionsFollow === true ? 1 : 0);
  checkRequiredHasAFallback(input.type, input.isRequired ?? false, defaultValue !== null, optionCount);
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
    const optionIds = options.length === 0 ? [] : await insertInitialOptions(tx, scope, row.id, input.type, options);
    // A required select or status starts on its first option, as the template's Deal Stage does.
    const fallback = firstOptionDefault(input.type, input.isRequired ?? false, defaultValue !== null, optionIds[0]);
    if (fallback !== undefined) {
      await tx.update(attributes).set({ defaultValue: fallback }).where(eq(attributes.id, row.id));
    }
    // A field made required with nothing to fill it breaks a live form exactly as turning Required on does
    // (security review, 27 October 2026): the same refusal, one code path earlier.
    if (
      fallback === undefined &&
      'objectId' in parent &&
      isUnfillableRequired(
        { type: input.type, isRequired: input.isRequired ?? false, isSystem: false, defaultValue },
        ANONYMOUS,
      )
    ) {
      await checkLiveFormsFill(tx, scope.access, {
        id: row.id,
        objectId: parent.objectId,
        title: input.title.trim(),
        apiSlug: input.apiSlug,
        type: input.type,
      });
    }
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
): Promise<readonly string[]> {
  try {
    const made = await tx
      .insert(attributeOptions)
      .values(
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
      )
      .returning({ id: attributeOptions.id, position: attributeOptions.position });
    return [...made].sort((a, b) => a.position - b.position).map((option) => option.id);
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

/**
 * The settings a first attribute needs but the dialog has no room to ask for. Only currency has one: its type
 * refuses to be made without a default currency, and the dialog guesses `currency` from a name like "Budget", so
 * without this a person typing a word of their own language is refused for a setting they were never shown. USD
 * is the schema's own example, and the attribute's settings change it afterwards (26 October 2026).
 */
function firstConfig(attribute: { readonly type: string; readonly config?: unknown }): { config?: unknown } {
  if (attribute.config !== undefined || attribute.type !== 'currency') return {};
  return { config: { defaultCurrency: 'USD' } };
}

/**
 * Defines an object and its first attributes in one write (one transaction): the object with its system and
 * Name attributes, then each given attribute in order through `insertAttribute`. Any refusal rolls all of it
 * back. A replay of the same object id (a lost answer) answers the object already made and adds nothing.
 */
export async function defineObjectWithAttributes(
  scope: EngineScope,
  input: Omit<ObjectInput, 'standard'>,
  attributeInputs: readonly Omit<AttributeInput, 'objectId' | 'listId'>[],
  hooks: readonly AfterWrite[] = [],
) {
  requirePermission(scope, 'schema.manage');
  const { result } = await runWrite(
    scope,
    async (context) => {
      const made = await insertObject(context, input);
      if (made.replayed) return made;
      for (const attribute of attributeInputs) {
        await insertAttribute(context, { ...attribute, objectId: made.objectId, ...firstConfig(attribute) });
      }
      return made;
    },
    hooks,
  );
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

/**
 * Locks an attribute's row and, when it is a side of a relationship, the
 * other side's, in id order (spec 0014): every write that changes or checks
 * both sides (archive, restore, a rename) takes them in this one order, so
 * two such writes started from opposite sides take turns rather than
 * deadlock. A malformed id locks nothing (the write refuses it next).
 */
async function lockWithPair(tx: WorkspaceTx, attributeId: string): Promise<void> {
  if (!isUuid(attributeId)) return;
  const [row] = await tx
    .select({ fromAttributeId: relationships.fromAttributeId, toAttributeId: relationships.toAttributeId })
    .from(attributes)
    .innerJoin(
      relationships,
      and(eq(relationships.workspaceId, attributes.workspaceId), eq(relationships.id, attributes.relationshipId)),
    )
    .where(eq(attributes.id, attributeId));
  const ids = row === undefined ? [attributeId] : [row.fromAttributeId, row.toAttributeId ?? row.fromAttributeId];
  await tx
    .select({ id: attributes.id })
    .from(attributes)
    .where(inArray(attributes.id, [...new Set(ids)]))
    .orderBy(asc(attributes.id))
    .for('update');
}

/** The first live option of a select or status attribute, in its order, or undefined (none, or another type). */
async function firstLiveOption(tx: WorkspaceTx, attribute: AttributeDef): Promise<string | undefined> {
  if (!OPTION_DEFAULT_TYPES.includes(attribute.type)) return undefined;
  const [option] = await tx
    .select({ id: attributeOptions.id })
    .from(attributeOptions)
    .where(and(eq(attributeOptions.attributeId, attribute.id), isNull(attributeOptions.archivedAt)))
    .orderBy(asc(attributeOptions.position), asc(attributeOptions.id))
    .limit(1);
  return option?.id;
}

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
      // A rename of a relationship's side locks both sides first, in id order, as every write over both does.
      if (input.title !== undefined) await lockWithPair(tx, input.attributeId);
      const attribute = await editable(tx, context.scope.access, input.attributeId);
      if (input.title !== undefined) checkName(input.title, 'title', 'title');
      const far = input.title === undefined ? undefined : await farEnd(tx, attribute);
      // A relationship from an object to itself keeps two different names (spec 0014, AC-307).
      if (
        far !== undefined &&
        far.objectId === attribute.objectId &&
        far.title.trim().toLowerCase() === (input.title ?? '').trim().toLowerCase()
      ) {
        throw refuseOn('CONFIG_INVALID', 'Give each side its own name.', 'title');
      }
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
      // Turning Required on, or clearing the default of a required field, must leave something to fill it
      // (27 October 2026). An attribute already in that state is left exactly as it is: no edit of its title
      // refuses, and no write silently changes anyone's data.
      const required = input.isRequired ?? attribute.isRequired;
      const stored = defaultValue === undefined ? attribute.defaultValue : defaultValue;
      // A wall for a visitor now and not before: Required turned on, or the default cleared or made Current user,
      // which fills nothing for a visitor (late trap #10: a Current user default used to pass as a fill).
      // Clearing a default that gave nothing a visitor could use (a kind the type no longer allows) still counts, so
      // a select or status is still given its first option.
      const becomingATrap =
        isUnfillableRequired({ ...attribute, isRequired: required, defaultValue: stored ?? null }, ANONYMOUS) &&
        (!isUnfillableRequired(attribute, ANONYMOUS) ||
          (defaultValue === null && attribute.defaultValue !== null && attribute.defaultValue !== undefined));
      const firstOption = becomingATrap ? await firstLiveOption(tx, attribute) : undefined;
      if (becomingATrap) checkRequiredHasAFallback(attribute.type, true, false, firstOption === undefined ? 0 : 1);
      const fallback = firstOptionDefault(attribute.type, becomingATrap, false, firstOption);
      // Still a wall after the fallback (a text field, say): no live form could make a record any more.
      if (becomingATrap && fallback === undefined) await checkLiveFormsFill(tx, context.scope.access, attribute);
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
          ...(fallback !== undefined ? { defaultValue: fallback } : defaultValue === undefined ? {} : { defaultValue }),
          ...touched(scope),
        })
        .where(eq(attributes.id, attribute.id));
      recordDefinition(context, attribute, ruled.attributeIds);
      // The other side carries this side's name in its relationship block (spec 0014): its object changes too.
      if (far !== undefined && input.title !== undefined && input.title.trim() !== attribute.title) {
        recordDefinition(context, far);
      }
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
      await lockWithPair(tx, attributeId);
      const attribute = await editable(tx, context.scope.access, attributeId);
      const [primary] = await tx
        .select({ id: objects.id })
        .from(objects)
        .where(eq(objects.primaryAttributeId, attribute.id));
      if (primary !== undefined)
        throw refuse('CONFIG_INVALID', "A record's name attribute can't be archived.", attribute.id);
      const far = await farEnd(tx, attribute);
      const ends = far === undefined ? [attribute] : [attribute, far];
      await checkNotAMatch(tx, context.scope.access, ends);
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

/**
 * How a count of live forms reads when none of them may be named.
 */
const FORMS = (count: number) => `${String(count)} live forms`;
const A_FORM = 'A live form';

/**
 * Refuses archiving the attribute a live form matches its submissions on, or
 * the one a live booking page finds its visitor by (27 October 2026). Both
 * keep working to look at: nothing in the form or the page changes, and every
 * question still files. But the match answer is dropped with the archived
 * attribute (`plan`), so `matchKey` finds nothing and every submission takes
 * the create branch — a new record for the same person, every time, with
 * nobody told; a booking page's `answersRecord` gives up and the answers go
 * unsaved. Refused here, which is the moment someone can still choose
 * otherwise. A form the caller may not see is counted, never named.
 */
async function checkNotAMatch(tx: WorkspaceTx, access: Access, ends: readonly AttributeDef[]): Promise<void> {
  for (const attribute of ends) {
    if (attribute.objectId === null || attribute.archivedAt !== null) continue;
    const live = await liveFormsOn(tx, access, attribute.objectId);
    const matching = live.filter((form) => form.document.targets.main?.matchAttributeId === attribute.id);
    // A page finds its visitor by the object's first unique email, worked out afresh at every booking.
    const pages =
      attribute.isUnique && attribute.type === 'email' && (await isFirstUniqueEmail(tx, attribute))
        ? await livePagesOn(tx, attribute.objectId, await isPeopleObject(tx, attribute.objectId))
        : [];
    const count = matching.length + pages.length;
    if (count === 0) continue;
    const named = [
      ...matching.flatMap((form) => (form.name === undefined ? [] : [form.name])),
      ...pages.flatMap((page) => (page.title === undefined ? [] : [page.title])),
    ];
    const subject = breakageNames(named, count - named.length, A_FORM, FORMS);
    throw refuse(
      'CONFIG_INVALID',
      `${attribute.title} is how ${subject} ${count === 1 ? 'finds' : 'find'} the record a submission belongs to. Archiving it would make every submission add a new record instead. Point ${count === 1 ? 'that one' : 'those'} at another field first, or pause ${count === 1 ? 'it' : 'them'}.`,
      attribute.id,
    );
  }
}

/** Whether this is the object's first unique email, the one a booking page matches its visitor on. */
async function isFirstUniqueEmail(tx: WorkspaceTx, attribute: AttributeDef): Promise<boolean> {
  if (attribute.objectId === null) return false;
  const [first] = await tx
    .select({ id: attributes.id })
    .from(attributes)
    .where(
      and(
        eq(attributes.objectId, attribute.objectId),
        eq(attributes.isUnique, true),
        eq(attributes.type, 'email'),
        isNull(attributes.archivedAt),
      ),
    )
    .orderBy(asc(attributes.position), asc(attributes.createdAt), asc(attributes.id))
    .limit(1);
  return first?.id === attribute.id;
}

/**
 * Refuses making an attribute required when a live form has no question for
 * it (27 October 2026). The form's own publish check covers this before it
 * goes live; this is the other direction, where the form was fine and the
 * field changed under it. Run wherever a field can become a wall: made
 * required, turned required, or restored into that state. A form the caller
 * may not see is counted, never named.
 */
async function checkLiveFormsFill(
  tx: WorkspaceTx,
  access: Access,
  attribute: {
    readonly id: string;
    readonly objectId: string | null;
    readonly title: string;
    readonly apiSlug: string;
    readonly type: string;
  },
): Promise<void> {
  if (attribute.objectId === null) return;
  await checkLivePagesFill(tx, attribute);
  const live = await liveFormsOn(tx, access, attribute.objectId);
  const broken = live.filter((form) => !filedBy(form.document).has(attribute.id));
  if (broken.length === 0) return;
  const named = broken.flatMap((form) => (form.name === undefined ? [] : [form.name]));
  const subject = breakageNames(named, broken.length - named.length, A_FORM, FORMS);
  throw refuseOn(
    'CONFIG_INVALID',
    `${subject} ${broken.length === 1 ? 'is live and has no question for' : 'are live and have no question for'} ${attribute.title}, so every submission would fail. Add ${broken.length === 1 ? 'a question' : 'questions'} for it, give it a default, or pause ${broken.length === 1 ? 'that form' : 'those forms'} first.`,
    'isRequired',
  );
}

const PAGES = (count: number) => `${String(count)} live booking pages`;
const A_PAGE = 'A live booking page';

/**
 * Refuses making an attribute a wall for the live booking pages that make records on its object (late trap #11):
 * each booking would still go through, and quietly leave the guest out of the CRM. The forms check's twin, run
 * from it, so every road to a wall checks both. Pages are named: a live page's title is on its public address for
 * anyone, and the caller holds `schema.manage` (as `checkNotAMatch` names them).
 */
async function checkLivePagesFill(
  tx: WorkspaceTx,
  attribute: {
    readonly id: string;
    readonly objectId: string | null;
    readonly title: string;
    readonly apiSlug: string;
    readonly type: string;
  },
): Promise<void> {
  const pages = await livePagesWalledBy(tx, attribute);
  if (pages.length === 0) return;
  const one = pages.length === 1;
  const named = pages.flatMap((page) => (page.title === undefined ? [] : [page.title]));
  const subject = breakageNames(named, pages.length - named.length, A_PAGE, PAGES);
  throw refuseOn(
    'CONFIG_INVALID',
    `${subject} ${one ? 'is live and makes' : 'are live and make'} records here at bookings, with nothing for ${attribute.title}, so each guest would be left out of the CRM. Give it a default, or pause ${one ? 'that page' : 'those pages'} first.`,
    'isRequired',
  );
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
      await lockWithPair(tx, attributeId);
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
      // Archive, submissions pass, restore, submissions fail: a required end with nothing to fill it is a wall
      // again the moment it comes back (security review, 27 October 2026).
      for (const end of archived) {
        if (isUnfillableRequired({ ...end, defaultValue: end.defaultValue }, ANONYMOUS)) {
          await checkLiveFormsFill(tx, context.scope.access, end);
        }
      }
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

/**
 * Refuses archiving an object a form is taking submissions onto (27 October
 * 2026). An archived object takes no new records (`liveObject`), so every
 * submission would fail on a sentence written for a member looking at
 * settings — "That object is archived. Restore it first." — shown to a
 * visitor who had just filled the form in. Refused here, naming the forms,
 * which is the moment someone can still pause them instead.
 */
async function checkNoLiveForms(tx: WorkspaceTx, access: Access, objectId: string): Promise<void> {
  const live = await liveFormsOn(tx, access, objectId);
  if (live.length === 0) return;
  const named = live.flatMap((form) => (form.name === undefined ? [] : [form.name]));
  const subject = breakageNames(named, live.length - named.length, A_FORM, FORMS);
  throw refuse(
    'CONFIG_INVALID',
    `${subject} ${live.length === 1 ? 'is' : 'are'} live and files submissions here, and an archived object takes no new records. Pause ${live.length === 1 ? 'that form' : 'those forms'} first, or send ${live.length === 1 ? 'it' : 'them'} to another object.`,
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
      if (input.archived) await checkNoLiveForms(tx, context.scope.access, input.objectId.toLowerCase());
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
