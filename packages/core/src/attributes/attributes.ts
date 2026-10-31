// An object's attributes as the tables and settings read them (spec 0005;
// spec 0012 widens them): the definitions behind the columns, with options
// inline, and the settings that create, edit, move, archive and restore
// them. Reads and writes go through the scope the access door made.
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type {
  AttributeComputed,
  AttributeDefinition,
  AttributeOption,
  AttributeRelationship,
  ComputedDefinitionInput,
  PickerAttributeType,
} from '@crm/contracts';
import { computedBlocks, computedReason, createComputedAttribute } from '../computed/define.ts';
import { conditionAttributeIds } from '@crm/contracts/validation';
import {
  AttributeDefault,
  HUES,
  toApiSlug,
  type AttributeValidation,
  type FilterGroup,
  type Hue,
  type ValidationRuleInput,
  type ValidationRuleView,
} from '@crm/contracts/values';
import { schema, type WorkspaceTx } from '@crm/db';
import {
  archiveAttribute,
  defineAttribute,
  insertAttribute,
  reorderAttribute,
  restoreAttribute,
  updateAttribute,
  type AttributeRef,
} from '../engine/definitions.ts';
import { checkId } from '../engine/ids.ts';
import { refuse, refuseOn } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { ARCHIVED_BY } from '../engine/values.ts';
import { runWrite, type AfterWrite } from '../engine/write.ts';
import { requirePermission } from '../access/check.ts';
import { inWorkspace } from '../access/run.ts';
import { isOpen, objectLevel, readOnlyReason, visibleAttributes } from '../access/policy.ts';
import { attributeVisible, UNKNOWN_LIST } from '../access/visibility.ts';
import { canManageList, listManagersSentence, requireFieldManager } from '../lists/manager.ts';
import { relationshipBlocks } from '../relationships/blocks.ts';

const { attributeOptions, attributes, lists, members, objects, validationRules } = schema;

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
  /** Each attribute's rules the caller may see, in order (spec 0013). */
  readonly rules: ReadonlyMap<string, readonly ValidationRuleView[]>;
  /** The far objects the caller may see, for `archivedBy`. */
  readonly canSeeObject: (objectId: string) => boolean;
  /** Each record reference's relationship block (spec 0014), by attribute id. */
  readonly relationships?: ReadonlyMap<string, AttributeRelationship>;
  /** Each computed attribute's block (spec 0015), by attribute id. */
  readonly computed?: ReadonlyMap<string, AttributeComputed>;
}

/** An attribute's relationship block, when it is a side of one (spec 0014). */
function relationshipOf(id: string, context: DefinitionContext): { relationship?: AttributeRelationship } {
  const relationship = context.relationships?.get(id);
  return relationship === undefined ? {} : { relationship };
}

/** A computed attribute's block, when it is one (spec 0015). */
function computedOf(id: string, context: DefinitionContext): { computed?: AttributeComputed } {
  const computed = context.computed?.get(id);
  return computed === undefined ? {} : { computed };
}

function definitionOf(row: AttributeRow, context: DefinitionContext, readOnly?: string): AttributeDefinition {
  const parsedDefault = row.defaultValue === null ? undefined : AttributeDefault.safeParse(row.defaultValue);
  return {
    id: row.id,
    objectId: row.objectId ?? '',
    ...(row.listId === null ? {} : { listId: row.listId }),
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
    ...relationshipOf(row.id, context),
    ...computedOf(row.id, context),
    ...(readOnly === undefined ? {} : { readOnly: { reason: readOnly } }),
    validation: validationOf(row, context.rules.get(row.id) ?? []),
  };
}

/**
 * An attribute's validation (spec 0013): Required is "always" exactly when
 * `is_required` is set (so `isRequired` keeps its meaning), "when" when it
 * holds a Required When rule, else "never"; its other rules in order.
 */
function validationOf(row: AttributeRow, rules: readonly ValidationRuleView[]): AttributeValidation {
  const required = row.isRequired ? 'always' : rules.some((rule) => rule.kind === 'required_when') ? 'when' : 'never';
  return { required, rules: [...rules] };
}

