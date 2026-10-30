// Changing an attribute's type in place, the safe subset (the field types pass, 31 October 2026). Spec 0013's
// full design (a ledger, three background jobs, history read in the type of its time, undo) needs its migration;
// this is the part that needs none: only pairs that keep every value (`TYPE_CHANGES` in `@crm/contracts/values`),
// on attributes holding at most `TYPE_CHANGE_MAX_VALUES` values, in one write.
//
// One plan serves the check and the change, so the preview can never promise what the write then refuses: it reads
// every current value (whatever the reader's record rules: a type change maps every value, and the counts say so),
// converts each with `convertValue`, and finds what depends on the attribute and couldn't follow (a board grouped
// by it, a view's filter the new type can't run, a live form or booking page filing an answer it can't take). The
// change locks the attribute row first, so every value write of it waits (`holdDefinitions` takes a key share lock
// on the same row) and then starts again on the new definition; it makes the plan again under that lock, refuses
// on any fail or blocker, and writes in one transaction: the definition, each value that changed form as a new
// version by the person changing it (so a record's history keeps the old one), the unique and sort keys, the rules
// the new type can't hold removed, and one coarse records change beside the definitions change, so every screen
// reads the column again.
import { sql } from 'drizzle-orm';
import type { PgInsertValue } from 'drizzle-orm/pg-core';
import {
  BookingQuestions,
  FormDocument,
  fitsAttribute,
  ViewConfig,
  type AttributeDefinition,
  type TypeChangeCheck,
  type TypeChangeTarget,
} from '@crm/contracts';
import { isGroupable } from '@crm/contracts/board';
import { conditionAttributeIds, type ValidationRule } from '@crm/contracts/validation';
import {
  AttributeConfig,
  AttributeDefault,
  checkRuleSettings,
  convertValue,
  TYPE_CHANGE_MAX_VALUES,
  TYPE_CHANGE_SPECS,
  typeChangeTargets,
  typeKeyOf,
  type ConditionAttribute,
  type ConvertContext,
  type FilterCondition,
  type FilterGroup,
  type ValidationRuleInput,
} from '@crm/contracts/values';
import { schema, type WorkspaceTx } from '@crm/db';
import { requirePermission } from '../access/check.ts';
import { objectLevel } from '../access/policy.ts';
import { inWorkspace } from '../access/run.ts';
import { attributeVisible, visibleRecords } from '../access/visibility.ts';
import { decodeValue, encodeValue, sameItems, type ItemColumns, type StoredItem } from '../engine/columns.ts';
import { checkNotAMatch, recordDefinition, touched } from '../engine/definitions.ts';
import { checkId, uuidArray } from '../engine/ids.ts';
import { baseLevel, compileFilter, type CompileContext } from '../engine/query/compile.ts';
import { isRefusal, refuse, refuseOn } from '../engine/refusals.ts';
import { actorRow, type EngineScope } from '../engine/scope.ts';
import { clearUniqueKeys, fillUniqueKeys, UNIQUE_TYPES, uniqueKeyOf } from '../engine/unique.ts';
import { isArchivedNow, ITEM_COLUMNS, loadAttribute, loadAttributes, type AttributeDef } from '../engine/values.ts';
import { runWrite, type AfterWrite, type WriteContext } from '../engine/write.ts';
import { loadRules, writeRules } from '../validation/rules.ts';
import { measurePattern } from '../validation/pattern.ts';
import { canSeeForm } from '../forms/shared.ts';
import { readOne } from './attributes.ts';
import { serverPhoneParser } from './phone.ts';

const { attributes, values } = schema;

/** What a type change asks for: the attribute, the picker key it becomes, and the new type's settings. */
export interface TypeChangeRequest {
  readonly attributeId: string;
  readonly to: TypeChangeTarget;
  readonly config?: Readonly<Record<string, unknown>> | undefined;
}

/** The names the refusals and the preview give each target. */
const TYPE_NAMES: Readonly<Record<TypeChangeTarget, string>> = {
  text: 'Text',
  long_text: 'Long text',
  multi_select: 'Multi select',
  number: 'Number',
  currency: 'Currency',
  email: 'Email',
  link: 'Link',
  phone: 'Phone',
};

