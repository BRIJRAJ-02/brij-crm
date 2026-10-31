// The bypass walk (spec 0013, AC-259): every function the engine exports is
// named here, as a record value write that runs rules, one of the writes
// allowed to skip them (restoring a record; the type change jobs and
// computed attributes come later), or something that writes no record value.
// A new export fails the walk until it is placed, and each write that runs
// rules is shown refusing a value that breaks one.
import type { ValidationRuleInput } from '@crm/contracts/values';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, type Database } from '@crm/db';
import * as engine from '../engine/index.ts';
import { isRefusal } from '../engine/refusals.ts';
import { createAttribute, editAttribute } from '../attributes/attributes.ts';
import { createObject } from '../objects/objects.ts';
import { testScope } from '../testing.ts';

/** Writes of record values, which run every rule they touch (AC-254). */
const RUN_RULES = ['createRecord', 'setValues', 'setRecordValues', 'setValuesBatch', 'updateMany'] as const;

/** The writes allowed to skip rules (AC-259). Type change jobs (milestone 3) and computed writes (spec 0015) join later. */
// A merge (spec 0049) writes only values already stored, valid where they stood, as a restore does.
const SKIP_RULES = ['restoreRecord', 'restoreRecords', 'restoreBatch', 'mergeRecords'] as const;

/** Writes of definitions, lifecycles, lists' entries (rules for lists come with #51) and workspaces: no record value. */
const NO_RECORD_VALUES = [
  'addEntry',
  'archiveAttribute',
  // A link delta (spec 0014) writes links only: no rule sits on or names a record reference (`checkRuleSettings`).
  'changeLinks',
  'createUserWorkspace',
  'createWorkspace',
  'defineAttribute',
  'defineList',
  'defineObject',
  'defineOption',
  'defineRelationship',
  'deleteRecord',
  'deleteRecords',
  // "Not a duplicate" and its Undo (spec 0049): a dismissal row and an audit row, no record value.
  'dismissPair',
  'eraseRecord',
  'purgeDeleted',
  'removeEntry',
  'reorderAttribute',
  'reorderObject',
  'restoreAttribute',
  'restoreEntry',
  'restorePair',
  'setObjectArchived',
  'updateAttribute',
  'updateObject',
  'updateOption',
  'updateRelationship',
] as const;

/** Reads, helpers and hooks: they write nothing of their own. */
const NOT_WRITES = [
  'aggregateGroups',
  'aggregateMatches',
  'capChange',
  'cappedHook',
  'checkDuplicates',
  'countMatches',
  'countTrash',
  'cursorBinding',
  'decodeCursor',
  'encodeCursor',
  'getActivity',
  'getEntries',
  'getHistory',
  'getRecordEntries',
  'getRecords',
  'getStageSince',
  'getTimeInStages',
  'getValuesAsOf',
  'inputInvalid',
  'isInputError',
  'isRefusal',
  'isUuidV7',
  'listAttributes',
  'listDuplicates',
  'listOptions',
  'newId',
  'outboxEvents',
  'outboxHook',
  'pageLinks',
  'previewMerge',
  'queryGroups',
  'queryPage',
  'queryTrash',
  'searchRecords',
] as const;

describe('the bypass walk', () => {
  it('places every function the engine exports', () => {
    const exported = Object.entries(engine)
      .filter(([, value]) => typeof value === 'function')
      .map(([name]) => name)
      .sort();
    expect(exported).toEqual([...RUN_RULES, ...SKIP_RULES, ...NO_RECORD_VALUES, ...NOT_WRITES].sort());
  });
});

describe('every write that runs rules', () => {
  const { appUrl } = inject('testDatabase');
  let db: Database;
  beforeAll(() => {
    db = createDatabase({ url: appUrl, applicationName: 'crm-bypass-tests' });
  });
  afterAll(async () => {
    await db.close();
  });

  it('refuses a value that breaks a rule, and restoring a record is allowed past them', async () => {
    const created = await engine.createWorkspace(db, {
      name: 'Bypass',
      slug: `bypass-${String(Date.now())}`,
      firstMember: { name: 'Ada', email: 'ada@example.com' },
    });
    const scope = testScope({ db, workspaceId: created.workspaceId, actor: { type: 'member', id: created.memberId } });
    const objectId = (
      await createObject(scope, {
        id: engine.newId(),
        singularName: 'Ticket',
        pluralName: 'Tickets',
        icon: 'box',
        hue: 'gray',
      })
    ).id;
    const code = await createAttribute(scope, { objectId, id: engine.newId(), title: 'Code', type: 'text' });
    const recordId = (
      await engine.createRecord(scope, { objectId, id: engine.newId(), values: { [code.id]: 'too long' } })
    ).recordId;
    const rule: ValidationRuleInput = { id: engine.newId(), kind: 'length', params: { max: 3 } };
    await editAttribute(scope, { attributeId: code.id, rules: [rule] });
    const bad = { [code.id]: { value: 'abcd' } };
    const codes = async (call: () => Promise<unknown>) => {
      try {
        const answer = await call();
        // A batch answers each record's outcome rather than throwing.
        if (Array.isArray(answer)) {
          return answer.flatMap((each: { ok: boolean; refusals?: { code: string }[] }) =>
            each.ok ? [] : (each.refusals ?? []).map((refusal) => refusal.code),
          );
        }
        // A bulk edit (spec 0022) answers each record's state.
        if (typeof answer === 'object' && answer !== null && 'outcomes' in answer && Array.isArray(answer.outcomes)) {
          return (answer.outcomes as { state: string; refusals?: { code: string }[] }[]).flatMap((each) =>
            each.state === 'refused' ? (each.refusals ?? []).map((refusal) => refusal.code) : [],
          );
        }
        return [];
      } catch (error) {
        if (isRefusal(error)) return error.refusals.map((refusal) => refusal.code);
        throw error;
      }
    };
    const calls: Record<(typeof RUN_RULES)[number], () => Promise<unknown>> = {
      createRecord: () => engine.createRecord(scope, { objectId, id: engine.newId(), values: { [code.id]: 'abcd' } }),
      setValues: () => engine.setValues(scope, { recordId, values: bad }),
      setRecordValues: () => engine.setRecordValues(scope, { recordId, values: bad }),
      setValuesBatch: () => engine.setValuesBatch(scope, { items: [{ recordId, values: bad }] }),
      updateMany: () =>
        engine.updateMany(scope, {
          objectId,
          recordIds: [recordId],
          edit: { attributeId: code.id, op: 'set', value: 'abcd' },
        }),
    };
    for (const name of RUN_RULES) expect(await codes(calls[name]), name).toEqual(['VALIDATION_FAILED']);
    // A record that broke the rule before it existed goes to the trash and comes back as it was.
    await engine.deleteRecord(scope, { recordId });
    await engine.restoreRecord(scope, { recordId });
    const [restored] = await engine.getRecords(scope, { ids: [recordId] });
    expect(restored?.values[code.id]).toBe('too long');
  });
});
