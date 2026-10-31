// A select's or status attribute's options as settings shape them (spec 0012,
// AC-236, AC-237): create with a client id, rename, recolour, set a stage's
// outcome and target time, move, archive and restore. Every write needs
// `schema.manage`, stores one definitions row for the attribute's object, and
// answers what it changed, read back through the access door.
import { and, eq } from 'drizzle-orm';
import type { AttributeOption } from '@crm/contracts';
import type { Hue } from '@crm/contracts/values';
import { schema, type WorkspaceTx } from '@crm/db';
import { checkId } from '../engine/ids.ts';
import { defineOption, updateOption, type OptionRef } from '../engine/options.ts';
import { refuse } from '../engine/refusals.ts';
import type { EngineScope } from '../engine/scope.ts';
import type { AfterWrite } from '../engine/write.ts';
import { requireFieldManager, requireOptionManager } from '../lists/manager.ts';
import { inWorkspace } from '../access/run.ts';
import { readOne } from './attributes.ts';

const { attributeOptions, attributes, lists } = schema;

const ATTRIBUTE_NOT_FOUND = 'That attribute does not exist.';
const OPTION_NOT_FOUND = 'That option does not exist.';

/** A stage's outcome. */
type Outcome = 'open' | 'won' | 'lost';

/** The object an attribute sits on, or `NOT_FOUND`: options here are an object's attribute's (a list's have no screens). */
async function parentOfAttribute(
  tx: WorkspaceTx,
  scope: EngineScope,
  attributeId: string,
): Promise<{ readonly objectId: string | null; readonly listId: string | null }> {
  // Row level security keeps the read to this workspace; the filter says so too (house style).
  const [row] = await tx
    .select({ objectId: attributes.objectId, listId: attributes.listId })
    .from(attributes)
    .where(and(eq(attributes.workspaceId, scope.workspaceId), eq(attributes.id, attributeId)));
  if (row === undefined) throw refuse('NOT_FOUND', ATTRIBUTE_NOT_FOUND);
  if (row.listId === null) return { objectId: row.objectId, listId: null };
  // A list's field is read through its object, as `listListAttributes` reads it (decision 2).
  const [list] = await tx
    .select({ objectId: lists.objectId })
    .from(lists)
    .where(and(eq(lists.workspaceId, scope.workspaceId), eq(lists.id, row.listId)));
  return { objectId: list?.objectId ?? null, listId: row.listId };
}

/** The attribute and object an option belongs to, or `NOT_FOUND`. */
async function ownerOfOption(tx: WorkspaceTx, scope: EngineScope, optionId: string): Promise<string> {
  const [row] = await tx
    .select({ attributeId: attributeOptions.attributeId })
    .from(attributeOptions)
    .where(and(eq(attributeOptions.workspaceId, scope.workspaceId), eq(attributeOptions.id, optionId)));
  if (row === undefined) throw refuse('NOT_FOUND', OPTION_NOT_FOUND);
  await parentOfAttribute(tx, scope, row.attributeId).catch(() => {
    throw refuse('NOT_FOUND', OPTION_NOT_FOUND);
  });
  return row.attributeId;
}

/** An attribute's options as the caller reads them now (archived ones included, in order). */
async function optionsAfter(scope: EngineScope, ref: OptionRef): Promise<AttributeOption[]> {
  const definition = await readOne(scope, { attributeId: ref.attributeId, objectId: ref.objectId, listId: ref.listId });
  return definition.options ?? [];
}

/** The one option a write changed, read back. */
async function optionAfter(scope: EngineScope, ref: OptionRef): Promise<AttributeOption> {
  const option = (await optionsAfter(scope, ref)).find((each) => each.id === ref.optionId);
  if (option === undefined) throw refuse('NOT_FOUND', OPTION_NOT_FOUND);
  return option;
}

/** A new option, as the options editor sends it (AC-236). */
export interface CreateOptionInput {
  readonly attributeId: string;
  /** The UUID v7 the browser minted: the retry key (AC-244). */
  readonly id: string;
  readonly label: string;
  /** The next hue after the last option's (`nextHue`) when absent. */
  readonly hue?: Hue | undefined;
  readonly outcome?: Outcome | undefined;
  /** A status stage's target time in stage, `P<N>D`. */
  readonly targetTimeInStage?: string | undefined;
}

