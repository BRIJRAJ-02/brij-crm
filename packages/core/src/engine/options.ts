// Select and status options (spec 0004, AC-4). Each change touches option
// rows only: renaming, recolouring, reordering or archiving an option never
// rewrites a value.
import { asc, eq, sql } from 'drizzle-orm';
import { schema, type WorkspaceTx } from '@crm/db';
import { HUES } from '@crm/contracts/values';
import { audit, touched } from './definitions.ts';
import { checkId, isUuid } from './ids.ts';
import { checkOptionRoom } from './limits.ts';
import { postgresError, refuse } from './refusals.ts';
import type { EngineScope } from './scope.ts';
import { loadAttribute } from './values.ts';
import { runWrite, type AfterWrite, type WriteContext } from './write.ts';
import { inWorkspace } from '../access/run.ts';
import { requirePermission } from '../access/check.ts';
import { isOpen } from '../access/policy.ts';
import { attributeVisible } from '../access/visibility.ts';

const { attributeOptions, attributes } = schema;

/** What a stage means for a status option. */
export type OptionOutcome = 'open' | 'won' | 'lost';

/** What a new option needs. `outcome` and `targetTimeInStage` (an ISO 8601 duration) are for status stages only. */
export interface OptionInput {
  readonly attributeId: string;
  readonly label: string;
  readonly hue: string;
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

const DURATION = /^P(?=\d|T\d)(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?)?$/;

function checkLabel(label: string): void {
  if (label.trim() === '' || label.trim().length > 100)
    throw refuse('CONFIG_INVALID', 'Give the option a label of 1 to 100 characters.');
}

function checkHue(hue: string): void {
  if (!(HUES as readonly string[]).includes(hue))
    throw refuse('CONFIG_INVALID', `Pick one of the hues: ${HUES.join(', ')}.`);
}

function checkTarget(target: string | null | undefined): void {
  if (target !== undefined && target !== null && !DURATION.test(target)) {
    throw refuse('CONFIG_INVALID', 'Give the target time as an ISO 8601 duration, such as P7D for a week.');
  }
}

async function labelGuard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const pg = postgresError(error);
    if (pg?.code === '23505' && pg.constraint === 'attribute_options_label') {
      throw refuse('CONFIG_INVALID', 'An option with that label already exists. Pick another label.');
    }
    throw error;
  }
}

/** Inserts an option at the end of its attribute's order, inside a write. */
export async function insertOption(context: WriteContext, input: OptionInput): Promise<{ optionId: string }> {
  const { tx, scope } = context;
  const attribute = await loadAttribute(tx, input.attributeId);
  // One the actor can't see answers as an unknown attribute (spec 0009, AC-141).
  if (!attributeVisible(scope.access, attribute)) {
    throw refuse('NOT_FOUND', 'That attribute does not exist.', attribute.id);
  }
  if (attribute.type !== 'select' && attribute.type !== 'status') {
    throw refuse('CONFIG_INVALID', 'Only select and status attributes have options.', attribute.id);
  }
  checkLabel(input.label);
  checkHue(input.hue);
  checkTarget(input.targetTimeInStage);
  const isStatus = attribute.type === 'status';
  if (
    !isStatus &&
    (input.outcome !== undefined || (input.targetTimeInStage !== undefined && input.targetTimeInStage !== null))
  ) {
    throw refuse('CONFIG_INVALID', 'Only status stages have an outcome and a target time.', attribute.id);
  }
  await checkOptionRoom(tx, scope, attribute.id);
  return labelGuard(async () => {
    const [row] = await tx
      .insert(attributeOptions)
      .values({
        workspaceId: scope.workspaceId,
        attributeId: attribute.id,
        label: input.label.trim(),
        hue: input.hue,
        position: sql`(select coalesce(max(position) + 1, 0) from attribute_options where attribute_id = ${attribute.id})`,
        outcome: isStatus ? (input.outcome ?? 'open') : null,
        targetTimeInStage: input.targetTimeInStage ?? null,
        ...audit(scope),
      })
      .returning({ id: attributeOptions.id });
    if (row === undefined) throw new Error('The option was not created.');
    return { optionId: row.id };
  });
}

/** Adds an option to a select or status attribute (AC-4, AC-16). */
export async function defineOption(scope: EngineScope, input: OptionInput, hooks: readonly AfterWrite[] = []) {
  requirePermission(scope, 'schema.manage');
  const { result } = await runWrite(scope, (context) => insertOption(context, input), hooks);
  return result;
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

/** Renames, recolours, reorders, archives or restores an option. No value row changes (AC-4). */
export async function updateOption(scope: EngineScope, input: OptionUpdate, hooks: readonly AfterWrite[] = []) {
  requirePermission(scope, 'schema.manage');
  checkId(input.optionId, 'That option does not exist.');
  await runWrite(
    scope,
    async ({ tx }) => {
      const [option] = await tx
        .select()
        .from(attributeOptions)
        .where(eq(attributeOptions.id, input.optionId))
        .for('update');
      if (option === undefined) throw refuse('NOT_FOUND', 'That option does not exist.');
      // An option of an attribute the actor can't see answers as an unknown option (spec 0009, AC-141).
      if (!isOpen(scope.access)) {
        const owner = await loadAttribute(tx, option.attributeId);
        if (!attributeVisible(scope.access, owner)) throw refuse('NOT_FOUND', 'That option does not exist.');
      }
      if (input.label !== undefined) checkLabel(input.label);
      if (input.hue !== undefined) checkHue(input.hue);
      checkTarget(input.targetTimeInStage);
      if (
        option.outcome === null &&
        (input.outcome !== undefined || (input.targetTimeInStage !== undefined && input.targetTimeInStage !== null))
      ) {
        throw refuse('CONFIG_INVALID', 'Only status stages have an outcome and a target time.');
      }
      if (input.position !== undefined) await renumber(tx, option.attributeId, option.id, input.position);
      await labelGuard(() =>
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
    },
    hooks,
  );
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
