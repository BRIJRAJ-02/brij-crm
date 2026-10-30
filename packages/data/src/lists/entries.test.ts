// The lists layer against a fake API answered by hand (spec 0048): a list's rows join each entry to its record in
// the records store's one copy; an add shows first; a list cell shows at once and rolls back on a refusal; a removal
// leaves at once and Undo goes on the stack.
import type { EntryView, RecordView, WrittenEntry } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { dataError } from '../errors.ts';
import { createMutationLog } from '../live/mutations.ts';
import type { ExternalEntry } from '../records/history.ts';
import { createPlainStore } from '../records/plain-store.ts';
import { createEntriesLayer, type EntriesApi } from './entries.ts';

const LIST = { id: 'list-1', objectId: 'object-1', name: 'Hiring' };
const STAGE = 'attr-stage';
const NAME = 'attr-name';

const record = (id: string, name: string): RecordView => ({
  id,
  objectId: 'object-1',
  display: { objectId: 'object-1', recordId: id, name, kind: 'person' },
  revision: 1,
  values: { [NAME]: name },
  versions: {},
  linkTotals: {},
});

const entry = (id: string, recordId: string, stage: string | null = null): EntryView => ({
  id,
  listId: LIST.id,
  recordId,
  createdAt: '2026-10-31T09:00:00.000Z',
  createdBy: { type: 'member', id: 'member-1' },
  updatedAt: '2026-10-31T09:00:00.000Z',
  updatedBy: { type: 'member', id: 'member-1' },
  values: { [STAGE]: stage },
  versions: {},
});

const written = (view: EntryView, extra: Partial<WrittenEntry> = {}): WrittenEntry => ({
  ...view,
  written: {},
  echoes: 1,
  ...extra,
});

/** A layer over a fake API, with the records store and undo stack it shares, every frame run at once. */
function setup(overrides: Partial<EntriesApi> = {}) {
  const records = createPlainStore<RecordView>();
  const undo: ExternalEntry[] = [];
  const notices: string[] = [];
  const api: EntriesApi = {
    query: () => Promise.resolve({ entries: [entry('e1', 'r1', 'lead')], records: [record('r1', 'Ada')] }),
    count: () => Promise.resolve({ count: 1, atLeast: false }),
    groups: () => Promise.resolve({ groups: [] }),
    get: () => Promise.resolve({ entries: [], records: [] }),
    membership: () => Promise.resolve({ recordIds: [] }),
    add: (input) =>
      Promise.resolve({ ...written(entry(input.id, input.recordId)), record: record(input.recordId, 'Bo') }),
    setValues: (input) => Promise.resolve(written({ ...entry(input.entryId, 'r1'), values: { [STAGE]: 'won' } })),
    remove: (input) => Promise.resolve({ results: input.entryIds.map((entryId) => ({ entryId })), echoes: 1 }),
    restore: (input) => Promise.resolve({ results: input.entryIds.map((entryId) => ({ entryId })), echoes: 1 }),
    ...overrides,
  };
  let minted = 0;
  const layer = createEntriesLayer({
    api,
    records: {
      receive: records.receive,
      hold: records.hold,
      release: records.release,
      get: records.get,
      subscribe: records.subscribe,
      pushUndo: (_workspace, made) => {
        undo.push(made);
      },
      displaysOf: (_workspace, refs) => refs.map(() => 'loading' as const),
      onNames: () => () => undefined,
    },
    notify: (notice) => {
      notices.push(notice.message);
    },
    mintId: () => `id-${String((minted += 1))}`,
    mutations: createMutationLog(),
    watch: () => () => undefined,
    refusalSummary: (error) => error.message,
    timeZone: () => 'UTC',
    schedule: (flush) => {
      flush();
    },
    later: () => () => undefined,
  });
  return { layer, records, undo, notices };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a list’s rows (AC-4809, AC-4840)', () => {
  it('joins each entry to its record from the records store’s one copy', async () => {
    const { layer, records } = setup();
    const view = layer.view('acme', LIST, {}, [NAME]);
    const release = view.retain();
    await view.ready();
    const first = view.getSnapshot();
    first.source.onRangeChange({ start: 0, end: 10 });
    await settle();
    const row = view.getSnapshot().source.getItem(0);
    expect(row).toMatchObject({ id: 'e1', recordId: 'r1', values: { [NAME]: 'Ada', [STAGE]: 'lead' } });
    // The record edited elsewhere shows in the row: there is one copy.
    records.receive([{ ...record('r1', 'Ada Lovelace'), revision: 2 }]);
    expect(layer.rowOf('e1')?.values[NAME]).toBe('Ada Lovelace');
    release();
  });
});