/** The words of the check and its refusals. */
const WORDS = {
  notFound: 'That attribute does not exist.',
  notHere: (title: string, to: string) => `${title} can't change to ${to}.`,
  onList: 'A list’s own fields can’t change type yet.',
  tooMany: (title: string) =>
    `${title} holds more than ${TYPE_CHANGE_MAX_VALUES.toLocaleString('en-GB')} values, too many to change at once. Archive it and make a new one instead.`,
  fails: (count: number, to: string, reason: string) =>
    `${count === 1 ? '1 value' : `${count.toLocaleString('en-GB')} values`} can’t become ${to}: ${reason} Fix ${count === 1 ? 'it' : 'them'} first.`,
  uniqueOff: 'Unique turns off.',
  shared: (title: string, count: number) =>
    `${count === 1 ? '1 value' : `${count.toLocaleString('en-GB')} values`} would be shared by more than one record, and ${title} is unique. Merge or change them first.`,
  rulesRemoved: (count: number) =>
    `${count === 1 ? 'A rule that doesn’t' : `${String(count)} rules that don’t`} fit the new type ${count === 1 ? 'is' : 'are'} removed.`,
  requiredWhen: (title: string) =>
    `A “Required when” rule looks at ${title} in a way the new type can’t. Change that rule first.`,
  defaultCleared: 'Its default is cleared.',
  trashCleared: (count: number) =>
    `${count === 1 ? '1 value' : `${count.toLocaleString('en-GB')} values`} in the trash can’t convert and ${count === 1 ? 'is' : 'are'} cleared.`,
  grouped: (view: string, title: string) => `${view} groups by ${title}. Group it by another field first.`,
  totals: (view: string, title: string) => `${view} totals ${title}. Pick another total first.`,
  filters: (view: string, title: string, to: string) =>
    `${view} filters ${title} in a way ${to} can’t. Change that filter first.`,
  form: (form: string, title: string, to: string) =>
    `${form} files an answer onto ${title} that ${to} can’t take. Change that question first.`,
  page: (page: string, title: string, to: string) =>
    `${page} files an answer onto ${title} that ${to} can’t take. Change that question first.`,
  aView: 'A private view',
  aForm: 'A live form',
  aPage: 'A live booking page',
} as const;

/** One record's current value of the attribute, as stored. */
interface HeldValue {
  readonly ownerId: string;
  readonly isTrashed: boolean;
  readonly items: readonly StoredItem[];
}

/** One value written again in its new form: a new version on the record, or a cleared one for a value in the trash. */
interface Rewrite {
  readonly ownerId: string;
  readonly items: readonly ItemColumns[];
}

/** What a type change would do, worked out once for the check and the write alike. */
interface Plan {
  readonly attribute: AttributeDef;
  /** The attribute as it becomes. */
  readonly next: AttributeDef;
  readonly isPrimary: boolean;
  readonly check: Omit<TypeChangeCheck, 'failedRecordIds'>;
  /** Live records whose value can't convert, in id order (for the filtered table, after the reader's rules). */
  readonly failed: readonly string[];
  readonly rewrites: readonly Rewrite[];
  /** Number to currency: the code every amount takes, filled onto every row in place (no new version). */
  readonly fillCurrency: string | undefined;
  /** The rules removed, by the attribute they sit on: the rules each keeps. */
  readonly keptRules: ReadonlyMap<string, readonly ValidationRuleInput[]>;
  readonly defaultValue: unknown;
}

/** Whether the object names its records by this attribute. */
async function isPrimaryOf(tx: WorkspaceTx, attribute: AttributeDef): Promise<boolean> {
  if (attribute.objectId === null) return false;
  const rows = await tx.execute<{ id: string | null }>(
    sql`select primary_attribute_id::text as id from objects where id = ${attribute.objectId}::uuid`,
  );
  return rows.rows[0]?.id === attribute.id;
}

