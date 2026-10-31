// Defining computed attributes (spec 0015, `define.ts`): a definition is
// parsed, its inputs resolved and checked (live, on the right object, through
// a two way side, of a type it can read), its result type derived, the input
// graph checked for loops and depth, and the 50 limit counted. Then, in one
// write, the attribute row, its dependency index (`computed_inputs`), the
// `dependent_count` of each input, a lookup's mirrored options, and the whole
// fill that works its values out. `checkComputed` marks computed attributes
// whose inputs went away as not updating, and starts them again when they
// come back.
import { and, eq, sql } from 'drizzle-orm';
import {
  ComputedDefinitionInput,
  type AttributeDefinition,
  type ComputedDefinition,
  type ComputedPreview,
  type LookupDefinition,
  type RollupDefinition,
} from '@crm/contracts';
import {
  computedReadOnlyReason,
  lookupResult,
  lookupTargetProblem,
  rollupResult,
  rollupTakesTarget,
  rollupTargetProblem,
  type ComputedSource,
} from '@crm/contracts/computed';
import { checkFormulaSource, formulaErrorText, type FormulaAttribute } from '@crm/contracts/formula';
import {
  RELATIVE_OPERATORS,
  toApiSlug,
  type AttributeType,
  type FilterCondition,
  type FilterGroup,
} from '@crm/contracts/values';
import { schema, type WorkspaceTx } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import { objectLevel, recordRule, SYSTEM_ACCESS, type Access } from '../access/policy.ts';
import { attributeVisible } from '../access/visibility.ts';
import { inWorkspace } from '../access/run.ts';
import { insertAttribute, recordDefinition, touched } from '../engine/definitions.ts';
import { decodeValue } from '../engine/columns.ts';
import { checkId, uuidArray } from '../engine/ids.ts';
import { limitsOf, lockAttributeParent } from '../engine/limits.ts';
import { isRefusal, refuse, refuseOn } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import { computedKindOf, isArchivedNow, loadAttribute, loadAttributes, type AttributeDef } from '../engine/values.ts';
import { runWrite, type AfterWrite, type WriteContext } from '../engine/write.ts';
import { readRecords } from '../engine/records.ts';
import { checkGraph, type ComputedEdge } from './graph.ts';
import { archiveMirrors, syncMirrors } from './mirrors.ts';
import { FILL_FAILED, runningFill, startFill } from './jobs.ts';
import { formulaOf, formulaValues } from './formulas.ts';
import { computerOf, storedDefinition } from './recompute.ts';
import { loadVia, whereSql, type ViaSide } from './statements.ts';
import type { NextItems } from './write.ts';

const { attributes, computedInputs } = schema;

/** One input a definition reads, as `computed_inputs` stores it. */
interface InputRow {
  readonly inputId: string;
  readonly role: 'same_record' | 'far_value' | 'link' | 'far_condition' | 'option_labels';
  readonly viaId?: string;
}

/** A definition resolved against the workspace as it is now. */
export interface Resolved {
  readonly stored: ComputedDefinition;
  readonly result: { readonly type: AttributeType; readonly isMulti: boolean };
  readonly config: Readonly<Record<string, unknown>>;
  readonly inputs: readonly InputRow[];
  /** A lookup of a select or status: the attribute whose options it mirrors. */
  readonly mirrorOf?: string;
}

const invalid = (message: string) => refuse('CONFIG_INVALID', message);

/** A refusal carrying a formula's position on its refusal, as the API answers it. */
function invalidAt(message: string, position: number) {
  const error = refuse('CONFIG_INVALID', message);
  return Object.assign(error, {
    refusal: { ...error.refusal, position },
    refusals: [{ ...error.refusal, position }],
  });
}

/** Whether the caller may see an input: the field, and its object (spec 0009; spec 0015, AC-329). */
const canSee = (access: Access, attribute: AttributeDef): boolean =>
  attributeVisible(access, attribute) &&
  (attribute.objectId === null || objectLevel(access, attribute.objectId) !== 'none');

