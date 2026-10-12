// Validation rules in the engine (spec 0013): the rule writes inside an
// attribute's create and edit (replace semantics, versions, the rule counts
// on attributes, the 20 rule limit), and the touched rule check every record
// write runs under the record's lock, after parsing and before writing.
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import {
  checkRules,
  conditionAttributeIds,
  ruleInputs,
  touchesRule,
  type RuleAttribute,
  type RuleFailure,
  type ValidationRule,
} from '@crm/contracts/validation';
import {
  checkRuleSettings,
  type ConditionAttribute,
  type EngineRefusal,
  type FilterGroup,
  type RuleCondition,
  type RuleKind,
  type ValidationRuleInput,
} from '@crm/contracts/values';
import { decodeValue } from '../engine/columns.ts';
import { isUuidV7, uuidArray } from '../engine/ids.ts';
import { checkRuleRoom } from '../engine/limits.ts';
import { refuseAll, refuseOn } from '../engine/refusals.ts';
import { linkValues } from '../engine/relationships.ts';
import { currentItems, isArchivedNow, loadAttributes, parseFor, type AttributeDef } from '../engine/values.ts';
import { actorRow, type EngineScope } from '../engine/scope.ts';
import type { WriteContext } from '../engine/write.ts';
import { SYSTEM_ACCESS } from '../access/policy.ts';
import { attributeVisible } from '../access/visibility.ts';
import { compilePattern } from './pattern.ts';

const { attributeOptions, attributes, validationRules } = schema;

/** An object's rules as one write read them, and the database's clock in the same statement. */
export interface LoadedRules {
  readonly rules: readonly ValidationRule[];
  /** The transaction's `now()`, in UTC: what "today" and relative dates resolve against. */
  readonly now: string;
}

/** The rules of one object, read once per write and kept on its context while the definitions hold still. */
export interface RuleCache {
  readonly key: string;
  readonly loaded: LoadedRules;
}