/** Every current value of the attribute, record by record, with whether the record is in the trash. */
async function heldValues(tx: WorkspaceTx, attributeId: string): Promise<readonly HeldValue[]> {
  const rows = await tx
    .select({
      ...ITEM_COLUMNS,
      ownerId: values.ownerId,
      isTrashed: sql<boolean>`exists (select 1 from records r where r.workspace_id = ${values.workspaceId} and r.id = ${values.ownerId} and r.deleted_at is not null)`,
    })
    .from(values)
    .where(sql`${values.attributeId} = ${attributeId} and ${values.activeUntil} is null and not ${values.isCleared}`)
    .orderBy(values.ownerId, values.position);
  const byOwner = new Map<string, { isTrashed: boolean; items: StoredItem[] }>();
  for (const row of rows) {
    const { ownerId, isTrashed, ...item } = row;
    const held = byOwner.get(ownerId) ?? { isTrashed, items: [] };
    held.items.push(item);
    byOwner.set(ownerId, held);
  }
  return [...byOwner].map(([ownerId, held]) => ({ ownerId, isTrashed: held.isTrashed, items: held.items }));
}

/** A stored item's value columns alone, as an encoding compares them (its place left out). */
function columnsOf({ position: _position, ...columns }: StoredItem): ItemColumns {
  return columns;
}

/** How many current values the attribute holds, counted before any is read. */
async function valueCount(tx: WorkspaceTx, attributeId: string): Promise<number> {
  const rows = await tx.execute<{ n: number }>(sql`
    select count(*)::int as n from "values"
    where attribute_id = ${attributeId}::uuid and active_until is null and not is_cleared
  `);
  return rows.rows[0]?.n ?? 0;
}

/** The leaf conditions of a filter that name `attributeId`, at any depth and behind any path. */
function conditionsOn(group: FilterGroup | undefined, attributeId: string): readonly FilterCondition[] {
  if (group === undefined) return [];
  return group.conditions.flatMap((item): readonly FilterCondition[] => {
    if ('conditions' in item) return conditionsOn(item, attributeId);
    let leaf: FilterCondition = item;
    while (leaf.operator === 'through') leaf = leaf.condition;
    return leaf.attributeId.toLowerCase() === attributeId ? [leaf] : [];
  });
}

/** Whether the new definition can still run `condition`: the compiler's own check, with nothing read. */
function stillRuns(scope: EngineScope, next: AttributeDef, condition: FilterCondition): boolean {
  if (next.objectId === null) return true;
  const context: CompileContext = {
    attributes: new Map([[next.id, next]]),
    relationships: new Map(),
    clock: { timeZone: 'UTC' },
    actor: scope.actor,
    access: scope.access,
  };
  try {
    compileFilter(context, baseLevel({ objectId: next.objectId }), { conjunction: 'and', conditions: [condition] });
    return true;
  } catch (error) {
    if (isRefusal(error) && error.refusal.code === 'FILTER_INVALID') return false;
    throw error;
  }
}

/** The views that use the attribute in a way the new type can't take: each a blocker, named only to who sees it. */
async function viewBlockers(
  scope: EngineScope,
  tx: WorkspaceTx,
  plan: { attribute: AttributeDef; next: AttributeDef; to: string },
) {
  const { attribute, next, to } = plan;
  const me = scope.actor.type === 'member' ? scope.actor.id : null;
  const rows = await tx.execute<{ name: string; config: unknown; seen: boolean }>(sql`
    select v.name, v.config, (v.visibility::text <> 'private' or v.creator_member_id = ${me}::uuid) as seen
    from views v
    where strpos(v.config::text, ${attribute.id}) > 0
    order by v.position, v.id
  `);
  const groupable = isGroupable({ type: next.type, isMulti: next.isMulti, isArchived: false });
  return rows.rows.flatMap((row): string[] => {
    const parsed = ViewConfig.safeParse(row.config);
    if (!parsed.success) return [];
    const config = parsed.data;
    const name = row.seen ? `The view “${row.name}”` : WORDS.aView;
    const found: string[] = [];
    if (!groupable && (config.groupBy === attribute.id || config.board?.groupByAttributeId === attribute.id)) {
      found.push(WORDS.grouped(name, attribute.title));
    }
    if (config.board?.totalAttributeId === attribute.id && next.type !== 'currency') {
      found.push(WORDS.totals(name, attribute.title));
    }
    if (conditionsOn(config.filter, attribute.id).some((condition) => !stillRuns(scope, next, condition))) {
      found.push(WORDS.filters(name, attribute.title, to));
    }
    return found;
  });
}