/** An attribute as the computed rules read it. */
const sourceOf = (attribute: AttributeDef): ComputedSource => ({
  type: attribute.type,
  isMulti: attribute.isMulti,
  isSystem: attribute.isSystem,
  apiSlug: attribute.apiSlug,
  isArchived: isArchivedNow(attribute),
});

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The side a lookup or rollup follows, checked: a live, two way side of this object. */
async function resolveVia(
  tx: WorkspaceTx,
  access: Access,
  objectId: string,
  viaId: string,
): Promise<{ via: ViaSide; title: string }> {
  const attribute = await loadAttribute(tx, viaId).catch(() => undefined);
  const via = attribute === undefined ? undefined : await loadVia(tx, attribute, objectId);
  // A side, or the far object, hidden from the caller answers as no side at all (spec 0009, AC-141).
  if (
    attribute === undefined ||
    via === undefined ||
    !canSee(access, attribute) ||
    objectLevel(access, via.farObjectId) === 'none'
  ) {
    throw invalid('Pick a relationship to look through.');
  }
  if (isArchivedNow(attribute)) throw invalid(`${attribute.title} is archived.`);
  return { via, title: attribute.title };
}

/** The related object's attribute a lookup or rollup reads, checked to be one of the far object's. */
async function resolveTarget(
  tx: WorkspaceTx,
  access: Access,
  via: ViaSide,
  targetId: string | undefined,
): Promise<AttributeDef> {
  const target = targetId === undefined ? undefined : await loadAttribute(tx, targetId).catch(() => undefined);
  if (target === undefined || target.objectId !== via.farObjectId || !canSee(access, target)) {
    throw invalid('Pick an attribute of the related records.');
  }
  return target;
}

/** Every leaf condition of a filter group. */
function leavesOf(group: FilterGroup): readonly FilterCondition[] {
  return group.conditions.flatMap((item) => ('conjunction' in item ? leavesOf(item) : [item]));
}

/** Count where's condition (AC-315): the related object's own attributes, no paths, no relative dates, no "me". */
function checkWhere(
  access: Access,
  where: FilterGroup,
  farAttributes: ReadonlyMap<string, AttributeDef>,
): readonly string[] {
  const ids: string[] = [];
  for (const leaf of leavesOf(where)) {
    if (leaf.operator === 'through') throw invalid('Count where uses the related records’ own attributes.');
    if ((RELATIVE_OPERATORS as readonly string[]).includes(leaf.operator) || leaf.operator === 'is_me') {
      throw invalid('Count where can’t use dates relative to today or “me” yet.');
    }
    const attribute = farAttributes.get(leaf.attributeId.toLowerCase());
    if (attribute === undefined || isArchivedNow(attribute) || !canSee(access, attribute)) {
      throw invalid('Count where names an attribute the related records don’t have.');
    }
    if (!ids.includes(attribute.id)) ids.push(attribute.id);
  }
  return ids;
}

async function resolveLookup(
  tx: WorkspaceTx,
  access: Access,
  objectId: string,
  definition: LookupDefinition,
): Promise<Resolved> {
  const { via } = await resolveVia(tx, access, objectId, definition.via);
  const target = await resolveTarget(tx, access, via, definition.target);
  // A lookup shows the related record's own value, so it is made only by someone who sees every related record.
  if (recordRule(access, via.farObjectId) !== undefined) throw invalid('Pick a relationship to look through.');
  const problem = lookupTargetProblem(sourceOf(target), via.holdsMany);
  if (problem !== undefined) throw invalid(`${target.title}: ${problem}`);
  const result = lookupResult(sourceOf(target), via.holdsMany);
  const config = result.type === target.type && isPlainObject(target.config) ? target.config : {};
  return {
    stored: { kind: 'lookup', via: via.attributeId, target: target.id },
    result: { type: result.type as AttributeType, isMulti: result.isMulti },
    config,
    inputs: [
      { inputId: via.attributeId, role: 'link', viaId: via.attributeId },
      { inputId: target.id, role: 'far_value', viaId: via.attributeId },
    ],
    ...(target.type === 'select' || target.type === 'status' ? { mirrorOf: target.id } : {}),
  };
}

