// Select and status options (spec 0004, AC-4; spec 0012, AC-236 to AC-238).
// Each change touches option rows only: renaming, recolouring, reordering or
// archiving an option never rewrites a value.
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import { nextHue } from '@crm/contracts/values';
import { audit, recordDefinition, touched } from './definitions.ts';
import { checkId, isUuid, isUuidV7 } from './ids.ts';
import { checkOptionRoom } from './limits.ts';
import { checkHue, checkLabel, checkTarget, hasStageSettings, type OptionOutcome } from './option-rules.ts';
import { postgresError, refuse, refuseOn } from './refusals.ts';
import type { EngineScope } from './scope.ts';
import { loadAttribute, type AttributeDef } from './values.ts';
import { runWrite, type AfterWrite, type WriteContext } from './write.ts';
import { inWorkspace } from '../access/run.ts';
import { requirePermission } from '../access/check.ts';
import { isOpen } from '../access/policy.ts';
import { attributeVisible } from '../access/visibility.ts';

const { attributeOptions, attributes } = schema;

export type { OptionOutcome } from './option-rules.ts';

/**
 * What a new option needs. `hue` is the next one after the last option's
 * (`nextHue`) when absent. `outcome` and `targetTimeInStage` (an ISO 8601
 * duration) are for status stages only; a status option is open unless said
 * otherwise.
 */
export interface OptionInput {
  /**
   * A UUID v7 the client minted (spec 0012, AC-244): the retry key. The same
   * create again (same attribute, same actor) answers the option already made
   * and writes nothing; anyone else's option with that id is `ID_TAKEN`.
   */
  readonly id?: string;
  readonly attributeId: string;
  readonly label: string;
  readonly hue?: string;
  readonly outcome?: OptionOutcome;
  readonly targetTimeInStage?: string | null;
}

/** What an option may change to. `position` moves it to that place in its attribute's order. */
export interface OptionUpdate {
  readonly optionId: string;
  readonly label?: string;
  readonly hue?: string;
  readonly position?: number;
  readonly outcome?: OptionOutcome;
  readonly targetTimeInStage?: string | null;
  readonly archived?: boolean;
}

/** One option a write changed, and the attribute it belongs to: what a service reads back to answer. */
export interface OptionRef {
  readonly optionId: string;
  readonly attributeId: string;
  readonly objectId: string | null;
  readonly listId: string | null;
}

/** What inserting an option made: its id, and whether an earlier try of the same create already made it. */
export interface InsertedOption {
  readonly optionId: string;
  /** The same create came again after a lost answer: nothing was written this time. */
  readonly replayed: boolean;
}

const LABEL_TAKEN = 'An option with that label already exists. Pick another label.';

/**
 * A label a live option of the attribute already holds (ignoring case)
 * refuses `CONFIG_INVALID` on `label`; an id another option holds `ID_TAKEN`.
 */
async function optionGuard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const pg = postgresError(error);
    if (pg?.code === '23505' && pg.constraint === 'attribute_options_label') {
      throw refuseOn('CONFIG_INVALID', LABEL_TAKEN, 'label');
    }
    if (pg?.code === '23505' && pg.constraint === 'attribute_options_pkey') {
      throw refuse('ID_TAKEN', 'An option with that id already exists.');
    }
    throw error;
  }
}

/** Locks an attribute's row for the rest of the write, so option creates, restores and moves on it take turns. */
export async function lockOptionParent(tx: WorkspaceTx, attributeId: string): Promise<void> {
  await tx.select({ id: attributes.id }).from(attributes).where(eq(attributes.id, attributeId)).for('update');
}

/** The hues of an attribute's options in its order, archived ones included: what `nextHue` reads. */
async function huesInOrder(tx: WorkspaceTx, attributeId: string): Promise<readonly { readonly hue: string }[]> {
  return tx
    .select({ hue: attributeOptions.hue })
    .from(attributeOptions)
    .where(eq(attributeOptions.attributeId, attributeId))
    .orderBy(asc(attributeOptions.position), asc(attributeOptions.id));
}

/**
 * The option an earlier try of the same create made (spec 0012, AC-244):
 * undefined when no option holds the id, the option when this actor made it
 * on the same attribute, else `ID_TAKEN`. Read under the attribute row's
 * lock, so a concurrent try with the same id has committed or not started.
 */
async function earlierOption(
  tx: WorkspaceTx,
  scope: EngineScope,
  id: string,
  attributeId: string,
): Promise<InsertedOption | undefined> {
  const [row] = await tx
    .select({
      id: attributeOptions.id,
      attributeId: attributeOptions.attributeId,
      createdByType: attributeOptions.createdByType,
      createdById: attributeOptions.createdById,
    })
    .from(attributeOptions)
    .where(eq(attributeOptions.id, id));
  if (row === undefined) return undefined;
  const isOwnTry =
    row.attributeId === attributeId && row.createdByType === scope.actor.type && row.createdById === scope.actor.id;
  if (!isOwnTry) throw refuse('ID_TAKEN', 'An option with that id already exists.');
  return { optionId: row.id, replayed: true };
}