/**
 * Published forms (live or paused: a paused one takes answers again when resumed) and live booking pages filing an
 * answer onto the attribute that the new type can't take, by the forms' own rule (`fitsAttribute`).
 */
async function captureBlockers(
  scope: EngineScope,
  tx: WorkspaceTx,
  attribute: AttributeDef,
  next: AttributeDef,
  to: string,
) {
  const forms = await tx.execute<{
    name: string;
    document: unknown;
    main_object_id: string | null;
    live_version_id: string | null;
    live_object_id: string | null;
  }>(sql`
    select f.name, fv.document, f.main_object_id::text as main_object_id, f.live_version_id::text as live_version_id,
      lower(fv.document->'targets'->'main'->>'objectId') as live_object_id
    from forms f
    join form_versions fv on fv.workspace_id = f.workspace_id and fv.id = f.live_version_id
    where f.status <> 'archived' and strpos(fv.document::text, ${attribute.id}) > 0
    order by f.name, f.id
  `);
  const pages = await tx.execute<{ title: string; questions: unknown }>(sql`
    select p.title, p.questions from booking_pages p
    where p.status = 'live' and p.deleted_at is null and strpos(p.questions::text, ${attribute.id}) > 0
    order by p.title, p.id
  `);
  const breaks = (
    questions: readonly {
      readonly answerType: Parameters<typeof fitsAttribute>[0];
      readonly filedOn?: { readonly attributeId: string } | undefined;
    }[],
  ) =>
    questions.some(
      (question) =>
        question.filedOn?.attributeId.toLowerCase() === attribute.id && !fitsAttribute(question.answerType, next.type),
    );
  return [
    ...forms.rows.flatMap((row) => {
      const document = FormDocument.safeParse(row.document);
      if (!document.success || !breaks(document.data.questions)) return [];
      // A form the caller may not see is counted, never named (spec 0009, hidden means absent).
      const seen = canSeeForm(scope.access, {
        mainObjectId: row.main_object_id,
        liveVersionId: row.live_version_id,
        liveObjectId: row.live_object_id,
      });
      return [WORDS.form(seen ? `The form “${row.name}”` : WORDS.aForm, attribute.title, to)];
    }),
    ...pages.rows.flatMap((row) => {
      const questions = BookingQuestions.safeParse(row.questions);
      // A live page's title is on its public address: named, as the archive check names them.
      return questions.success && breaks(questions.data)
        ? [WORDS.page(`The booking page “${row.title}”`, attribute.title, to)]
        : [];
    }),
  ];
}

/** The rule as its `rules` input carries it. */
const inputOf = (rule: ValidationRule): ValidationRuleInput => ({
  id: rule.id,
  kind: rule.kind as ValidationRuleInput['kind'],
  params: { ...rule.params },
  ...(rule.condition === undefined ? {} : { condition: rule.condition }),
  ...(rule.message === undefined ? {} : { message: rule.message }),
});

/**
 * The rules the new type can't hold (spec 0013, AC-271: removed and listed): rules on the attribute whose kind or
 * settings don't fit it, and rules on its object's other attributes whose "Only when…" names it in a way it can't
 * read. Answers the rules each affected attribute keeps, how many go, and whether a Required when breaks (the
 * `rules` input can't carry one, so it can't be removed here: a blocker).
 */
