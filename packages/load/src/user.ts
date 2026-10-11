// One simulated person at the People table (spec 0011, AC-198). A user holds
// one object's view and the 100 row window it last loaded, and turns each
// arrival into the calls a browser makes:
//
// - A view `canJump` admits (no filter, at most one sort on a stored key)
//   scrolls by position: a scroll reads the next or previous 1 to 3 windows,
//   a jump reads the window at a row (`steady`: 70% within the first 2,000
//   rows; `spread`: anywhere).
// - Any other view runs by cursor, as spec 0006's windows do: its first window
//   and its count together, a scroll follows `nextCursor`, and a jump reads
//   forward in calls of 200 rows from the last checkpoint the user holds. It
//   never sends a position.
// - Filter or sort replaces the view with another of the object's shapes, and
//   aborts the old view's count if it is still running.
// - Open reads one record; edit changes one editable attribute of a record in
//   the window (spread: a sampled one); create adds a record.
//
// Every call goes through `LoadApi` (the real contract client in a run, a fake
// in tests), and each action's time runs from its scheduled moment.
import type {
  CountRecordsInput,
  CreateRecordInput,
  GetRecordsInput,
  QueryRecordsInput,
  RecordCount,
  RecordPage,
  RecordView,
  SetValuesInput,
} from '@crm/contracts';
import type { LoadAction } from '@crm/core/scale-budget';
import { outcomeOfError, REQUEST_TIMEOUT_MS, type Outcome } from './outcome.ts';
import type { Random } from './random.ts';
import {
  createValues,
  EDITABLE,
  jumpsByPosition,
  type ObjectKey,
  type ShapeAttribute,
  type ViewShape,
} from './shapes.ts';
import { newValue } from './values.ts';

/** Rows in a window, as the People table reads them. */
export const WINDOW_ROWS = 100;
/** Rows in one call of a cursor jump's forward read. */
export const JUMP_READ_ROWS = 200;
/** `steady`'s jumps: this share lands in the first `NEAR_TOP_ROWS` rows. */
export const NEAR_TOP_SHARE = 0.7;
/** The rows near the top, for `steady`'s jumps. */
export const NEAR_TOP_ROWS = 2_000;

/** What a sample measures: the four judged kinds, and counts (reported). */
export type Metric = 'read' | 'open' | 'edit' | 'create' | 'count';

/** One measured thing a user did: when it was scheduled, when it answered, and how. */
export interface Sample {
  readonly user: number;
  readonly action: LoadAction | 'join';
  readonly metric: Metric;
  readonly mode?: 'position' | 'cursor';
  readonly scheduledAt: number;
  readonly answeredAt: number;
  readonly outcome: Outcome;
  readonly reason?: string;
  readonly measured: boolean;
  /** How many requests it took. */
  readonly requests: number;
  /** The API's pool wait of each request that answered with a timing header. */
  readonly poolMs: readonly number[];
}

/** One call's extras: the signal that aborts it, and where the client notes the API's pool wait. */
export interface Call {
  readonly signal: AbortSignal;
  readonly poolMs: number[];
}

/** The calls a user makes, as the contract names them. */
export interface LoadApi {
  readonly query: (input: QueryRecordsInput, call: Call) => Promise<RecordPage>;
  readonly count: (input: CountRecordsInput, call: Call) => Promise<RecordCount>;
  readonly get: (input: GetRecordsInput, call: Call) => Promise<readonly RecordView[]>;
  readonly setValues: (input: SetValuesInput, call: Call) => Promise<unknown>;
  readonly create: (input: CreateRecordInput, call: Call) => Promise<unknown>;
}

/** One object as the users see it. */
export interface ObjectModel {
  readonly key: ObjectKey;
  readonly objectId: string;
  /** Its attributes by API slug. */
  readonly attributes: ReadonlyMap<string, ShapeAttribute>;
  /** Its fixed shapes; the first is the plain view a user joins on. */
  readonly shapes: readonly ViewShape[];
  /** Live ids spread over the whole object (the manifest's samples), for `spread`. */
  readonly samples: readonly string[];
  /** Its live records when seeded: a position view's bounds until its count answers. */
  readonly liveCount: number;
  /**
   * The columns on screen, which window reads name (`attributeIds`, as the
   * People table sends): `columnsOnScreen` picks them. An open reads the whole
   * record, as a record page does.
   */
  readonly columns: readonly string[];
}

/** How a scenario's users jump and pick records. */
export interface Behaviour {
  /** `near-top`: 70% of jumps within the first 2,000 rows (steady); `even`: anywhere (spread). */
  readonly jumps: 'near-top' | 'even';
  /** `window`: opens and edits pick from the window; `samples`: from the manifest's samples (spread). */
  readonly picks: 'window' | 'samples';
  /** The share of scrolls that jump rather than move by 1 to 3 windows. */
  readonly jumpShare: number;
}