const isGroup = (value: unknown): value is FilterGroup =>
  typeof value === 'object' &&
  value !== null &&
  'conjunction' in value &&
  'conditions' in value &&
  Array.isArray(value.conditions);

/**
 * The rules of some attributes, by attribute, in order, as the caller may see
 * them (spec 0013, AC-276): a rule whose condition names an attribute hidden
 * from the caller is left out (the server still enforces it). One read.
 */
async function rulesOf(
  tx: WorkspaceTx,
  objectId: string,
  canSee: (attributeId: string) => boolean,
): Promise<ReadonlyMap<string, readonly ValidationRuleView[]>> {
  const rows = await tx
    .select({
      id: validationRules.id,
      attributeId: validationRules.attributeId,
      kind: validationRules.kind,
      params: validationRules.params,
      condition: validationRules.condition,
      message: validationRules.message,
      position: validationRules.position,
    })
    .from(validationRules)
    .where(eq(validationRules.objectId, objectId))
    .orderBy(asc(validationRules.attributeId), asc(validationRules.position));
  const byAttribute = new Map<string, ValidationRuleView[]>();
  for (const row of rows) {
    const condition = isGroup(row.condition) ? row.condition : undefined;
    if (!conditionAttributeIds(condition).every(canSee)) continue;
    const view: ValidationRuleView = {
      id: row.id,
      kind: row.kind,
      params: isPlainObject(row.params) ? row.params : {},
      ...(condition === undefined ? {} : { condition }),
      ...(row.message === null ? {} : { message: row.message }),
      position: row.position,
    };
    const list = byAttribute.get(row.attributeId);
    if (list === undefined) byAttribute.set(row.attributeId, [view]);
    else list.push(view);
  }
  return byAttribute;
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
    // Hidden means absent (AC-276): a rule naming an attribute the caller can't see isn't theirs to read.
    const visibleIds = new Set(
      visibleAttributes(
        scope.access,
        rows.map(({ attribute }) => ({ ...attribute, objectId: id })),
      ).map((row) => row.id),
    );
    const anyRules = rows.some(({ attribute }) => attribute.ruleCount > 0);
    const context: DefinitionContext = {
      primaryAttributeId: object.primaryAttributeId,
      options: await optionsOf(
        tx,
        listed.filter((row) => OPTION_TYPES.includes(row.type)).map((row) => row.id),
      ),
      rules: anyRules ? await rulesOf(tx, id, (attributeId) => visibleIds.has(attributeId)) : new Map(),
      canSeeObject: (far) => objectLevel(scope.access, far) !== 'none',
      relationships: await relationshipBlocks(tx, scope.access, listed),
      computed: await computedBlocks(tx, listed),
    };
    return listed.map((row) =>
      definitionOf(
        row,
        context,
        readOnlyReason(scope.access, row, object) ??
          computedReason(row) ??
          (row.isSystem ? `${row.title} is set by the system.` : undefined),
      ),
    );
  });
}

/**
 * The list a fields read or write names, if the caller may read it (spec 0048,
 * decision 2): live, its object live and readable. Otherwise `NOT_FOUND`, as an
 * unknown list. Answers whether they may manage it (AC-4834) and change its
 * entries.
 */
async function readFieldsList(
  tx: WorkspaceTx,
  scope: EngineScope,
  listId: string,
  includeArchived: boolean,
): Promise<{
  readonly id: string;
  readonly objectId: string;
  readonly name: string;
  readonly canManage: boolean;
  readonly canWrite: boolean;
}> {
  const [list] = await tx
    .select({
      id: lists.id,
      objectId: lists.objectId,
      name: lists.name,
      archivedAt: lists.archivedAt,
      objectArchivedAt: objects.archivedAt,
      createdByMemberId: lists.createdByMemberId,
      makerStatus: members.status,
    })
    .from(lists)
    .innerJoin(objects, and(eq(objects.workspaceId, lists.workspaceId), eq(objects.id, lists.objectId)))
    .leftJoin(members, and(eq(members.workspaceId, lists.workspaceId), eq(members.id, lists.createdByMemberId)))
    .where(and(eq(lists.workspaceId, scope.workspaceId), eq(lists.id, listId)));
  const hidden =
    list === undefined ||
    (!includeArchived && (list.archivedAt !== null || list.objectArchivedAt !== null)) ||
    (!isOpen(scope.access) &&
      (objectLevel(scope.access, list.objectId) === 'none' || objectLevel(scope.access, list.id) === 'none'));
  if (hidden) throw refuse('NOT_FOUND', UNKNOWN_LIST);
  return {
    id: list.id,
    objectId: list.objectId,
    name: list.name,
    canManage: canManageList(scope, list, list.makerStatus === 'active'),
    canWrite:
      isOpen(scope.access) ||
      (objectLevel(scope.access, list.objectId) === 'write' && objectLevel(scope.access, list.id) === 'write'),
  };
}