async function resolveRollup(
  tx: WorkspaceTx,
  access: Access,
  objectId: string,
  definition: RollupDefinition,
): Promise<Resolved> {
  const { via } = await resolveVia(tx, access, objectId, definition.via);
  const takesTarget = rollupTakesTarget(definition.calc);
  const target = takesTarget ? await resolveTarget(tx, access, via, definition.target) : undefined;
  if (target !== undefined) {
    const problem = rollupTargetProblem(definition.calc, sourceOf(target));
    if (problem !== undefined) throw invalid(problem);
  }
  const conditionIds =
    definition.calc === 'count_where' && definition.where !== undefined
      ? checkWhere(access, definition.where, await loadAttributes(tx, via.farObjectId))
      : [];
  if (conditionIds.length > 0) {
    // The engine's own compiler checks each condition's operator and value, as a view's filter is checked.
    try {
      await whereSql(tx, definition, via.farObjectId);
    } catch (error) {
      if (isRefusal(error) && error.refusal.code === 'FILTER_INVALID') throw invalid(error.refusal.message);
      throw error;
    }
  }
  const result = rollupResult(definition.calc, target === undefined ? undefined : sourceOf(target));
  const targetCurrency =
    target !== undefined && isPlainObject(target.config) && typeof target.config.defaultCurrency === 'string'
      ? target.config.defaultCurrency
      : undefined;
  const currency = result.type === 'currency' ? (definition.currency ?? targetCurrency) : undefined;
  if (result.type === 'currency' && currency === undefined) throw invalid('Pick a currency.');
  const stored: RollupDefinition = {
    kind: 'rollup',
    via: via.attributeId,
    calc: definition.calc,
    ...(target === undefined ? {} : { target: target.id }),
    ...(definition.calc === 'count_where' && definition.where !== undefined ? { where: definition.where } : {}),
    ...(currency === undefined ? {} : { currency: currency as NonNullable<RollupDefinition['currency']> }),
  };
  return {
    stored,
    result: { type: result.type as AttributeType, isMulti: false },
    config: currency === undefined ? {} : { defaultCurrency: currency },
    inputs: [
      { inputId: via.attributeId, role: 'link', viaId: via.attributeId },
      ...(target === undefined ? [] : [{ inputId: target.id, role: 'far_value' as const, viaId: via.attributeId }]),
      ...conditionIds
        .filter((id) => id !== target?.id)
        .map((id) => ({ inputId: id, role: 'far_condition' as const, viaId: via.attributeId })),
    ],
  };
}

/** The object's attributes as a formula sees them, by API name, leaving the formula itself out. */
function formulaAttributes(
  access: Access,
  attributesOfObject: ReadonlyMap<string, AttributeDef>,
  selfId: string | undefined,
): ReadonlyMap<string, FormulaAttribute> {
  const bySlug = new Map<string, FormulaAttribute>();
  for (const attribute of attributesOfObject.values()) {
    // The formula itself, and anything hidden from the caller, is no attribute a formula can name.
    if (attribute.id === selfId || !canSee(access, attribute)) continue;
    const currency =
      attribute.type === 'currency' &&
      isPlainObject(attribute.config) &&
      typeof attribute.config.defaultCurrency === 'string'
        ? attribute.config.defaultCurrency
        : undefined;
    bySlug.set(attribute.apiSlug, {
      id: attribute.id,
      apiSlug: attribute.apiSlug,
      title: attribute.title,
      type: attribute.type,
      isMulti: attribute.isMulti,
      isArchived: isArchivedNow(attribute),
      ...(currency === undefined ? {} : { defaultCurrency: currency }),
    });
  }
  return bySlug;
}

async function resolveFormula(
  tx: WorkspaceTx,
  access: Access,
  objectId: string,
  source: string,
  selfId: string | undefined,
): Promise<Resolved> {
  const checked = checkFormulaSource(source, formulaAttributes(access, await loadAttributes(tx, objectId), selfId));
  if (!checked.ok) throw invalidAt(formulaErrorText(checked.error), checked.error.position);
  const resultType = { number: 'number', currency: 'currency', text: 'text', date: 'date', bool: 'checkbox' } as const;
  return {
    stored: { kind: 'formula', source, ast: checked.ast },
    result: { type: resultType[checked.type], isMulti: false },
    config: checked.currency === undefined ? {} : { defaultCurrency: checked.currency },
    inputs: [
      ...checked.references.map((id) => ({ inputId: id, role: 'same_record' as const })),
      ...checked.optionReferences.map((id) => ({ inputId: id, role: 'option_labels' as const })),
    ],
  };
}