async function rulePlan(tx: WorkspaceTx, attribute: AttributeDef, next: AttributeDef) {
  const kept = new Map<string, ValidationRuleInput[]>();
  if (attribute.objectId === null) return { kept, removed: 0, requiredWhenBreaks: false };
  const own = await loadAttributes(tx, attribute.objectId);
  const named = new Map<string, ConditionAttribute>(
    [...own.values()].map((each) => [
      each.id,
      { type: each.id === next.id ? next.type : each.type, isSystem: each.isSystem },
    ]),
  );
  const { rules } = await loadRules(tx, attribute.objectId);
  const touched = rules.filter(
    (rule) =>
      rule.attributeId === attribute.id ||
      (rule.condition !== undefined && conditionAttributeIds(rule.condition).includes(attribute.id)),
  );
  let removed = 0;
  let requiredWhenBreaks = false;
  const failing = new Set<string>();
  for (const rule of touched) {
    const holder = rule.attributeId === attribute.id ? next : own.get(rule.attributeId);
    if (holder === undefined) continue;
    const checked = checkRuleSettings(
      {
        kind: rule.kind,
        params: rule.params,
        ...(rule.condition === undefined ? {} : { condition: rule.condition }),
        ...(rule.message === undefined ? {} : { message: rule.message }),
      },
      { attribute: { type: holder.type, isMulti: holder.isMulti }, attributes: named, compile: measurePattern },
    );
    if (checked.ok) continue;
    if (rule.kind === 'required_when') requiredWhenBreaks = true;
    else {
      failing.add(rule.id);
      removed += 1;
    }
  }
  for (const holderId of new Set(rules.filter((rule) => failing.has(rule.id)).map((rule) => rule.attributeId))) {
    kept.set(
      holderId,
      rules
        .filter((rule) => rule.attributeId === holderId && rule.kind !== 'required_when' && !failing.has(rule.id))
        .map(inputOf),
    );
  }
  return { kept, removed, requiredWhenBreaks };
}

/** The new default: a static one converted (or cleared when it can't be), any other kind kept. */
function convertDefault(attribute: AttributeDef, from: string, to: string, context: ConvertContext) {
  const parsed = attribute.defaultValue === null ? undefined : AttributeDefault.safeParse(attribute.defaultValue);
  if (parsed === undefined || !parsed.success) return { value: null, cleared: false };
  if (parsed.data.kind !== 'static') return { value: parsed.data, cleared: false };
  const converted = convertValue(from, to, parsed.data.value, context);
  return converted.outcome === 'empty'
    ? { value: null, cleared: true }
    : { value: { kind: 'static', value: converted.value }, cleared: false };
}

/**
 * Works out a type change (the check's and the write's one plan). Refuses `FORBIDDEN` without `schema.manage`,
 * `NOT_FOUND` for an attribute the caller can't see, `TYPE_CHANGE_REFUSED` for a pair that isn't safe (or a list's
 * field), and `CONFIG_INVALID` on `config` for settings the new type doesn't take.
 */