/** Refuses an attribute that has no options, and status settings on a select. */
function checkOptionInput(attribute: AttributeDef, input: Omit<OptionInput, 'attributeId'>): void {
  if (attribute.type !== 'select' && attribute.type !== 'status') {
    throw refuse('CONFIG_INVALID', 'Only select and status attributes have options.', attribute.id);
  }
  checkLabel(input.label, 'label');
  if (input.hue !== undefined) checkHue(input.hue, 'hue');
  checkTarget(input.targetTimeInStage, 'targetTimeInStage');
  if (attribute.type !== 'status' && hasStageSettings(input)) {
    throw refuse('CONFIG_INVALID', 'Only status stages have an outcome and a target time.', attribute.id);
  }
}

/**
 * Inserts an option of an attribute already loaded and checked, at the end of
 * its order, under the attribute row's lock (taken here): the replay check,
 * then the room check (AC-237), then the insert. Records the attribute's
 * definitions change.
 */
export async function insertOptionOf(
  context: WriteContext,
  attribute: AttributeDef,
  input: Omit<OptionInput, 'attributeId'>,
): Promise<InsertedOption> {
  const { tx, scope } = context;
  checkOptionInput(attribute, input);
  if (input.id !== undefined && !isUuidV7(input.id)) {
    throw refuse('CONFIG_INVALID', 'The option id must be a UUID v7.');
  }
  // The attribute's lock first: a replay is found under it, before the room check would count it twice.
  await lockOptionParent(tx, attribute.id);
  const id = input.id?.toLowerCase();
  if (id !== undefined) {
    const earlier = await earlierOption(tx, scope, id, attribute.id);
    if (earlier !== undefined) return earlier;
  }
  await checkOptionRoom(tx, scope, attribute.id);
  const hue = input.hue ?? nextHue(await huesInOrder(tx, attribute.id));
  const isStatus = attribute.type === 'status';
  return optionGuard(async () => {
    const [row] = await tx
      .insert(attributeOptions)
      .values({
        ...(id === undefined ? {} : { id }),
        workspaceId: scope.workspaceId,
        attributeId: attribute.id,
        label: input.label.trim(),
        hue,
        position: sql`(select coalesce(max(position) + 1, 0) from attribute_options where attribute_id = ${attribute.id})`,
        outcome: isStatus ? (input.outcome ?? 'open') : null,
        targetTimeInStage: input.targetTimeInStage ?? null,
        ...audit(scope),
      })
      .returning({ id: attributeOptions.id });
    if (row === undefined) throw new Error('The option was not created.');
    // The attribute's options changed: its object's (or list's) screens read its definition again.
    recordDefinition(context, attribute);
    return { optionId: row.id, replayed: false };
  });
}

/** Inserts an option at the end of its attribute's order, inside a write. */
export async function insertOption(context: WriteContext, input: OptionInput): Promise<InsertedOption> {
  const attribute = await loadAttribute(context.tx, input.attributeId);
  // One the actor can't see answers as an unknown attribute (spec 0009, AC-141).
  if (!attributeVisible(context.scope.access, attribute)) {
    throw refuse('NOT_FOUND', 'That attribute does not exist.', attribute.id);
  }
  return insertOptionOf(context, attribute, input);
}

/**
 * Adds an option to a select or status attribute (AC-4, AC-16; spec 0012,
 * AC-236), refusing the 501st live one `LIMIT_REACHED` (AC-237).
 */
export async function defineOption(scope: EngineScope, input: OptionInput, hooks: readonly AfterWrite[] = []) {
  requirePermission(scope, 'schema.manage');
  const { result } = await runWrite(scope, (context) => insertOption(context, input), hooks);
  return result;
}

/**
 * The live option of an attribute whose label is `label` ignoring case, if
 * any: a cell's "Create" sets it rather than making a second (AC-238).
 */
export async function liveOptionLabelled(
  tx: WorkspaceTx,
  attributeId: string,
  label: string,
): Promise<string | undefined> {
  const [row] = await tx
    .select({ id: attributeOptions.id })
    .from(attributeOptions)
    .where(
      and(
        eq(attributeOptions.attributeId, attributeId),
        isNull(attributeOptions.archivedAt),
        sql`lower(${attributeOptions.label}) = lower(${label.trim()})`,
      ),
    );
  return row?.id;
}

async function renumber(tx: WorkspaceTx, attributeId: string, optionId: string, position: number): Promise<void> {
  const order = await tx
    .select({ id: attributeOptions.id })
    .from(attributeOptions)
    .where(eq(attributeOptions.attributeId, attributeId))
    .orderBy(asc(attributeOptions.position), asc(attributeOptions.id))
    .for('update');
  const ids = order.map((row) => row.id).filter((id) => id !== optionId);
  const at = Math.max(0, Math.min(position, ids.length));
  ids.splice(at, 0, optionId);
  const rows = sql.join(
    ids.map((id, index) => sql`(${id}::uuid, ${index}::int)`),
    sql`, `,
  );
  await tx.execute(sql`
    update attribute_options o set position = data.position
    from (values ${rows}) as data(id, position)
    where o.id = data.id and o.position <> data.position
  `);
}