/** Resolves a definition as sent against the object as it is now, or refuses `CONFIG_INVALID`. */
export async function resolveDefinition(
  tx: WorkspaceTx,
  access: Access,
  objectId: string,
  input: ComputedDefinitionInput,
  selfId?: string,
): Promise<Resolved> {
  const parsed = ComputedDefinitionInput.safeParse(input);
  if (!parsed.success) throw invalid(parsed.error.issues[0]?.message ?? 'That computed attribute is not valid.');
  const definition = parsed.data;
  if (definition.kind === 'lookup') return resolveLookup(tx, access, objectId, definition);
  if (definition.kind === 'rollup') return resolveRollup(tx, access, objectId, definition);
  return resolveFormula(tx, access, objectId, definition.source, selfId);
}

/** Every edge of the workspace's dependency index (definitions only: a few rows per computed attribute). */
async function allEdges(tx: WorkspaceTx): Promise<readonly ComputedEdge[]> {
  const rows = await tx
    .select({ computedId: computedInputs.computedAttributeId, inputId: computedInputs.inputAttributeId })
    .from(computedInputs);
  return rows;
}

/** Refuses a loop or a chain deeper than 3, and answers the attribute's depth. */
async function checkDepth(tx: WorkspaceTx, computedId: string, title: string, resolved: Resolved): Promise<number> {
  const edges = await allEdges(tx);
  const ids = [
    ...new Set([
      ...edges.flatMap((edge) => [edge.computedId, edge.inputId]),
      ...resolved.inputs.map((input) => input.inputId),
    ]),
  ];
  const titles = new Map<string, string>([[computedId, title]]);
  if (ids.length > 0) {
    const named = await tx
      .select({ id: attributes.id, title: attributes.title })
      .from(attributes)
      .where(sql`${attributes.id} = any(${uuidArray(ids)})`);
    for (const row of named) if (row.id !== computedId) titles.set(row.id, row.title);
  }
  const checked = checkGraph(
    edges,
    computedId,
    resolved.inputs.map((input) => input.inputId),
    titles,
  );
  if (!checked.ok) throw invalid(checked.message);
  return Math.max(1, checked.depth);
}

/** Replaces an attribute's dependency index and keeps every input's `dependent_count` exact. */
async function writeInputs(context: WriteContext, computedId: string, inputs: readonly InputRow[]): Promise<void> {
  const { tx, scope } = context;
  const before = await tx
    .delete(computedInputs)
    .where(eq(computedInputs.computedAttributeId, computedId))
    .returning({ inputId: computedInputs.inputAttributeId });
  const unique = [...new Map(inputs.map((input) => [`${input.inputId}:${input.role}`, input])).values()];
  if (unique.length > 0) {
    await tx.insert(computedInputs).values(
      unique.map((input) => ({
        workspaceId: scope.workspaceId,
        computedAttributeId: computedId,
        inputAttributeId: input.inputId,
        role: input.role,
        viaAttributeId: input.viaId ?? null,
      })),
    );
  }
  const was = new Set(before.map((row) => row.inputId));
  const now = new Set(unique.map((input) => input.inputId));
  const lost = [...was].filter((id) => !now.has(id));
  const gained = [...now].filter((id) => !was.has(id));
  if (lost.length > 0) {
    await tx
      .update(attributes)
      .set({ dependentCount: sql`greatest(${attributes.dependentCount} - 1, 0)` })
      .where(sql`${attributes.id} = any(${uuidArray(lost)})`);
  }
  if (gained.length > 0) {
    await tx
      .update(attributes)
      .set({ dependentCount: sql`${attributes.dependentCount} + 1` })
      .where(sql`${attributes.id} = any(${uuidArray(gained)})`);
  }
}