async function planChange(
  scope: EngineScope,
  tx: WorkspaceTx,
  request: TypeChangeRequest,
  lock: boolean,
): Promise<Plan> {
  const attributeId = checkId(request.attributeId, WORDS.notFound);
  const attribute = await loadAttribute(tx, attributeId, lock);
  if (
    !attributeVisible(scope.access, attribute) ||
    (attribute.objectId !== null && objectLevel(scope.access, attribute.objectId) === 'none')
  ) {
    throw refuse('NOT_FOUND', WORDS.notFound, attribute.id);
  }
  if (attribute.objectId === null) throw refuse('TYPE_CHANGE_REFUSED', WORDS.onList, attribute.id);
  const to = request.to;
  const toName = TYPE_NAMES[to];
  const isPrimary = await isPrimaryOf(tx, attribute);
  const from = typeKeyOf(attribute);
  const targets = typeChangeTargets({ ...attribute, isPrimary, isArchived: isArchivedNow(attribute) });
  const spec = TYPE_CHANGE_SPECS[to];
  if (!targets.includes(to) || spec === undefined) {
    throw refuse('TYPE_CHANGE_REFUSED', WORDS.notHere(attribute.title, toName), attribute.id);
  }
  const config = AttributeConfig[spec.type].safeParse(request.config ?? {});
  if (!config.success) {
    throw refuseOn(
      'CONFIG_INVALID',
      config.error.issues[0]?.message ?? 'Those settings don’t fit this type.',
      'config',
    );
  }
  const settings: Readonly<Record<string, unknown>> = config.data;
  const context: ConvertContext = {
    ...(typeof settings.defaultCurrency === 'string' ? { defaultCurrency: settings.defaultCurrency } : {}),
    ...(typeof settings.defaultCountry === 'string' ? { defaultCountry: settings.defaultCountry } : {}),
    ...(spec.type === 'phone' ? { phone: await serverPhoneParser() } : {}),
  };
  const isUnique = attribute.isUnique && UNIQUE_TYPES.includes(spec.type);
  const next: AttributeDef = { ...attribute, type: spec.type, isMulti: spec.isMulti, isUnique, config: settings };
  const consequences: string[] = [];
  const blockers: string[] = [];

  const total = await valueCount(tx, attribute.id);
  if (total > TYPE_CHANGE_MAX_VALUES) {
    return {
      attribute,
      next,
      isPrimary,
      check: { total, converts: 0, fails: 0, consequences, blockers: [WORDS.tooMany(attribute.title)] },
      failed: [],
      rewrites: [],
      fillCurrency: undefined,
      keptRules: new Map(),
      defaultValue: null,
    };
  }

  // Every value: what it becomes, and whether its row must be written again in the new form.
  const held = await heldValues(tx, attribute.id);
  const fillCurrency = from === 'number' && to === 'currency' ? context.defaultCurrency : undefined;
  // Number to currency fills the code onto every row in place; currency to number reads the amount alone, so the
  // code it leaves on the row is never read. Neither writes a version: the amount itself never changed.
  const inPlace = from === 'currency' || fillCurrency !== undefined;
  const rewrites: Rewrite[] = [];
  const failed: string[] = [];
  const reasons = new Map<string, number>();
  const keys = new Map<string, number>();
  let converts = 0;
  let live = 0;
  let trashCleared = 0;
  for (const value of held) {
    if (!value.isTrashed) live += 1;
    const outcome = convertValue(from, to, decodeValue(attribute.type, attribute.isMulti, value.items), context);
    if (outcome.outcome === 'empty') {
      if (value.isTrashed) {
        trashCleared += 1;
        rewrites.push({ ownerId: value.ownerId, items: [] });
      } else {
        failed.push(value.ownerId);
        reasons.set(outcome.reason, (reasons.get(outcome.reason) ?? 0) + 1);
      }
      continue;
    }
    if (!value.isTrashed) converts += 1;
    const items = encodeValue(next.type, outcome.value);
    if (isUnique && !value.isTrashed) {
      for (const item of items) {
        const key = uniqueKeyOf(next.type, item);
        if (key !== null) keys.set(key, (keys.get(key) ?? 0) + 1);
      }
    }
    if (!inPlace && !sameItems(value.items.map(columnsOf), items)) rewrites.push({ ownerId: value.ownerId, items });
  }
  const reason = [...reasons].sort(([, a], [, b]) => b - a)[0]?.[0];
  if (failed.length > 0 && reason !== undefined) blockers.push(WORDS.fails(failed.length, toName, reason));
  const shared = [...keys.values()].filter((count) => count > 1).length;
  if (shared > 0) blockers.push(WORDS.shared(attribute.title, shared));
  if (trashCleared > 0) consequences.push(WORDS.trashCleared(trashCleared));

  // Unique off: a live form matching records on it would add a new record at every submission.
  if (attribute.isUnique && !isUnique) {
    consequences.push(WORDS.uniqueOff);
    try {
      await checkNotAMatch(tx, scope.access, [attribute], 'unique');
    } catch (error) {
      if (!isRefusal(error)) throw error;
      blockers.push(error.refusal.message);
    }
  }
  const ruled = await rulePlan(tx, attribute, next);
  if (ruled.removed > 0) consequences.push(WORDS.rulesRemoved(ruled.removed));
  if (ruled.requiredWhenBreaks) blockers.push(WORDS.requiredWhen(attribute.title));
  const fallback = convertDefault(attribute, from, to, context);
  if (fallback.cleared) consequences.push(WORDS.defaultCleared);
  blockers.push(...(await viewBlockers(scope, tx, { attribute, next, to: toName })));
  blockers.push(...(await captureBlockers(scope, tx, attribute, next, toName)));

  return {
    attribute,
    next: { ...next, defaultValue: fallback.value },
    isPrimary,
    check: {
      total: live,
      converts,
      fails: failed.length,
      ...(reason === undefined ? {} : { reason }),
      consequences,
      blockers,
    },
    failed,
    rewrites,
    fillCurrency,
    keptRules: ruled.kept,
    defaultValue: fallback.value,
  };
}

