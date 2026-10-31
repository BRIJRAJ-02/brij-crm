// The bulk bar's rules and words (spec 0022, AC-524 to AC-526, AC-541).
import { dataError } from '@crm/data';
import { describe, expect, it } from 'vitest';
import type { JobView, RecordsView } from '@crm/data';
import {
  bulkEditToast,
  bulkJobToast,
  combineEditResults,
  deleteOffer,
  deleteToast,
  jobProgress,
  lifecycleUndoToast,
  recordsWord,
} from './bulk.ts';
import { carrySelection } from './BulkActions.tsx';
import { breaksUnique } from './BulkEditDialog.tsx';
import { undoToast } from './undo.ts';

const PEOPLE = { singularName: 'Person', pluralName: 'People' };
const RECORDS = { singularName: 'Record', pluralName: 'Records' };
const OBJECT = '0199a6f2-0000-7000-8000-000000000003';

describe('the bulk bar', () => {
  it('deletes up to 500 at once; past 500 it says so', () => {
    expect(deleteOffer(500)).toBe('delete');
    expect(deleteOffer(501)).toBe('too-many');
    expect(recordsWord(1, PEOPLE)).toBe('1 person');
    expect(recordsWord(1500, PEOPLE)).toBe('1,500 people');
  });

  it('says what a delete did, with Undo (AC-524, AC-525)', () => {
    const undone: string[] = [];
    const onUndo = (id: string) => undone.push(id);
    expect(
      deleteToast({ kind: 'done', deleted: 1, refused: 0, recordName: 'Ada Lovelace', undoId: 'u1' }, PEOPLE, onUndo),
    ).toMatchObject({ tone: 'success', message: 'Deleted Ada Lovelace.', action: { label: 'Undo' } });
    const many = deleteToast({ kind: 'done', deleted: 48, refused: 0, undoId: 'u2' }, PEOPLE, onUndo);
    expect(many?.message).toBe('Deleted 48 people.');
    many?.action?.onAction();
    expect(undone).toEqual(['u2']);
    expect(deleteToast({ kind: 'done', deleted: 46, refused: 2, undoId: 'u3' }, PEOPLE, onUndo)?.message).toBe(
      'Deleted 46 people. 2 weren’t: see their rows.',
    );
    expect(
      deleteToast({ kind: 'done', deleted: 0, refused: 1, reason: 'That record does not exist.' }, PEOPLE, onUndo),
    ).toEqual({ tone: 'danger', message: 'That record does not exist.' });
    expect(
      deleteToast(
        { kind: 'failed', error: dataError('FORBIDDEN', 'You can view People but not change them.') },
        PEOPLE,
        onUndo,
      ),
    ).toEqual({ tone: 'danger', message: 'You can view People but not change them.' });
    expect(deleteToast({ kind: 'too-many', limit: 500 }, PEOPLE, onUndo)?.message).toBe('At most 500 records at once.');
  });

  it('offers Retry for a passing failure only, and warns when rows were left behind', () => {
    const retried: string[] = [];
    const offline = deleteToast(
      { kind: 'failed', error: dataError('API_UNAVAILABLE', 'Can’t reach the CRM.') },
      PEOPLE,
      () => undefined,
      () => retried.push('again'),
    );
    expect(offline?.action?.label).toBe('Retry');
    offline?.action?.onAction();
    expect(retried).toEqual(['again']);
    const refused = deleteToast(
      { kind: 'failed', error: dataError('FORBIDDEN', 'You can view People but not change them.') },
      PEOPLE,
      () => undefined,
      () => undefined,
    );
    expect(refused?.action).toBeUndefined();
    expect(deleteToast({ kind: 'done', deleted: 46, refused: 2, undoId: 'u' }, PEOPLE, () => undefined)?.tone).toBe(
      'danger',
    );
  });

  it('says what an undo of a delete or a create did (AC-526, AC-541)', () => {
    const restored = { kind: 'restored' as const, objectId: OBJECT, ...PEOPLE };
    expect(lifecycleUndoToast({ ...restored, restored: 46, kept: 2, reason: 'unique' })).toEqual({
      tone: 'danger',
      message: 'Restored 46 people. 2 are still in the trash because a unique value is now used by another record.',
    });
    expect(lifecycleUndoToast({ ...restored, restored: 1, kept: 0, recordName: 'Ada Lovelace' })).toEqual({
      tone: 'success',
      message: 'Restored Ada Lovelace.',
    });
    expect(lifecycleUndoToast({ ...restored, restored: 0, kept: 3, reason: 'gone' })?.message).toBe(
      'Nothing from that delete is still in the trash.',
    );
    expect(undoToast({ kind: 'uncreated', objectId: OBJECT, recordName: 'Ada Lovelace', deleted: true })).toEqual({
      tone: 'success',
      message: 'Undid the create of Ada Lovelace.',
    });
  });
});

