// The bulk bar's rules and words (spec 0022, AC-524 to AC-526, AC-541).
import { dataError } from '@crm/data';
import { describe, expect, it } from 'vitest';
import { deleteOffer, deleteToast, lifecycleUndoToast, needsConfirm, recordsWord } from './bulk.ts';
import { undoToast } from './undo.ts';

const PEOPLE = { singularName: 'Person', pluralName: 'People' };
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
      'Changes to more than 500 records arrive soon.',
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