/** Refuses the 51st computed attribute of an object (AC-331), counted under the object's row lock. */
async function checkComputedRoom(tx: WorkspaceTx, scope: EngineScope, objectId: string): Promise<void> {
  await lockAttributeParent(tx, { objectId });
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(attributes)
    .where(and(eq(attributes.objectId, objectId), sql`${attributes.computed} is not null`));
  const limit = limitsOf(scope).computedPerObject;
  if ((row?.n ?? 0) + 1 > limit) {
    throw refuse('LIMIT_REACHED', `An object holds at most ${String(limit)} computed attributes.`);
  }
}

/** What a new computed attribute needs. */
export interface CreateComputedInput {
  readonly id: string;
  readonly objectId: string;
  readonly title: string;
  readonly apiSlug?: string | undefined;
  readonly description?: string | undefined;
  readonly computed: ComputedDefinitionInput;
}

/**
 * Creates a computed attribute (AC-312) with `schema.manage`: resolved and
 * checked, written with its inputs and mirrors, `filling` until its fill
 * ends. A replay of the same id answers the attribute already made.
 */
export async function createComputedAttribute(
  scope: EngineScope,
  input: CreateComputedInput,
  hooks: readonly AfterWrite[] = [],
): Promise<{ readonly attributeId: string }> {
  requirePermission(scope, 'schema.manage');
  const objectId = checkId(input.objectId, 'That object does not exist.');
  if (objectLevel(scope.access, objectId) === 'none') throw refuse('NOT_FOUND', 'That object does not exist.');
  const title = input.title.trim();
  const apiSlug =
    input.apiSlug === undefined || input.apiSlug.trim() === '' ? toApiSlug(title, 'attribute') : input.apiSlug.trim();
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      await checkComputedRoom(tx, context.scope, objectId);
      const resolved = await resolveDefinition(tx, context.scope.access, objectId, input.computed);
      const made = await insertAttribute(context, {
        id: input.id,
        objectId,
        apiSlug,
        title,
        type: resolved.result.type,
        isMulti: resolved.result.isMulti,
        config: resolved.config,
        ...(input.description === undefined || input.description.trim() === ''
          ? {}
          : { description: input.description }),
      });
      if (made.replayed) return { attributeId: made.attributeId };
      const depth = await checkDepth(tx, made.attributeId, title, resolved);
      await tx
        .update(attributes)
        .set({
          computed: resolved.stored,
          computedState: 'filling',
          computedVersion: 1,
          computedDepth: depth,
        })
        .where(eq(attributes.id, made.attributeId));
      await writeInputs(context, made.attributeId, resolved.inputs);
      if (resolved.mirrorOf !== undefined) await syncMirrors(context, resolved.mirrorOf, made.attributeId);
      await startFill(context, made.attributeId);
      await tellRestrictedMembers(context);
      return { attributeId: made.attributeId };
    },
    hooks,
  );
  return result;
}

/**
 * Changes a computed attribute's definition (AC-322), keeping its result type
 * ("Create a new attribute for a different result type." otherwise): its
 * inputs, mirrors and version change, and every record works out again in
 * the background, old values showing until replaced.
 */
export async function changeComputedDefinition(
  context: WriteContext,
  attribute: AttributeDef,
  input: ComputedDefinitionInput,
): Promise<void> {
  const { tx } = context;
  if (attribute.objectId === null || computedKindOf(attribute) === undefined) {
    throw invalid('Only a computed attribute takes a computed definition.');
  }
  const resolved = await resolveDefinition(tx, context.scope.access, attribute.objectId, input, attribute.id);
  if (resolved.result.type !== attribute.type || resolved.result.isMulti !== attribute.isMulti) {
    throw invalid('Create a new attribute for a different result type.');
  }
  const depth = await checkDepth(tx, attribute.id, attribute.title, resolved);
  const before = storedDefinition(attribute);
  await tx
    .update(attributes)
    .set({
      computed: resolved.stored,
      computedState: 'filling',
      computedError: null,
      computedVersion: sql`${attributes.computedVersion} + 1`,
      computedDepth: depth,
      ...(Object.keys(resolved.config).length === 0 ? {} : { config: resolved.config }),
      ...touched(context.scope),
    })
    .where(eq(attributes.id, attribute.id));
  await writeInputs(context, attribute.id, resolved.inputs);
  const oldTarget = before?.kind === 'lookup' ? before.target : undefined;
  if (oldTarget !== undefined && oldTarget !== resolved.mirrorOf) await archiveMirrors(tx, attribute.id);
  if (resolved.mirrorOf !== undefined) await syncMirrors(context, resolved.mirrorOf, attribute.id);
  await startFill(context, attribute.id);
  await tellRestrictedMembers(context);
  recordDefinition(context, attribute);
}