/** A bulk job as the finish toast and the bar read it. */
const bulkJob = (status: JobView['status'], extra: Partial<JobView> = {}): JobView => ({
  id: '0199a6f2-0000-7000-8000-0000000000aa',
  kind: 'records.bulk_delete',
  label: 'Bulk delete',
  status,
  total: 12_345,
  done: 0,
  refused: 0,
  skipped: 0,
  startedBy: { type: 'member' },
  createdAt: '2026-10-21T09:00:00.000Z',
  cancellable: true,
  ...extra,
});

describe('a background change in the bar (spec 0022, AC-528)', () => {
  it('counts, waits for Review with the count, runs, and stops after its batch', () => {
    expect(jobProgress(bulkJob('preparing'), PEOPLE)).toEqual({ label: 'Counting…' });
    expect(jobProgress(bulkJob('ready'), PEOPLE)).toEqual({ label: '12,345 people counted', value: 100 });
    expect(jobProgress(bulkJob('running', { done: 4500 }), PEOPLE)).toEqual({
      label: 'Deleting 4,500 of 12,345',
      value: 36,
    });
    expect(jobProgress(bulkJob('cancelling', { done: 4500 }), PEOPLE)).toEqual({
      label: 'Stopping after this batch…',
      value: 36,
    });
    expect(jobProgress(bulkJob('running', { kind: 'records.purge', done: 4500 }), PEOPLE)?.label).toBe(
      'Deleting 4,500 of 12,345 forever',
    );
    expect(jobProgress(bulkJob('succeeded'), PEOPLE)).toBeUndefined();
  });
});

describe('a background change’s finish toast (spec 0022, AC-528, AC-531)', () => {
  const onView = () => undefined;
  it('says what a list’s bulk add or removal did, with Undo, and a restore with none (spec 0048)', () => {
    const onUndo = () => undefined;
    const added = bulkJobToast(bulkJob('succeeded', { kind: 'entries.bulk_add', total: 600, done: 600 }), PEOPLE, {
      onView,
      onUndo,
    });
    expect(added).toMatchObject({
      tone: 'success',
      message: 'Added 600 people to the list.',
      action: { label: 'Undo' },
    });
    const removed = bulkJobToast(bulkJob('succeeded', { kind: 'entries.bulk_remove', total: 600, done: 600 }), PEOPLE, {
      onView,
      onUndo,
    });
    expect(removed).toMatchObject({ message: 'Removed 600 entries from the list.', action: { label: 'Undo' } });
    const back = bulkJobToast(bulkJob('succeeded', { kind: 'entries.bulk_restore', total: 1, done: 1 }), PEOPLE, {
      onView,
      onUndo,
    });
    expect(back).toMatchObject({ message: 'Brought back 1 entry.', action: { label: 'View details' } });
  });

  it('says nothing for a change that ended before it touched anything', () => {
    // A declined confirm, or Cancel while counting.
    expect(bulkJobToast(bulkJob('cancelled'), PEOPLE, { onView })).toBeUndefined();
    // A failure while counting is said in the bar that started it (AC-539).
    const tooLarge = bulkJob('failed', { error: { code: 'JOB_TOO_LARGE', message: 'Narrow the filter.' } });
    expect(bulkJobToast(tooLarge, PEOPLE, { onView })).toBeUndefined();
  });

  it('says how far a stopped change got, in the others’ words, with its reason when it failed', () => {
    const undone: string[] = [];
    const stopped = bulkJobToast(bulkJob('cancelled', { done: 4500 }), PEOPLE, {
      onView,
      onUndo: () => undone.push('undo'),
    });
    expect(stopped).toMatchObject({
      tone: 'success',
      message: 'Stopped deleting after 4,500 of 12,345 people. They’re in the trash.',
      action: { label: 'Undo' },
    });
    const failed = bulkJobToast(
      bulkJob('failed', { kind: 'records.bulk_edit', done: 20, error: { code: 'JOB_FAILED', message: 'It broke.' } }),
      PEOPLE,
      { onView },
    );
    expect(failed).toMatchObject({
      tone: 'danger',
      message: 'Stopped updating after 20 of 12,345 people. It broke. What it finished is kept.',
      action: { label: 'View details' },
    });
  });

  it('says where refusals are, and what a purge left in the trash', () => {
    expect(
      bulkJobToast(bulkJob('succeeded', { kind: 'records.bulk_edit', done: 9998, refused: 2 }), PEOPLE, { onView })
        ?.message,
    ).toBe('Updated 9,998 people. 2 refused.');
    const purge = bulkJobToast(bulkJob('succeeded', { kind: 'records.purge', done: 1200 }), RECORDS, { onView }, [
      { names: PEOPLE, count: 12 },
    ]);
    expect(purge).toMatchObject({
      tone: 'danger',
      message: 'Deleted 1,200 records forever. 12 People records stay in the trash: People are view only.',
    });
  });
});

