// The records layer against a fake API whose answers the test gives by hand
// (spec 0005, the data layer's tests): windows and status, optimistic edits
// and creates with rollback, cell refusals and toasts, retries when busy.
import {
  MAX_BATCH_RECORDS as CONTRACT_MAX_BATCH,
  type AttributeDefinition,
  type BatchResults,
  type ChangeEvent,
  type CreateRecordInput,
  type DeleteManyInput,
  type DeleteManyResults,
  type RecordView,
  type RestoreBatchInput,
  type RestoreBatchResults,
  type SetValuesBatchInput,
  type SetValuesInput,
} from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { dataError, type DataError } from '../errors.ts';
import type { Notice } from '../notice.ts';
import type { GroupsAnswer, GroupsRequest } from './board.ts';
import { UNDO_DEPTH } from './history.ts';
import { createRecordsLayer, MAX_BATCH_RECORDS, RECORD_WORDS, type RecordsApi, type ReplacedNotice } from './layer.ts';

const WS = 'acme';
/** This person's member id, and someone else's. */
const ME = '0199a6f2-0000-7000-8000-0000000000e1';
const BEA = '0199a6f2-0000-7000-8000-0000000000e2';
const PEOPLE = '0199a6f2-0000-7000-8000-00000000000a';
const NAME = 'attr-name';
const CITY = 'attr-city';
const CREATED = 'attr-created-at';
const OWNER = 'attr-owner';
const UPDATED = 'attr-updated-at';
/** People's attributes as `describe` gives them: a name, a city, created at, an owner (a member) and updated at. */
const SHAPE = [
  { id: NAME, type: 'personal_name', isSystem: false, apiSlug: 'name' },
  { id: CITY, type: 'text', isSystem: false, apiSlug: 'city' },
  { id: CREATED, type: 'timestamp', isSystem: true, apiSlug: 'created_at' },
  { id: OWNER, type: 'actor_reference', isSystem: false, apiSlug: 'owner' },
  { id: UPDATED, type: 'timestamp', isSystem: true, apiSlug: 'updated_at' },
];

const idAt = (index: number) => `0199a6f2-0000-7000-8000-${index.toString(16).padStart(12, '0')}`;
const version = (ms: number) => `0199a6f2-${ms.toString(16).padStart(4, '0')}-7000-8000-000000000000`;
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
    revision: 0,
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

/** The versions a write made, as the server answers them: each attribute it sent, at the row's version. */
const writtenOf = (row: RecordView, attributeIds: readonly string[]): Record<string, string> =>
  Object.fromEntries(
    attributeIds.flatMap((attributeId) => {
      const version = row.versions[attributeId];
      return version === undefined ? [] : [[attributeId, version]];
    }),
  );

/** A fake API: each call waits in its own queue until the test answers it. */
function fakeApi() {
  const queries: Pending<QueryCall, readonly RecordView[] | { records: readonly RecordView[]; nextCursor?: string }>[] =
    [];
  const counts: Pending<CountCall, number | { count: number; atLeast: boolean }>[] = [];
  const creates: Pending<CreateRecordInput, RecordView>[] = [];
  // A test may say what the write itself made (`written`); by default, each value it sent at the answer's version.
  const edits: Pending<SetValuesInput, RecordView & { readonly written?: Record<string, string> }>[] = [];
  const batches: Pending<SetValuesBatchInput, BatchResults>[] = [];
  const gets: Pending<readonly string[], RecordView[]>[] = [];
  const deletes: Pending<DeleteManyInput, DeleteManyResults['results']>[] = [];
  const restores: Pending<RestoreBatchInput, RestoreBatchResults['results']>[] = [];
  const groups: Pending<GroupsRequest, GroupsAnswer>[] = [];
  // What each records.get asked for besides its ids: the attributes (spec 0006, AC-55).
  const getAttributes: (readonly string[] | undefined)[] = [];
  const queue =
    <I, O>(list: Pending<I, O>[]) =>
    (input: I, signal?: AbortSignal) =>
      new Promise<O>((resolve, reject) => {
        list.push({ input, answer: resolve, fail: reject, ...(signal === undefined ? {} : { signal }) });
      });
  const api: RecordsApi = {
    query: async (input, signal) => {
      const { workspace: _workspace, objectId: _objectId, ...asked } = input;
      // The tests that don't look at the read's attributes or clock compare only where it starts and how many.
      const call: QueryCall = { ...asked };
      const answer = await queue(queries)(call, signal);
      return Array.isArray(answer)
        ? { records: [...(answer as readonly RecordView[])] }
        : (answer as { records: RecordView[]; nextCursor?: string });
    },
    count: async (input, signal) => {
      const { workspace: _workspace, objectId: _objectId, ...asked } = input;
      const answer = await queue(counts)(asked, signal);
      return typeof answer === 'number' ? { count: answer, atLeast: false } : answer;
    },
    get: (input) => {
      getAttributes.push(input.attributeIds);
      return queue(gets)(input.ids);
    },
    // Each write stores one outbox row here: one echo.
    create: async (input) => ({ ...(await queue(creates)(input)), echoes: 1, written: {} }),
    setValues: async (input) => {
      const { written, ...row } = await queue(edits)(input);
      return { ...row, echoes: 1, written: written ?? writtenOf(row, Object.keys(input.values)) };
    },
    // A result that names no `written` made each value it sent, at its record's version.
    setValuesBatch: async (input) => {
      const answer = await queue(batches)(input);
      const sent = new Map(input.items.map((item) => [item.recordId, Object.keys(item.values)]));
      return {
        ...answer,
        results: answer.results.map((result) =>
          result.record === undefined || result.written !== undefined
            ? result
            : { ...result, written: writtenOf(result.record, sent.get(result.recordId) ?? []) },
        ),
      };
    },
    // Spec 0022: each answers its results with one echo.
    deleteMany: async (input) => ({ results: await queue(deletes)(input), echoes: 1 }),
    restoreBatch: async (input) => ({ mode: 'inline' as const, results: await queue(restores)(input), echoes: 1 }),
    // Spec 0021: a board's first cards and counts.
    groups: (input, signal) => queue(groups)(input, signal),
  };
  return { api, queries, counts, creates, edits, batches, gets, getAttributes, deletes, restores, groups };
}

/** What a records.query carried, past its workspace and object. */
interface QueryCall {
  readonly position?: number;
  readonly cursor?: string;
  readonly limit: number;
  readonly attributeIds?: readonly string[];
  readonly filter?: unknown;
  readonly sorts?: unknown;
  readonly now?: string;
  readonly timeZone?: string;
}

/** What a records.count carried, past its workspace and object. */
interface CountCall {
  readonly filter?: unknown;
  readonly now?: string;
  readonly timeZone?: string;
}

/** The records layer on a fake API, with frames, waits, timers and notices in the test's hands. */
function setup(
  options: {
    readonly describe?: Parameters<typeof createRecordsLayer>[0]['describe'];
    readonly definitionsOf?: Parameters<typeof createRecordsLayer>[0]['definitionsOf'];
  } = {},
) {
  const server = fakeApi();
  const watching: string[] = [];
  const mutationLog: string[] = [];
  const notices: Notice[] = [];
  const replaced: ReplacedNotice[] = [];
  const waits: number[] = [];
  const frames: (() => void)[] = [];
  const timers: { ms: number; run: () => void; live: boolean }[] = [];
  let clock = Date.parse(at(30));
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
    now: () => clock,
    random: () => 0,
    timeZone: () => 'Europe/London',
    later: (run, ms) => {
      const timer = { ms, run, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    describe: options.describe ?? (() => Promise.resolve({ primaryAttributeId: NAME, attributes: SHAPE })),
    ...(options.definitionsOf === undefined ? {} : { definitionsOf: options.definitionsOf }),
    watch: (workspace) => {
      watching.push(workspace);
      return () => {
        watching.splice(watching.indexOf(workspace), 1);
      };
    },
    mutations: {
      sent: (id) => mutationLog.push(`sent ${id}`),
      answered: (id, echoes) => mutationLog.push(`answered ${id} ${String(echoes)}`),
      forget: (id) => mutationLog.push(`forget ${id}`),
    },
    memberOf: () => Promise.resolve(ME),
    onReplaced: (notice) => replaced.push(notice),
  });
  const frame = () => {
    for (const flush of frames.splice(0)) flush();
  };
  /** Runs the timers that are due, `ms` from now (settle's 1.5 s), moving the clock on. */
  const tick = (ms: number) => {
    clock += ms;
    for (const timer of timers.splice(0)) {
      if (!timer.live) continue;
      if (timer.ms <= ms) timer.run();
      else timers.push({ ...timer, ms: timer.ms - ms });
    }
  };
  return { ...server, layer, notices, replaced, waits, frame, tick, watching, mutationLog };
}

/** The first `count` rows of the table, as the server holds them. */
const block = (from: number, count: number) =>
  Array.from({ length: count }, (_, index) =>
    rowOf(idAt(from + index), { [NAME]: `P${String(from + index)}`, [CITY]: 'London' }, { [CITY]: version(1) }),
  );

/** A view of 3 people, loaded and ready, shown by a screen with the city column. */
async function readyView(options: Parameters<typeof setup>[0] = {}) {
  const context = setup(options);
  const view = context.layer.view(WS, PEOPLE);
  const reader = view.retain([CITY]);
  await settle();
  context.counts[0]?.answer(3);
  await settle();
  context.queries[0]?.answer(block(0, 3));
  await settle();
  await view.ready();
  context.frame();
  return { ...context, view, reader };
}

