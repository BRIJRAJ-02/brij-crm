// Bulk writes to a list's own fields (spec 0048, AC-4826): one list field of
// up to 500 entries of one list, changed by one operation (Set, Clear, Add,
// Remove, Replace), and the undo's batch that puts each entry's old value back
// while it still holds the version the edit wrote. Each entry goes through the
// engine's own entry write (`updateRecord` with an `entryId`), so the access
// door's entry check (`lockEntry`: a hidden list, object or record is
// `NOT_FOUND`, a read only list `FORBIDDEN`), value history, rules and the
// change event are exactly a single cell edit's.
//
// Locks follow one order: the list's row first (as an add takes it), then the
// entries in id order, each its record (share) then the entry.
import { applyOp } from '@crm/contracts/bulk-ops';
import type { EngineRefusal } from '@crm/contracts/values';
import { fieldReadOnlyReason, isOpen } from '../access/policy.ts';
import { attributeLevel } from '../access/visibility.ts';
import { checkBulkChange, type BulkEditChange } from './bulk-edit.ts';
import { decodeValue, encodeValue, sameItems } from './columns.ts';
import { canonicalId, checkId, isUuid } from './ids.ts';
import { checkWritableList } from './lists.ts';
import { updateRecord, type ValueInput } from './records.ts';
import { refuse } from './refusals.ts';
import type { EngineScope } from './scope.ts';
import { currentItems, loadListAttributes, lockEntry } from './values.ts';
import { runWrite, type AfterWrite, type WriteContext } from './write.ts';

/** The most entries one bulk write names. */
export const MAX_ENTRY_EDIT = 500;

/** What naming an attribute that isn't the list's own (or is hidden) answers. */
const UNKNOWN_FIELD = 'That field does not exist.';

/** What an entry that isn't in this list (or is hidden) answers. */
const UNKNOWN_ENTRY = 'That entry does not exist.';

/**
 * One entry's outcome: changed (with the value read under its lock before the
 * write and the version it made), unchanged (it already held the result), or
 * refused with why.
 */
export type EntryEditOutcome =
  | { readonly entryId: string; readonly state: 'changed'; readonly before: unknown; readonly versionId: string }
  | { readonly entryId: string; readonly state: 'unchanged' }
  | { readonly entryId: string; readonly state: 'refused'; readonly refusals: readonly EngineRefusal[] };

/** The entries asked for, canonical, each once, in id order (the lock order). */
function orderedIds(raw: readonly string[]): readonly string[] {
  return [...new Set(raw.filter(isUuid).map(canonicalId))].sort();
}

/** An entry asked for that never got an outcome: not a UUID, or another list's. */
const missing = (entryId: string): EntryEditOutcome => ({
  entryId,
  state: 'refused',
  refusals: [{ code: 'NOT_FOUND', message: UNKNOWN_ENTRY }],
});

/** Locks one entry for a write and refuses one of another list, as an unknown one. */
async function lockListEntry(context: WriteContext, listId: string, entryId: string): Promise<void> {
  const parents = await lockEntry(context.tx, entryId, context.scope.access);
  if (parents.listId !== listId) throw refuse('NOT_FOUND', UNKNOWN_ENTRY);
}

/**
 * Changes one list field of up to 500 entries of one list in one write
 * (AC-4826): the list at `write` (hidden `NOT_FOUND`, read only 403, archived
 * `NOT_FOUND`), the field the list's own and not hidden (`NOT_FOUND`) nor read
 * only (`ATTRIBUTE_READ_ONLY`), the change as a record's bulk edit checks it.
 * Each entry's value is computed from its current one under its lock
 * (`applyOp`, as the browser runs it); an unchanged entry writes nothing and
 * answers no `before`, so a retry changes nothing twice. One refused entry
 * never stops the rest. Answers each entry in the order asked.
 */