describe('the bulk edit dialog’s rules (AC-529)', () => {
  it('refuses Set, Add and Replace on a unique field for several records, never Remove or Clear', () => {
    const unique = { isUnique: true };
    expect(breaksUnique(unique, 'set', 2)).toBe(true);
    expect(breaksUnique(unique, 'add', 2)).toBe(true);
    expect(breaksUnique(unique, 'replace', 2)).toBe(true);
    expect(breaksUnique(unique, 'remove', 2)).toBe(false);
    expect(breaksUnique(unique, 'clear', 2)).toBe(false);
    expect(breaksUnique(unique, 'set', 1)).toBe(false);
    expect(breaksUnique({ isUnique: false }, 'set', 2)).toBe(false);
  });

  it('says where a partly refused edit’s reasons are, and undoes it in its object’s words', () => {
    expect(
      bulkEditToast({ kind: 'done', updated: 46, unchanged: 0, refused: 2 }, PEOPLE, () => undefined)?.message,
    ).toBe('Updated 46 people. 2 refused: see their cells.');
    const undone = undoToast(
      {
        kind: 'undone',
        action: 'bulk',
        objectId: OBJECT,
        cells: 2,
        undone: 2,
        kept: 0,
        failed: 0,
        first: { recordId: 'r1', attributeId: 'a1', recordName: 'Ada' },
        attributeTitle: 'Stage',
      },
      PEOPLE,
    );
    expect(undone?.message).toBe('Undid the edit of 2 people.');
  });
});

describe('ticked rows across a new question', () => {
  const before = {} as RecordsView;
  const after = {} as RecordsView;
  const ticked = { kind: 'some' as const, ids: new Set(['a', 'b']) };
  const held = { view: before, selection: ticked, key: 'view-1', filterKey: 'f1', dropped: 0 };

  it('keeps them through a sort on the same view and filter, all matching and its moment too', () => {
    expect(carrySelection(held, after, 'view-1', 'f1')).toEqual({ ...held, view: after });
    const all = { ...held, selection: { kind: 'all-matching' as const, except: new Set<string>() }, asOf: 'then' };
    expect(carrySelection(all, after, 'view-1', 'f1')).toEqual({ ...all, view: after });
  });

  it('clears them on a filter change and counts it, so the screen says so once', () => {
    const next = carrySelection(held, after, 'view-1', 'f2');
    expect(next.selection).toEqual({ kind: 'some', ids: new Set() });
    expect(next.dropped).toBe(1);
    expect(next.filterKey).toBe('f2');
  });

  it('clears them quietly for another view, or when nothing was ticked', () => {
    expect(carrySelection(held, after, 'view-2', 'f1').dropped).toBe(0);
    const none = { ...held, selection: { kind: 'some' as const, ids: new Set<string>() } };
    expect(carrySelection(none, after, 'view-1', 'f2').dropped).toBe(0);
  });
});

describe('combineEditResults', () => {
  const done = (updated: number, undoId?: string, refused = 0) => ({
    kind: 'done' as const,
    updated,
    unchanged: 0,
    refused,
    ...(undoId === undefined ? {} : { undoId }),
  });

  it('says one outcome for several fields: the most records touched, every undo id oldest first', () => {
    const { result, undoIds } = combineEditResults([done(3, 'u1'), done(5, 'u2', 1)]);
    expect(result).toEqual({ kind: 'done', updated: 5, unchanged: 0, refused: 1, undoId: 'u2' });
    expect(undoIds).toEqual(['u1', 'u2']);
  });

  it('lets a failure stand for the whole, keeping the undo of what landed before it', () => {
    const failed = { kind: 'failed' as const, error: dataError('FORBIDDEN', 'No.') };
    const { result, undoIds } = combineEditResults([done(2, 'u1'), failed]);
    expect(result).toBe(failed);
    expect(undoIds).toEqual(['u1']);
  });

  it('has nothing to undo when nothing changed', () => {
    expect(combineEditResults([done(0), done(0)]).undoIds).toEqual([]);
  });
});