/** Everything one user needs. */
export interface UserOptions {
  readonly user: number;
  readonly workspace: string;
  readonly memberId: string;
  readonly memberIds: readonly string[];
  readonly model: ObjectModel;
  readonly api: LoadApi;
  readonly random: Random;
  readonly behaviour: Behaviour;
  /** Milliseconds since the epoch, on the clock every thread shares. */
  readonly now: () => number;
  /** A new record id (uuid v7). */
  readonly newId: () => string;
  /** A new `mutationId`. */
  readonly mutationId: () => string;
  readonly record: (sample: Sample) => void;
}

/** What a user holds, for tests. */
export interface UserSnapshot {
  readonly view: string;
  readonly mode: 'position' | 'cursor';
  readonly block: number;
  readonly total: number | undefined;
  readonly windowIds: readonly string[];
  readonly checkpoints: readonly number[];
}

/** One simulated user. Neither method ever rejects: every failure becomes a sample. */
export interface LoadUser {
  /** Opens the object's plain view: its first window and its count. */
  readonly join: (scheduledAt: number, measured: boolean) => Promise<void>;
  /** One arrival of the mix. */
  readonly act: (action: LoadAction, scheduledAt: number, measured: boolean) => Promise<void>;
  readonly snapshot: () => UserSnapshot;
}

interface ViewState {
  readonly generation: number;
  readonly shape: ViewShape;
  readonly position: boolean;
  total: number | undefined;
  block: number;
  window: readonly RecordView[];
  /** Cursor mode: block `b`'s start cursor (block 0 needs none). */
  readonly checkpoints: Map<number, string>;
  /** Cursor mode: the window holds the last rows. */
  atEnd: boolean;
  readonly countAbort: AbortController;
}

type Answer<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly outcome: Outcome; readonly reason: string };

/** The worse of two outcomes for one action: unexpected, then expected, then ok. */
function worse(left: Outcome, right: Outcome): Outcome {
  const rank: Record<Outcome, number> = { ok: 0, aborted: 1, expected: 2, unexpected: 3 };
  return rank[right] > rank[left] ? right : left;
}