/**
 * A new or changed definition can hide a field from members under access rules (strictest of inputs, AC-329), and
 * the relay groups members by their policies: an `access` change naming the members rules can reach makes it read
 * their policies again, so no live event names the new attribute to someone it is hidden from. Nothing in a
 * workspace without rules.
 */
async function tellRestrictedMembers(context: WriteContext): Promise<void> {
  const rows = await context.tx.execute<{ id: string }>(sql`
    select m.id::text as id from members m
    where m.status = 'active' and m.role not in ('owner', 'admin')
      and (exists (select 1 from access_rules) or exists (select 1 from record_rules))
  `);
  if (rows.rows.length > 0) context.record({ access: rows.rows.map((row) => row.id) });
}

/** Refuses Required, Unique, a default and rules on a computed attribute (AC-323). */
export function refuseComputedSettings(
  attribute: AttributeDef,
  input: {
    readonly isRequired?: boolean;
    readonly isUnique?: boolean;
    readonly defaultValue?: unknown;
    readonly rules?: unknown;
  },
): void {
  if (computedKindOf(attribute) === undefined) return;
  const settings = [
    input.isRequired === true ? 'isRequired' : undefined,
    input.isUnique === true ? 'isUnique' : undefined,
    input.defaultValue !== undefined && input.defaultValue !== null ? 'defaultValue' : undefined,
    Array.isArray(input.rules) && input.rules.length > 0 ? 'rules' : undefined,
  ].filter((each) => each !== undefined);
  const [first] = settings;
  if (first !== undefined) {
    const words = { isRequired: 'Required', isUnique: 'Unique', defaultValue: 'default', rules: 'rules' }[first];
    throw refuseOn('CONFIG_INVALID', `${attribute.title} is worked out, so it takes no ${words}.`, first);
  }
}

/** Why a stored definition no longer checks, or undefined while it does. */
async function brokenReason(tx: WorkspaceTx, attribute: AttributeDef): Promise<string | undefined> {
  const definition = storedDefinition(attribute);
  if (definition === undefined || attribute.objectId === null) return undefined;
  const input: ComputedDefinitionInput =
    definition.kind === 'formula' ? { kind: 'formula', source: definition.source } : definition;
  try {
    // As the system: whether it still works never depends on who made the change.
    const resolved = await resolveDefinition(tx, SYSTEM_ACCESS, attribute.objectId, input, attribute.id);
    if (resolved.result.type !== attribute.type || resolved.result.isMulti !== attribute.isMulti) {
      return 'An attribute it reads changed type.';
    }
    return undefined;
  } catch (error) {
    if (!isRefusal(error)) throw error;
    return error.refusal.message;
  }
}

/**
 * Checks again every computed attribute that reads one of `changedIds` (an
 * archive, a restore, a type change, an object archived: AC-327, AC-339): one
 * that no longer checks stops updating ("Not updating: <reason>"), keeping its
 * values; one that checks again after stopping works out every record again.
 * With `dryRun` nothing is written, and the titles it would stop are answered.
 */