/** Up to 100 of the records whose value can't convert that the reader may open, for the filtered table. */
async function failedShown(tx: WorkspaceTx, scope: EngineScope, plan: Plan): Promise<readonly string[]> {
  const objectId = plan.attribute.objectId;
  if (objectId === null || plan.failed.length === 0) return [];
  const visible = await visibleRecords(
    tx,
    scope.access,
    plan.failed.map((recordId) => ({ objectId, recordId })),
  );
  return plan.failed.filter((id) => visible.has(id)).slice(0, 100);
}

/**
 * What changing an attribute's type would do (`TypeChangeCheck`), written nowhere. Refuses as `planChange` does;
 * everything that would stop the change is a blocker in the answer, never a refusal.
 */
export async function checkTypeChange(scope: EngineScope, request: TypeChangeRequest): Promise<TypeChangeCheck> {
  requirePermission(scope, 'schema.manage');
  return inWorkspace(scope, async (tx) => {
    const plan = await planChange(scope, tx, request, false);
    return { ...plan.check, failedRecordIds: [...(await failedShown(tx, scope, plan))] };
  });
}

/** Brings every key row of the attribute in line with its values, in one statement (`syncSortKey`'s set form). */
async function syncSortKeys(tx: WorkspaceTx, attributeId: string): Promise<void> {
  const columns = sql.raw(
    'workspace_id, owner_id, attribute_id, record_id, entry_id, live, text_key, number_key, code_key, date_key, time_key, option_id, bool_key',
  );
  await tx.execute(sql`
    with source as (
      select ${columns} from sort_key_sources where attribute_id = ${attributeId}::uuid
    ), gone as (
      delete from sort_keys k where k.attribute_id = ${attributeId}::uuid
        and not exists (select 1 from source s where s.owner_id = k.owner_id)
    )
    insert into sort_keys (${columns}) select ${columns} from source
    on conflict (workspace_id, owner_id, attribute_id) do update set
      live = excluded.live, text_key = excluded.text_key, number_key = excluded.number_key,
      code_key = excluded.code_key, date_key = excluded.date_key, time_key = excluded.time_key,
      option_id = excluded.option_id, bool_key = excluded.bool_key
  `);
}

/** Rows inserted per statement when values are written again. */
const INSERT_BATCH = 1_000;

/**
 * Writes each rewritten value as a new version by the person changing the type, by the write protocol: the
 * current rows end at `t` and the new rows (or a cleared marker, for a value in the trash) start at `t`, so the
 * old value stays in the record's history. The attribute row is locked, so no other write of it is under way.
 */