/** Makes one user. */
export function createLoadUser(options: UserOptions): LoadUser {
  const { api, model, random, behaviour } = options;
  const editable = EDITABLE[model.key].flatMap((slug) => {
    const attribute = model.attributes.get(slug);
    return attribute === undefined ? [] : [attribute];
  });
  let generation = 0;
  let view: ViewState | undefined;

  /** One action's tally: its requests, their worst outcome, and their pool waits. */
  function tally() {
    let requests = 0;
    let outcome: Outcome = 'ok';
    let reason: string | undefined;
    const poolMs: number[] = [];
    async function call<T>(run: (call: Call) => Promise<T>, abort?: AbortSignal): Promise<Answer<T>> {
      requests += 1;
      const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      const signal = abort === undefined ? timeout : AbortSignal.any([timeout, abort]);
      try {
        return { ok: true, value: await run({ signal, poolMs }) };
      } catch (error) {
        const failed = outcomeOfError(error, abort?.aborted === true && !timeout.aborted);
        if (worse(outcome, failed.outcome) !== outcome) {
          outcome = failed.outcome;
          reason = failed.reason;
        }
        return { ok: false, ...failed };
      }
    }
    const finish = (
      metric: Metric,
      action: LoadAction | 'join',
      scheduledAt: number,
      measured: boolean,
      mode?: 'position' | 'cursor',
    ) =>
      options.record({
        user: options.user,
        action,
        metric,
        ...(mode === undefined ? {} : { mode }),
        scheduledAt,
        answeredAt: options.now(),
        outcome,
        ...(reason === undefined ? {} : { reason }),
        measured,
        requests,
        poolMs,
      });
    return { call, finish };
  }

  const base = () => ({ workspace: options.workspace, objectId: model.objectId });
  // A window reads the columns on screen, as the People table does (spec 0006, AC-55).
  const shapeInput = (shape: ViewShape) => ({
    ...(shape.filter === undefined ? {} : { filter: shape.filter }),
    ...(shape.sorts === undefined ? {} : { sorts: shape.sorts }),
    attributeIds: [...model.columns],
  });
  const current = (state: ViewState) => state.generation === generation;
  const modeOf = (state: ViewState) => (state.position ? 'position' : 'cursor');

  /** Replaces the view with `shape`: its first window and its count, together. */
  async function open(shape: ViewShape, action: LoadAction | 'join', scheduledAt: number, measured: boolean) {
    view?.countAbort.abort();
    generation += 1;
    const state: ViewState = {
      generation,
      shape,
      position: jumpsByPosition(shape, model.attributes),
      total: undefined,
      block: 0,
      window: [],
      checkpoints: new Map(),
      atEnd: false,
      countAbort: new AbortController(),
    };
    view = state;
    const counting = tally();
    const counted = (async () => {
      const answer = await counting.call(
        (call) => api.count({ ...base(), ...(shape.filter === undefined ? {} : { filter: shape.filter }) }, call),
        state.countAbort.signal,
      );
      if (answer.ok && current(state)) state.total = answer.value.count;
      counting.finish('count', action, scheduledAt, measured, modeOf(state));
    })();
    const reading = tally();
    const first = await reading.call((call) =>
      api.query(
        { ...base(), ...shapeInput(shape), limit: WINDOW_ROWS, ...(state.position ? { position: 0 } : {}) },
        call,
      ),
    );
    if (first.ok && current(state)) {
      state.window = first.value.records;
      if (!state.position) remember(state, 0, WINDOW_ROWS, first.value);
    }
    reading.finish('read', action, scheduledAt, measured, modeOf(state));
    await counted;
  }

  /** Cursor mode: notes where the block after a read of `rows` from block `from` starts, or that the list ended. */
  function remember(state: ViewState, from: number, rows: number, page: RecordPage) {
    const next = from + rows / WINDOW_ROWS;
    if (page.nextCursor === undefined) state.atEnd = true;
    else state.checkpoints.set(next, page.nextCursor);
  }

  /** The view's row count as far as the user knows: its count, else the seeded count for a plain view. */
  const totalOf = (state: ViewState) => state.total ?? (state.position ? model.liveCount : NEAR_TOP_ROWS);

  async function scroll(state: ViewState, scheduledAt: number, measured: boolean) {
    const reading = tally();
    const windows = random.int(1, 4);
    const lastBlock = Math.max(0, Math.ceil(totalOf(state) / WINDOW_ROWS) - 1);
    const canForward = state.position ? state.block < lastBlock : !state.atEnd;
    const forward = state.block === 0 || (canForward && random.chance(0.75));
    if (state.position) {
      const target = forward ? Math.min(state.block + windows, lastBlock) : Math.max(state.block - windows, 0);
      const step = target >= state.block ? 1 : -1;
      const blocks: number[] = [];
      for (let block = state.block + step; step > 0 ? block <= target : block >= target; block += step) {
        blocks.push(block);
      }
      // A view of one window: read it again.
      if (blocks.length === 0) blocks.push(target);
      const pages = await Promise.all(
        blocks.map((block) =>
          reading.call((call) =>
            api.query(
              { ...base(), ...shapeInput(state.shape), position: block * WINDOW_ROWS, limit: WINDOW_ROWS },
              call,
            ),
          ),
        ),
      );
      const landed = pages[pages.length - 1];
      if (landed?.ok === true && current(state)) {
        state.block = target;
        state.window = landed.value.records;
      }
    } else if (forward && canForward) {
      for (let moved = 0; moved < windows && !state.atEnd && current(state); moved += 1) {
        const cursor = state.checkpoints.get(state.block + 1);
        if (cursor === undefined) break;
        const page = await reading.call((call) =>
          api.query({ ...base(), ...shapeInput(state.shape), cursor, limit: WINDOW_ROWS }, call),
        );
        if (!page.ok || !current(state)) break;
        state.block += 1;
        state.window = page.value.records;
        remember(state, state.block, WINDOW_ROWS, page.value);
      }
    } else {
      await readForward(state, Math.max(state.block - windows, 0), reading.call);
    }
    reading.finish('read', 'scroll', scheduledAt, measured, modeOf(state));
  }

  /**
   * Cursor mode: reads forward from the last checkpoint at or before `target`
   * in calls of 200 rows until the window holding block `target` is loaded
   * (or the list ends), noting each checkpoint on the way.
   */
  async function readForward(state: ViewState, target: number, call: ReturnType<typeof tally>['call']) {
    let from = target;
    while (from > 0 && !state.checkpoints.has(from)) from -= 1;
    for (;;) {
      const cursor = from === 0 ? undefined : state.checkpoints.get(from);
      const page = await call((each) =>
        api.query(
          { ...base(), ...shapeInput(state.shape), ...(cursor === undefined ? {} : { cursor }), limit: JUMP_READ_ROWS },
          each,
        ),
      );
      if (!page.ok || !current(state)) return;
      remember(state, from, JUMP_READ_ROWS, page.value);
      const { records } = page.value;
      const reached = target <= from + 1 || page.value.nextCursor === undefined;
      if (reached) {
        const second = target > from && records.length > WINDOW_ROWS;
        state.block = second ? from + 1 : from;
        state.window = second ? records.slice(WINDOW_ROWS) : records.slice(0, WINDOW_ROWS);
        state.atEnd = page.value.nextCursor === undefined && (second || records.length <= WINDOW_ROWS);
        return;
      }
      from += 2;
    }
  }

  async function jump(state: ViewState, scheduledAt: number, measured: boolean) {
    const reading = tally();
    const total = Math.max(totalOf(state), 1);
    const nearTop = behaviour.jumps === 'near-top' && random.chance(NEAR_TOP_SHARE);
    const row = random.int(0, nearTop ? Math.min(NEAR_TOP_ROWS, total) : total);
    const target = Math.floor(row / WINDOW_ROWS);
    if (state.position) {
      const page = await reading.call((call) =>
        api.query({ ...base(), ...shapeInput(state.shape), position: target * WINDOW_ROWS, limit: WINDOW_ROWS }, call),
      );
      if (page.ok && current(state)) {
        state.block = target;
        state.window = page.value.records;
      }
    } else {
      await readForward(state, target, reading.call);
    }
    reading.finish('read', 'scroll', scheduledAt, measured, modeOf(state));
  }

  /** A record to open or edit: from the window, or the samples (spread, or before the first window lands). */
  function pickRecord(): { id: string; view?: RecordView } {
    const window = view?.window ?? [];
    if (behaviour.picks === 'window' && window.length > 0) {
      const record = random.pick(window);
      return { id: record.id, view: record };
    }
    return { id: random.pick(model.samples) };
  }

  async function openRecord(scheduledAt: number, measured: boolean) {
    const reading = tally();
    const { id } = pickRecord();
    await reading.call((call) => api.get({ workspace: options.workspace, ids: [id] }, call));
    reading.finish('open', 'open', scheduledAt, measured);
  }

  async function edit(scheduledAt: number, measured: boolean) {
    const writing = tally();
    const record = pickRecord();
    const attribute = random.pick(editable);
    const value = newValue(attribute, record.view?.values[attribute.id], random);
    const version = record.view?.versions[attribute.id];
    const change =
      record.view === undefined ? { value } : { value, baseVersionId: version === undefined ? null : version };
    await writing.call((call) =>
      api.setValues(
        {
          workspace: options.workspace,
          recordId: record.id,
          values: { [attribute.id]: change },
          mutationId: options.mutationId(),
        },
        call,
      ),
    );
    writing.finish('edit', 'edit', scheduledAt, measured);
  }

  async function create(scheduledAt: number, measured: boolean) {
    const writing = tally();
    const id = options.newId();
    const values = createValues(model.key, id, {
      attributes: model.attributes,
      memberIds: options.memberIds,
      memberId: options.memberId,
    });
    await writing.call((call) =>
      api.create({ ...base(), id, values: { ...values }, mutationId: options.mutationId() }, call),
    );
    writing.finish('create', 'create', scheduledAt, measured);
  }

  async function act(action: LoadAction, scheduledAt: number, measured: boolean): Promise<void> {
    const state = view;
    switch (action) {
      case 'scroll':
        if (state === undefined || state.window.length === 0) {
          await open(state?.shape ?? firstShape(), 'scroll', scheduledAt, measured);
        } else if (random.chance(behaviour.jumpShare)) {
          await jump(state, scheduledAt, measured);
        } else {
          await scroll(state, scheduledAt, measured);
        }
        return;
      case 'filterSort': {
        const others = model.shapes.filter((shape) => shape.name !== state?.shape.name);
        await open(random.pick(others.length > 0 ? others : model.shapes), 'filterSort', scheduledAt, measured);
        return;
      }
      case 'open':
        await openRecord(scheduledAt, measured);
        return;
      case 'edit':
        await edit(scheduledAt, measured);
        return;
      case 'create':
        await create(scheduledAt, measured);
        return;
    }
  }

  function firstShape(): ViewShape {
    const shape = model.shapes[0];
    if (shape === undefined) throw new Error(`${model.key} has no view shapes.`);
    return shape;
  }

  return {
    join: (scheduledAt, measured) => open(firstShape(), 'join', scheduledAt, measured),
    act,
    snapshot: () => ({
      view: view?.shape.name ?? '',
      mode: view?.position === false ? 'cursor' : 'position',
      block: view?.block ?? 0,
      total: view?.total,
      windowIds: (view?.window ?? []).map((record) => record.id),
      checkpoints: [...(view?.checkpoints.keys() ?? [])].sort((left, right) => left - right),
    }),
  };
}