describe('adding, editing and removing (AC-4810, AC-4813, AC-4817)', () => {
  it('shows an added entry first, marked new, and puts its Undo on the stack', async () => {
    const { layer, undo } = setup();
    const view = layer.view('acme', LIST, {}, []);
    view.retain();
    await view.ready();
    const outcome = await layer.add('acme', LIST, 'r2');
    expect(outcome.kind).toBe('added');
    const state = view.getSnapshot();
    expect(state.source.getItem(0)?.recordId).toBe('r2');
    expect(state.rowNotes.get(state.source.getItem(0)?.id ?? '')).toBe('new');
    expect(state.count.count).toBe(2);
    expect(undo).toHaveLength(1);
  });

  it('answers a refused add with its code and sentence', async () => {
    const refusal = dataError('ENTRY_EXISTS', 'That record is already in this list.');
    const { layer } = setup({ add: () => Promise.reject(refusal) });
    expect(await layer.add('acme', LIST, 'r1')).toMatchObject({
      kind: 'refused',
      code: 'ENTRY_EXISTS',
      message: refusal.message,
    });
  });

  it('shows a list cell at once, and rolls it back with the refusal’s sentence', async () => {
    let refuse: (error: Error) => void = () => undefined;
    const { layer, notices } = setup({
      setValues: () =>
        new Promise((_resolve, reject) => {
          refuse = reject;
        }),
    });
    const view = layer.view('acme', LIST, {}, []);
    view.retain();
    await view.ready();
    view.getSnapshot().source.onRangeChange({ start: 0, end: 10 });
    await settle();
    const saving = layer.setCell('acme', LIST, 'e1', { id: STAGE, title: 'Stage' }, 'won');
    expect(layer.rowOf('e1')?.values[STAGE]).toBe('won');
    refuse(dataError('ATTRIBUTE_VALUE_INVALID', 'Pick one of the stages.'));
    expect(await saving).toBe(false);
    expect(layer.rowOf('e1')?.values[STAGE]).toBe('lead');
    expect(notices).toEqual(['Pick one of the stages.']);
    expect(view.getSnapshot().cellErrors.get(`e1:${STAGE}`)).toBe('Pick one of the stages.');
  });

  it('takes removed entries out, says how many stayed, and Undo restores exactly those that left', async () => {
    const restored: string[][] = [];
    const { layer, undo } = setup({
      remove: (input) =>
        Promise.resolve({
          results: input.entryIds.map((entryId) =>
            entryId === 'e2'
              ? { entryId, refusal: { code: 'NOT_FOUND' as const, message: 'That entry does not exist.' } }
              : { entryId },
          ),
          echoes: 1,
        }),
      restore: (input) => {
        restored.push([...input.entryIds]);
        return Promise.resolve({ results: input.entryIds.map((entryId) => ({ entryId })), echoes: 1 });
      },
    });
    const outcome = await layer.remove('acme', LIST, ['e1', 'e2']);
    expect(outcome).toMatchObject({ removed: 1, kept: 1, reason: 'That entry does not exist.' });
    expect(undo).toHaveLength(1);
    const said = await undo[0]?.run();
    expect(said?.tone).toBe('success');
    expect(restored).toEqual([['e1']]);
  });
});
