// The Trash screen's rules and words (spec 0022, AC-533, AC-534).
import { dataError, type MemberSummary, type ObjectSummary, type TrashRow } from '@crm/data';
import { describe, expect, it } from 'vitest';
import {
  canRestore,
  cellValue,
  dayFormatter,
  dayIn,
  deletedBy,
  objectLabel,
  purgeToast,
  restoreToast,
  TRASH_COLUMNS,
} from './trash.ts';
import { strings } from './strings.ts';

const PEOPLE = { id: 'people', pluralName: 'People', isArchived: false, access: 'write' } as ObjectSummary;
const DEALS = { id: 'deals', pluralName: 'Deals', isArchived: true, access: 'read' } as ObjectSummary;
const OBJECTS = new Map([PEOPLE, DEALS].map((object) => [object.id, object]));
const ADA = { id: 'member-ada', name: 'Ada Lovelace' } as MemberSummary;

function rowOf(objectId: string, by: TrashRow['item']['deletedBy'] = { type: 'member', id: ADA.id }): TrashRow {
  return {
    id: `record-${objectId}`,
    values: {},
    item: {
      recordId: `record-${objectId}`,
      objectId,
      display: { objectId, recordId: `record-${objectId}`, name: 'Ada', kind: 'person' },
      deletedAt: '2026-10-15T23:30:00.000Z',
      deletedBy: by,
      expiresAt: '2026-11-14T23:30:00.000Z',
    },
  };
}

describe('the trash', () => {
  it('shows each cell in its type’s shape, the removal day in the browser’s zone', () => {
    const row = rowOf('deals');
    expect(cellValue(row, TRASH_COLUMNS.name, OBJECTS, dayFormatter('UTC'))).toEqual({
      objectId: 'deals',
      recordId: 'record-deals',
    });
    expect(cellValue(row, TRASH_COLUMNS.object, OBJECTS, dayFormatter('UTC'))).toBe('Deals (archived)');
    expect(cellValue(row, TRASH_COLUMNS.expiresAt, OBJECTS, dayFormatter('UTC'))).toBe('2026-11-14');
    expect(dayIn('2026-11-14T23:30:00.000Z', 'Asia/Tokyo')).toBe('2026-11-15');
    expect(objectLabel(PEOPLE)).toBe('People');
  });

  it('names who deleted a record, and someone who left', () => {
    expect(deletedBy(rowOf('people'), [ADA])?.name).toBe('Ada Lovelace');
    expect(deletedBy(rowOf('people'), [])?.name).toBe('Someone removed from this workspace');
    expect(deletedBy(rowOf('people', { type: 'system', id: null }), [])?.name).toBe('The system');
    expect(deletedBy(rowOf('people', { type: 'api_key', id: 'key' }), [])?.name).toBe('An API key');
  });

  it('allows Restore when any selected record’s object may be changed (AC-534)', () => {
    const rows = new Map([rowOf('deals'), rowOf('people')].map((row) => [row.id, row]));
    const rowFor = (id: string) => rows.get(id);
    expect(canRestore(['record-deals', 'record-people'], rowFor, OBJECTS)).toBe(true);
    expect(canRestore(['record-deals'], rowFor, OBJECTS)).toBe(false);
    // A row scrolled out of the loaded ones may be writable: the server decides.
    expect(canRestore(['record-gone'], rowFor, OBJECTS)).toBe(true);
    // It stops at the first row it may restore.
    const asked: string[] = [];
    canRestore(
      ['record-people', 'record-deals'],
      (id) => {
        asked.push(id);
        return rowFor(id);
      },
      OBJECTS,
    );
    expect(asked).toEqual(['record-people']);
  });

  it('says what Delete forever did, in restore’s words when some were refused (AC-538)', () => {
    expect(purgeToast({ kind: 'done', purged: 46, skipped: 0, refused: 2, refusedIds: ['a', 'b'] })).toEqual({
      tone: 'danger',
      message: 'Deleted 46 records forever. 2 couldn’t be deleted; each row says why.',
    });
    expect(purgeToast({ kind: 'done', purged: 0, skipped: 0, refused: 1, refusedIds: ['a'] })).toEqual({
      tone: 'danger',
      message: '1 record couldn’t be deleted. Each row says why.',
    });
    expect(purgeToast({ kind: 'done', purged: 1, skipped: 0, refused: 0, refusedIds: [] })).toEqual({
      tone: 'success',
      message: 'Deleted 1 record forever.',
    });
  });

  it('says what a restore did', () => {
    expect(
      restoreToast({ kind: 'done', restored: 1, refused: 0, refusedIds: [], objectIds: ['people'] }, 'Ada'),
    ).toEqual({
      tone: 'success',
      message: 'Restored Ada.',
    });
    expect(
      restoreToast({ kind: 'done', restored: 46, refused: 2, refusedIds: ['a', 'b'], objectIds: ['people'] }, undefined)
        ?.message,
    ).toBe('Restored 46 records. 2 couldn’t be restored; each row says why.');
    expect(
      restoreToast({ kind: 'done', restored: 0, refused: 1, refusedIds: ['a'], objectIds: [] }, undefined)?.message,
    ).toBe('1 record couldn’t be restored. Each row says why.');
    expect(
      restoreToast({ kind: 'failed', error: dataError('API_UNAVAILABLE', 'Can’t reach the CRM.') }, undefined),
    ).toEqual({ tone: 'danger', message: 'Can’t reach the CRM.' });
  });
});

describe('the count beside the title', () => {
  it('says record for one and records for any other count (Q98)', () => {
    expect(strings.countLabel(1)).toBe('record');
    expect(strings.countLabel(2)).toBe('records');
    expect(strings.countLabel(1234)).toBe('records');
  });
});