describe('a records view', () => {
  it('loads its count, then its first block, and is ready', async () => {
    const { view, queries, counts } = await readyView();
    expect(counts).toHaveLength(1);
    // Only the columns on screen and the primary, on the window's clock (spec 0006, AC-51, AC-55).
    expect(queries[0]?.input).toEqual({
      position: 0,
      limit: 100,
      attributeIds: [CITY, NAME],
      now: at(30),
      timeZone: 'Europe/London',
    });
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
    void layer.setValues(WS, [{ rowId: idAt(4001), columnId: CITY, value: 'Oslo' }]);
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

  it('reads the count again at the next settle when a block brings fewer rows than it promised', async () => {
    const { layer, counts, queries, frame, tick } = setup();
    const view = layer.view(WS, PEOPLE);
    view.retain([CITY]);
    await settle();
    counts[0]?.answer(3);
    await settle();
    queries[0]?.answer(block(0, 2));
    await settle();
    expect(counts).toHaveLength(1);
    tick(1500);
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
    const reader = view.retain();
    view.retain().release();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(layer.view(WS, PEOPLE)).toBe(view);
    reader.release();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(layer.view(WS, PEOPLE)).not.toBe(view);
  });

  it('lets go of the bodies of blocks scrolled far away, 30 seconds later', async () => {
    const { layer, counts, queries, tick } = setup();
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
    // The first block's bodies stay a while (another window may show them), then go.
    expect(layer.size()).toBe(200);
    tick(30_000);
    expect(layer.size()).toBe(100);
    expect(view.getSnapshot().source.getItem(4001)?.id).toBe(idAt(4001));
  });
});

describe('one store (spec 0006, AC-42)', () => {
  it('keeps one body for a record two windows show, and an edit shows in both in the same frame, one render each', async () => {
    const { layer, counts, queries, frame } = setup();
    const byCity = layer.view(WS, PEOPLE, { sorts: [{ attributeId: CITY, direction: 'descending' }] });
    const newest = layer.view(WS, PEOPLE);
    byCity.retain([CITY]);
    newest.retain([CITY]);
    await settle();
    for (const count of counts) count.answer(3);
    await settle();
    // The same three people, in two orders.
    queries[0]?.answer([...block(0, 3)].reverse());
    queries[1]?.answer(block(0, 3));
    await Promise.all([byCity.ready(), newest.ready()]);
    frame();
    expect(layer.size()).toBe(3);
    const renders = [0, 0];
    byCity.subscribe(() => (renders[0] = (renders[0] ?? 0) + 1));
    newest.subscribe(() => (renders[1] = (renders[1] ?? 0) + 1));
    void layer.setValues(WS, [{ rowId: idAt(1), columnId: NAME, value: 'Grace' }]);
    frame();
    expect(byCity.getSnapshot().source.getItem(1)?.values[NAME]).toBe('Grace');
    expect(newest.getSnapshot().source.getItem(1)?.values[NAME]).toBe('Grace');
    // The same object in both: one body.
    expect(byCity.getSnapshot().source.getItem(1)).toBe(newest.getSnapshot().source.getItem(1));
    expect(renders).toEqual([1, 1]);
  });
});

describe('windows keyed by their question (spec 0006, AC-51 to AC-53)', () => {
  const byCity = { sorts: [{ attributeId: CITY, direction: 'ascending' as const }] };
  const byOwner = { sorts: [{ attributeId: OWNER, direction: 'ascending' as const }] };
  const inLondon = {
    filter: {
      conjunction: 'and' as const,
      conditions: [{ attributeId: CITY, operator: 'is' as const, value: 'London' }],
    },
  };

  /** A view of `query`, ready with `rows` (a page in cursor mode when `nextCursor` is given). */
  async function readyQuery(
    query: Parameters<ReturnType<typeof setup>['layer']['view']>[2],
    count: number | { count: number; atLeast: boolean },
    rows: readonly RecordView[],
    nextCursor?: string,
  ) {
    const context = setup();
    const view = context.layer.view(WS, PEOPLE, query);
    const reader = view.retain([CITY]);
    await settle();
    context.counts[0]?.answer(count);
    await settle();
    context.queries[0]?.answer(nextCursor === undefined ? rows : { records: rows, nextCursor });
    await settle();
    await view.ready();
    context.frame();
    return { ...context, view, reader };
  }

  it('aborts a window no screen showed once it is abandoned (a draft typed on, spec 0020 AC-464), and opens a fresh one after', async () => {
    const { layer, counts } = setup();
    const typed = layer.view(WS, PEOPLE, inLondon);
    const ready = typed.ready();
    await settle();
    const count = counts[0];
    expect(count?.signal?.aborted).toBe(false);
    typed.abandon();
    expect(count?.signal?.aborted).toBe(true);
    // Its ready settles, so nothing waits on it for ever.
    await expect(ready).resolves.toBeUndefined();
    expect(layer.view(WS, PEOPLE, inLondon)).not.toBe(typed);
    // A view a screen holds is left alone.
    const held = layer.view(WS, PEOPLE, byCity);
    const reader = held.retain([CITY]);
    held.abandon();
    expect(layer.view(WS, PEOPLE, byCity)).toBe(held);
    reader.release();
  });

  it('shares one window between screens asking the same question, and opens another for a new sort', () => {
    const { layer } = setup();
    const one = layer.view(WS, PEOPLE, byCity);
    // The same question spelled another way (no filter, an empty one) is the same window.
    expect(layer.view(WS, PEOPLE, { ...byCity, filter: { conjunction: 'and', conditions: [] } })).toBe(one);
    expect(layer.view(WS, PEOPLE, byOwner)).not.toBe(one);
    expect(layer.view(WS, PEOPLE)).not.toBe(one);
  });

  it('jumps by position on no sort or a stored kind, and pages by cursor on a member sort or a filter', async () => {
    const plain = await readyQuery(undefined, 3, block(0, 3));
    expect(plain.view.getSnapshot().mode).toBe('position');
    const city = await readyQuery(byCity, 3, block(0, 3));
    expect(city.view.getSnapshot().mode).toBe('position');
    expect(city.queries[0]?.input).toMatchObject({ position: 0, sorts: byCity.sorts });
    const owner = await readyQuery(byOwner, 3, block(0, 3));
    expect(owner.view.getSnapshot().mode).toBe('cursor');
    expect(owner.queries[0]?.input.position).toBeUndefined();
    expect(owner.queries[0]?.input.cursor).toBeUndefined();
    const filtered = await readyQuery(inLondon, { count: 10_000, atLeast: true }, block(0, 100), 'c1');
    const state = filtered.view.getSnapshot();
    expect(state.mode).toBe('cursor');
    // "10,000+": the label says at least, the bar covers 10,000 for now.
    expect(state.count).toEqual({ count: 10_000, atLeast: true });
    expect(filtered.counts[0]?.input).toMatchObject({ filter: inLondon.filter });
  });

  it('sends one clock with every block and count of a window, and takes a fresh one at each settle', async () => {
    const { layer, view, queries, counts, tick, frame } = await readyQuery(inLondon, 300, block(0, 100), 'after-99');
    view.getSnapshot().source.onRangeChange({ start: 90, end: 140 });
    await settle();
    expect(queries[1]?.input).toMatchObject({ cursor: 'after-99', now: at(30) });
    expect(counts[0]?.input.now).toBe(at(30));
    queries[1]?.answer({ records: block(100, 100), nextCursor: 'after-199' });
    await settle();
    // Someone made a record elsewhere (the event names it created): 1.5 s later the window settles, on a clock
    // taken then.
    layer.changed(WS, PEOPLE, [idAt(4002)], [NAME], { createdIds: [idAt(4002)] });
    frame();
    tick(1000);
    expect(queries).toHaveLength(2);
    tick(500);
    await settle();
    const settledAt = new Date(Date.parse(at(30)) + 1500).toISOString();
    expect(queries[2]?.input).toMatchObject({ limit: 200, now: settledAt });
    expect(queries[2]?.input.cursor).toBeUndefined();
    expect(counts[1]?.input.now).toBe(settledAt);
  });

  it('restarts the chain once when the server refuses a cursor, and shows the error with Retry when it fails again', async () => {
    const { view, queries, frame } = await readyQuery(byOwner, 300, block(0, 100), 'after-99');
    const refused = () =>
      dataError('INPUT_INVALID', 'This page link belongs to another view.', {
        issues: [{ path: ['cursor'], message: 'This page link belongs to another view.' }],
      });
    view.getSnapshot().source.onRangeChange({ start: 100, end: 140 });
    await settle();
    queries[1]?.fail(refused());
    await settle();
    // Started again from block 0, no cursor.
    expect(queries[2]?.input.cursor).toBeUndefined();
    queries[2]?.answer({ records: block(0, 100), nextCursor: 'after-99-again' });
    await settle();
    // That read landed, so one more refusal may restart again; but a refusal of the restart itself shows the error.
    queries[3]?.fail(refused());
    await settle();
    queries[4]?.fail(refused());
    await settle();
    frame();
    expect(view.getSnapshot().status).toBe('error');
    expect(queries).toHaveLength(5);
  });

  it('never restarts on a refused filter: the view shows its error state', async () => {
    const { view, queries, frame } = await readyQuery(byOwner, 300, block(0, 100), 'after-99');
    view.getSnapshot().source.onRangeChange({ start: 100, end: 140 });
    await settle();
    queries[1]?.fail(dataError('FILTER_INVALID', 'That filter is not valid.'));
    await settle();
    frame();
    expect(view.getSnapshot().status).toBe('error');
    expect(queries).toHaveLength(2);
  });
});

describe('visible attributes (spec 0006, AC-55)', () => {
  it('fetches a newly shown column for the loaded rows only, and reads later blocks with it', async () => {
    const { reader, gets, getAttributes, view, queries } = await readyView();
    reader.columns([CITY, OWNER]);
    expect(gets.map((call) => call.input)).toEqual([[idAt(0), idAt(1), idAt(2)]]);
    expect(getAttributes).toEqual([[OWNER]]);
    gets[0]?.answer(block(0, 3).map((row) => ({ ...row, values: { [OWNER]: null } })));
    await settle();
    // Merged into the bodies: the city read before stays.
    expect(view.getSnapshot().source.getItem(0)?.values[CITY]).toBe('London');
    view.retry();
    await settle();
    expect(queries.at(-1)?.input.attributeIds).toEqual([CITY, OWNER, NAME]);
    // Hiding it fetches nothing.
    reader.columns([CITY]);
    expect(gets).toHaveLength(1);
  });

  it('refetches only the changed attributes a window reads, and nothing for an event naming none of them', async () => {
    const { layer, gets, getAttributes, frame, reader } = await readyView();
    layer.changed(WS, PEOPLE, [idAt(1)], [OWNER]);
    frame();
    expect(gets).toHaveLength(0);
    layer.changed(WS, PEOPLE, [idAt(1)], [CITY, OWNER]);
    frame();
    expect(getAttributes).toEqual([[CITY]]);
    // A shown updated at moves with every write, so it comes too.
    reader.columns([CITY, UPDATED]);
    layer.changed(WS, PEOPLE, [idAt(2)], [NAME]);
    frame();
    expect(getAttributes.at(-1)).toEqual([NAME, UPDATED]);
  });
});

describe('settle (spec 0006, AC-56)', () => {
  const byCity = { sorts: [{ attributeId: CITY, direction: 'ascending' as const }] };
  const inLondon = {
    filter: {
      conjunction: 'and' as const,
      conditions: [{ attributeId: CITY, operator: 'is' as const, value: 'London' }],
    },
  };

  async function sortedView(query: typeof byCity | typeof inLondon) {
    const context = setup();
    const view = context.layer.view(WS, PEOPLE, query);
    const reader = view.retain([CITY]);
    await settle();
    context.counts[0]?.answer(3);
    await settle();
    context.queries[0]?.answer(query === byCity ? block(0, 3) : { records: block(0, 3) });
    await settle();
    await view.ready();
    context.frame();
    view.getSnapshot().source.onRangeChange({ start: 0, end: 3 });
    return { ...context, view, reader };
  }

  it('patches values at once, and settles order 1.5 s after the last change, never while an editor is open', async () => {
    const { layer, view, gets, queries, counts, tick, frame } = await sortedView(byCity);
    layer.changed(WS, PEOPLE, [idAt(0)], [CITY]);
    frame();
    gets[0]?.answer([rowOf(idAt(0), { [NAME]: 'P0', [CITY]: 'Zurich' }, { [CITY]: version(3) }, 3)]);
    await settle();
    frame();
    // The value shows at once, in place.
    expect(view.getSnapshot().source.getItem(0)?.values[CITY]).toBe('Zurich');
    view.holdSettle(true);
    tick(5000);
    expect(queries).toHaveLength(1);
    view.holdSettle(false);
    tick(1500);
    await settle();
    expect(queries).toHaveLength(2);
    expect(counts).toHaveLength(2);
    counts[1]?.answer(3);
    queries[1]?.answer([...block(1, 2), rowOf(idAt(0), { [NAME]: 'P0', [CITY]: 'Zurich' })]);
    await settle();
    frame();
    expect(view.getSnapshot().source.getItem(2)?.id).toBe(idAt(0));
  });

  it('settles for a record the event names made, deleted or restored, never for an edit out of sight (no herd of rereads)', async () => {
    const { layer, queries, tick, frame } = await sortedView(byCity);
    // A record out of sight, edited on an attribute the sort ignores: nothing moves, whatever its id says.
    layer.changed(WS, PEOPLE, [idAt(4000)], [NAME]);
    frame();
    tick(5000);
    await settle();
    expect(queries).toHaveLength(1);
    // The event names it made: the count moves, so the window settles.
    layer.changed(WS, PEOPLE, [idAt(4001)], [NAME], { createdIds: [idAt(4001)] });
    frame();
    tick(1500);
    await settle();
    expect(queries).toHaveLength(2);
  });

  it.each([{ deletedIds: [idAt(4001)] }, { restoredIds: [idAt(4001)] }])(
    'settles for a record out of sight the event names deleted or restored (%o)',
    async (lifecycle) => {
      const { layer, queries, tick, frame } = await sortedView(byCity);
      layer.changed(WS, PEOPLE, [idAt(4001)], [NAME], lifecycle);
      frame();
      tick(1500);
      await settle();
      expect(queries).toHaveLength(2);
    },
  );

  it('keeps a row the member edited where they see it, and notes one that no longer matches the filter', async () => {
    const { layer, view, edits, queries, counts, tick, frame } = await sortedView(inLondon);
    void layer.setValues(WS, [{ rowId: idAt(0), columnId: CITY, value: 'Paris' }]);
    await settle();
    edits[0]?.answer(rowOf(idAt(0), { [NAME]: 'P0', [CITY]: 'Paris' }, { [CITY]: version(2) }, 2));
    await settle();
    tick(1500);
    await settle();
    counts[1]?.answer(2);
    queries[1]?.answer({ records: block(1, 2) });
    await settle();
    frame();
    const state = view.getSnapshot();
    // Still the first row, with its note; the count shows it until the member scrolls away or leaves.
    expect(state.source.getItem(0)?.id).toBe(idAt(0));
    expect(state.rowNotes.get(idAt(0))).toBe('no-longer-matches');
    expect(state.source.count).toBe(3);
    expect(state.source.getItem(1)?.id).toBe(idAt(1));
  });
});

describe('editing a cell', () => {
  const change = (value: unknown) => ({ rowId: idAt(1), columnId: CITY, value });

  it('shows at once, then takes the server’s row', async () => {
    const { layer, view, edits, frame } = await readyView();
    void layer.setValues(WS, [change('Paris')]);
    frame();
    expect(view.getSnapshot().source.getItem(1)?.values[CITY]).toBe('Paris');
    await settle();
    // The base the edit started from: the city's version, read with the block (spec 0006, AC-45).
    expect(edits[0]?.input.values).toEqual({ [CITY]: { value: 'Paris', baseVersionId: version(1) } });
    edits[0]?.answer(rowOf(idAt(1), { [NAME]: 'P1', [CITY]: 'Paris' }, { [CITY]: version(2) }, 2));
    await settle();
    frame();
    expect(view.getSnapshot().source.getItem(1)?.versions[CITY]).toBe(version(2));
  });

  it('rolls back a refused value and marks its cell, which says why: no toast, and no Retry that would be refused again', async () => {
    const { layer, view, edits, frame, notices } = await readyView();
    void layer.setValues(WS, [change('Paris')]);
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
    expect(notices).toEqual([]);
  });

  it('rolls back an edit the server failed, and raises a toast with Retry that sends it again', async () => {
    const { layer, view, edits, frame, notices } = await readyView();
    void layer.setValues(WS, [change('Paris')]);
    await settle();
    edits[0]?.fail(dataError('INTERNAL', 'Something went wrong. Try again in a moment.'));
    await settle();
    frame();
    expect(view.getSnapshot().source.getItem(1)?.values[CITY]).toBe('London');
    expect(notices).toHaveLength(1);
    expect(notices[0]?.message).toMatch(/Something went wrong\. Try again in a moment\.$/);
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
    void layer.setValues(WS, [change('Paris')]);
    void layer.setValues(WS, [change('Rome')]);
    await settle();
    expect(city()).toBe('Rome');
    // Rome waits for Paris's answer, so the server writes them in the order they were made.
    expect(edits).toHaveLength(1);
    edits[0]?.answer(rowOf(idAt(1), { [NAME]: 'P1', [CITY]: 'Paris' }, { [CITY]: version(2) }, 2));
    await settle();
    expect(city()).toBe('Rome');
    // The same base as the first: the base hadn't moved when Rome was typed, and never comes from a layer.
    expect(edits[1]?.input.values).toEqual({ [CITY]: { value: 'Rome', baseVersionId: version(1) } });
    edits[1]?.answer(rowOf(idAt(1), { [NAME]: 'P1', [CITY]: 'Rome' }, { [CITY]: version(3) }, 3));
    await settle();
    expect(city()).toBe('Rome');
  });

  it('sends the next edit even when the one before it was refused', async () => {
    const { layer, edits } = await readyView();
    void layer.setValues(WS, [change('Paris')]);
    void layer.setValues(WS, [change('Rome')]);
    await settle();
    edits[0]?.fail(dataError('ATTRIBUTE_VALUE_INVALID', 'No.'));
    await settle();
    expect(edits).toHaveLength(2);
  });

  it('keeps a second edit showing when the first is confirmed', async () => {
    const { layer, view, edits, frame } = await readyView();
    void layer.setValues(WS, [change('Paris')]);
    void layer.setValues(WS, [change('Rome')]);
    await settle();
    edits[0]?.answer(rowOf(idAt(1), { [NAME]: 'P1', [CITY]: 'Paris' }, { [CITY]: version(2) }, 2));
    await settle();
    frame();
    expect(view.getSnapshot().source.getItem(1)?.values[CITY]).toBe('Rome');
  });

  it('rolls back without a toast of its own when the session ended', async () => {
    const { layer, view, edits, frame, notices } = await readyView();
    void layer.setValues(WS, [change('Paris')]);
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
    void layer.setValues(WS, [change('Paris')]);
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

  it('names a cell read with no version as never set, and leaves out one never read', async () => {
    const { layer, edits } = await readyView();
    void layer.setValues(WS, [
      { rowId: idAt(1), columnId: NAME, value: 'Ada' },
      { rowId: idAt(1), columnId: 'attr-unread', value: 'x' },
    ]);
    await settle();
    expect(edits[0]?.input.values).toEqual({
      [NAME]: { value: 'Ada', baseVersionId: null },
      'attr-unread': { value: 'x' },
    });
  });
});

describe('a paste or a range clear (spec 0006, AC-50)', () => {
  const paste = [
    { rowId: idAt(0), columnId: CITY, value: 'A' },
    { rowId: idAt(0), columnId: NAME, value: 'B' },
    { rowId: idAt(2), columnId: CITY, value: 'C' },
  ];

  it('goes as one batch with one mutation id, keeps what landed and rolls back the rest with one toast', async () => {
    const { layer, view, batches, edits, notices, frame, mutationLog } = await readyView();
    const done = layer.setValues(WS, paste);
    await settle();
    frame();
    expect(view.getSnapshot().source.getItem(2)?.values[CITY]).toBe('C');
    expect(edits).toHaveLength(0);
    expect(batches).toHaveLength(1);
    const input = batches[0]?.input;
    expect(input?.items.map((item) => item.recordId)).toEqual([idAt(0), idAt(2)]);
    expect(input?.items[0]?.values).toEqual({
      [CITY]: { value: 'A', baseVersionId: version(1) },
      [NAME]: { value: 'B', baseVersionId: null },
    });
    batches[0]?.answer({
      results: [
        {
          recordId: idAt(0),
          record: rowOf(idAt(0), { [NAME]: 'B', [CITY]: 'A' }, { [CITY]: version(2), [NAME]: version(2) }, 2),
        },
        {
          recordId: idAt(2),
          refusals: [{ code: 'ATTRIBUTE_VALUE_INVALID', message: 'Not a city.', attributeId: CITY }],
        },
      ],
      echoes: 1,
    });
    expect(await done).toEqual({ kind: 'done', cells: 3, landed: 2, undoId: input?.mutationId });
    frame();
    const state = view.getSnapshot();
    expect(state.source.getItem(0)?.values[CITY]).toBe('A');
    expect(state.source.getItem(2)?.values[CITY]).toBe('London');
    expect(state.cellErrors.get(`${idAt(2)}:${CITY}`)).toBe('Not a city.');
    // The refused cell says why itself: one refused value raises no toast.
    expect(notices).toEqual([]);
    expect(mutationLog).toEqual([`sent ${input?.mutationId ?? ''}`, `answered ${input?.mutationId ?? ''} 1`]);
  });

  it('rolls every record back, with one toast, when the whole batch fails', async () => {
    const { layer, view, batches, notices, frame } = await readyView();
    const done = layer.setValues(WS, paste);
    await settle();
    batches[0]?.fail(dataError('INTERNAL', 'Something went wrong.'));
    expect(await done).toEqual({ kind: 'done', cells: 3, landed: 0 });
    frame();
    expect(view.getSnapshot().source.getItem(0)?.values[CITY]).toBe('London');
    expect(notices.map((notice) => notice.message)).toEqual([RECORD_WORDS.notSaved(2)]);
  });

  it(`refuses a paste into more than ${String(MAX_BATCH_RECORDS)} records before anything shows`, async () => {
    expect(MAX_BATCH_RECORDS).toBe(CONTRACT_MAX_BATCH);
    const { layer, batches, view, frame } = await readyView();
    const many = Array.from({ length: MAX_BATCH_RECORDS + 1 }, (_, index) => ({
      rowId: idAt(index),
      columnId: CITY,
      value: 'X',
    }));
    expect(await layer.setValues(WS, many)).toEqual({ kind: 'too-many', limit: MAX_BATCH_RECORDS });
    await settle();
    frame();
    expect(batches).toHaveLength(0);
    expect(view.getSnapshot().source.getItem(0)?.values[CITY]).toBe('London');
  });
});

describe('creating a record', () => {
  it('puts the draft first at once, marked new, and keeps the server’s row (spec 0006, AC-56)', async () => {
    const { layer, view, creates, frame } = await readyView();
    const made = layer.create(WS, PEOPLE, { [NAME]: 'Grace' });
    await settle();
    frame();
    const state = view.getSnapshot();
    expect(state.source.count).toBe(4);
    expect(state.source.getItem(0)?.values[NAME]).toBe('Grace');
    expect(state.source.getItem(1)?.values[NAME]).toBe('P0');
    const id = creates[0]?.input.id ?? '';
    expect(view.indexOf(id)).toBe(0);
    expect(state.rowNotes.get(id)).toBe('new');
    creates[0]?.answer(rowOf(id, { [NAME]: 'Grace', created: at(30) }, { [NAME]: version(4) }, 30));
    expect((await made).id).toBe(id);
    frame();
    expect(view.getSnapshot().source.getItem(0)?.values.created).toBe(at(30));
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
    expect(view.getSnapshot().source.getItem(0)?.values[NAME]).toBe('P0');
    expect(view.getSnapshot().rowNotes.size).toBe(0);
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
    void layer.setValues(WS, [{ rowId: id, columnId: CITY, value: 'Austin' }]);
    await settle();
    frame();
    expect(view.getSnapshot().source.getItem(0)?.values[CITY]).toBe('Austin');
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
    void layer.setValues(WS, [{ rowId: id, columnId: CITY, value: 'Austin' }]);
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
    void layer.setValues(WS, [{ rowId: idAt(0), columnId: CITY, value: 'Oslo' }]);
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
    // Its answer names one echo, which keeps the id due until it comes (spec 0006, AC-60).
    expect(mutationLog).toEqual([`sent ${edit}`, `forget ${edit}`, `sent ${create}`, `answered ${create} 1`]);
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

describe('undo (spec 0006, AC-48, AC-49)', () => {
  const change = (value: unknown, row = 1) => ({ rowId: idAt(row), columnId: CITY, value });
  const landedRow = (row: number, city: string, at: number) =>
    rowOf(idAt(row), { [NAME]: `P${String(row)}`, [CITY]: city }, { [CITY]: version(at) }, at);

  it('puts one cell back at once, checked by the version it wrote, and says what it undid', async () => {
    const { layer, view, edits, frame } = await readyView();
    void layer.setValues(WS, [change('Paris')]);
    await settle();
    edits[0]?.answer(landedRow(1, 'Paris', 2));
    await settle();
    const undone = layer.undo.run(WS);
    await settle();
    frame();
    expect(view.getSnapshot().source.getItem(1)?.values[CITY]).toBe('London');
    expect(edits[1]?.input.values).toEqual({ [CITY]: { value: 'London', ifVersionId: version(2) } });
    edits[1]?.answer(landedRow(1, 'London', 3));
    expect(await undone).toEqual({
      kind: 'undone',
      action: 'cell',
      objectId: PEOPLE,
      cells: 1,
      undone: 1,
      kept: 0,
      failed: 0,
      first: { recordId: idAt(1), attributeId: CITY, recordName: 'P1' },
    });
    // The undo itself is never pushed: nothing is left to undo.
    expect(await layer.undo.run(WS)).toEqual({ kind: 'nothing' });
  });

  it('keeps the cells changed since and puts the rest of the paste back', async () => {
    const { layer, batches, edits, notices } = await readyView();
    void layer.setValues(WS, [
      { rowId: idAt(0), columnId: CITY, value: 'A' },
      { rowId: idAt(0), columnId: NAME, value: 'B' },
      { rowId: idAt(2), columnId: CITY, value: 'C' },
    ]);
    await settle();
    batches[0]?.answer({
      results: [
        {
          recordId: idAt(0),
          record: rowOf(idAt(0), { [NAME]: 'B', [CITY]: 'A' }, { [CITY]: version(2), [NAME]: version(2) }, 2),
        },
        {
          recordId: idAt(2),
          record: rowOf(idAt(2), { [NAME]: 'P2', [CITY]: 'C' }, { [CITY]: version(2) }, 2),
          written: { [CITY]: version(2) },
        },
      ],
      echoes: 1,
    });
    await settle();
    const undone = layer.undo.run(WS);
    await settle();
    expect(batches[1]?.input.items).toEqual([
      {
        recordId: idAt(0),
        values: {
          [CITY]: { value: 'London', ifVersionId: version(2) },
          [NAME]: { value: 'P0', ifVersionId: version(2) },
        },
      },
      { recordId: idAt(2), values: { [CITY]: { value: 'London', ifVersionId: version(2) } } },
    ]);
    // Someone changed record 0's city since: that record is refused whole, naming the cell.
    batches[1]?.answer({
      results: [
        {
          recordId: idAt(0),
          refusals: [
            { code: 'VERSION_CHANGED', message: 'City was changed since, so it was kept.', attributeId: CITY },
          ],
        },
        {
          recordId: idAt(2),
          record: rowOf(idAt(2), { [NAME]: 'P2', [CITY]: 'London' }, { [CITY]: version(3) }, 3),
          written: { [CITY]: version(3) },
        },
      ],
      echoes: 1,
    });
    await settle();
    // Its name goes back on its own, still checked by the version the paste wrote.
    expect(edits[0]?.input).toMatchObject({
      recordId: idAt(0),
      values: { [NAME]: { value: 'P0', ifVersionId: version(2) } },
    });
    edits[0]?.answer(rowOf(idAt(0), { [NAME]: 'P0', [CITY]: 'Z' }, { [CITY]: version(4), [NAME]: version(4) }, 4));
    expect(await undone).toMatchObject({ kind: 'undone', action: 'paste', cells: 3, undone: 2, kept: 1, failed: 0 });
    // Kept cells are said in the undo's own toast, never as a refusal.
    expect(notices).toEqual([]);
  });

  it('rolls an undo refused for another reason back, with its message', async () => {
    const { layer, view, edits, notices, frame } = await readyView();
    void layer.setValues(WS, [change('Paris')]);
    await settle();
    edits[0]?.answer(landedRow(1, 'Paris', 2));
    await settle();
    const undone = layer.undo.run(WS);
    await settle();
    edits[1]?.fail(
      dataError('ATTRIBUTE_VALUE_INVALID', 'No.', {
        refusals: [{ code: 'ATTRIBUTE_VALUE_INVALID', message: 'City is archived.', attributeId: CITY }],
      }),
    );
    expect(await undone).toMatchObject({ undone: 0, kept: 0, failed: 1 });
    frame();
    expect(view.getSnapshot().source.getItem(1)?.values[CITY]).toBe('Paris');
    expect(notices.map((notice) => notice.message)).toEqual(['City is archived.']);
  });

  it('waits for a write still in flight before undoing it', async () => {
    const { layer, edits } = await readyView();
    void layer.setValues(WS, [change('Paris')]);
    await settle();
    const undone = layer.undo.run(WS);
    await settle();
    expect(edits).toHaveLength(1);
    edits[0]?.answer(landedRow(1, 'Paris', 2));
    await settle();
    await settle();
    expect(edits[1]?.input.values).toEqual({ [CITY]: { value: 'London', ifVersionId: version(2) } });
    edits[1]?.answer(landedRow(1, 'London', 3));
    expect(await undone).toMatchObject({ undone: 1 });
  });

  it('pushes nothing for a refused or unchanged edit', async () => {
    const { layer, edits } = await readyView();
    void layer.setValues(WS, [change('Paris')]);
    await settle();
    edits[0]?.fail(dataError('ATTRIBUTE_VALUE_INVALID', 'No.'));
    await settle();
    void layer.setValues(WS, [change('London')]);
    await settle();
    // The same value: the server wrote nothing, so the version is the one the block read.
    edits[1]?.answer({ ...landedRow(1, 'London', 1), written: {} });
    await settle();
    expect(layer.undo.depth(WS)).toBe(0);
  });

  it(`walks back through the last ${String(UNDO_DEPTH)} actions, the oldest forgotten`, async () => {
    const { layer, edits } = await readyView();
    for (let at = 2; at < UNDO_DEPTH + 3; at += 1) {
      void layer.setValues(WS, [change(`City ${String(at)}`)]);
      await settle();
      edits.at(-1)?.answer(landedRow(1, `City ${String(at)}`, at));
      await settle();
    }
    expect(layer.undo.depth(WS)).toBe(UNDO_DEPTH);
    expect(layer.undo.depth('elsewhere')).toBe(0);
    layer.clear();
    expect(layer.undo.depth(WS)).toBe(0);
  });
});

describe('undo, walking back one cell and checking only what this tab wrote', () => {
  const change = (value: unknown) => ({ rowId: idAt(1), columnId: CITY, value });
  const at = (
    city: string,
    revision: number,
    more: Partial<RecordView> & { written?: Record<string, string> } = {},
  ) => ({
    ...rowOf(idAt(1), { [NAME]: 'P1', [CITY]: city }, { [CITY]: version(revision) }, revision),
    ...more,
  });

  it('undoes two edits of the same cell one press at a time', async () => {
    const { layer, edits } = await readyView();
    void layer.setValues(WS, [change('Paris')]);
    await settle();
    edits[0]?.answer(at('Paris', 2));
    await settle();
    void layer.setValues(WS, [change('Rome')]);
    await settle();
    edits[1]?.answer(at('Rome', 3));
    await settle();
    const first = layer.undo.run(WS);
    await settle();
    expect(edits[2]?.input.values).toEqual({ [CITY]: { value: 'Paris', ifVersionId: version(3) } });
    edits[2]?.answer(at('Paris', 4));
    expect(await first).toMatchObject({ undone: 1, kept: 0 });
    // The older entry now finds the version the first undo wrote.
    const second = layer.undo.run(WS);
    await settle();
    expect(edits[3]?.input.values).toEqual({ [CITY]: { value: 'London', ifVersionId: version(4) } });
    edits[3]?.answer(at('London', 5));
    expect(await second).toMatchObject({ undone: 1, kept: 0 });
  });

  it('walks back two changes to one cell on a quick double press, one after the other', async () => {
    const { layer, edits } = await readyView();
    void layer.setValues(WS, [change('Paris')]);
    await settle();
    edits[0]?.answer(at('Paris', 2));
    await settle();
    void layer.setValues(WS, [change('Rome')]);
    await settle();
    edits[1]?.answer(at('Rome', 3));
    await settle();
    // Both presses before either answer comes back.
    const first = layer.undo.run(WS);
    const second = layer.undo.run(WS);
    await settle();
    expect(edits).toHaveLength(3);
    edits[2]?.answer(at('Paris', 4));
    expect(await first).toMatchObject({ undone: 1, kept: 0 });
    await settle();
    expect(edits[3]?.input.values).toEqual({ [CITY]: { value: 'London', ifVersionId: version(4) } });
    edits[3]?.answer(at('London', 5));
    expect(await second).toMatchObject({ undone: 1, kept: 0 });
  });

  it('puts back old values too big for one request in several, each record whole', async () => {
    const { layer, batches, edits } = await readyView();
    const long = 'x'.repeat(400_000);
    // A long city on each row, one edit at a time, then a clear of all three: the clear is small, its undo is not.
    for (const row of [0, 1, 2]) {
      void layer.setValues(WS, [{ rowId: idAt(row), columnId: CITY, value: long }]);
      await settle();
      edits.at(-1)?.answer(rowOf(idAt(row), { [NAME]: `P${String(row)}`, [CITY]: long }, { [CITY]: version(2) }, 2));
      await settle();
    }
    void layer.setValues(
      WS,
      [0, 1, 2].map((row) => ({ rowId: idAt(row), columnId: CITY, value: null })),
      'clear',
    );
    await settle();
    batches[0]?.answer({
      results: [0, 1, 2].map((row) => ({
        recordId: idAt(row),
        record: rowOf(idAt(row), { [NAME]: `P${String(row)}`, [CITY]: null }, { [CITY]: version(3) }, 3),
      })),
      echoes: 1,
    });
    await settle();
    void layer.undo.run(WS);
    await settle();
    // About 1.2 MB of old values: two records in one batch, the third on its own, neither past the limit.
    expect(batches[1]?.input.items.map((item) => item.recordId)).toEqual([idAt(0), idAt(1)]);
    expect(edits.at(-1)?.input.recordId).toBe(idAt(2));
  });

  it('calls only the version the write made its own, never a later one the read back saw', async () => {
    const { layer, edits, replaced } = await readyView();
    void layer.setValues(WS, [change('Paris')]);
    await settle();
    // Someone wrote version 3 between this write (version 2) and its read back.
    edits[0]?.answer(at('Berlin', 3, { written: { [CITY]: version(2) } }));
    await settle();
    const undone = layer.undo.run(WS);
    await settle();
    expect(edits[1]?.input.values).toEqual({ [CITY]: { value: 'London', ifVersionId: version(2) } });
    edits[1]?.fail(
      dataError('VERSION_CHANGED', 'City was changed since, so it was kept.', {
        refusals: [{ code: 'VERSION_CHANGED', message: 'City was changed since, so it was kept.', attributeId: CITY }],
      }),
    );
    expect(await undone).toMatchObject({ undone: 0, kept: 1 });
    // Their version isn't this tab's: a notice naming it says nothing.
    layer.replaced(WS, {
      seq: 1,
      at: at('x', 1).updatedAt ?? '',
      kind: 'records',
      objectId: PEOPLE,
      recordIds: [idAt(1)],
      attributeIds: [CITY],
      replaced: {
        by: { type: 'member', id: BEA },
        cells: [{ recordId: idAt(1), attributeId: CITY, versionId: version(3) }],
      },
    });
    await settle();
    expect(replaced).toEqual([]);
  });

  it('retries a refused undo as the same undo, still checked by the version it wrote', async () => {
    const { layer, edits, notices } = await readyView();
    void layer.setValues(WS, [change('Paris')]);
    await settle();
    edits[0]?.answer(at('Paris', 2));
    await settle();
    const undone = layer.undo.run(WS);
    await settle();
    edits[1]?.fail(dataError('INTERNAL', 'Something went wrong.'));
    expect(await undone).toMatchObject({ undone: 0, failed: 1 });
    notices[0]?.action?.onAction();
    await settle();
    expect(edits[2]?.input.values).toEqual({ [CITY]: { value: 'London', ifVersionId: version(2) } });
    edits[2]?.answer(at('London', 3));
    await settle();
    // No screen asked for the retry: the layer says what it did. Not pushed: nothing is left to undo.
    expect(notices.at(-1)?.message).toBe(RECORD_WORDS.undoRetried(1));
    expect(layer.undo.depth(WS)).toBe(0);
  });

  it('undoes a toast’s own action only while it is the newest', async () => {
    const { layer, edits, batches } = await readyView();
    const pasted = layer.setValues(WS, [
      { rowId: idAt(0), columnId: CITY, value: 'A' },
      { rowId: idAt(2), columnId: CITY, value: 'C' },
    ]);
    await settle();
    batches[0]?.answer({
      results: [
        { recordId: idAt(0), record: rowOf(idAt(0), { [NAME]: 'P0', [CITY]: 'A' }, { [CITY]: version(2) }, 2) },
        { recordId: idAt(2), record: rowOf(idAt(2), { [NAME]: 'P2', [CITY]: 'C' }, { [CITY]: version(2) }, 2) },
      ],
      echoes: 1,
    });
    const outcome = await pasted;
    const undoId = outcome.kind === 'done' ? outcome.undoId : undefined;
    expect(undoId).toEqual(expect.any(String));
    void layer.setValues(WS, [change('Paris')]);
    await settle();
    edits[0]?.answer(at('Paris', 2));
    await settle();
    // A later edit sits on top: the paste toast's Undo does nothing, and the edit stays undoable.
    expect(await layer.undo.run(WS, undoId)).toEqual({ kind: 'stale' });
    expect(layer.undo.depth(WS)).toBe(2);
  });

  it('pushes nothing to undo for a cell whose old value was never read (a column not read yet)', async () => {
    const { layer, edits } = await readyView();
    // The view reads the city and the name; Owner was never read, so its old value is unknown.
    void layer.setValues(WS, [{ rowId: idAt(1), columnId: OWNER, value: null }]);
    await settle();
    edits[0]?.answer(rowOf(idAt(1), { [NAME]: 'P1', [OWNER]: null }, { [OWNER]: version(2) }, 2));
    await settle();
    expect(layer.undo.depth(WS)).toBe(0);
  });

  it('refuses before anything shows a paste too big for one write', async () => {
    const { layer, batches, edits } = await readyView();
    const long = 'x'.repeat(10_000);
    const many = Array.from({ length: 100 }, (_, index) => ({ rowId: idAt(index), columnId: CITY, value: long }));
    expect(await layer.setValues(WS, many)).toEqual({ kind: 'too-big' });
    expect(batches).toHaveLength(0);
    expect(edits).toHaveLength(0);
  });
});

describe('the replaced notice (spec 0006, AC-46, AC-47)', () => {
  const replacedBy = (
    by: { type: 'member' | 'api_key' | 'automation' | 'system'; id: string | null },
    versionId: string,
  ) =>
    ({
      seq: 9,
      at: at(40),
      kind: 'records',
      objectId: PEOPLE,
      recordIds: [idAt(1)],
      attributeIds: [CITY],
      replaced: { by, cells: [{ recordId: idAt(1), attributeId: CITY, versionId }] },
    }) satisfies ChangeEvent;

  /** A view where this tab saved Paris over London, landing as version 2. */
  async function saved() {
    const context = await readyView();
    void context.layer.setValues(WS, [{ rowId: idAt(1), columnId: CITY, value: 'Paris' }]);
    await settle();
    context.edits[0]?.answer(rowOf(idAt(1), { [NAME]: 'P1', [CITY]: 'Paris' }, { [CITY]: version(2) }, 2));
    await settle();
    return context;
  }

  it('tells this tab when another member replaced a value it wrote, and Use mine saves it again', async () => {
    const { layer, replaced, edits } = await saved();
    layer.replaced(WS, replacedBy({ type: 'member', id: BEA }, version(2)));
    await settle();
    expect(replaced).toHaveLength(1);
    expect(replaced[0]).toMatchObject({
      workspace: WS,
      objectId: PEOPLE,
      recordId: idAt(1),
      recordName: 'P1',
      attributeIds: [CITY],
      by: { type: 'member', id: BEA },
    });
    replaced[0]?.useMine();
    await settle();
    expect(edits[1]?.input.values[CITY]?.value).toBe('Paris');
  });

  it('says nothing for its own member, the system, a version it never wrote, or another workspace', async () => {
    const { layer, replaced } = await saved();
    layer.replaced(WS, replacedBy({ type: 'member', id: ME }, version(2)));
    layer.replaced(WS, replacedBy({ type: 'system', id: null }, version(2)));
    layer.replaced(WS, replacedBy({ type: 'member', id: BEA }, version(1)));
    layer.replaced('elsewhere', replacedBy({ type: 'member', id: BEA }, version(2)));
    await settle();
    expect(replaced).toEqual([]);
  });

  it('names an API key and an automation by their kind, one notice per record', async () => {
    const { layer, replaced } = await saved();
    layer.replaced(WS, replacedBy({ type: 'api_key', id: BEA }, version(2)));
    await settle();
    expect(replaced.map((notice) => notice.by)).toEqual([{ type: 'api_key', id: BEA }]);
  });

  it('says nothing for a write that replaced more than 200 cells, whose event carries no list (owner decision, 8 Oct 2026)', async () => {
    const { layer, replaced } = await saved();
    const { replaced: _list, ...bulk } = replacedBy({ type: 'member', id: BEA }, version(2));
    layer.replaced(WS, bulk);
    await settle();
    expect(replaced).toEqual([]);
  });

  it('forgets its own versions with the records', async () => {
    const { layer, replaced } = await saved();
    layer.clear();
    layer.replaced(WS, replacedBy({ type: 'member', id: BEA }, version(2)));
    await settle();
    expect(replaced).toEqual([]);
  });
});

describe('one record (spec 0006, records.one; the record page, spec 0017)', () => {
  const OTHER = idAt(42);

  it('reads the attributes asked for, holds the body, and is ready with the store’s one copy', async () => {
    const { layer, gets, getAttributes } = setup();
    const one = layer.one(WS, OTHER, [NAME, CITY]);
    const release = one.retain();
    expect(one.getSnapshot().status).toBe('loading');
    await settle();
    expect(gets.map((call) => call.input)).toEqual([[OTHER]]);
    expect(getAttributes).toEqual([[NAME, CITY]]);
    gets[0]?.answer([rowOf(OTHER, { [NAME]: 'Jane', [CITY]: 'Oslo' })]);
    await one.ready();
    const state = one.getSnapshot();
    expect(state).toMatchObject({ status: 'ready', isLost: false });
    expect(state.record?.values[CITY]).toBe('Oslo');
    // The same subscription for every screen asking it.
    expect(layer.one(WS, OTHER, [CITY])).toBe(one);
    expect(layer.size()).toBe(1);
    release();
  });

  it('is ready at once from a body a view keeps fresh, reading only what it lacks', async () => {
    const { layer, gets, getAttributes } = await readyView();
    const held = layer.one(WS, idAt(1), [CITY]);
    expect(held.getSnapshot().status).toBe('ready');
    expect(held.getSnapshot().record?.values[CITY]).toBe('London');
    const wider = layer.one(WS, idAt(2), [CITY, OWNER]);
    await settle();
    expect(gets.map((call) => call.input)).toEqual([[idAt(2)]]);
    expect(getAttributes).toEqual([[OWNER]]);
    expect(wider.getSnapshot().status).toBe('loading');
  });

  it('says deleted, not lost, when the first read leaves it out', async () => {
    const { layer, gets } = setup();
    const one = layer.one(WS, OTHER, [NAME]);
    await settle();
    gets[0]?.answer([]);
    await one.ready();
    expect(one.getSnapshot()).toMatchObject({ status: 'deleted', isLost: false });
    expect(one.getSnapshot().record).toBeUndefined();
  });

  it('fails with Retry, and reads again on retry', async () => {
    const { layer, gets } = setup();
    const one = layer.one(WS, OTHER, [NAME]);
    await settle();
    gets[0]?.fail(dataError('API_UNAVAILABLE', 'Can’t reach the CRM.'));
    await one.ready();
    expect(one.getSnapshot()).toMatchObject({ status: 'error', error: { code: 'API_UNAVAILABLE' } });
    one.retry();
    expect(one.getSnapshot().status).toBe('loading');
    await settle();
    gets[1]?.answer([rowOf(OTHER, { [NAME]: 'Jane' })]);
    await settle();
    expect(one.getSnapshot().status).toBe('ready');
  });

  it('reads a live change it shows, and goes lost, keeping the last record, when a read leaves it out', async () => {
    const { layer, gets, getAttributes, frame } = setup();
    const one = layer.one(WS, OTHER, [NAME, CITY]);
    const release = one.retain();
    await settle();
    gets[0]?.answer([rowOf(OTHER, { [NAME]: 'Jane', [CITY]: 'Oslo' }, { [CITY]: version(1) })]);
    await one.ready();
    // An edit elsewhere to an attribute it doesn't show reads nothing; one it shows reads that attribute.
    layer.changed(WS, PEOPLE, [OTHER], [OWNER]);
    frame();
    await settle();
    expect(gets).toHaveLength(1);
    layer.changed(WS, PEOPLE, [OTHER], [CITY]);
    frame();
    await settle();
    expect(getAttributes.at(-1)).toEqual([CITY]);
    gets[1]?.answer([rowOf(OTHER, { [NAME]: 'Jane', [CITY]: 'Rome' }, { [CITY]: version(2) }, 2)]);
    await settle();
    expect(one.getSnapshot().record?.values[CITY]).toBe('Rome');
    // Deleted elsewhere: the event names it, its read leaves it out.
    layer.changed(WS, PEOPLE, [OTHER], [], { deletedIds: [OTHER] });
    frame();
    await settle();
    gets[2]?.answer([]);
    await settle();
    const state = one.getSnapshot();
    expect(state).toMatchObject({ status: 'deleted', isLost: true });
    expect(state.record?.values[CITY]).toBe('Rome');
    release();
  });

  it('reads it again on a reload (a resync, or access changed), and shows its refused values', async () => {
    const { layer, gets, edits } = setup();
    const one = layer.one(WS, OTHER, [NAME, CITY]);
    const release = one.retain();
    await settle();
    gets[0]?.answer([rowOf(OTHER, { [NAME]: 'Jane', [CITY]: 'Oslo' }, { [CITY]: version(1) })]);
    await one.ready();
    layer.reload(WS);
    await settle();
    expect(gets).toHaveLength(2);
    expect(gets[1]?.input).toEqual([OTHER]);
    gets[1]?.answer([rowOf(OTHER, { [NAME]: 'Jane', [CITY]: 'Oslo' }, { [CITY]: version(1) })]);
    void layer.setValues(WS, [{ rowId: OTHER, columnId: CITY, value: 'Paris' }]);
    expect(one.getSnapshot().record?.values[CITY]).toBe('Paris');
    await settle();
    edits[0]?.fail(
      dataError('UNIQUE_CONFLICT', 'Not unique.', {
        refusals: [{ code: 'UNIQUE_CONFLICT', message: 'Another person has this city.', attributeId: CITY }],
      }),
    );
    await settle();
    expect(one.getSnapshot().record?.values[CITY]).toBe('Oslo');
    expect(one.getSnapshot().cellErrors.get(CITY)).toBe('Another person has this city.');
    release();
  });

  it('reads a wider ask on the same subscription, and lets go of the body once however often it is let go', async () => {
    const { layer, gets, getAttributes, tick } = setup();
    const one = layer.one(WS, OTHER, [NAME]);
    const first = one.retain();
    await settle();
    gets[0]?.answer([rowOf(OTHER, { [NAME]: 'Jane' })]);
    await one.ready();
    // A column added since: the same subscription reads only what it lacks.
    expect(layer.one(WS, OTHER, [NAME, CITY])).toBe(one);
    await settle();
    expect(getAttributes.at(-1)).toEqual([CITY]);
    gets[1]?.answer([rowOf(OTHER, { [NAME]: 'Jane', [CITY]: 'Oslo' })]);
    await settle();
    expect(one.getSnapshot().record?.values[CITY]).toBe('Oslo');
    // Let go twice over (a screen and its StrictMode twin), then shown again from a cached page: held once.
    first();
    first();
    tick(30_000);
    tick(30_000);
    const again = one.retain();
    await settle();
    expect(gets).toHaveLength(3);
    gets[2]?.answer([rowOf(OTHER, { [NAME]: 'Jane', [CITY]: 'Oslo' })]);
    await settle();
    expect(layer.one(WS, OTHER, [NAME])).toBe(one);
    expect(layer.size()).toBe(1);
    again();
  });

  it('comes back from lost when a read finds it again (restored, or in reach once more)', async () => {
    const { layer, gets, frame } = setup();
    const one = layer.one(WS, OTHER, [NAME]);
    const release = one.retain();
    await settle();
    gets[0]?.answer([rowOf(OTHER, { [NAME]: 'Jane' })]);
    await one.ready();
    layer.changed(WS, PEOPLE, [OTHER], [], { deletedIds: [OTHER] });
    frame();
    await settle();
    gets[1]?.answer([]);
    await settle();
    expect(one.getSnapshot()).toMatchObject({ status: 'deleted', isLost: true });
    layer.changed(WS, PEOPLE, [OTHER], [], { restoredIds: [OTHER] });
    frame();
    await settle();
    gets[2]?.answer([rowOf(OTHER, { [NAME]: 'Jane' }, {}, 3)]);
    await settle();
    expect(one.getSnapshot()).toMatchObject({ status: 'ready', isLost: false });
    release();
  });

  it('lets go of its body 30 seconds after the last screen leaves, and forgets it with the records', async () => {
    const { layer, gets, tick } = setup();
    const one = layer.one(WS, OTHER, [NAME]);
    const release = one.retain();
    await settle();
    gets[0]?.answer([rowOf(OTHER, { [NAME]: 'Jane' })]);
    await one.ready();
    release();
    tick(30_000);
    // A new subscription after it was let go reads again.
    expect(layer.one(WS, OTHER, [NAME])).not.toBe(one);
    layer.clear();
    expect(layer.size()).toBe(0);
  });
});

describe('validation rules in the browser (spec 0013, AC-256, AC-257)', () => {
  /** People's attributes as the definitions store holds them, City with `rules` and Name plain. */
  const definitions = (rules: AttributeDefinition['validation']): AttributeDefinition[] => [
    {
      id: NAME,
      objectId: PEOPLE,
      apiSlug: 'name',
      title: 'Name',
      type: 'text',
      isMulti: false,
      isRequired: false,
      isUnique: false,
      isSystem: false,
      isPrimary: true,
      config: {},
      position: 5,
      isArchived: false,
      validation: { required: 'never', rules: [] },
    },
    {
      id: CITY,
      objectId: PEOPLE,
      apiSlug: 'city',
      title: 'City',
      type: 'text',
      isMulti: false,
      isRequired: false,
      isUnique: false,
      isSystem: false,
      isPrimary: false,
      config: {},
      position: 6,
      isArchived: false,
      ...(rules === undefined ? {} : { validation: rules }),
    },
  ];
  const RULE = '0199a6f2-0000-7000-8000-0000000000f1';
  const short = definitions({
    required: 'never',
    rules: [{ id: RULE, kind: 'length', params: { max: 5 }, position: 0 }],
  });
  const change = (value: unknown) => ({ rowId: idAt(1), columnId: CITY, value });

  it('refuses a value that breaks a rule before it shows or is sent: the cell says why, and a toast, with no Retry', async () => {
    const { layer, view, edits, frame, notices } = await readyView({ definitionsOf: () => short });
    const outcome = await layer.setValues(WS, [change('Amsterdam')]);
    frame();
    const state = view.getSnapshot();
    expect(state.source.getItem(1)?.values[CITY]).toBe('London');
    expect(state.cellErrors.get(`${idAt(1)}:${CITY}`)).toBe('City can have at most 5 characters.');
    expect(notices).toEqual([{ tone: 'danger', message: 'City can have at most 5 characters.' }]);
    expect(edits).toEqual([]);
    expect(outcome).toEqual({ kind: 'done', cells: 1, landed: 0 });
  });

  it('shows a value that meets the rules at once, and sends the writer’s time zone', async () => {
    const { layer, view, edits, frame } = await readyView({ definitionsOf: () => short });
    void layer.setValues(WS, [change('Paris')]);
    frame();
    expect(view.getSnapshot().source.getItem(1)?.values[CITY]).toBe('Paris');
    await settle();
    expect(edits[0]?.input.timeZone).toBe('Europe/London');
  });

  it('runs a pattern rule with RE2, loaded only when one is touched', async () => {
    const digits = definitions({
      required: 'never',
      rules: [{ id: RULE, kind: 'pattern', params: { preset: 'digits', ignoreCase: false }, position: 0 }],
    });
    const { layer, view, edits, frame } = await readyView({ definitionsOf: () => digits });
    await layer.setValues(WS, [change('12a')]);
    frame();
    expect(view.getSnapshot().cellErrors.get(`${idAt(1)}:${CITY}`)).toBe('City can only contain digits.');
    expect(edits).toEqual([]);
  });

  it('leaves a rule whose inputs it doesn’t hold to the server', async () => {
    const OTHER = 'attr-other';
    const naming = definitions({
      required: 'never',
      rules: [
        {
          id: RULE,
          kind: 'length',
          params: { max: 2 },
          condition: { conjunction: 'and', conditions: [{ attributeId: OTHER, operator: 'is_empty' }] },
          position: 0,
        },
      ],
    });
    const { layer, edits } = await readyView({ definitionsOf: () => naming });
    void layer.setValues(WS, [change('Paris')]);
    await settle();
    expect(edits).toHaveLength(1);
  });

  it('marks the edited cell with the server’s refusal on a field the edit didn’t touch, with a toast and no Retry', async () => {
    const { layer, view, edits, frame, notices } = await readyView();
    void layer.setValues(WS, [change('Paris')]);
    await settle();
    edits[0]?.fail(
      dataError('VALIDATION_FAILED', 'Name is required when City is Paris.', {
        refusals: [
          {
            code: 'VALIDATION_FAILED',
            message: 'Name is required when City is Paris.',
            attributeId: NAME,
            ruleId: RULE,
          },
        ],
      }),
    );
    await settle();
    frame();
    expect(view.getSnapshot().cellErrors.get(`${idAt(1)}:${CITY}`)).toBe('Name is required when City is Paris.');
    expect(notices).toEqual([{ tone: 'danger', message: 'Name is required when City is Paris.' }]);
  });

  it('names the field a rule with its own words is about, and shows every broken rule on the cell', async () => {
    const OWN = '0199a6f2-0000-7000-8000-0000000000f2';
    const both = definitions({ required: 'never', rules: [] }).map((definition) =>
      definition.id === NAME
        ? {
            ...definition,
            validation: {
              required: 'never' as const,
              rules: [
                {
                  id: OWN,
                  kind: 'length' as const,
                  params: { min: 9 },
                  message: 'Use the full name.',
                  condition: {
                    conjunction: 'and' as const,
                    conditions: [{ attributeId: CITY, operator: 'is' as const, value: 'Rome' }],
                  },
                  position: 0,
                },
              ],
            },
          }
        : {
            ...definition,
            validation: {
              required: 'never' as const,
              rules: [{ id: RULE, kind: 'length' as const, params: { max: 3 }, position: 0 }],
            },
          },
    );
    const { layer, view, frame, notices, edits } = await readyView({ definitionsOf: () => both });
    await layer.setValues(WS, [change('Rome')]);
    frame();
    // The cell shows its own rule; the toast leads with the first, Name's, its own words led by its field.
    expect(view.getSnapshot().cellErrors.get(`${idAt(1)}:${CITY}`)).toBe('City can have at most 3 characters.');
    expect(notices).toEqual([{ tone: 'danger', message: 'Name: Use the full name. And 1 more.' }]);
    expect(edits).toEqual([]);
  });

  it('refuses a create that breaks a rule before a draft shows, with the server’s refusals', async () => {
    const { layer, creates, view, frame } = await readyView({ definitionsOf: () => short });
    await expect(layer.create(WS, PEOPLE, { [CITY]: 'Amsterdam' })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: 'City can have at most 5 characters.',
      data: {
        refusals: [
          {
            code: 'VALIDATION_FAILED',
            message: 'City can have at most 5 characters.',
            attributeId: CITY,
            ruleId: RULE,
          },
        ],
      },
    });
    frame();
    expect(creates).toEqual([]);
    expect(view.getSnapshot().source.count).toBe(3);
  });
});

describe('deleting records (spec 0022, AC-524 to AC-526, AC-541)', () => {
  it('takes the rows out of the view and the count at once, then drops what the server deleted', async () => {
    const { layer, view, deletes, frame, queries } = await readyView();
    const deleting = layer.deleteMany(WS, PEOPLE, [idAt(0), idAt(1)]);
    frame();
    // Gone from the rows and the count before any answer (AC-525).
    expect(view.getSnapshot().source.count).toBe(1);
    expect(view.getSnapshot().source.getItem(0)?.id).toBe(idAt(2));
    expect(view.getSnapshot().count).toEqual({ count: 1, atLeast: false });
    await settle();
    expect(deletes[0]?.input).toMatchObject({ workspace: WS, objectId: PEOPLE, recordIds: [idAt(0), idAt(1)] });
    deletes[0]?.answer([
      { recordId: idAt(0), state: 'deleted' },
      { recordId: idAt(1), state: 'deleted' },
    ]);
    const outcome = await deleting;
    expect(outcome).toMatchObject({ kind: 'done', deleted: 2, refused: 0 });
    // The block reloads, since the rows after the gone ones moved up.
    expect(queries.length).toBeGreaterThan(1);
    // A screen drops them from its selection (AC-522).
    frame();
    expect([...view.getSnapshot().gone]).toEqual([idAt(0), idAt(1)]);
    expect(layer.undo.depth(WS)).toBe(1);
  });

  it('brings a refused record back with its reason on its name cell, and counts it', async () => {
    const { layer, view, deletes, frame } = await readyView();
    const deleting = layer.deleteMany(WS, PEOPLE, [idAt(0), idAt(1)]);
    await settle();
    deletes[0]?.answer([
      { recordId: idAt(0), state: 'deleted' },
      { recordId: idAt(1), state: 'refused', refusal: { code: 'NOT_FOUND', message: 'That record does not exist.' } },
    ]);
    expect(await deleting).toMatchObject({
      kind: 'done',
      deleted: 1,
      refused: 1,
      reason: 'That record does not exist.',
    });
    frame();
    expect(view.getSnapshot().cellErrors.get(`${idAt(1)}:${NAME}`)).toBe('That record does not exist.');
    const shown = Array.from({ length: view.getSnapshot().source.count }, (_, at) =>
      view.getSnapshot().source.getItem(at),
    ).map((row) => row?.id);
    expect(shown).toContain(idAt(1));
  });

  it('brings every row back when the whole delete is refused, and pushes nothing to undo', async () => {
    const { layer, view, deletes, frame } = await readyView();
    const deleting = layer.deleteMany(WS, PEOPLE, [idAt(0)]);
    await settle();
    deletes[0]?.fail(dataError('FORBIDDEN', 'You can view People but not change them.'));
    const outcome = await deleting;
    expect(outcome).toMatchObject({ kind: 'failed', error: { code: 'FORBIDDEN' } });
    frame();
    expect(view.getSnapshot().source.count).toBe(3);
    expect(layer.undo.depth(WS)).toBe(0);
  });

  it('refuses more than 500 records before anything leaves', async () => {
    const { layer, view, deletes } = await readyView();
    const ids = Array.from({ length: 501 }, (_, at) => idAt(at));
    expect(await layer.deleteMany(WS, PEOPLE, ids)).toEqual({ kind: 'too-many', limit: 500 });
    expect(deletes).toHaveLength(0);
    expect(view.getSnapshot().source.count).toBe(3);
  });

  it('undoes a delete by its batch, rereading the view, and says what stayed in the trash (AC-526)', async () => {
    const { layer, view, deletes, restores, queries } = await readyView();
    const deleting = layer.deleteMany(WS, PEOPLE, [idAt(0), idAt(1)]);
    await settle();
    deletes[0]?.answer([
      { recordId: idAt(0), state: 'deleted' },
      { recordId: idAt(1), state: 'deleted' },
    ]);
    const outcome = await deleting;
    const batchId = deletes[0]?.input.batchId;
    const undone = layer.undo.run(WS, outcome.kind === 'done' ? outcome.undoId : undefined);
    await settle();
    expect(restores[0]?.input).toMatchObject({ workspace: WS, batchId });
    const before = queries.length;
    restores[0]?.answer([
      { recordId: idAt(0), state: 'restored' },
      {
        recordId: idAt(1),
        state: 'refused',
        refusal: { code: 'UNIQUE_CONFLICT', message: 'Another record now has Email ada@acme.com.' },
      },
    ]);
    expect(await undone).toEqual({ kind: 'restored', objectId: PEOPLE, restored: 1, kept: 1, reason: 'unique' });
    // Read live again, a restored record is no longer gone, so a screen may select it again.
    await settle();
    queries.at(-1)?.answer(block(0, 3));
    await settle();
    expect(view.getSnapshot().gone.has(idAt(0))).toBe(false);
    // The view reads its rows on screen again, so the restored record returns to its place.
    await settle();
    expect(queries.length).toBeGreaterThan(before);
    expect(layer.undo.depth(WS)).toBe(0);
  });

  it('names the one record a delete took, and answers gone when nothing is left in the trash', async () => {
    const { layer, deletes, restores } = await readyView();
    const deleting = layer.deleteMany(WS, PEOPLE, [idAt(2)]);
    await settle();
    deletes[0]?.answer([{ recordId: idAt(2), state: 'deleted' }]);
    expect(await deleting).toMatchObject({ kind: 'done', deleted: 1, recordName: 'P2' });
    const undone = layer.undo.run(WS);
    await settle();
    restores[0]?.fail(dataError('NOT_FOUND', 'Nothing from that delete is still in the trash.'));
    expect(await undone).toEqual({
      kind: 'restored',
      objectId: PEOPLE,
      restored: 0,
      kept: 1,
      reason: 'gone',
      recordName: 'P2',
    });
  });

  it('waits for a delete still out before an undo runs, so Cmd+Z undoes the delete', async () => {
    const { layer, deletes, restores } = await readyView();
    const deleting = layer.deleteMany(WS, PEOPLE, [idAt(0)]);
    const undone = layer.undo.run(WS);
    await settle();
    expect(restores).toHaveLength(0);
    deletes[0]?.answer([{ recordId: idAt(0), state: 'deleted' }]);
    await deleting;
    await settle();
    restores[0]?.answer([{ recordId: idAt(0), state: 'restored' }]);
    expect(await undone).toMatchObject({ kind: 'restored', restored: 1, kept: 0 });
  });

  it('pushes no undo for a retried delete that deleted nothing new', async () => {
    const { layer, deletes } = await readyView();
    const deleting = layer.deleteMany(WS, PEOPLE, [idAt(0)]);
    await settle();
    deletes[0]?.answer([
      {
        recordId: idAt(0),
        state: 'already-deleted',
        refusal: { code: 'RECORD_DELETED', message: 'That record was already deleted.' },
      },
    ]);
    expect(await deleting).toMatchObject({ kind: 'done', deleted: 0, refused: 0 });
    expect(layer.undo.depth(WS)).toBe(0);
  });

  it('undoes a create by moving the record to the trash, pushing nothing more (AC-541)', async () => {
    const { layer, creates, deletes } = await readyView();
    const id = idAt(7000);
    const making = layer.create(WS, PEOPLE, { [NAME]: 'Grace' }, id);
    await settle();
    creates[0]?.answer(rowOf(id, { [NAME]: 'Grace' }));
    await making;
    expect(layer.undo.depth(WS)).toBe(1);
    const undone = layer.undo.run(WS);
    await settle();
    expect(deletes[0]?.input).toMatchObject({ objectId: PEOPLE, recordIds: [id] });
    deletes[0]?.answer([{ recordId: id, state: 'deleted' }]);
    expect(await undone).toEqual({ kind: 'uncreated', objectId: PEOPLE, recordName: 'Grace', deleted: true });
    expect(layer.undo.depth(WS)).toBe(0);
  });
});

describe('deleting records, the state review (spec 0022)', () => {
  it('lowers the count with the rows the server deleted, so it never bounces back before a settle', async () => {
    const { layer, view, deletes, frame } = await readyView();
    const deleting = layer.deleteMany(WS, PEOPLE, [idAt(0)]);
    await settle();
    deletes[0]?.answer([{ recordId: idAt(0), state: 'deleted' }]);
    await deleting;
    frame();
    expect(view.getSnapshot().count).toEqual({ count: 2, atLeast: false });
  });

  it('marks no cell for a record another delete took first', async () => {
    const { layer, view, deletes, frame } = await readyView();
    const deleting = layer.deleteMany(WS, PEOPLE, [idAt(1)]);
    await settle();
    deletes[0]?.answer([
      {
        recordId: idAt(1),
        state: 'already-deleted',
        refusal: { code: 'RECORD_DELETED', message: 'That record was already deleted.' },
      },
    ]);
    await deleting;
    frame();
    expect(view.getSnapshot().cellErrors.size).toBe(0);
    expect(view.getSnapshot().gone.has(idAt(1))).toBe(true);
  });

  it('calls an undo restored when its first answer was lost and the retry finds the batch gone', async () => {
    const { layer, deletes, restores } = await readyView();
    const deleting = layer.deleteMany(WS, PEOPLE, [idAt(0), idAt(1)]);
    await settle();
    deletes[0]?.answer([
      { recordId: idAt(0), state: 'deleted' },
      { recordId: idAt(1), state: 'deleted' },
    ]);
    await deleting;
    const undone = layer.undo.run(WS);
    await settle();
    restores[0]?.fail(dataError('API_UNAVAILABLE', 'Can’t reach the CRM.'));
    await settle();
    await settle();
    restores[1]?.fail(dataError('NOT_FOUND', 'Nothing from that delete is still in the trash.'));
    expect(await undone).toEqual({ kind: 'restored', objectId: PEOPLE, restored: 2, kept: 0 });
  });

  it('keeps a delete on the stack when its undo fails for a passing reason', async () => {
    const { layer, deletes, restores } = await readyView();
    const deleting = layer.deleteMany(WS, PEOPLE, [idAt(0)]);
    await settle();
    deletes[0]?.answer([{ recordId: idAt(0), state: 'deleted' }]);
    await deleting;
    const undone = layer.undo.run(WS);
    await settle();
    restores[0]?.fail(dataError('INTERNAL', 'Something went wrong. Try again in a moment.'));
    await expect(undone).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(layer.undo.depth(WS)).toBe(1);
  });

  it('reads ticked rows again on request and notes the ones gone (a coarse delete elsewhere)', async () => {
    const { view, gets, frame } = await readyView();
    view.confirm([idAt(0), idAt(1)]);
    await settle();
    expect(gets[0]?.input).toEqual([idAt(0), idAt(1)]);
    gets[0]?.answer([rowOf(idAt(0), { [NAME]: 'P0' })]);
    await settle();
    frame();
    expect([...view.getSnapshot().gone]).toEqual([idAt(1)]);
  });
});

describe('a board (spec 0021)', () => {
  const STAGE = 'attr-stage';
  const option = (n: number) => `0199a6f2-0000-7000-8000-${(0xa000 + n).toString(16).padStart(12, '0')}`;
  /** 13 options and the no value column: 14 columns, the 4th option archived. */
  const OPTIONS = Array.from({ length: 13 }, (_, n) => option(n));
  const ARCHIVED = option(3);
  const COLUMNS = [null, ...OPTIONS];
  const QUERY = {
    groupBy: STAGE,
    columnIds: COLUMNS,
    archivedIds: [ARCHIVED],
    sorts: [{ attributeId: CREATED, direction: 'descending' as const }],
  };
  /** A column's first cards: `count` of them, from `from`, the cursor after when more remain. */
  const seed = (id: string | null, from: number, count: number, total = count) => ({
    id,
    records: block(from, count),
    ...(total > count ? { nextCursor: `after-${String(from + count - 1)}` } : {}),
    count: total,
    atLeast: false,
  });

  it('asks for 12 columns a call, one call after another, the first probing archived options', async () => {
    const { layer, groups, queries, counts, frame } = setup();
    const board = layer.board(WS, PEOPLE, QUERY, [CITY]);
    board.retain();
    await settle();
    expect(groups).toHaveLength(1);
    expect(groups[0]?.input).toEqual({
      workspace: WS,
      objectId: PEOPLE,
      groupBy: STAGE,
      groupIds: COLUMNS.slice(0, 12),
      sorts: QUERY.sorts,
      attributeIds: [CITY, STAGE],
      limit: 25,
      probeArchived: true,
      now: at(30),
      timeZone: 'Europe/London',
    });
    expect(board.getSnapshot().status).toBe('loading');
    // Archived options hide until the probe says a live record holds them.
    expect(board.getSnapshot().columns.map((column) => column.id)).not.toContain(ARCHIVED);
    groups[0]?.answer({
      groups: COLUMNS.slice(0, 12).map((id, n) => seed(id, n * 10, 1)),
      archivedHolding: [],
    });
    await settle();
    // The second call waits for the first, and asks for what is left, the unheld archived option dropped.
    expect(groups).toHaveLength(2);
    expect(groups[1]?.input.groupIds).toEqual(COLUMNS.slice(12));
    expect(groups[1]?.input.probeArchived).toBeUndefined();
    const snapshot = board.getSnapshot();
    expect(snapshot.status).toBe('ready');
    expect(snapshot.columns.map((column) => column.id)).toEqual(COLUMNS.filter((id) => id !== ARCHIVED));
    expect(snapshot.columns.filter((column) => column.view !== undefined)).toHaveLength(11);
    groups[1]?.answer({ groups: COLUMNS.slice(12).map((id, n) => seed(id, 200 + n * 10, 1)) });
    await settle();
    frame();
    expect(board.getSnapshot().columns.every((column) => column.view !== undefined)).toBe(true);
    // Seeded: no column asked for its own count or first block.
    expect(queries).toHaveLength(0);
    expect(counts).toHaveLength(0);
  });

  it('seeds each column window, which pages on by cursor 25 at a time', async () => {
    const { layer, groups, queries, frame } = setup();
    const board = layer.board(WS, PEOPLE, { ...QUERY, columnIds: [null, option(0)], archivedIds: [] }, [CITY]);
    await settle();
    groups[0]?.answer({ groups: [seed(null, 0, 0), seed(option(0), 100, 25, 40)], archivedHolding: [] });
    await settle();
    const view = board.getSnapshot().columns[1]?.view;
    if (view === undefined) throw new Error('No column.');
    view.retain([CITY]);
    await view.ready();
    frame();
    const state = view.getSnapshot();
    expect(state.status).toBe('ready');
    expect(state.mode).toBe('cursor');
    expect(state.count).toEqual({ count: 40, atLeast: false });
    expect(state.source.getItem(0)?.id).toBe(idAt(100));
    expect(state.source.getItem(24)?.id).toBe(idAt(124));
    state.source.onRangeChange({ start: 20, end: 35 });
    await settle();
    expect(queries).toHaveLength(1);
    expect(queries[0]?.input).toMatchObject({
      cursor: 'after-124',
      limit: 25,
      filter: { conjunction: 'and', conditions: [{ attributeId: STAGE, operator: 'is', value: option(0) }] },
      sorts: QUERY.sorts,
    });
    // The empty column is ready with nothing to load.
    const empty = board.getSnapshot().columns[0]?.view;
    await empty?.ready();
    expect(empty?.getSnapshot().count).toEqual({ count: 0, atLeast: false });
  });

  it('shows an archived option still held, in its place', async () => {
    const { layer, groups } = setup();
    const board = layer.board(WS, PEOPLE, { ...QUERY, columnIds: COLUMNS.slice(0, 6) }, [CITY]);
    await settle();
    groups[0]?.answer({
      groups: COLUMNS.slice(0, 6).map((id, n) => seed(id, n * 10, 1)),
      archivedHolding: [ARCHIVED],
    });
    await settle();
    expect(board.getSnapshot().columns.map((column) => column.id)).toEqual(COLUMNS.slice(0, 6));
    expect(groups).toHaveLength(1);
  });

  it('keeps the columns already in when a later call fails, and Retry sends again from that call', async () => {
    const { layer, groups } = setup();
    const board = layer.board(WS, PEOPLE, QUERY, [CITY]);
    await settle();
    groups[0]?.answer({ groups: COLUMNS.slice(0, 12).map((id, n) => seed(id, n * 10, 1)), archivedHolding: [] });
    await settle();
    groups[1]?.fail(dataError('QUERY_CANCELLED', 'The board took too long to load.'));
    await settle();
    const failed = board.getSnapshot();
    expect(failed.status).toBe('error');
    expect(failed.error?.code).toBe('QUERY_CANCELLED');
    expect(failed.columns.filter((column) => column.view !== undefined)).toHaveLength(11);
    board.retry();
    await settle();
    expect(groups).toHaveLength(3);
    expect(groups[2]?.input.groupIds).toEqual(COLUMNS.slice(12));
    groups[2]?.answer({ groups: COLUMNS.slice(12).map((id, n) => seed(id, 200 + n * 10, 1)) });
    await settle();
    expect(board.getSnapshot().status).toBe('ready');
    expect(board.getSnapshot().columns.every((column) => column.view !== undefined)).toBe(true);
  });

  it('fails whole when its first call fails, and loads on Retry', async () => {
    const { layer, groups } = setup();
    const board = layer.board(WS, PEOPLE, { ...QUERY, columnIds: [null], archivedIds: [] });
    await settle();
    groups[0]?.fail(dataError('API_UNAVAILABLE', 'Can’t reach the CRM.'));
    await settle();
    expect(board.getSnapshot()).toMatchObject({ status: 'error', columns: [{ id: null }] });
    board.retry();
    expect(board.getSnapshot().status).toBe('loading');
    await settle();
    groups[1]?.answer({ groups: [seed(null, 0, 2)], archivedHolding: [] });
    await settle();
    expect(board.getSnapshot().status).toBe('ready');
  });

  it('is one board for every screen asking the same thing, and aborts its call when the records are cleared', async () => {
    const { layer, groups } = setup();
    const board = layer.board(WS, PEOPLE, QUERY, [CITY]);
    expect(layer.board(WS, PEOPLE, QUERY, [CITY])).toBe(board);
    expect(layer.board(WS, PEOPLE, { ...QUERY, filter: { conjunction: 'and', conditions: [] }, sorts: [] })).not.toBe(
      board,
    );
    await settle();
    layer.clear();
    expect(groups[0]?.signal?.aborted).toBe(true);
  });

  it('waits out a busy server before its first call lands', async () => {
    const { layer, groups, waits } = setup();
    const board = layer.board(WS, PEOPLE, { ...QUERY, columnIds: [null], archivedIds: [] });
    await settle();
    groups[0]?.fail(dataError('TOO_MANY_REQUESTS', 'Busy.', undefined, 1));
    await settle();
    expect(waits).toEqual([1000]);
    groups[1]?.answer({ groups: [seed(null, 0, 1)], archivedHolding: [] });
    await settle();
    expect(board.getSnapshot().status).toBe('ready');
  });
});