export async function checkComputed(
  context: WriteContext,
  changedIds: readonly string[],
  /** `refill`: a type change rewrote the input's values, so the ones still checking work out every record again. */
  options: { readonly dryRun?: boolean; readonly refill?: boolean } = {},
): Promise<readonly string[]> {
  if (changedIds.length === 0) return [];
  const { tx } = context;
  const rows = await tx.execute<{ id: string }>(sql`
    select distinct ci.computed_attribute_id::text as id from computed_inputs ci
    where ci.input_attribute_id = any(${uuidArray(changedIds)}) or ci.via_attribute_id = any(${uuidArray(changedIds)})
  `);
  const stopped: string[] = [];
  for (const row of rows.rows) {
    const attribute = await loadAttribute(tx, row.id);
    if (attribute.archivedAt !== null) continue;
    const reason = await brokenReason(tx, attribute);
    if (reason !== undefined && attribute.computedState !== 'broken') {
      stopped.push(attribute.title);
      if (options.dryRun === true) continue;
      await tx
        .update(attributes)
        .set({ computedState: 'broken', computedError: reason })
        .where(eq(attributes.id, attribute.id));
      recordDefinition(context, attribute);
    } else if (reason === undefined && attribute.computedState === 'broken' && options.dryRun !== true) {
      await tx
        .update(attributes)
        .set({ computedState: 'filling', computedError: null, computedVersion: sql`${attributes.computedVersion} + 1` })
        .where(eq(attributes.id, attribute.id));
      await startFill(context, attribute.id);
      recordDefinition(context, attribute);
    } else if (reason === undefined && options.refill === true && options.dryRun !== true) {
      await startFill(context, attribute.id);
    }
  }
  return stopped;
}

/** The attributes of objects, for `checkComputed` after an object is archived or restored. */
export async function attributesOfObject(tx: WorkspaceTx, objectId: string): Promise<readonly string[]> {
  const rows = await tx.select({ id: attributes.id }).from(attributes).where(eq(attributes.objectId, objectId));
  return rows.map((row) => row.id);
}

/**
 * Works a broken attribute's values out again after its fill failed (AC-334),
 * with `schema.manage`; 409 `CONFIG_INVALID` for one that isn't stopped by a failed fill.
 */
export async function refillComputed(
  scope: EngineScope,
  attributeId: string,
  hooks: readonly AfterWrite[] = [],
): Promise<{ readonly attributeId: string }> {
  requirePermission(scope, 'schema.manage');
  const id = checkId(attributeId, 'That attribute does not exist.');
  const { result } = await runWrite(
    scope,
    async (context) => {
      const attribute = await loadAttribute(context.tx, id, true);
      if (
        attribute.objectId === null ||
        !canSee(context.scope.access, attribute) ||
        computedKindOf(attribute) === undefined
      ) {
        throw refuse('NOT_FOUND', 'That attribute does not exist.');
      }
      const [row] = await context.tx
        .select({ error: attributes.computedError })
        .from(attributes)
        .where(eq(attributes.id, id));
      if (attribute.computedState !== 'broken' || row?.error !== FILL_FAILED) {
        throw refuse('CONFIG_INVALID', `${attribute.title} is not waiting to be worked out again.`);
      }
      await context.tx
        .update(attributes)
        .set({ computedState: 'filling', computedError: null, computedVersion: sql`${attributes.computedVersion} + 1` })
        .where(eq(attributes.id, id));
      await startFill(context, id);
      recordDefinition(context, attribute);
      return { attributeId: id };
    },
    hooks,
  );
  return result;
}

/** The computed block of some attributes' definitions, with a running fill's progress (AC-312). */
export async function computedBlocks(
  tx: WorkspaceTx,
  rows: readonly {
    readonly id: string;
    readonly type: AttributeType;
    readonly isMulti: boolean;
    readonly computed: unknown;
    readonly computedState: 'filling' | 'ok' | 'broken' | null;
    readonly computedError: string | null;
  }[],
): Promise<ReadonlyMap<string, NonNullable<AttributeDefinition['computed']>>> {
  const computed = rows.filter((row) => computedKindOf(row) !== undefined && row.computedState !== null);
  if (computed.length === 0) return new Map();
  const filling = computed.filter((row) => row.computedState === 'filling').map((row) => row.id);
  const fills = await runningFill({ tx }, filling);
  return new Map(
    computed.map((row) => {
      const stored = row.computed as ComputedDefinition;
      const definition: ComputedDefinitionInput =
        stored.kind === 'formula' ? { kind: 'formula', source: stored.source } : stored;
      const fill = fills.get(row.id);
      return [
        row.id,
        {
          kind: stored.kind,
          definition,
          state: row.computedState ?? 'ok',
          ...(row.computedError === null ? {} : { error: row.computedError }),
          resultType: { type: row.type, isMulti: row.isMulti },
          ...(fill === undefined
            ? {}
            : { fillJobId: fill.jobId, done: fill.done, ...(fill.total === undefined ? {} : { total: fill.total }) }),
        },
      ];
    }),
  );
}