function isGroup(value: unknown): value is FilterGroup {
  return (
    typeof value === 'object' &&
    value !== null &&
    'conjunction' in value &&
    'conditions' in value &&
    Array.isArray(value.conditions)
  );
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * An object's rules, in attribute then rule position, with the
 * transaction's clock read in the same statement (spec 0013, "the database's
 * `now()`, read in the statement that loads the rules").
 */
export async function loadRules(tx: WorkspaceTx, objectId: string): Promise<LoadedRules> {
  const rows = await tx
    .select({
      id: validationRules.id,
      attributeId: validationRules.attributeId,
      kind: validationRules.kind,
      params: validationRules.params,
      condition: validationRules.condition,
      message: validationRules.message,
      position: validationRules.position,
      now: sql<string>`to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
    })
    .from(validationRules)
    .where(eq(validationRules.objectId, objectId))
    .orderBy(asc(validationRules.attributeId), asc(validationRules.position));
  const now =
    rows[0]?.now ??
    (
      await tx.execute<{ now: string }>(
        sql`select to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as now`,
      )
    ).rows[0]?.now ??
    new Date().toISOString();
  return {
    now,
    rules: rows.map((row) => ({
      id: row.id,
      attributeId: row.attributeId,
      kind: row.kind,
      params: isRecord(row.params) ? row.params : {},
      ...(isGroup(row.condition) ? { condition: row.condition } : {}),
      ...(row.message === null ? {} : { message: row.message }),
      position: row.position,
    })),
  };
}

/** The key a write's rule cache is good for: every attribute's rule version, so any rule change misses it. */
function cacheKey(attributesOf: ReadonlyMap<string, AttributeDef>): string {
  return [...attributesOf.values()]
    .map((attribute) => `${attribute.id}:${String(attribute.rulesVersion)}`)
    .sort()
    .join(',');
}

/** The object's rules for this write: from its context when the definitions it loaded still match, else read. */
async function rulesFor(
  context: WriteContext,
  objectId: string,
  attributesOf: ReadonlyMap<string, AttributeDef>,
): Promise<LoadedRules> {
  const key = cacheKey(attributesOf);
  const cached = context.rules.get(objectId);
  if (cached?.key === key) return cached.loaded;
  const loaded = await loadRules(context.tx, objectId);
  context.rules.set(objectId, { key, loaded });
  return loaded;
}

/** The writer's time zone when the runtime knows it, else UTC (spec 0013: an unknown zone reads as UTC). */
export function knownTimeZone(timeZone: string | undefined): string {
  if (timeZone === undefined || timeZone === '') return 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return timeZone;
  } catch {
    return 'UTC';
  }
}

/** One record write, as the rule check sees it. */
export interface RecordRuleCheck {
  readonly objectId: string;
  /** The record: undefined for a create, which holds nothing yet. */
  readonly recordId?: string;
  readonly attributes: ReadonlyMap<string, AttributeDef>;
  /** What the write sets, parsed: on a create, the given values and the defaults. */
  readonly parsed: readonly { readonly attribute: AttributeDef; readonly input: { readonly value: unknown } }[];
  readonly isCreate: boolean;
  readonly timeZone?: string | undefined;
  /** Takes the write's hold on its definitions (`holdDefinitions`), before any rule is read. */
  readonly hold: () => Promise<void>;
}

/** Whether a write may touch a rule at all: an attribute it touches has some (`rule_count`, exact). */
export function mayTouchRules(input: Pick<RecordRuleCheck, 'attributes' | 'parsed' | 'isCreate'>): boolean {
  return input.isCreate
    ? [...input.attributes.values()].some((attribute) => attribute.ruleCount > 0)
    : input.parsed.some(({ attribute }) => attribute.ruleCount > 0);
}

/** The attributes a create must hold still besides those it writes: every one that had rules when loaded. */
export function ruledAttributes(attributesOf: ReadonlyMap<string, AttributeDef>): readonly AttributeDef[] {
  return [...attributesOf.values()].filter((attribute) => attribute.ruleCount > 0);
}

/** Reads the current values a rule needs that the write doesn't set: value rows, and links for a reference. */
async function currentValues(
  tx: WorkspaceTx,
  recordId: string,
  needed: readonly AttributeDef[],
): Promise<Record<string, unknown>> {
  const plain = needed.filter((attribute) => attribute.type !== 'record_reference');
  const references = needed.filter((attribute) => attribute.type === 'record_reference');
  const values: Record<string, unknown> = {};
  if (plain.length > 0) {
    const items = await currentItems(
      tx,
      [recordId],
      plain.map((attribute) => attribute.id),
    );
    for (const attribute of plain) {
      values[attribute.id] = decodeValue(
        attribute.type,
        attribute.isMulti,
        items.filter((item) => item.attributeId === attribute.id),
      );
    }
  }
  if (references.length > 0) {
    // Every link, whoever writes: a rule holds for the record as it is, not as the writer sees it. Never answered.
    const links = await linkValues(tx, SYSTEM_ACCESS, [recordId], references);
    for (const attribute of references) {
      values[attribute.id] = links.values.get(recordId)?.get(attribute.id) ?? (attribute.isMulti ? [] : null);
    }
  }
  return values;
}

/** The labels of the options a condition's select or status attributes hold, for its summary. */
async function optionLabels(
  tx: WorkspaceTx,
  attributeIds: readonly string[],
): Promise<ReadonlyMap<string, readonly { id: string; label: string }[]>> {
  if (attributeIds.length === 0) return new Map();
  const rows = await tx
    .select({ id: attributeOptions.id, attributeId: attributeOptions.attributeId, label: attributeOptions.label })
    .from(attributeOptions)
    .where(inArray(attributeOptions.attributeId, [...attributeIds]));
  const byAttribute = new Map<string, { id: string; label: string }[]>();
  for (const row of rows) {
    const list = byAttribute.get(row.attributeId) ?? [];
    list.push({ id: row.id, label: row.label });
    byAttribute.set(row.attributeId, list);
  }
  return byAttribute;
}

/**
 * Checks the rules a record write touches (spec 0013, AC-254, AC-255) under
 * the record's lock, after its values parsed and before anything is written:
 * the write's hold on its definitions is taken first, then the object's rules
 * are read (only when an attribute the write touches has some), the values
 * the touched rules need that the write doesn't set are read, merged with the
 * write's, and `checkRules` runs. A failure refuses `VALIDATION_FAILED`,
 * naming every failing rule, and nothing is written.
 */
export async function checkRecordRules(context: WriteContext, input: RecordRuleCheck): Promise<void> {
  await input.hold();
  if (!mayTouchRules(input)) return;
  const { tx, scope } = context;
  const loaded = await rulesFor(context, input.objectId, input.attributes);
  const writable = [...input.attributes.values()].filter(
    (attribute) => !attribute.isSystem && !isArchivedNow(attribute),
  );
  const written = new Set(
    input.isCreate ? writable.map((attribute) => attribute.id) : input.parsed.map(({ attribute }) => attribute.id),
  );
  const touched = loaded.rules.filter((rule) => touchesRule(rule, written));
  if (touched.length === 0) return;

  const values: Record<string, unknown> = {};
  if (input.isCreate) {
    // A create holds only what it sets: everything else is empty.
    for (const attribute of writable) values[attribute.id] = attribute.type === 'checkbox' ? false : null;
  } else if (input.recordId !== undefined) {
    const needed = [...new Set(touched.flatMap(ruleInputs))]
      .filter((id) => !written.has(id))
      .flatMap((id) => {
        const attribute = input.attributes.get(id);
        return attribute === undefined || attribute.isSystem ? [] : [attribute];
      });
    Object.assign(values, await currentValues(tx, input.recordId, needed));
  }
  for (const { attribute, input: value } of input.parsed) values[attribute.id] = parseFor(attribute, value.value);

  const named = [...new Set(touched.flatMap((rule) => conditionAttributeIds(rule.condition)))].filter((id) => {
    const type = input.attributes.get(id)?.type;
    return type === 'select' || type === 'status';
  });
  const options = await optionLabels(tx, named);
  const ruleAttributes = new Map<string, RuleAttribute>(
    [...input.attributes.values()].map((attribute) => [
      attribute.id,
      {
        type: attribute.type,
        isMulti: attribute.isMulti,
        title: attribute.title,
        position: attribute.position,
        visible: attributeVisible(scope.access, attribute),
        archived: isArchivedNow(attribute),
        ...(options.has(attribute.id) ? { options: options.get(attribute.id) ?? [] } : {}),
      },
    ]),
  );
  const failures = checkRules({
    rules: touched,
    attributes: ruleAttributes,
    values,
    written,
    clock: { now: loaded.now, timeZone: knownTimeZone(input.timeZone), weekStart: 'monday' },
    actor: { type: scope.actor.type, id: scope.actor.id },
    pattern: compilePattern,
  });
  const [first, ...rest] = failures.map(toRefusal);
  if (first !== undefined) throw refuseAll([first, ...rest]);
}

/** A failing rule as a refusal: `VALIDATION_FAILED`, its message, its attribute (unless hidden) and its id. */
function toRefusal(failure: RuleFailure): EngineRefusal {
  return {
    code: 'VALIDATION_FAILED',
    message: failure.message,
    ruleId: failure.ruleId,
    ...(failure.attributeId === undefined ? {} : { attributeId: failure.attributeId }),
  };
}

// ---- rule writes -------------------------------------------------------------------------------------------------

/** Who made a rule and when it was last changed, from the scope's actor. */
function madeBy(scope: EngineScope) {
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

/** The columns an update of a rule moves: when, and by whom. */
function changedBy(scope: EngineScope) {
  const by = actorRow(scope.actor);
  return { updatedAt: sql`now()`, updatedByType: by.type, updatedById: by.id, updatedByMemberId: by.memberId };
}

/** A condition with every attribute id lower case, as ids are stored and compared. */
function canonicalCondition(group: RuleCondition): RuleCondition {
  return {
    conjunction: group.conjunction,
    conditions: group.conditions.map((item) =>
      'conjunction' in item
        ? canonicalCondition(item)
        : item.operator === 'through'
          ? item
          : { ...item, attributeId: item.attributeId.toLowerCase() },
    ),
  };
}

/** A stored rule, as the write compares it with the one sent. */
interface StoredRule {
  readonly id: string;
  readonly kind: RuleKind;
  readonly params: unknown;
  readonly condition: unknown;
  readonly message: string | null;
  readonly position: number;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

/** A value with every object's keys in order, so two spellings of one setting compare equal. */
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sorted(value[key])]),
    );
  }
  return value ?? null;
}

/** What `writeRules` changed: the attributes whose rule counts it moved (the rule's own first). */
export interface RulesWritten {
  readonly attributeIds: readonly string[];
}

/**
 * Replaces an attribute's rules with `inputs`, in order (spec 0013, AC-252,
 * AC-253): each rule's settings are checked (`checkRuleSettings`, patterns
 * compiled by RE2) and refused `CONFIG_INVALID` on `rules.<index>.<setting>`;
 * a rule left out is deleted; a kept one's `version` goes up when its kind,
 * settings or condition change. A rule id another attribute's rule holds is
 * `ID_TAKEN`. Then every attribute whose rule count moved (the rule's own,
 * and those an old or new condition names) gets its `rule_count` set exactly
 * and its `rules_version` moved on, under its row's lock, and more than 20
 * rules on the attribute refuses `LIMIT_REACHED`. The attribute's own row is
 * already locked by the caller. Runs inside the definition write.
 */
export async function writeRules(
  context: WriteContext,
  attribute: AttributeDef,
  inputs: readonly ValidationRuleInput[],
): Promise<RulesWritten> {
  const { tx, scope } = context;
  if (attribute.objectId === null) {
    throw refuseOn('CONFIG_INVALID', 'Rules on a list’s attributes come later.', 'rules');
  }
  const objectId = attribute.objectId;
  const ids = inputs.map((input) => input.id.toLowerCase());
  if (new Set(ids).size !== ids.length) throw refuseOn('CONFIG_INVALID', 'Each rule needs its own id.', 'rules');
  if (!ids.every(isUuidV7)) throw refuseOn('CONFIG_INVALID', 'A rule id must be a UUID v7.', 'rules');

  // What a condition may name: the object's own attributes the writer may see (no relationship path, no system one).
  const own = await loadAttributes(tx, objectId);
  const conditionAttributes = new Map<string, ConditionAttribute>(
    [...own.values()]
      .filter((each) => attributeVisible(scope.access, each))
      .map((each) => [each.id, { type: each.type, isSystem: each.isSystem }]),
  );
  const problems: EngineRefusal[] = [];
  const checked = inputs.map((input, index) => {
    const result = checkRuleSettings(
      {
        kind: input.kind,
        params: input.params,
        ...(input.condition === undefined ? {} : { condition: input.condition }),
        ...(input.message === undefined ? {} : { message: input.message }),
      },
      { attribute, attributes: conditionAttributes, compile: compilePattern },
    );
    if (!result.ok) {
      for (const problem of result.problems) {
        problems.push({
          code: 'CONFIG_INVALID',
          message: problem.message,
          field: `rules.${String(index)}.${problem.field}`,
        });
      }
      return undefined;
    }
    return {
      id: ids[index] ?? input.id,
      position: index,
      ...result.rule,
      ...(result.rule.condition === undefined ? {} : { condition: canonicalCondition(result.rule.condition) }),
    };
  });
  const [firstProblem, ...moreProblems] = problems;
  if (firstProblem !== undefined) throw refuseAll([firstProblem, ...moreProblems]);
  const next = checked.flatMap((rule) => (rule === undefined ? [] : [rule]));

  if (ids.length > 0) {
    const elsewhere = await tx
      .select({ id: validationRules.id })
      .from(validationRules)
      .where(and(inArray(validationRules.id, ids), ne(validationRules.attributeId, attribute.id)))
      .limit(1);
    if (elsewhere.length > 0) throw refuseAll([{ code: 'ID_TAKEN', message: 'A rule with that id already exists.' }]);
  }
  const stored: readonly StoredRule[] = await tx
    .select({
      id: validationRules.id,
      kind: validationRules.kind,
      params: validationRules.params,
      condition: validationRules.condition,
      message: validationRules.message,
      position: validationRules.position,
    })
    .from(validationRules)
    .where(eq(validationRules.attributeId, attribute.id));
  const storedById = new Map(stored.map((rule) => [rule.id, rule]));
  const nextIds = new Set(next.map((rule) => rule.id));
  const deleted = stored.filter((rule) => !nextIds.has(rule.id));
  const inserted = next.filter((rule) => !storedById.has(rule.id));
  const kept = next.flatMap((rule) => {
    const before = storedById.get(rule.id);
    if (before === undefined) return [];
    const meaning =
      before.kind !== rule.kind || !same(before.params, rule.params) || !same(before.condition, rule.condition);
    const wording = (before.message ?? undefined) !== rule.message;
    const moved = before.position !== rule.position;
    return meaning || wording || moved ? [{ rule, before, meaning, wording }] : [];
  });
  const changesRules = deleted.length > 0 || inserted.length > 0 || kept.some((each) => each.meaning || each.wording);
  if (!changesRules && kept.length === 0) return { attributeIds: [] };

  // Every attribute whose count can move: the rule's own, and any an old or new condition names.
  const conditionIds = (value: unknown) => (isGroup(value) ? conditionAttributeIds(value) : []);
  const affected = [
    ...new Set([
      attribute.id,
      ...deleted.flatMap((rule) => conditionIds(rule.condition)),
      ...inserted.flatMap((rule) => conditionIds(rule.condition)),
      ...kept.flatMap(({ rule, before }) => [...conditionIds(before.condition), ...conditionIds(rule.condition)]),
    ]),
  ].filter((id) => own.has(id));
  // The others' rows for update, in id order (the rule's own is already held): a value write on them waits, or is seen.
  const others = affected.filter((id) => id !== attribute.id).sort();
  if (others.length > 0) {
    await tx.execute(sql`select id from attributes where id = any(${uuidArray(others)}) order by id for update`);
  }

  if (deleted.length > 0) {
    await tx.delete(validationRules).where(
      inArray(
        validationRules.id,
        deleted.map((rule) => rule.id),
      ),
    );
  }
  if (inserted.length > 0) {
    await tx.insert(validationRules).values(
      inserted.map((rule) => ({
        workspaceId: scope.workspaceId,
        id: rule.id,
        objectId,
        attributeId: attribute.id,
        kind: rule.kind,
        params: rule.params,
        condition: rule.condition ?? null,
        message: rule.message ?? null,
        position: rule.position,
        ...madeBy(scope),
      })),
    );
  }
  for (const { rule, meaning } of kept) {
    await tx
      .update(validationRules)
      .set({
        kind: rule.kind,
        params: rule.params,
        condition: rule.condition ?? null,
        message: rule.message ?? null,
        position: rule.position,
        ...(meaning ? { version: sql`${validationRules.version} + 1` } : {}),
        ...changedBy(scope),
      })
      .where(eq(validationRules.id, rule.id));
  }
  if (!changesRules) return { attributeIds: [] };

  await recountRules(tx, objectId, affected);
  await checkRuleRoom(tx, scope, attribute.id);
  return { attributeIds: affected };
}

/**
 * Sets `rule_count` exactly on some attributes of an object (its own rules,
 * plus other attributes' rules whose condition names it) and moves their
 * `rules_version` on, in one statement. Their rows are already locked.
 */
async function recountRules(tx: WorkspaceTx, objectId: string, affected: readonly string[]): Promise<void> {
  if (affected.length === 0) return;
  const rules = await tx
    .select({ attributeId: validationRules.attributeId, condition: validationRules.condition })
    .from(validationRules)
    .where(eq(validationRules.objectId, objectId));
  const counts = affected.map((id) =>
    rules.reduce(
      (total, rule) =>
        total +
        (rule.attributeId === id || (isGroup(rule.condition) && conditionAttributeIds(rule.condition).includes(id))
          ? 1
          : 0),
      0,
    ),
  );
  await tx.execute(sql`
    update ${attributes} set rule_count = counted.count, rules_version = ${attributes.rulesVersion} + 1
    from unnest(${uuidArray([...affected])}, ${sql`array[${sql.join(
      counts.map((count) => sql`${count}`),
      sql`, `,
    )}]::int[]`}) as counted(id, count)
    where ${attributes.id} = counted.id
  `);
}