/**
 * Renames, recolours, reorders, archives or restores an option. No value row
 * changes (AC-4). Restoring an archived option needs room among the live
 * ones (spec 0012, AC-237), checked under the attribute row's lock; a label a
 * live option took meanwhile refuses the restore on `label`. Answers the
 * option and its attribute.
 */
export async function updateOption(
  scope: EngineScope,
  input: OptionUpdate,
  hooks: readonly AfterWrite[] = [],
): Promise<OptionRef> {
  requirePermission(scope, 'schema.manage');
  const optionId = checkId(input.optionId, 'That option does not exist.');
  if (input.position !== undefined && (!Number.isInteger(input.position) || input.position < 0)) {
    throw refuseOn('CONFIG_INVALID', 'Give the position as a whole number from 0.', 'position');
  }
  const { result } = await runWrite(
    scope,
    async (context) => {
      const { tx } = context;
      const [found] = await tx
        .select({ attributeId: attributeOptions.attributeId })
        .from(attributeOptions)
        .where(eq(attributeOptions.id, optionId));
      if (found === undefined) throw refuse('NOT_FOUND', 'That option does not exist.');
      const owner = await loadAttribute(tx, found.attributeId);
      // An option of an attribute the actor can't see answers as an unknown option (spec 0009, AC-141).
      if (!isOpen(scope.access) && !attributeVisible(scope.access, owner)) {
        throw refuse('NOT_FOUND', 'That option does not exist.');
      }
      // The attribute's row first, then the option's: the order every option create and restore takes.
      await lockOptionParent(tx, owner.id);
      const [option] = await tx.select().from(attributeOptions).where(eq(attributeOptions.id, optionId)).for('update');
      if (option === undefined) throw refuse('NOT_FOUND', 'That option does not exist.');
      if (input.label !== undefined) checkLabel(input.label, 'label');
      if (input.hue !== undefined) checkHue(input.hue, 'hue');
      checkTarget(input.targetTimeInStage, 'targetTimeInStage');
      if (option.outcome === null && hasStageSettings(input)) {
        throw refuse('CONFIG_INVALID', 'Only status stages have an outcome and a target time.');
      }
      // A restore needs room among the live options (AC-237); an archived one doesn't count until then.
      if (input.archived === false && option.archivedAt !== null) await checkOptionRoom(tx, scope, owner.id);
      // Renamed, recoloured, reordered, archived or restored: its object's (or list's) screens read it again.
      recordDefinition(context, owner);
      if (input.position !== undefined) await renumber(tx, option.attributeId, option.id, input.position);
      await optionGuard(() =>
        tx
          .update(attributeOptions)
          .set({
            ...(input.label === undefined ? {} : { label: input.label.trim() }),
            ...(input.hue === undefined ? {} : { hue: input.hue }),
            ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
            ...(input.targetTimeInStage === undefined ? {} : { targetTimeInStage: input.targetTimeInStage }),
            ...(input.archived === undefined
              ? {}
              : { archivedAt: input.archived ? sql`coalesce(${attributeOptions.archivedAt}, now())` : null }),
            ...touched(scope),
          })
          .where(eq(attributeOptions.id, option.id)),
      );
      return { optionId: option.id, attributeId: owner.id, objectId: owner.objectId, listId: owner.listId };
    },
    hooks,
  );
  return result;
}

/**
 * An attribute's options, in order, archived ones included (they still show
 * on the values that hold them). None for a malformed id, and none for an
 * attribute the principal can't see (spec 0009, AC-141).
 */
export async function listOptions(scope: EngineScope, attributeId: string) {
  if (!isUuid(attributeId)) return [];
  return inWorkspace(scope, async (tx) => {
    if (!isOpen(scope.access)) {
      const [attribute] = await tx
        .select({ id: attributes.id, objectId: attributes.objectId, listId: attributes.listId })
        .from(attributes)
        .where(eq(attributes.id, attributeId));
      if (attribute === undefined || !attributeVisible(scope.access, attribute)) return [];
    }
    return tx
      .select({
        id: attributeOptions.id,
        label: attributeOptions.label,
        hue: attributeOptions.hue,
        position: attributeOptions.position,
        outcome: attributeOptions.outcome,
        targetTimeInStage: attributeOptions.targetTimeInStage,
        archived: sql<boolean>`${attributeOptions.archivedAt} is not null`,
      })
      .from(attributeOptions)
      .where(eq(attributeOptions.attributeId, attributeId))
      .orderBy(asc(attributeOptions.position), asc(attributeOptions.id));
  });
}
