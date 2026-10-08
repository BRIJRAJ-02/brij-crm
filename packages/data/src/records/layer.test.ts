// The records layer against a fake API whose answers the test gives by hand
// (spec 0005, the data layer's tests): windows and status, optimistic edits
// and creates with rollback, cell refusals and toasts, retries when busy.
import type { CreateRecordInput, RecordView, SetValuesInput } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { dataError, type DataError } from '../errors.ts';
import type { Notice } from '../notice.ts';
import { createRecordsLayer, RECORD_WORDS, type RecordsApi } from './layer.ts';

const WS = 'acme';
const PEOPLE = '0199a6f2-0000-7000-8000-00000000000a';
const NAME = 'attr-name';
const CITY = 'attr-city';

const idAt = (index: number) => `0199a6f2-0000-7000-8000-${index.toString(16).padStart(12, '0')}`;
const version = (ms: number) => `0199a6f2-${ms.toString(16).padStart(4, '0')}-7000-8000-000000000000`;
/** A UUID v7 minted at the test's now (`at(30)`): a record that may have just been made. */
const justMinted = (() => {
  const hex = Date.UTC(2026, 9, 8, 9, 0, 30).toString(16).padStart(12, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7000-8000-000000000001`;
})();
const at = (second: number) => `2026-10-08T09:00:${String(second).padStart(2, '0')}.000Z`;

function rowOf(id: string, values: Record<string, unknown>, versions: Record<string, string> = {}, second = 1) {
  const actor = { type: 'member' as const, id: idAt(9999) };
  const view: RecordView = {
    id,
    objectId: PEOPLE,
    createdAt: at(0),
    createdBy: actor,
    updatedAt: at(second),
    updatedBy: actor,
    display: {
      objectId: PEOPLE,
      recordId: id,
      name: typeof values[NAME] === 'string' ? values[NAME] : '',
      kind: 'person',
    },
    values,
    versions,
    linkTotals: {},
  };
  return view;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

interface Pending<I, O> {
  readonly input: I;
  readonly answer: (output: O) => void;
  readonly fail: (error: DataError) => void;
  readonly signal?: AbortSignal;
}

/** A fake API: each call waits in its own queue until the test answers it. */
function fakeApi() {
  const queries: Pending<{ position: number; limit: number }, readonly RecordView[]>[] = [];
  const counts: Pending<undefined, number>[] = [];
  const creates: Pending<CreateRecordInput, RecordView>[] = [];
  const edits: Pending<SetValuesInput, RecordView>[] = [];
  const gets: Pending<readonly string[], RecordView[]>[] = [];
  const queue =
    <I, O>(list: Pending<I, O>[]) =>
    (input: I, signal?: AbortSignal) =>
      new Promise<O>((resolve, reject) => {
        list.push({ input, answer: resolve, fail: reject, ...(signal === undefined ? {} : { signal }) });
      });
  const api: RecordsApi = {
    query: async (input, signal) => ({
      records: [...(await queue(queries)({ position: input.position, limit: input.limit }, signal))],
    }),
    count: async (_input, signal) => ({ count: await queue(counts)(undefined, signal), atLeast: false }),
    get: (input) => queue(gets)(input.ids),
    create: (input) => queue(creates)(input),
    setValues: (input) => queue(edits)(input),
  };
  return { api, queries, counts, creates, edits, gets };
}

/** The records layer on a fake API, with frames, waits and notices in the test's hands. */
function setup() {
  const server = fakeApi();
  const watching: string[] = [];
  const mutationLog: string[] = [];
  const notices: Notice[] = [];
  const waits: number[] = [];
  const frames: (() => void)[] = [];
  let minted = 0;
  const layer = createRecordsLayer({
    api: server.api,
    notify: (notice) => notices.push(notice),
    mintId: () => idAt(5000 + (minted += 1)),
    schedule: (flush) => frames.push(flush),
    wait: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
    now: () => Date.parse(at(30)),
    random: () => 0,
    watch: (workspace) => {
      watching.push(workspace);
      return () => {
        watching.splice(watching.indexOf(workspace), 1);
      };
    },
    mutations: {
      sent: (id) => mutationLog.push(`sent ${id}`),
      forget: (id) => mutationLog.push(`forget ${id}`),
    },
  });
  const frame = () => {
    for (const flush of frames.splice(0)) flush();
  };
  return { ...server, layer, notices, waits, frame, watching, mutationLog };
}

/** The first `count` rows of the table, as the server holds them. */
const block = (from: number, count: number) =>
  Array.from({ length: count }, (_, index) =>
    rowOf(idAt(from + index), { [NAME]: `P${String(from + index)}`, [CITY]: 'London' }, { [CITY]: version(1) }),
  );

/** A view of 3 people, loaded and ready. */
async function readyView() {
  const context = setup();
  const view = context.layer.view(WS, PEOPLE);
  await settle();
  context.counts[0]?.answer(3);
  await settle();
  context.queries[0]?.answer(block(0, 3));
  await settle();
  await view.ready();
  context.frame();
  return { ...context, view };
}

describe('a records view', () => {
  it('loads its count, then its first block, and is ready', async () => {
    const { view, queries, counts } = await readyView();
    expect(counts).toHaveLength(1);
    expect(queries[0]?.input).toEqual({ position: 0, limit: 100 });
    const state = view.getSnapshot();
    expect(state.status).toBe('ready');
    expect(state.source.count).toBe(3);
    expect(state.source.getItem(2)?.values[NAME]).toBe('P2');
  });

  it('is ready at once with no rows, asking for no block', async () => {
    const { layer, counts, queries } = setup();
    const view = layer.view(WS, PEOPLE);
    await settle();
    counts[0]?.answer(0);
    await view.ready();
    expect(view.getSnapshot().status).toBe('ready');
    expect(queries).toHaveLength(0);
  });

  it('is the same view for every screen that asks', () => {
    const { layer } = setup();
    expect(layer.view(WS, PEOPLE)).toBe(layer.view(WS, PEOPLE));
  });

  it('tries a busy read again after the server’s Retry-After', async () => {
    const { layer, counts, queries, waits } = setup();
    const view = layer.view(WS, PEOPLE);
    await settle();
    counts[0]?.answer(3);
    await settle();
    queries[0]?.fail(dataError('TOO_MANY_REQUESTS', 'Busy.', undefined, 2));
    await settle();
    expect(waits).toEqual([2000]);
    expect(queries).toHaveLength(2);
    queries[1]?.answer(block(0, 3));
    await view.ready();
    expect(view.getSnapshot().status).toBe('ready');
  });

  it('fails with Retry, and loads again on retry', async () => {
    const { layer, counts, queries, frame } = setup();
    const view = layer.view(WS, PEOPLE);
    await settle();
    counts[0]?.fail(dataError('API_UNAVAILABLE', 'Can’t reach the CRM.'));
    await view.ready();
    frame();
    expect(view.getSnapshot().status).toBe('error');
    expect(view.getSnapshot().error?.code).toBe('API_UNAVAILABLE');
    view.retry();
    frame();
    expect(view.getSnapshot().status).toBe('loading');
    await settle();
    counts[1]?.answer(2);
    await settle();
    queries[0]?.answer(block(0, 2));
    await view.ready();
    frame();
    expect(view.getSnapshot().status).toBe('ready');
  });

  it('keeps the windows where they are when the count is read again', async () => {
    const { layer, counts, queries, edits } = setup();
    const view = layer.view(WS, PEOPLE);
    await settle();
    counts[0]?.answer(5000);
    await settle();
    queries[0]?.answer(block(0, 100));
    await view.ready();
    view.getSnapshot().source.onRangeChange({ start: 4000, end: 4040 });
    await settle();
    queries[1]?.answer(block(4000, 100));
    await settle();
    // An edit finds its record deleted: the rows after it reload and the count is read again.
    layer.setValues(WS, [{ rowId: idAt(4001), columnId: CITY, value: 'Oslo' }]);
    await settle();
    edits[0]?.fail(dataError('RECORD_DELETED', 'In the trash.'));
    await settle();
    counts[1]?.answer(4999);
    await settle();
    // Only block 40 loads again; nothing jumps back to the top.
    expect(queries.slice(2).map((query) => query.input.position)).toEqual([4000]);
    expect(view.getSnapshot().source.getItem(4005)?.id).toBe(idAt(4005));
  });

  it('keeps the table when a block fails after it is ready, and tries the block again', async () => {
    const { layer, counts, queries, waits, frame } = setup();
    const view = layer.view(WS, PEOPLE);
    await settle();
    counts[0]?.answer(5000);
    await settle();
    queries[0]?.answer(block(0, 100));
    await view.ready();
    view.getSnapshot().source.onRangeChange({ start: 4000, end: 4040 });
    await settle();
    queries[1]?.fail(dataError('API_UNAVAILABLE', 'Can’t reach the CRM.'));
    await settle();
    frame();
    expect(view.getSnapshot().status).toBe('ready');
    expect(waits).toEqual([1000]);
    expect(queries[2]?.input.position).toBe(4000);
  });

  it('brings a record made here into its block when the block was still loading', async () => {
    const { layer, counts, queries, creates } = setup();
    const view = layer.view(WS, PEOPLE);
    await settle();
    counts[0]?.answer(3);
    await settle();
    void layer.create(WS, PEOPLE, { [NAME]: 'Grace' }, idAt(7000)).catch(() => undefined);
    await settle();
    queries[0]?.answer(block(0, 3));
    await view.ready();
    expect(view.indexOf(idAt(7000))).toBe(3);
    expect(creates[0]?.input.id).toBe(idAt(7000));
  });

  it('reads the count again when a block brings fewer rows than it promised', async () => {
    const { layer, counts, queries, frame } = setup();
    const view = layer.view(WS, PEOPLE);
    await settle();
    counts[0]?.answer(3);
    await settle();
    queries[0]?.answer(block(0, 2));
    await settle();
    expect(counts).toHaveLength(2);
    counts[1]?.answer(2);
    await settle();
    frame();
    expect(view.getSnapshot().source.count).toBe(2);
  });

  it('lets go of a view nobody shows, and makes a fresh one next time', async () => {
    const server = fakeApi();
    const layer = createRecordsLayer({
      api: server.api,
      notify: () => undefined,
      mintId: () => idAt(1),
      schedule: (flush) => {
        flush();
      },
      keepUnusedViewMs: 0,
    });
    const view = layer.view(WS, PEOPLE);
    const release = view.retain();
    view.retain()();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(layer.view(WS, PEOPLE)).toBe(view);
    release();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(layer.view(WS, PEOPLE)).not.toBe(view);
  });

  it('lets go of the bodies of blocks scrolled far away', async () => {
    const { layer, counts, queries } = setup();
    const view = layer.view(WS, PEOPLE);
    await settle();
    counts[0]?.answer(5000);
    await settle();
    queries[0]?.answer(block(0, 100));
    await view.ready();
    expect(layer.size()).toBe(100);
    view.getSnapshot().source.onRangeChange({ start: 4000, end: 4040 });
    await settle();
    queries[1]?.answer(block(4000, 100));
    await settle();
    expect(layer.size()).toBe(100);
    expect(view.getSnapshot().source.getItem(4001)?.id).toBe(idAt(4001));
  });
});

describe('editing a cell', () => {
  const change = (value: unknown) => ({ rowId: idAt(1), columnId: CITY, value });

  it('shows at once, then takes the server’s row', async () => {
    const { layer, view, edits, frame } = await readyView();
    layer.setValues(WS, [change('Paris')]);
    frame();
    expect(view.getSnapshot().source.getItem(1)?.values[CITY]).toBe('Paris');
    await settle();
    expect(edits[0]?.input.values).toEqual({ [CITY]: { value: 'Paris' } });
    edits[0]?.answer(rowOf(idAt(1), { [NAME]: 'P1', [CITY]: 'Paris' }, { [CITY]: version(2) }, 2));
    await settle();
    frame();
    expect(view.getSnapshot().source.getItem(1)?.versions[CITY]).toBe(version(2));
  });

  it('rolls back a refusal, marks the cell and raises a toast with Retry that sends it again', async () => {
    const { layer, view, edits, frame, notices } = await readyView();
    layer.setValues(WS, [change('Paris')]);
    await settle();
    edits[0]?.fail(
      dataError('UNIQUE_CONFLICT', 'Not unique.', {
        refusals: [{ code: 'UNIQUE_CONFLICT', message: 'Another person has this city.', attributeId: CITY }],
      }),
    );
    await settle();
    frame();
    const state = view.getSnapshot();
    expect(state.source.getItem(1)?.values[CITY]).toBe('London');
    expect(state.cellErrors.get(`${idAt(1)}:${CITY}`)).toBe('Another person has this city.');
    expect(notices).toHaveLength(1);
    expect(notices[0]?.message).toBe('Another person has this city.');
    expect(notices[0]?.action?.label).toBe(RECORD_WORDS.retry);
    notices[0]?.action?.onAction();
    await settle();
    frame();
    // The retry shows the value again and clears the cell's refusal while it is out.
    expect(view.getSnapshot().source.getItem(1)?.values[CITY]).toBe('Paris');
    expect(view.getSnapshot().cellErrors.size).toBe(0);
    expect(edits).toHaveLength(2);
  });

  it('sends a record’s edits one after another, and never shows the older of two quick edits to one cell', async () => {
    const { layer, view, edits, frame } = await readyView();
    const city = () => {
      frame();
      return view.getSnapshot().source.getItem(1)?.values[CITY];
    };
    layer.setValues(WS, [change('Paris')]);
    layer.setValues(WS, [change('Rome')]);
    await settle();
    expect(city()).toBe('Rome');
    // Rome waits for Paris's answer, so the server writes them in the order they were made.
    expect(edits).toHaveLength(1);
    edits[0]?.answer(rowOf(idAt(1), { [NAME]: 'P1', [CITY]: 'Paris' }, { [CITY]: version(2) }, 2));
    await settle();
    expect(city()).toBe('Rome');
    expect(edits[1]?.input.values).toEqual({ [CITY]: { value: 'Rome' } });
    edits[1]?.answer(rowOf(idAt(1), { [NAME]: 'P1', [CITY]: 'Rome' }, { [CITY]: version(3) }, 3));
    await settle();
    expect(city()).toBe('Rome');
  });

  it('sends the next edit even when the one before it was refused', async () => {
    const { layer, edits } = await readyView();
    layer.setValues(WS, [change('Paris')]);
    layer.setValues(WS, [change('Rome')]);
    await settle();
    edits[0]?.fail(dataError('ATTRIBUTE_VALUE_INVALID', 'No.'));
    await settle();
    expect(edits).toHaveLength(2);
  });

  it('keeps a second edit showing when the first is confirmed', async () => {
    const { layer, view, edits, frame } = await readyView();
    layer.setValues(WS, [change('Paris')]);
    layer.setValues(WS, [change('Rome')]);
    await settle();
    edits[0]?.answer(rowOf(idAt(1), { [NAME]: 'P1', [CITY]: 'Paris' }, { [CITY]: version(2) }, 2));
    await settle();
    frame();
    expect(view.getSnapshot().source.getItem(1)?.values[CITY]).toBe('Rome');
  });

  it('rolls back without a toast of its own when the session ended', async () => {
    const { layer, view, edits, frame, notices } = await readyView();
    layer.setValues(WS, [change('Paris')]);
    await settle();
    edits[0]?.fail(dataError('UNAUTHENTICATED', 'Signed out.'));
    await settle();
    frame();
    expect(view.getSnapshot().source.getItem(1)?.values[CITY]).toBe('London');
    expect(view.getSnapshot().cellErrors.size).toBe(0);
    expect(notices).toEqual([]);
  });

  it('drops a record deleted elsewhere from the table', async () => {
    const { layer, view, edits, frame, notices, queries } = await readyView();
    layer.setValues(WS, [change('Paris')]);
    await settle();
    edits[0]?.fail(dataError('RECORD_DELETED', 'In the trash.'));
    await settle();
    frame();
    expect(view.getSnapshot().source.getItem(1)).toBeUndefined();
    expect(view.indexOf(idAt(1))).toBeUndefined();
    expect(notices[0]?.message).toBe(RECORD_WORDS.recordGone);
    // Its block loads again, since the rows after it moved up.
    expect(queries).toHaveLength(2);
  });

  it('sends a paste as one write per record, and one toast for several refusals', async () => {
    const { layer, edits, notices } = await readyView();
    layer.setValues(WS, [
      { rowId: idAt(0), columnId: CITY, value: 'A' },
      { rowId: idAt(0), columnId: NAME, value: 'B' },
      { rowId: idAt(2), columnId: CITY, value: 'C' },
    ]);
    await settle();
    expect(edits).toHaveLength(2);
    expect(Object.keys(edits[0]?.input.values ?? {})).toEqual([CITY, NAME]);
    for (const edit of edits) edit.fail(dataError('ATTRIBUTE_VALUE_INVALID', 'No.'));
    await settle();
    expect(notices).toHaveLength(1);
    expect(notices[0]?.message).toBe(RECORD_WORDS.notSaved(2));
  });
});

describe('creating a record', () => {
  it('adds the draft at the end at once, and keeps the server’s row', async () => {
    const { layer, view, creates, frame } = await readyView();
    const made = layer.create(WS, PEOPLE, { [NAME]: 'Grace' });
    await settle();
    frame();
    const state = view.getSnapshot();
    expect(state.source.count).toBe(4);
    expect(state.source.getItem(3)?.values[NAME]).toBe('Grace');
    const id = creates[0]?.input.id ?? '';
    expect(view.indexOf(id)).toBe(3);
    creates[0]?.answer(rowOf(id, { [NAME]: 'Grace', created: at(30) }, { [NAME]: version(4) }, 30));
    expect((await made).id).toBe(id);
    frame();
    expect(view.getSnapshot().source.getItem(3)?.values.created).toBe(at(30));
  });

  it('takes a refused create out again, restores the count, and hands back the refusals', async () => {
    const { layer, view, creates, frame } = await readyView();
    const made = layer.create(WS, PEOPLE, { [NAME]: '' });
    await settle();
    const refusal = { code: 'VALUE_REQUIRED' as const, message: 'Name is required.', attributeId: NAME };
    creates[0]?.fail(dataError('VALUE_REQUIRED', 'Name is required.', { refusals: [refusal] }));
    await expect(made).rejects.toMatchObject({ code: 'VALUE_REQUIRED', data: { refusals: [refusal] } });
    frame();
    expect(view.getSnapshot().source.count).toBe(3);
    expect(view.getSnapshot().source.getItem(3)).toBeUndefined();
    expect(layer.size()).toBe(3);
  });

  it('sends a create again with the id the form minted, so a second press makes nothing twice', async () => {
    const { layer, creates } = await readyView();
    const first = layer.create(WS, PEOPLE, { [NAME]: 'Grace' }, idAt(8000));
    await settle();
    creates[0]?.fail(dataError('INTERNAL', 'Lost.'));
    await expect(first).rejects.toMatchObject({ code: 'INTERNAL' });
    const second = layer.create(WS, PEOPLE, { [NAME]: 'Grace' }, idAt(8000));
    await settle();
    expect(creates[1]?.input.id).toBe(idAt(8000));
    creates[1]?.answer(rowOf(idAt(8000), { [NAME]: 'Grace' }));
    expect((await second).id).toBe(idAt(8000));
  });

  it('sends the same create again when it never reached the server', async () => {
    const { layer, creates } = await readyView();
    const made = layer.create(WS, PEOPLE, { [NAME]: 'Grace' });
    await settle();
    creates[0]?.fail(dataError('API_UNAVAILABLE', 'Can’t reach the CRM.'));
    await settle();
    expect(creates).toHaveLength(2);
    expect(creates[1]?.input.id).toBe(creates[0]?.input.id);
    expect(creates[1]?.input.mutationId).toBe(creates[0]?.input.mutationId);
    creates[1]?.answer(rowOf(creates[1].input.id, { [NAME]: 'Grace' }));
    await made;
  });

  it('holds an edit to the draft until the create is in, and drops it with a message when the create is refused', async () => {
    const { layer, view, creates, edits, frame, notices } = await readyView();
    const made = layer.create(WS, PEOPLE, { [NAME]: 'Grace' });
    await settle();
    const id = creates[0]?.input.id ?? '';
    layer.setValues(WS, [{ rowId: id, columnId: CITY, value: 'Austin' }]);
    await settle();
    frame();
    expect(view.getSnapshot().source.getItem(3)?.values[CITY]).toBe('Austin');
    expect(edits).toHaveLength(0);
    creates[0]?.fail(dataError('LIMIT_REACHED', 'Full.'));
    await expect(made).rejects.toMatchObject({ code: 'LIMIT_REACHED' });
    await settle();
    expect(edits).toHaveLength(0);
    expect(notices.map((notice) => notice.message)).toEqual([RECORD_WORDS.draftRefused]);
    expect(layer.size()).toBe(3);
  });

  it('sends an edit to the draft once the create is in', async () => {
    const { layer, creates, edits } = await readyView();
    const made = layer.create(WS, PEOPLE, { [NAME]: 'Grace' });
    await settle();
    const id = creates[0]?.input.id ?? '';
    layer.setValues(WS, [{ rowId: id, columnId: CITY, value: 'Austin' }]);
    await settle();
    creates[0]?.answer(rowOf(id, { [NAME]: 'Grace' }));
    await made;
    await settle();
    expect(edits[0]?.input.recordId).toBe(id);
  });
});

describe('live changes', () => {
  it('watches the workspace while a view of it is open', async () => {
    const { layer, watching } = await readyView();
    expect(watching).toEqual([WS]);
    layer.clear();
    expect(watching).toEqual([]);
  });

  it("logs each write's mutation id as it goes out, and forgets a refused one", async () => {
    const { layer, edits, creates, mutationLog } = await readyView();
    layer.setValues(WS, [{ rowId: idAt(0), columnId: CITY, value: 'Oslo' }]);
    await settle();
    const edit = edits[0]?.input.mutationId ?? '';
    expect(mutationLog).toEqual([`sent ${edit}`]);
    edits[0]?.fail(dataError('ATTRIBUTE_VALUE_INVALID', 'No.'));
    await settle();
    const made = layer.create(WS, PEOPLE, { [NAME]: 'Grace' });
    await settle();
    const create = creates[0]?.input.mutationId ?? '';
    creates[0]?.answer(rowOf(creates[0].input.id, { [NAME]: 'Grace' }));
    await made;
    expect(mutationLog).toEqual([`sent ${edit}`, `forget ${edit}`, `sent ${create}`]);
  });

  it('fetches the held records a frame of events names in one records.get, and patches them in place', async () => {
    const { layer, view, gets, frame } = await readyView();
    layer.changed(WS, PEOPLE, [idAt(0)]);
    layer.changed(WS, PEOPLE, [idAt(2), idAt(0)]);
    expect(gets).toHaveLength(0);
    frame();
    expect(gets.map((call) => call.input)).toEqual([[idAt(0), idAt(2)]]);
    gets[0]?.answer([rowOf(idAt(0), { [NAME]: 'P0', [CITY]: 'Paris' }, { [CITY]: version(2) })]);
    await settle();
    frame();
    const state = view.getSnapshot();
    expect(state.source.getItem(0)?.values[CITY]).toBe('Paris');
    // Left out by the server: deleted elsewhere, so it leaves the table.
    expect(state.source.getItem(2)).toBeUndefined();
  });

  it("never touches a record another workspace's view shows under the same id", async () => {
    const { layer, view, gets, frame } = await readyView();
    // Ids are unique per workspace only: another workspace's change to its own record idAt(0).
    layer.changed('other', PEOPLE, [idAt(0)]);
    frame();
    await settle();
    expect(gets).toHaveLength(0);
    expect(view.getSnapshot().source.getItem(0)?.values[NAME]).toBe('P0');
  });

  it('places a record made elsewhere at the end when the last row is loaded', async () => {
    const { layer, view, gets, counts, frame } = await readyView();
    layer.changed(WS, PEOPLE, [idAt(7)]);
    frame();
    expect(gets.map((call) => call.input)).toEqual([[idAt(7)]]);
    gets[0]?.answer([rowOf(idAt(7), { [NAME]: 'Ada' })]);
    await settle();
    frame();
    const state = view.getSnapshot();
    expect(state.source.count).toBe(4);
    expect(state.source.getItem(3)?.values[NAME]).toBe('Ada');
    // No count was needed for it.
    expect(counts).toHaveLength(1);
  });

  it('asks for the count again, spread out, for a record made out of sight, never for an edit to an older one', async () => {
    const { layer, counts, queries, waits, gets, frame } = setup();
    const view = layer.view(WS, PEOPLE);
    await settle();
    counts[0]?.answer(5000);
    await settle();
    queries[0]?.answer(block(0, 100));
    await view.ready();
    frame();
    // An older record, out of sight: an edit, which leaves the count alone.
    layer.changed(WS, PEOPLE, [idAt(4000)]);
    frame();
    await settle();
    expect(counts).toHaveLength(1);
    // An id minted just now, out of sight (the end isn't loaded): it may be new.
    layer.changed(WS, PEOPLE, [justMinted]);
    frame();
    await settle();
    expect(gets).toHaveLength(0);
    expect(waits).toEqual([0]);
    expect(counts).toHaveLength(2);
    counts[1]?.answer(5001);
    await settle();
    frame();
    expect(view.getSnapshot().source.count).toBe(5001);
  });

  it('keeps the table when a count fails after it is ready, and asks again later', async () => {
    const { layer, view, counts, waits, frame } = await readyView();
    layer.reload(WS);
    counts[1]?.fail(dataError('API_UNAVAILABLE', 'Can’t reach the CRM.'));
    await settle();
    frame();
    expect(view.getSnapshot().status).toBe('ready');
    expect(waits).toEqual([1000]);
    expect(counts).toHaveLength(3);
  });

  it('fetches a record again when it changed while its block was loading', async () => {
    const { layer, counts, queries, gets } = setup();
    const view = layer.view(WS, PEOPLE);
    await settle();
    counts[0]?.answer(3);
    await settle();
    // The block is on its way when an event names one of its rows.
    layer.changed(WS, PEOPLE, [idAt(1)]);
    queries[0]?.answer(block(0, 3));
    await view.ready();
    expect(gets.map((call) => call.input)).toEqual([[idAt(1)]]);
  });

  it('keeps the newer row when a record placed from an event is named again', async () => {
    const { layer, view, gets, frame } = await readyView();
    layer.changed(WS, PEOPLE, [idAt(7)]);
    frame();
    layer.changed(WS, PEOPLE, [idAt(7)]);
    frame();
    expect(gets).toHaveLength(2);
    gets[0]?.answer([rowOf(idAt(7), { [NAME]: 'Ada' }, { [NAME]: version(1) })]);
    await settle();
    gets[1]?.answer([rowOf(idAt(7), { [NAME]: 'Ada Lovelace' }, { [NAME]: version(2) })]);
    await settle();
    frame();
    expect(view.getSnapshot().source.count).toBe(4);
    expect(view.getSnapshot().source.getItem(3)?.values[NAME]).toBe('Ada Lovelace');
  });

  it('loads the count and blocks again on reload, keeping the table', async () => {
    const { layer, view, counts, queries, frame } = await readyView();
    layer.reload(WS);
    frame();
    expect(view.getSnapshot().status).toBe('ready');
    expect(counts).toHaveLength(2);
    expect(queries).toHaveLength(2);
    counts[1]?.answer(3);
    queries[1]?.answer(block(0, 3));
    await settle();
    layer.reload('elsewhere');
    expect(counts).toHaveLength(2);
  });
});