/**
 * A list's own fields (spec 0048, AC-4807), system ones included (Added and
 * Added by), by position, with select and status options inline. Each carries
 * `listId` and, as `objectId`, the list's object. A list the caller can't read
 * is `NOT_FOUND`. A field reads as read only when the caller can't change the
 * list's entries, and a system field always. With `includeArchived`, archived
 * fields are listed too, marked.
 */
export async function listListAttributes(
  scope: EngineScope,
  listId: string,
  options: { readonly includeArchived?: boolean } = {},
): Promise<AttributeDefinition[]> {
  const id = checkId(listId, UNKNOWN_LIST);
  const includeArchived = options.includeArchived === true;
  return inWorkspace(scope, async (tx) => {
    const list = await readFieldsList(tx, scope, id, includeArchived);
    const rows = await tx
      .select({ attribute: attributes, archivedBy: ARCHIVED_BY })
      .from(attributes)
      .where(
        includeArchived
          ? and(eq(attributes.workspaceId, scope.workspaceId), eq(attributes.listId, id))
          : and(
              eq(attributes.workspaceId, scope.workspaceId),
              eq(attributes.listId, id),
              isNull(attributes.archivedAt),
            ),
      )
      .orderBy(asc(attributes.position), asc(attributes.createdAt), asc(attributes.id));
    // A list's fields follow its object's access (decision 2); a field rule hiding one leaves it out (hidden is absent).
    const listed = rows
      .filter(({ attribute }) => attributeVisible(scope.access, attribute))
      .map(({ attribute, archivedBy }) => ({ ...attribute, archivedBy, objectId: list.objectId }));
    const context: DefinitionContext = {
      primaryAttributeId: null,
      options: await optionsOf(
        tx,
        listed.filter((row) => OPTION_TYPES.includes(row.type)).map((row) => row.id),
      ),
      rules: new Map(),
      canSeeObject: (far) => objectLevel(scope.access, far) !== 'none',
    };
    const readOnly = list.canWrite ? undefined : `You can view the entries of ${list.name} but not change them.`;
    return listed.map((row) =>
      definitionOf(row, context, row.isSystem ? `${row.title} is set by the system.` : readOnly),
    );
  });
}

/**
 * Some attributes' definitions, as the caller sees them, archived ones too,
 * in the order asked: one read per object they sit on. An attribute the
 * caller can't see (or one on a list) is left out.
 */
export async function readDefinitions(
  scope: EngineScope,
  refs: readonly AttributeRef[],
): Promise<AttributeDefinition[]> {
  // An end on an object the caller can't see is left out, object and all (spec 0009, AC-140).
  const objectIds = [
    ...new Set(
      refs.flatMap((ref) =>
        ref.objectId === null || objectLevel(scope.access, ref.objectId) === 'none' ? [] : [ref.objectId],
      ),
    ),
  ];
  // A list's field is read through its list (spec 0048, AC-4834), which answers only a list the caller may read.
  const listIds = [...new Set(refs.flatMap((ref) => (ref.listId === null ? [] : [ref.listId])))];
  const listed = await Promise.all([
    ...objectIds.map((objectId) => listObjectAttributes(scope, objectId, { includeArchived: true })),
    ...listIds.map((listId) =>
      listListAttributes(scope, listId, { includeArchived: true }).catch(() => [] as AttributeDefinition[]),
    ),
  ]);
  const byId = new Map(listed.flat().map((definition) => [definition.id, definition]));
  return refs.flatMap((ref) => {
    const definition = byId.get(ref.attributeId);
    return definition === undefined ? [] : [definition];
  });
}

