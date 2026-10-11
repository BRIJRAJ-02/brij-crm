// The simulated user against a fake API (spec 0011, AC-198, AC-212): a view
// `canJump` admits scrolls and jumps by position; a filtered view runs by
// cursor, follows `nextCursor`, jumps by reading forward in 200 row calls
// from its last checkpoint, and never sends a position; a newer view aborts a
// count still running; edits change an editable attribute of a record in the
// window; creates are unique; refusals and failures become samples.
import { ORPCError } from '@orpc/client';
import { describe, expect, it } from 'vitest';
import type { QueryRecordsInput, RecordPage, RecordView } from '@crm/contracts';
import { createRandom } from './random.ts';
import { viewShapes, type ShapeAttribute } from './shapes.ts';
import { createLoadUser, type Behaviour, type Call, type LoadApi, type ObjectModel, type Sample } from './user.ts';

const ROWS = 5_000;
const id = (n: number) => `00000000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;

const attributes = new Map<string, ShapeAttribute>([
  ['name', { id: id(900_001), apiSlug: 'name', type: 'personal_name', isSystem: false, isMulti: false, options: [] }],
  ['job_title', { id: id(900_002), apiSlug: 'job_title', type: 'text', isSystem: false, isMulti: false, options: [] }],
  [
    'owner',
    { id: id(900_003), apiSlug: 'owner', type: 'actor_reference', isSystem: false, isMulti: false, options: [] },
  ],
  [
    'created_at',
    { id: id(900_004), apiSlug: 'created_at', type: 'timestamp', isSystem: true, isMulti: false, options: [] },
  ],
  [
    'email_opt_out',
    { id: id(900_005), apiSlug: 'email_opt_out', type: 'checkbox', isSystem: false, isMulti: false, options: [] },
  ],
  [
    'description',
    { id: id(900_006), apiSlug: 'description', type: 'long_text', isSystem: false, isMulti: false, options: [] },
  ],
  [
    'email_addresses',
    { id: id(900_007), apiSlug: 'email_addresses', type: 'email', isSystem: false, isMulti: true, options: [] },
  ],
]);

const member = id(800_001);
const model: ObjectModel = {
  key: 'people',
  objectId: id(700_001),
  attributes,
  shapes: viewShapes('people', { attributes, memberIds: [member] }),
  samples: [id(4_000), id(4_001)],
  liveCount: ROWS,
  columns: [id(900_001), id(900_002)],
};

const record = (n: number): RecordView => ({
  id: id(n),
  objectId: model.objectId,
  createdAt: '2026-10-01T00:00:00.000Z',
  createdBy: { type: 'system', id: null },
  updatedAt: '2026-10-01T00:00:00.000Z',
  updatedBy: { type: 'system', id: null },
  display: { objectId: model.objectId, recordId: id(n), name: `Person ${String(n)}`, kind: 'person' },
  revision: 1,
  values: { [id(900_002)]: 'Engineer', [id(900_005)]: false },
  versions: { [id(900_002)]: id(600_000 + n) },
  linkTotals: {},
});

/** A fake API over `ROWS` records (a filtered view matches every other one), logging every call. */
function fakeApi(options: { countDelayMs?: number; failWith?: () => Error } = {}) {
  const calls: { procedure: string; input: unknown }[] = [];
  const page = (input: QueryRecordsInput): RecordPage => {
    const filtered = input.filter !== undefined;
    const size = filtered ? ROWS / 2 : ROWS;
    const view = JSON.stringify([input.filter ?? null, input.sorts ?? null]);
    let start = input.position ?? 0;
    if (input.cursor !== undefined) {
      const [cursorView, offset] = JSON.parse(input.cursor) as [string, number];
      if (cursorView !== view) throw new Error('A cursor from another view.');
      start = offset;
    }
    const limit = input.limit ?? 50;
    const end = Math.min(start + limit, size);
    const records = Array.from({ length: Math.max(end - start, 0) }, (_, index) => record(start + index));
    return { records, ...(end < size ? { nextCursor: JSON.stringify([view, end]) } : {}) };
  };
  const api: LoadApi = {
    query: (input) => {
      calls.push({ procedure: 'query', input });
      if (options.failWith) return Promise.reject(options.failWith());
      return Promise.resolve(page(input));
    },
    count: (input, call: Call) => {
      calls.push({ procedure: 'count', input });
      const answer = { count: input.filter === undefined ? ROWS : ROWS / 2, atLeast: false };
      if (options.countDelayMs === undefined) return Promise.resolve(answer);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(answer), options.countDelayMs);
        call.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    },
    get: (input) => {
      calls.push({ procedure: 'get', input });
      return Promise.resolve([]);
    },
    setValues: (input) => {
      calls.push({ procedure: 'setValues', input });
      if (options.failWith) return Promise.reject(options.failWith());
      return Promise.resolve({});
    },
    create: (input) => {
      calls.push({ procedure: 'create', input });
      return Promise.resolve({});
    },
  };
  return { api, calls };
}

const steady: Behaviour = { jumps: 'near-top', picks: 'window', jumpShare: 0.2 };

function user(api: LoadApi, options: { behaviour?: Behaviour; seed?: number } = {}) {
  const samples: Sample[] = [];
  let clock = 1_000;
  let ids = 0;
  const loadUser = createLoadUser({
    user: 3,
    workspace: 'load',
    memberId: member,
    memberIds: [member],
    model,
    api,
    random: createRandom(options.seed ?? 7, 'user'),
    behaviour: options.behaviour ?? steady,
    now: () => (clock += 5),
    newId: () => id(1_000_000 + (ids += 1)),
    mutationId: () => id(2_000_000 + (ids += 1)),
    record: (sample) => samples.push(sample),
  });
  return { loadUser, samples };
}

const queries = (calls: { procedure: string; input: unknown }[]) =>
  calls.filter((call) => call.procedure === 'query').map((call) => call.input as QueryRecordsInput);

describe('a view canJump admits', () => {
  it('joins on its first window by position with its count, and scrolls by position', async () => {
    const { api, calls } = fakeApi();
    const { loadUser, samples } = user(api, { behaviour: { ...steady, jumpShare: 0 } });
    await loadUser.join(0, false);
    expect(calls.map((call) => call.procedure).sort()).toEqual(['count', 'query']);
    expect(queries(calls)[0]).toMatchObject({ position: 0, limit: 100 });
    expect(loadUser.snapshot()).toMatchObject({ view: 'all', mode: 'position', block: 0, total: ROWS });
    expect(samples.map((each) => each.metric).sort()).toEqual(['count', 'read']);
    expect(samples.every((each) => !each.measured)).toBe(true);
    for (let step = 0; step < 20; step += 1) await loadUser.act('scroll', 100 * step, true);
    const scrolled = queries(calls).slice(1);
    expect(scrolled.every((input) => input.position !== undefined && input.position % 100 === 0)).toBe(true);
    expect(scrolled.every((input) => input.cursor === undefined && input.limit === 100)).toBe(true);
    // A window reads the columns on screen, as the People table does.
    expect(queries(calls).every((input) => input.attributeIds?.length === 2)).toBe(true);
    // Each scroll read 1 to 3 windows and was timed once, from its schedule.
    const reads = samples.filter((each) => each.action === 'scroll');
    expect(reads).toHaveLength(20);
    expect(reads.every((each) => each.requests >= 1 && each.requests <= 3 && each.mode === 'position')).toBe(true);
    expect(loadUser.snapshot().windowIds).toHaveLength(100);
  });

  it('jumps by position, mostly near the top in steady and anywhere in spread', async () => {
    const jumpsOf = async (behaviour: Behaviour) => {
      const { api, calls } = fakeApi();
      const { loadUser } = user(api, { behaviour: { ...behaviour, jumpShare: 1 } });
      await loadUser.join(0, false);
      for (let step = 0; step < 200; step += 1) await loadUser.act('scroll', step, true);
      return queries(calls)
        .slice(1)
        .map((input) => input.position ?? -1);
    };
    const nearTop = await jumpsOf(steady);
    const share = nearTop.filter((position) => position < 2_000).length / nearTop.length;
    // 70% near the top, plus the even 30% that lands there by chance (2,000 of 5,000 rows).
    expect(share).toBeGreaterThan(0.72);
    const even = await jumpsOf({ ...steady, jumps: 'even' });
    expect(even.filter((position) => position < 2_000).length / even.length).toBeLessThan(0.55);
  });
});

describe('a filtered view', () => {
  async function filtered(behaviour: Behaviour) {
    const fake = fakeApi();
    const made = user(fake.api, { behaviour, seed: 11 });
    await made.loadUser.join(0, false);
    // Filter or sort until the view is the job title one (by cursor).
    for (
      let tries = 0;
      tries < 50 && made.loadUser.snapshot().view !== 'job title contains manager, by name';
      tries += 1
    ) {
      await made.loadUser.act('filterSort', tries, true);
    }
    expect(made.loadUser.snapshot()).toMatchObject({ view: 'job title contains manager, by name', mode: 'cursor' });
    return { ...fake, ...made };
  }

  it('reads its first window and its count together, and scrolls by following nextCursor', async () => {
    const { calls, loadUser } = await filtered({ ...steady, jumpShare: 0 });
    const before = calls.length;
    for (let step = 0; step < 30; step += 1) await loadUser.act('scroll', step, true);
    const scrolls = queries(calls.slice(before));
    expect(scrolls.length).toBeGreaterThan(0);
    // Never a position on a filtered view.
    expect(
      queries(calls)
        .filter((input) => input.filter !== undefined)
        .every((input) => input.position === undefined),
    ).toBe(true);
    const snapshot = loadUser.snapshot();
    expect(snapshot.block).toBeGreaterThan(0);
    expect(snapshot.checkpoints).toContain(snapshot.block + 1);
  });

  it('jumps by reading forward in 200 row calls from its last checkpoint', async () => {
    const { calls, loadUser } = await filtered({ jumps: 'even', picks: 'window', jumpShare: 1 });
    const before = calls.length;
    await loadUser.act('scroll', 0, true);
    const jump = queries(calls.slice(before));
    expect(jump.every((input) => input.limit === 200 && input.position === undefined)).toBe(true);
    // The first window left checkpoints at blocks 0 and 1: the jump starts from the nearer, and each next call follows.
    const landed = loadUser.snapshot();
    const from = landed.block >= 1 ? 1 : 0;
    expect(jump[0]?.cursor === undefined).toBe(from === 0);
    expect(jump.slice(1).every((input) => input.cursor !== undefined)).toBe(true);
    expect(jump.length).toBe(Math.floor((landed.block - from) / 2) + 1);
    expect(landed.windowIds).toHaveLength(100);
    expect(landed.windowIds[0]).toBe(id(landed.block * 100));
    // A second jump starts from the nearest checkpoint it holds, not from the top.
    const again = calls.length;
    await loadUser.act('scroll', 1, true);
    const second = queries(calls.slice(again));
    const target = loadUser.snapshot().block;
    if (target >= 2) expect(second[0]?.cursor).toBeDefined();
  });
});

describe('filter or sort', () => {
  it('aborts the old view’s count while it still runs, which counts as neither success nor error', async () => {
    const { api } = fakeApi({ countDelayMs: 200 });
    const { loadUser, samples } = user(api);
    const joining = loadUser.join(0, true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await loadUser.act('filterSort', 10, true);
    await joining;
    const counts = samples.filter((each) => each.metric === 'count');
    expect(counts.map((each) => each.outcome).sort()).toEqual(['aborted', 'ok']);
  });
});

describe('open, edit and create', () => {
  it('opens and edits records in the window, with the version the window holds', async () => {
    const { api, calls } = fakeApi();
    const { loadUser } = user(api);
    await loadUser.join(0, false);
    const window = new Set(loadUser.snapshot().windowIds);
    for (let step = 0; step < 10; step += 1) {
      await loadUser.act('open', step, true);
      await loadUser.act('edit', step, true);
    }
    const opened = calls
      .filter((call) => call.procedure === 'get')
      .map((call) => (call.input as { ids: string[] }).ids);
    expect(opened.every((ids) => ids.length === 1 && window.has(ids[0] ?? ''))).toBe(true);
    const edits = calls
      .filter((call) => call.procedure === 'setValues')
      .map(
        (call) =>
          call.input as { recordId: string; values: Record<string, { value: unknown; baseVersionId?: unknown }> },
      );
    const editable = new Set([id(900_002), id(900_005), id(900_006)]);
    for (const edit of edits) {
      expect(window.has(edit.recordId)).toBe(true);
      const [[attributeId, change] = ['', { value: undefined }]] = Object.entries(edit.values);
      expect(editable.has(attributeId)).toBe(true);
      // A job title edit names the version the window held; a checkbox flips.
      if (attributeId === id(900_002)) expect(change.baseVersionId).toBeDefined();
      if (attributeId === id(900_005)) expect(change.value).toBe(true);
    }
  });

  it('opens and edits the manifest’s samples in spread', async () => {
    const { api, calls } = fakeApi();
    const { loadUser } = user(api, { behaviour: { jumps: 'even', picks: 'samples', jumpShare: 0.2 } });
    await loadUser.join(0, false);
    await loadUser.act('open', 0, true);
    await loadUser.act('edit', 0, true);
    const touched = calls
      .filter((call) => call.procedure === 'get' || call.procedure === 'setValues')
      .map((call) => {
        const input = call.input as { ids?: string[]; recordId?: string };
        return input.ids?.[0] ?? input.recordId;
      });
    expect(touched.every((each) => model.samples.includes(each ?? ''))).toBe(true);
  });

  it('creates a record with a unique name and email made from its id', async () => {
    const { api, calls } = fakeApi();
    const { loadUser } = user(api);
    await loadUser.act('create', 0, true);
    await loadUser.act('create', 1, true);
    const creates = calls
      .filter((call) => call.procedure === 'create')
      .map((call) => call.input as { id: string; values: Record<string, unknown> });
    expect(creates).toHaveLength(2);
    expect(creates[0]?.id).not.toBe(creates[1]?.id);
    const [first] = creates;
    expect(first?.values[id(900_007)]).toEqual([`${first?.id ?? ''}@load.example.com`]);
    expect(first?.values[id(900_001)]).toMatchObject({ fullName: `Load person ${(first?.id ?? '').slice(0, 8)}` });
  });
});

describe('failures', () => {
  it('records a 409 as an expected refusal and a 500 or a dropped connection as unexpected', async () => {
    const outcomes = async (error: () => Error) => {
      const { api } = fakeApi({ failWith: error });
      const { loadUser, samples } = user(api);
      await loadUser.act('edit', 0, true);
      return samples.map((each) => [each.outcome, each.reason]);
    };
    expect(await outcomes(() => new ORPCError('UNIQUE_CONFLICT', { status: 409 }))).toEqual([
      ['expected', '409 UNIQUE_CONFLICT'],
    ]);
    expect(await outcomes(() => new ORPCError('INTERNAL', { status: 500 }))).toEqual([['unexpected', '500 INTERNAL']]);
    expect(await outcomes(() => new TypeError('fetch failed'))).toEqual([['unexpected', 'dropped']]);
    expect(await outcomes(() => new DOMException('The operation timed out.', 'TimeoutError'))).toEqual([
      ['unexpected', 'timeout'],
    ]);
  });
});