export async function updateEntries(
  scope: EngineScope,
  input: {
    readonly listId: string;
    readonly entryIds: readonly string[];
    readonly edit: BulkEditChange;
    readonly timeZone?: string | undefined;
  },
  hooks: readonly AfterWrite[] = [],
): Promise<readonly EntryEditOutcome[]> {
  if (input.entryIds.length === 0) throw refuse('CONFIG_INVALID', 'Choose at least one entry.');
  if (new Set(input.entryIds).size > MAX_ENTRY_EDIT) {
    throw refuse('CONFIG_INVALID', `Change at most ${String(MAX_ENTRY_EDIT)} entries at once.`);
  }
  const listId = checkId(input.listId, 'That list does not exist.');
  const { result } = await runWrite(
    scope,
    async (context) => {
      await checkWritableList(context, listId);
      const attributeId = checkId(input.edit.attributeId, UNKNOWN_FIELD);
      const attribute = (await loadListAttributes(context.tx, listId)).get(attributeId);
      const level = attribute === undefined || isOpen(scope.access) ? 'write' : attributeLevel(scope.access, attribute);
      if (attribute === undefined || level === 'hidden') throw refuse('NOT_FOUND', UNKNOWN_FIELD);
      if (level === 'read') throw refuse('ATTRIBUTE_READ_ONLY', fieldReadOnlyReason(attribute.title), attribute.id);
      const ids = orderedIds(input.entryIds);
      const value = checkBulkChange(attribute, false, input.edit, ids.length);
      const outcomes = new Map<string, EntryEditOutcome>();
      for (const entryId of ids) {
        const done = await context.perRecord(async (child): Promise<EntryEditOutcome> => {
          await lockListEntry(child, listId, entryId);
          const items = await currentItems(child.tx, [entryId], [attribute.id]);
          const current = decodeValue(attribute.type, attribute.isMulti, items);
          const next = applyOp(attribute, input.edit.op, current, value);
          if (sameItems(encodeValue(attribute.type, current), encodeValue(attribute.type, next))) {
            return { entryId, state: 'unchanged' };
          }
          const written = await updateRecord(child, { entryId, values: { [attribute.id]: { value: next } } });
          const versionId = written[attribute.id]?.versionId;
          return versionId === undefined
            ? { entryId, state: 'unchanged' }
            : { entryId, state: 'changed', before: current, versionId };
        });
        outcomes.set(entryId, done.ok ? done.value : { entryId, state: 'refused', refusals: done.refusals });
      }
      return input.entryIds.map((raw) => outcomes.get(isUuid(raw) ? canonicalId(raw) : raw) ?? missing(raw));
    },
    hooks,
  );
  return result;
}

/** One entry's values an undo puts back: each cell with the version it must still hold (`ifVersionId`). */
export interface EntryValuesItem {
  readonly entryId: string;
  readonly values: Readonly<Record<string, ValueInput>>;
}

/** One entry's outcome in a batch of values: the versions it made, or why it was kept. */
export type EntryValuesOutcome =
  | { readonly entryId: string; readonly ok: true; readonly written: Readonly<Record<string, string>> }
  | { readonly entryId: string; readonly ok: false; readonly refusals: readonly EngineRefusal[] };

/**
 * Sets values on up to 500 entries of one list in one write, each on its own
 * (a bulk edit's undo): the list at `write`, then each entry through the
 * engine's entry write in id order; a cell whose `ifVersionId` moved on is
 * 409 `VERSION_CHANGED` for that entry alone, and the rest go on.
 */
export async function setEntryValuesBatch(
  scope: EngineScope,
  input: { readonly listId: string; readonly items: readonly EntryValuesItem[] },
  hooks: readonly AfterWrite[] = [],
): Promise<readonly EntryValuesOutcome[]> {
  if (input.items.length === 0) throw refuse('CONFIG_INVALID', 'Choose at least one entry.');
  if (input.items.length > MAX_ENTRY_EDIT) {
    throw refuse('CONFIG_INVALID', `Change at most ${String(MAX_ENTRY_EDIT)} entries at once.`);
  }
  const listId = checkId(input.listId, 'That list does not exist.');
  const { result } = await runWrite(
    scope,
    async (context) => {
      await checkWritableList(context, listId);
      const byId = new Map(
        input.items.filter((item) => isUuid(item.entryId)).map((item) => [canonicalId(item.entryId), item.values]),
      );
      const outcomes = new Map<string, EntryValuesOutcome>();
      for (const entryId of [...byId.keys()].sort()) {
        const values = byId.get(entryId) ?? {};
        const done = await context.perRecord(async (child) => {
          await lockListEntry(child, listId, entryId);
          return updateRecord(child, { entryId, values });
        });
        outcomes.set(
          entryId,
          done.ok
            ? {
                entryId,
                ok: true,
                written: Object.fromEntries(
                  Object.entries(done.value).flatMap(([id, each]) =>
                    each.versionId === undefined ? [] : [[id, each.versionId]],
                  ),
                ),
              }
            : { entryId, ok: false, refusals: done.refusals },
        );
      }
      return input.items.map(
        (item): EntryValuesOutcome =>
          outcomes.get(isUuid(item.entryId) ? canonicalId(item.entryId) : item.entryId) ?? {
            entryId: item.entryId,
            ok: false,
            refusals: [{ code: 'NOT_FOUND', message: UNKNOWN_ENTRY }],
          },
      );
    },
    hooks,
  );
  return result;
}