async function writeVersions(context: WriteContext, next: AttributeDef, rewrites: readonly Rewrite[]): Promise<void> {
  if (rewrites.length === 0) return;
  const { tx, scope } = context;
  const owners = rewrites.map((rewrite) => rewrite.ownerId);
  const stamp = await tx.execute<{ t: string }>(sql`
    select greatest(clock_timestamp(), coalesce(max(active_from) + interval '1 microsecond', clock_timestamp()))::text as t
    from "values" where attribute_id = ${next.id}::uuid and active_until is null and owner_id = any(${uuidArray(owners)})
  `);
  const t = stamp.rows[0]?.t;
  if (t === undefined) throw new Error('Could not stamp the new versions.');
  const at = sql`${t}::timestamptz`;
  await tx.execute(sql`
    update "values" set active_until = ${at}
    where attribute_id = ${next.id}::uuid and active_until is null and owner_id = any(${uuidArray(owners)})
  `);
  const by = actorRow(scope.actor);
  const rows = rewrites.flatMap((rewrite): PgInsertValue<typeof values>[] => {
    const base = {
      workspaceId: scope.workspaceId,
      versionId: sql`uuidv7()`,
      attributeId: next.id,
      ownerId: rewrite.ownerId,
      recordId: rewrite.ownerId,
      activeFrom: at,
      setByType: by.type,
      setById: by.id,
      setByMemberId: by.memberId,
    };
    return rewrite.items.length === 0
      ? [{ ...base, position: 0, isCleared: true }]
      : rewrite.items.map((item, position) => ({
          ...base,
          position,
          textValue: item.textValue,
          numberValue: item.numberValue,
          dateValue: item.dateValue,
          timestampValue: item.timestampValue === null ? null : sql`${item.timestampValue}::timestamptz`,
          boolValue: item.boolValue,
          optionId: item.optionId,
          actorType: item.actorType,
          actorId: item.actorId,
          actorMemberId: item.actorType === 'member' ? item.actorId : null,
          jsonValue: item.jsonValue,
        }));
  });
  for (let start = 0; start < rows.length; start += INSERT_BATCH) {
    await tx.insert(values).values(rows.slice(start, start + INSERT_BATCH));
  }
  // A new revision (spec 0006, AC-44), so a copy read before the change never replaces one read after it.
  await tx.execute(sql`update records set revision = revision + 1 where id = any(${uuidArray(owners)})`);
}

/**
 * Changes an attribute's type in place (the field types pass): every value converted in the same write, each one
 * that changed form a new version by the caller, the definition, Unique, the keys, the default and the rules the
 * new type can't hold removed, then one definitions change and one coarse records change for the object. Refuses
 * as the check does, and `TYPE_CHANGE_REFUSED` with the first blocker when anything would stop it. Answers the
 * attribute as it is now.
 */
export async function changeAttributeType(
  scope: EngineScope,
  request: TypeChangeRequest,
  hooks: readonly AfterWrite[] = [],
): Promise<AttributeDefinition> {
  requirePermission(scope, 'schema.manage');
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      // The row first, for update: value writes of it take a key share lock on it, so they wait for this one.
      const plan = await planChange(scope, tx, request, true);
      const [blocker] = plan.check.blockers;
      if (blocker !== undefined) throw refuse('TYPE_CHANGE_REFUSED', blocker, plan.attribute.id);
      const { attribute, next } = plan;
      await tx
        .update(attributes)
        .set({
          type: next.type,
          isMulti: next.isMulti,
          isUnique: next.isUnique,
          config: next.config,
          defaultValue: plan.defaultValue,
          ...touched(scope),
        })
        .where(sql`${attributes.id} = ${attribute.id}`);
      if (plan.fillCurrency !== undefined) {
        // Every row, current and past, so each version reads as an amount in the code chosen.
        await tx.execute(sql`
          update "values" set text_value = ${plan.fillCurrency}
          where attribute_id = ${attribute.id}::uuid and number_value is not null and text_value is null
        `);
      }
      await writeVersions(context, next, plan.rewrites);
      for (const [holderId, kept] of plan.keptRules) {
        const holder =
          holderId === attribute.id ? next : (await loadAttributes(tx, attribute.objectId ?? '')).get(holderId);
        if (holder !== undefined) await writeRules(context, holder, kept);
      }
      if (attribute.isUnique) await clearUniqueKeys(tx, attribute.id);
      if (next.isUnique) await fillUniqueKeys(tx, next, scope.access);
      await syncSortKeys(tx, attribute.id);
      // The attributes whose rules went changed too: their definitions carry their rules.
      recordDefinition(context, attribute, [...plan.keptRules.keys()]);
      // Every screen holding the column reads it again: its values changed shape with the type.
      if (attribute.objectId !== null) context.record({ coarseObjects: [attribute.objectId] });
      return { attributeId: attribute.id, objectId: attribute.objectId, listId: attribute.listId };
    },
    hooks,
  );
  return readOne(scope, result);
}
