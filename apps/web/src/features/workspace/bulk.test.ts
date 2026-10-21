// The bulk bar's rules and words (spec 0022, AC-524 to AC-526, AC-541).
import { dataError } from '@crm/data';
import { describe, expect, it } from 'vitest';
import type { JobView } from '@crm/data';
import {
  bulkEditToast,
  bulkJobToast,
  deleteOffer,
  deleteToast,
  jobProgress,
  lifecycleUndoToast,
  needsConfirm,
  recordsWord,
} from './bulk.ts';
import { breaksUnique } from './BulkEditDialog.tsx';
import { undoToast } from './undo.ts';

const PEOPLE = { singularName: 'Person', pluralName: 'People' };
const RECORDS = { singularName: 'Record', pluralName: 'Records' };
const OBJECT = '0199a6f2-0000-7000-8000-000000000003';

describe('the bulk bar', () => {
  it('deletes one at once and asks for two or more; past 500 it says so', () => {
    expect(needsConfirm(1)).toBe(false);
    expect(needsConfirm(2)).toBe(true);
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
      'Deleted 46 people. 2 weren’t deleted; each row says why.',
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
    expect(deleteToast({ kind: 'too-many', limit: 500 }, PEOPLE, onUndo)?.message).toBe(
      'Change at most 500 records in one request; more run as a background change.',
    );
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
    ).toBe('Updated 9,998 people. 2 were refused; the details say why.');
    const purge = bulkJobToast(bulkJob('succeeded', { kind: 'records.purge', done: 1200 }), RECORDS, { onView }, [
      { names: PEOPLE, count: 12 },
    ]);
    expect(purge).toMatchObject({
      tone: 'danger',
      message:
        'Deleted 1,200 records forever. 12 People records stay in the trash because you can view People but not change them.',
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
    ).toBe('Updated 46 people. 2 were refused; each cell says why.');
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