/** The one attribute a write changed, read back, or an error: a write answers what it made (its options too). */
export async function readOne(scope: EngineScope, ref: AttributeRef): Promise<AttributeDefinition> {
  const [made] = await readDefinitions(scope, [ref]);
  // Hidden from the caller since it was made (a replay under new rules): unknown to them.
  if (made === undefined) throw refuse('NOT_FOUND', ATTRIBUTE_NOT_FOUND);
  return made;
}

/** A new attribute, as settings and the table's "+" send it (spec 0012, AC-229). */
export interface CreateAttributeInput {
  readonly objectId: string;
  /** A field of one of the object's lists (spec 0048, AC-4811): its managers make it. */
  readonly listId?: string | undefined;
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
  /** A select's or status attribute's first options, in order (AC-230): each with its client id. */
  readonly options?: readonly NewAttributeOption[] | undefined;
  /** Its first validation rules, in order (spec 0013, AC-252). */
  readonly rules?: readonly ValidationRuleInput[] | undefined;
  /** A computed attribute (spec 0015): its type is then derived from it. */
  readonly computed?: ComputedDefinitionInput | undefined;
}

/** One option a new select or status attribute starts with (AC-230); a stage's target time is `P<N>D`. */
export interface NewAttributeOption {
  readonly id: string;
  readonly label: string;
  readonly hue: Hue;
  readonly outcome?: 'open' | 'won' | 'lost' | undefined;
  readonly targetTimeInStage?: string | undefined;
}

/**
 * Creates an attribute at the end of a live object's attributes (AC-229),
 * and answers it. Its API name is the one given, else `toApiSlug` of the
 * title. The same create again (same id, same object, same actor) answers
 * the attribute already made and writes nothing (AC-244). Refuses
 * `FORBIDDEN` without `schema.manage`, `NOT_FOUND` for an object that is
 * missing, archived or hidden, `SLUG_TAKEN` and `CONFIG_INVALID` on their
 * field, `LIMIT_REACHED` and `ID_TAKEN`. A select or status attribute is
 * made with its first options in the same write (AC-230).
 */
export async function createAttribute(
  scope: EngineScope,
  input: CreateAttributeInput,
  hooks: readonly AfterWrite[] = [],
): Promise<AttributeDefinition> {
  if (input.listId !== undefined) return createListAttribute(scope, { ...input, listId: input.listId }, hooks);
  requirePermission(scope, 'schema.manage');
  if (input.computed !== undefined) return createComputed(scope, { ...input, computed: input.computed }, hooks);
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
      ...(input.options === undefined
        ? {}
        : {
            options: input.options.map((option) => ({
              id: option.id,
              label: option.label,
              hue: option.hue,
              ...(option.outcome === undefined ? {} : { outcome: option.outcome }),
              ...(option.targetTimeInStage === undefined ? {} : { targetTimeInStage: option.targetTimeInStage }),
            })),
          }),
      ...(input.rules === undefined ? {} : { rules: input.rules }),
    },
    hooks,
  );
  return readOne(scope, { attributeId: made.attributeId, objectId, listId: null });
}

/**
 * A new computed attribute (spec 0015, AC-312): its type comes from its definition, and Required, Unique, a
 * default, options and rules are refused (AC-323). Answers it `filling`, as every member's table shows it.
 */
async function createComputed(
  scope: EngineScope,
  input: CreateAttributeInput & { readonly computed: ComputedDefinitionInput },
  hooks: readonly AfterWrite[],
): Promise<AttributeDefinition> {
  const taken = [
    input.isRequired === true ? 'isRequired' : undefined,
    input.isUnique === true ? 'isUnique' : undefined,
    input.defaultValue === undefined ? undefined : 'defaultValue',
    input.options === undefined || input.options.length === 0 ? undefined : 'options',
    input.rules === undefined || input.rules.length === 0 ? undefined : 'rules',
  ].find((each) => each !== undefined);
  if (taken !== undefined) {
    throw refuseOn('CONFIG_INVALID', 'A computed attribute is worked out, so it takes no such setting.', taken);
  }
  const objectId = checkId(input.objectId, OBJECT_NOT_FOUND);
  const made = await createComputedAttribute(
    scope,
    {
      id: input.id,
      objectId,
      title: input.title,
      apiSlug: input.apiSlug,
      description: input.description,
      computed: input.computed,
    },
    hooks,
  );
  return readOne(scope, { attributeId: made.attributeId, objectId, listId: null });
}