/**
 * Adds an option at the end of a select or status attribute's options
 * (AC-236), and answers it. The same create again (same id, same attribute,
 * same actor) answers the option already made and writes nothing (AC-244).
 * Refuses `FORBIDDEN`, `NOT_FOUND`, `LIMIT_REACHED` at 500 live options
 * (AC-237), `ID_TAKEN`, and `CONFIG_INVALID` (a label a live option holds, on
 * `label`; an attribute that takes no options).
 */
export async function createOption(
  scope: EngineScope,
  input: CreateOptionInput,
  hooks: readonly AfterWrite[] = [],
): Promise<AttributeOption> {
  await requireFieldManager(scope, input.attributeId);
  const attributeId = checkId(input.attributeId, ATTRIBUTE_NOT_FOUND);
  const parent = await inWorkspace(scope, (tx) => parentOfAttribute(tx, scope, attributeId));
  const made = await defineOption(
    scope,
    {
      id: input.id,
      attributeId,
      label: input.label,
      ...(input.hue === undefined ? {} : { hue: input.hue }),
      ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
      ...(input.targetTimeInStage === undefined ? {} : { targetTimeInStage: input.targetTimeInStage }),
    },
    hooks,
  );
  return optionAfter(scope, { optionId: made.optionId, attributeId, ...parent });
}

/** What the options editor may change on an option (AC-236); `null` clears a stage's target time. */
export interface EditOptionInput {
  readonly optionId: string;
  readonly label?: string | undefined;
  readonly hue?: Hue | undefined;
  readonly outcome?: Outcome | undefined;
  readonly targetTimeInStage?: string | null | undefined;
}

/**
 * Renames or recolours an option, or changes a stage's outcome or target
 * time (AC-236), and answers it. No value changes. Refuses `FORBIDDEN`,
 * `NOT_FOUND` and `CONFIG_INVALID` (a label a live option holds, on `label`).
 */
export async function editOption(
  scope: EngineScope,
  input: EditOptionInput,
  hooks: readonly AfterWrite[] = [],
): Promise<AttributeOption> {
  await requireOptionManager(scope, input.optionId);
  const optionId = checkId(input.optionId, OPTION_NOT_FOUND);
  await inWorkspace(scope, (tx) => ownerOfOption(tx, scope, optionId));
  const ref = await updateOption(
    scope,
    {
      optionId,
      ...(input.label === undefined ? {} : { label: input.label }),
      ...(input.hue === undefined ? {} : { hue: input.hue }),
      ...(input.outcome === undefined ? {} : { outcome: input.outcome }),
      ...(input.targetTimeInStage === undefined ? {} : { targetTimeInStage: input.targetTimeInStage }),
    },
    hooks,
  );
  return optionAfter(scope, ref);
}

/**
 * Moves an option to `position` in its attribute's order, archived ones
 * counted (AC-236), and answers the attribute's options in their new order.
 */
export async function moveOption(
  scope: EngineScope,
  input: { readonly optionId: string; readonly position: number },
  hooks: readonly AfterWrite[] = [],
): Promise<AttributeOption[]> {
  await requireOptionManager(scope, input.optionId);
  const optionId = checkId(input.optionId, OPTION_NOT_FOUND);
  await inWorkspace(scope, (tx) => ownerOfOption(tx, scope, optionId));
  return optionsAfter(scope, await updateOption(scope, { optionId, position: input.position }, hooks));
}

/**
 * Archives an option (AC-236): it stays on the values that hold it, muted,
 * and is refused for new ones (`OPTION_ARCHIVED`). Archiving the one an
 * attribute's default names keeps the default stored. Answers the option.
 */
export async function archiveOption(
  scope: EngineScope,
  input: { readonly optionId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<AttributeOption> {
  await requireOptionManager(scope, input.optionId);
  const optionId = checkId(input.optionId, OPTION_NOT_FOUND);
  await inWorkspace(scope, (tx) => ownerOfOption(tx, scope, optionId));
  return optionAfter(scope, await updateOption(scope, { optionId, archived: true }, hooks));
}

/**
 * Restores an archived option at its old place (AC-236), refusing
 * `LIMIT_REACHED` while 500 are live (AC-237) and `CONFIG_INVALID` on `label`
 * when a live option took its label meanwhile. Answers the option.
 */
export async function restoreOption(
  scope: EngineScope,
  input: { readonly optionId: string },
  hooks: readonly AfterWrite[] = [],
): Promise<AttributeOption> {
  await requireOptionManager(scope, input.optionId);
  const optionId = checkId(input.optionId, OPTION_NOT_FOUND);
  await inWorkspace(scope, (tx) => ownerOfOption(tx, scope, optionId));
  return optionAfter(scope, await updateOption(scope, { optionId, archived: false }, hooks));
}