/** A computed attribute's cell reason (AC-323, AC-327). */
export function computedReason(row: {
  readonly computed: unknown;
  readonly computedError: string | null;
  readonly computedState: string | null;
}) {
  const kind = computedKindOf(row);
  if (kind === undefined) return undefined;
  return computedReadOnlyReason(kind, row.computedState === 'broken' ? (row.computedError ?? undefined) : undefined);
}

/**
 * The preview (AC-312, AC-317) with `schema.manage`: the result type or the
 * first error, and the values for up to 5 of the object's most recently
 * updated records the caller may see, worked out by the same statements and
 * evaluator as the jobs, writing nothing.
 */
export async function previewComputed(
  scope: EngineScope,
  input: { readonly objectId: string; readonly definition: ComputedDefinitionInput },
): Promise<ComputedPreview> {
  requirePermission(scope, 'schema.manage');
  const objectId = checkId(input.objectId, 'That object does not exist.');
  if (objectLevel(scope.access, objectId) === 'none') throw refuse('NOT_FOUND', 'That object does not exist.');
  return inWorkspace(scope, async (tx) => {
    let resolved: Resolved;
    try {
      resolved = await resolveDefinition(tx, scope.access, objectId, input.definition);
    } catch (error) {
      if (!isRefusal(error) || error.refusal.code !== 'CONFIG_INVALID') throw error;
      const position = error.refusal.position;
      return {
        error: { message: error.refusal.message, ...(position === undefined ? {} : { position }) },
        samples: [],
      };
    }
    const preview: AttributeDef = {
      id: '00000000-0000-7000-8000-000000000000',
      objectId,
      listId: null,
      apiSlug: 'preview',
      objectKey: null,
      title: 'Preview',
      type: resolved.result.type,
      isMulti: resolved.result.isMulti,
      isRequired: false,
      isUnique: false,
      isSystem: false,
      systemColumn: null,
      archivedAt: null,
      archivedBy: null,
      config: resolved.config,
      defaultValue: null,
      relationshipId: null,
      position: 0,
      ruleCount: 0,
      rulesVersion: 0,
      computed: resolved.stored,
      computedState: 'ok',
    };
    // The 25 most recently updated live records (an index read), then the first 5 the caller may see.
    const recent = await tx.execute<{ id: string }>(sql`
      select id::text as id from records where object_id = ${objectId} and deleted_at is null
      order by updated_at desc, id desc limit 25
    `);
    const views = await readRecords(
      tx,
      scope.access,
      recent.rows.map((row) => row.id),
      { attributeIds: [] },
    );
    const order = recent.rows.map((row) => row.id);
    const refs = [...views]
      .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
      .slice(0, 5)
      .map((view) => ({ ...view.display, recordId: view.id }));
    const ids = refs.map((ref) => ref.recordId);
    const target = { ...preview, objectId };
    const stored = resolved.stored;
    let next: NextItems = new Map();
    if (stored.kind === 'formula') {
      const formula = formulaOf(preview);
      const attributesOfIt = await loadAttributes(tx, objectId);
      if (formula !== undefined) next = await formulaValues(tx, formula, attributesOfIt, ids);
    } else {
      const computer = await computerOf(tx, target, stored, true);
      // A lookup's options map to mirrors the preview hasn't made: it shows the related attribute's own.
      if (computer !== undefined) next = await computer(tx, ids);
    }
    return {
      resultType: resolved.result,
      samples: refs.map((ref) => ({
        record: ref,
        value: decodeValue(
          resolved.result.type,
          resolved.result.isMulti,
          (next.get(ref.recordId) ?? []).map((item, position) => ({ ...item, position })),
        ),
      })),
    };
  });
}