/**
 * A list's new field (spec 0048, AC-4811, AC-4834): its managers (`schema.manage`,
 * or the list's maker with `lists.manage`) make it, of any type but a record
 * reference; anyone else is 403 `FORBIDDEN` naming who may. A list the caller
 * can't read is `NOT_FOUND`.
 */
async function createListAttribute(
  scope: EngineScope,
  input: CreateAttributeInput & { readonly listId: string },
  hooks: readonly AfterWrite[],
): Promise<AttributeDefinition> {
  const listId = checkId(input.listId, UNKNOWN_LIST);
  const title = input.title.trim();
  const apiSlug =
    input.apiSlug === undefined || input.apiSlug.trim() === '' ? toApiSlug(title, 'attribute') : input.apiSlug.trim();
  const { result } = await runWrite(
    scope,
    async (context) => {
      const list = await readFieldsList(context.tx, scope, listId, false);
      if (list.objectId !== input.objectId.toLowerCase()) throw refuse('NOT_FOUND', UNKNOWN_LIST);
      if (!list.canManage) throw refuse('FORBIDDEN', await listManagersSentence(context.tx, scope, listId));
      return insertAttribute(context, {
        id: input.id,
        listId,
        apiSlug,
        title,
        type: input.type,
        ...(input.description === undefined || input.description.trim() === ''
          ? {}
          : { description: input.description }),
        ...(input.isMulti === undefined ? {} : { isMulti: input.isMulti }),
        ...(input.isRequired === undefined ? {} : { isRequired: input.isRequired }),
        ...(input.isUnique === undefined ? {} : { isUnique: input.isUnique }),
        ...(input.config === undefined ? {} : { config: input.config }),
        ...(input.defaultValue === undefined ? {} : { defaultValue: input.defaultValue }),
        ...(input.options === undefined
          ? {}
          : {
              options: input.options.map((option) => ({
                id: option.id,
                label: option.label,
                hue: option.hue,
                ...(option.outcome === undefined ? {} : { outcome: option.outcome }),
                ...(option.targetTimeInStage === undefined ? {} : { targetTimeInStage: option.targetTimeInStage }),
              })),
            }),
      });
    },
    hooks,
  );
  const made = (await listListAttributes(scope, listId)).find((each) => each.id === result.attributeId);
  if (made === undefined) throw refuse('NOT_FOUND', ATTRIBUTE_NOT_FOUND);
  return made;
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
  /** Its validation rules, in order (spec 0013, AC-252): the list replaces the attribute's own rules. */
  readonly rules?: readonly ValidationRuleInput[] | undefined;
  /** A computed attribute's new definition, of the same result type (spec 0015, AC-322). */
  readonly computed?: ComputedDefinitionInput | undefined;
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
  await requireFieldManager(scope, input.attributeId);
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
      ...(input.rules === undefined ? {} : { rules: input.rules }),
      ...(input.computed === undefined ? {} : { computed: input.computed }),
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
  await requireFieldManager(scope, input.attributeId);
  const attributeId = checkId(input.attributeId, ATTRIBUTE_NOT_FOUND);
  const moved = await reorderAttribute(scope, { attributeId, position: input.position }, hooks);
  if (moved.listId !== null) return listListAttributes(scope, moved.listId, { includeArchived: true });
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
  await requireFieldManager(scope, input.attributeId);
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
  await requireFieldManager(scope, input.attributeId);
  const attributeId = checkId(input.attributeId, ATTRIBUTE_NOT_FOUND);
  return readDefinitions(scope, await restoreAttribute(scope, attributeId, hooks));
}
