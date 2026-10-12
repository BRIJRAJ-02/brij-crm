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
// - In `hub` (AC-206), half the edits move one of the user's people to or from
//   the hub company (its Company), a fifth of the opens read the hub (its
//   first 20 Team links and the total), and one user renames the hub every 10
//   seconds.
//
// Every call goes through `LoadApi` (the real contract client in a run, a fake
// in tests), and each action's time runs from its scheduled moment.
import type {
  CountRecordsInput,
  FilterGroup,
  CreateRecordInput,
  GetRecordsInput,
  QueryRecordsInput,
  RecordCount,
  RecordPage,
  RecordView,
  SetValuesInput,
} from '@crm/contracts';
import type { LoadAction } from '@crm/core/scale-budget';
import type { Outcome } from './outcome.ts';
import type { Random } from './random.ts';
import {
  createValues,
  EDITABLE,
  jumpsByPosition,
  type ObjectKey,
  type ShapeAttribute,
  type ViewShape,
} from './shapes.ts';
import { createTally, type Answered, type Call, type TallyCall } from './tally.ts';
import { newValue } from './values.ts';

export type { Call } from './tally.ts';

/** Rows in a window, as the People table reads them. */
export const WINDOW_ROWS = 100;
/** Rows in one call of a cursor jump's forward read. */
export const JUMP_READ_ROWS = 200;
/** `steady`'s jumps: this share lands in the first `NEAR_TOP_ROWS` rows. */
export const NEAR_TOP_SHARE = 0.7;
/** The rows near the top, for `steady`'s jumps. */
export const NEAR_TOP_ROWS = 2_000;

/**
 * What a sample measures: the four judged kinds of action, counts (reported),
 * and what live updates cost (milestone 3): a holder's refetch after an event
 * (`delivery`), a window settling after a create, delete or reorder
 * (`settle`), and the live connection's own calls and drops (`live`).
 */
export type Metric = 'read' | 'open' | 'edit' | 'create' | 'count' | 'delivery' | 'settle' | 'live';

/** The metrics of the mix's actions: the denominator of the unexpected error share. */
export const ACTION_METRICS: ReadonlySet<Metric> = new Set(['read', 'open', 'edit', 'create']);

/** How an event reached a holder: live, replayed by Centrifugo's recovery, or read through `realtime.catchUp`. */
export type Via = 'live' | 'recovered' | 'catchUp';

/** One measured thing a user did: when it was scheduled, when it answered, and how. */
export interface Sample {
  readonly user: number;
  readonly action: LoadAction | 'join' | 'live';
  readonly metric: Metric;
  /** A storm burst's edit (AC-207), kept off the mix and the edit line. */
  readonly burst?: boolean;
  /**
   * The hub scenario's own (AC-206): a person moved to or from the hub (an
   * edit, on the edit line), the hub opened (its own line, off the open
   * line), or the hub renamed (its own line, off the mix and the edit line).
   */
  readonly hub?: 'move' | 'open' | 'edit';
  /** A write's `mutationId`, joining it to its holders' refetches (scheduled to visible, AC-200). */
  readonly mutationId?: string;
  /** A delivery: how the event came, and its commit time `at` on the database's clock (ms since the epoch). */
  readonly via?: Via;
  readonly atMs?: number;
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
  /** The API's own handler time of each such request (`app` in `Server-Timing`). */
  readonly appMs: readonly number[];
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

/** The share of a hub user's edits that move a person to or from the hub (AC-206). */
export const HUB_MOVE_SHARE = 0.5;
/** The share of a hub user's opens that read the hub itself (AC-206). */
export const HUB_OPEN_SHARE = 0.2;
/** The hub's name after rename `round` (AC-206): a new one each round. `pnpm load:reset` puts the seed's back. */
export const hubName = (round: number): string => `Hub Company (renamed ${String(round + 1)})`;

/** The hub as the `hub` scenario's users see it (AC-206). */
export interface HubModel {
  readonly companyId: string;
  /** Companies' object id: a reference to a company names it. */
  readonly companiesObjectId: string;
  /** People's Company attribute: a move writes it (from the person's side, the side that holds one link). */
  readonly companyAttributeId: string;
  /** Companies' name attribute: the hub's renames write it. */
  readonly nameAttributeId: string;
  /** Live companies other than the hub, where a person moved off the hub goes. */
  readonly elsewhere: readonly string[];
}

/** One user's part of the hub: the model, and the hub's people it moves (each in the hub when the run starts). */
export interface HubUser {
  readonly model: HubModel;
  readonly people: readonly string[];
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
  /** The `hub` scenario's part (AC-206); absent in every other scenario. */
  readonly hub?: HubUser;
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

/**
 * What the live client asks of the user it rides with (milestone 3, AC-200):
 * what it holds now, and the reads a live change makes, each answering its
 * tally rather than recording a sample (the live client records it, with the
 * event's commit time).
 */
export interface Holder {
  readonly objectId: string;
  /** The columns a window reads (`attributeIds`): a refetch asks only for the changed ones among them. */
  readonly columns: ReadonlySet<string>;
  /** The ids in the window on screen. */
  readonly windowIds: () => ReadonlySet<string>;
  /** The attributes the view filters or sorts on: a change to one may reorder the window. */
  readonly viewAttributeIds: () => ReadonlySet<string>;
  /** `records.get` of held ids, with only `attributeIds`. */
  readonly refetch: (ids: readonly string[], attributeIds: readonly string[]) => Promise<Answered>;
  /** Reads the window on screen and the view's count again (a coarse event's reload, or a settle). */
  readonly reread: () => Promise<Answered>;
}

/** One simulated user. Neither method ever rejects: every failure becomes a sample. */
export interface LoadUser {
  /** Opens the object's plain view: its first window and its count. */
  readonly join: (scheduledAt: number, measured: boolean) => Promise<void>;
  /** One arrival of the mix. */
  readonly act: (action: LoadAction, scheduledAt: number, measured: boolean) => Promise<void>;
  /**
   * A storm burst's edit (AC-207): every online user edits a different
   * record in the same second, so each takes its own `slot` of the object's
   * samples (the manifest's ids spread over the whole object).
   */
  readonly burst: (scheduledAt: number, measured: boolean, slot: number) => Promise<void>;
  /** The hub's rename number `round` (AC-206), to `hubName(round)`. Only in `hub`. */
  readonly hubEdit: (scheduledAt: number, measured: boolean, round: number) => Promise<void>;
  readonly holder: Holder;
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
  /** Settles when the view's first window has answered (or failed): a scroll meanwhile waits for it. */
  loading: Promise<void>;
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
    const { call, answered } = createTally(options.now);
    const finish = (
      metric: Metric,
      action: LoadAction | 'join',
      scheduledAt: number,
      measured: boolean,
      mode?: 'position' | 'cursor',
      extras: Pick<Sample, 'burst' | 'mutationId' | 'hub'> = {},
    ) =>
      options.record({
        user: options.user,
        action,
        metric,
        ...(mode === undefined ? {} : { mode }),
        ...extras,
        scheduledAt,
        measured,
        ...answered(),
      });
    return { call, finish, answered };
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
      loading: Promise.resolve(),
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
    state.loading = (async () => {
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
    })();
    await state.loading;
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
        if (cursor === undefined) {
          // The window is the first half of a 200 row read, whose cursor names the block after the next: read on
          // from the nearest checkpoint, as the People table's windows do.
          await readForward(state, state.block + 1, reading.call);
          continue;
        }
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
  async function readForward(state: ViewState, target: number, call: TallyCall) {
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

  async function edit(scheduledAt: number, measured: boolean, slot?: number) {
    const writing = tally();
    const record = slot === undefined ? pickRecord() : slotRecord(slot);
    const attribute = random.pick(editable);
    const mutationId = options.mutationId();
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
          mutationId,
        },
        call,
      ),
    );
    writing.finish('edit', 'edit', scheduledAt, measured, undefined, {
      mutationId,
      ...(slot === undefined ? {} : { burst: true }),
    });
  }

  /** A burst's record: sample `slot` of the object, so no two users edit the same record in one burst. */
  function slotRecord(slot: number): { id: string; view?: RecordView } {
    const id = model.samples[slot % Math.max(model.samples.length, 1)] ?? random.pick(model.samples);
    const shown = (view?.window ?? []).find((record) => record.id === id);
    return shown === undefined ? { id } : { id, view: shown };
  }

  // The hub's people this user moves, and whether each is in the hub now (all are when the run starts). A person
  // whose move is in flight, or whose move failed (it may have landed after the timeout), is left out: moving it
  // again could write what it already holds, a no op that would read as a fast move.
  const inHub = new Map((options.hub?.people ?? []).map((id) => [id, true]));

  /**
   * Moves one of the user's people to or from the hub (AC-206): half the
   * moves each way, written from the person's Company. A person moved off
   * goes to another company; a move back links it to the hub again. Only
   * people whose place the user knows are moved.
   */
  async function hubMove(hub: HubUser, scheduledAt: number, measured: boolean) {
    const writing = tally();
    const toHub = random.chance(0.5);
    const known = [...inHub.keys()];
    const ready = known.filter((id) => inHub.get(id) !== toHub);
    const person = random.pick(ready.length > 0 ? ready : known);
    const goesToHub = inHub.get(person) !== true;
    inHub.delete(person);
    const target = goesToHub ? hub.model.companyId : random.pick(hub.model.elsewhere);
    const mutationId = options.mutationId();
    const answer = await writing.call((call) =>
      api.setValues(
        {
          workspace: options.workspace,
          recordId: person,
          values: {
            [hub.model.companyAttributeId]: { value: { objectId: hub.model.companiesObjectId, recordId: target } },
          },
          mutationId,
        },
        call,
      ),
    );
    if (answer.ok) inHub.set(person, goesToHub);
    writing.finish('edit', 'edit', scheduledAt, measured, undefined, { mutationId, hub: 'move' });
  }

  /** Opens the hub as a record page does (AC-206): the whole record, its Team as the first 20 links and the total. */
  async function hubOpen(hub: HubUser, scheduledAt: number, measured: boolean) {
    const reading = tally();
    await reading.call((call) => api.get({ workspace: options.workspace, ids: [hub.model.companyId] }, call));
    reading.finish('open', 'open', scheduledAt, measured, undefined, { hub: 'open' });
  }

  /**
   * Renames the hub (AC-206), each round to a name of its own, so a round
   * after a failed one never writes the name the hub already holds (a no op
   * that would read as a fast rename). `pnpm load:reset` puts the seed's back.
   */
  async function hubEdit(scheduledAt: number, measured: boolean, round: number) {
    const hub = options.hub;
    if (hub === undefined) return;
    const writing = tally();
    const mutationId = options.mutationId();
    await writing.call((call) =>
      api.setValues(
        {
          workspace: options.workspace,
          recordId: hub.model.companyId,
          values: { [hub.model.nameAttributeId]: { value: hubName(round) } },
          mutationId,
        },
        call,
      ),
    );
    writing.finish('edit', 'edit', scheduledAt, measured, undefined, { mutationId, hub: 'edit' });
  }

  async function create(scheduledAt: number, measured: boolean) {
    const writing = tally();
    const id = options.newId();
    const values = createValues(model.key, id, {
      attributes: model.attributes,
      memberIds: options.memberIds,
      memberId: options.memberId,
    });
    const mutationId = options.mutationId();
    await writing.call((call) => api.create({ ...base(), id, values: { ...values }, mutationId }, call));
    writing.finish('create', 'create', scheduledAt, measured, undefined, { mutationId });
  }

  async function act(action: LoadAction, scheduledAt: number, measured: boolean): Promise<void> {
    const state = view;
    switch (action) {
      case 'scroll': {
        // A scroll while the view's first window is still loading waits for it, as the screen does, rather than
        // asking again; then it scrolls whatever view the user holds by then.
        if (view !== undefined && view.window.length === 0) await view.loading;
        const held = view;
        if (held === undefined || held.window.length === 0) {
          await open(held?.shape ?? firstShape(), 'scroll', scheduledAt, measured);
        } else if (random.chance(behaviour.jumpShare)) {
          await jump(held, scheduledAt, measured);
        } else {
          await scroll(held, scheduledAt, measured);
        }
        return;
      }
      case 'filterSort': {
        const others = model.shapes.filter((shape) => shape.name !== state?.shape.name);
        await open(random.pick(others.length > 0 ? others : model.shapes), 'filterSort', scheduledAt, measured);
        return;
      }
      case 'open':
        if (options.hub !== undefined && random.chance(HUB_OPEN_SHARE))
          await hubOpen(options.hub, scheduledAt, measured);
        else await openRecord(scheduledAt, measured);
        return;
      case 'edit':
        if (options.hub !== undefined && inHub.size > 0 && random.chance(HUB_MOVE_SHARE)) {
          await hubMove(options.hub, scheduledAt, measured);
        } else {
          await edit(scheduledAt, measured);
        }
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

  /** The view's filter and sort attributes. */
  function viewAttributeIds(): ReadonlySet<string> {
    const shape = view?.shape;
    const ids = new Set<string>();
    for (const sort of shape?.sorts ?? []) ids.add(sort.attributeId);
    const visit = (group: FilterGroup | undefined) => {
      for (const condition of group?.conditions ?? []) {
        if ('conjunction' in condition) visit(condition);
        else if ('attributeId' in condition) ids.add(condition.attributeId);
        else if (condition.path[0] !== undefined) ids.add(condition.path[0]);
      }
    };
    visit(shape?.filter);
    return ids;
  }

  /** Reads the window on screen again, and the count beside it, as a reload or a settle does (spec 0006, AC-56). */
  async function reread(): Promise<Answered> {
    const reading = tally();
    const state = view;
    if (state === undefined) return reading.answered();
    const counted = reading
      .call(
        (call) =>
          api.count({ ...base(), ...(state.shape.filter === undefined ? {} : { filter: state.shape.filter }) }, call),
        state.countAbort.signal,
      )
      .then((answer) => {
        if (answer.ok && current(state)) state.total = answer.value.count;
      });
    const block = state.block;
    const cursor = state.checkpoints.get(block);
    if (state.position || block === 0 || cursor !== undefined) {
      const page = await reading.call((call) =>
        api.query(
          {
            ...base(),
            ...shapeInput(state.shape),
            limit: WINDOW_ROWS,
            ...(state.position ? { position: block * WINDOW_ROWS } : cursor === undefined ? {} : { cursor }),
          },
          call,
        ),
      );
      if (page.ok && current(state) && state.block === block) state.window = page.value.records;
    } else {
      // The window is the second half of a 200 row read: read on from the nearest checkpoint, as windows.ts does.
      await readForward(state, block, reading.call);
    }
    await counted;
    return reading.answered();
  }

  const columns: ReadonlySet<string> = new Set(model.columns);
  // The window's ids, made again only when the window changes: every live event asks for them.
  let windowIdsOf: { window: readonly RecordView[]; ids: ReadonlySet<string> } = { window: [], ids: new Set() };
  const holder: Holder = {
    objectId: model.objectId,
    columns,
    windowIds: () => {
      const window = view?.window ?? [];
      if (window !== windowIdsOf.window) windowIdsOf = { window, ids: new Set(window.map((record) => record.id)) };
      return windowIdsOf.ids;
    },
    viewAttributeIds,
    refetch: async (ids, attributeIds) => {
      const reading = tally();
      const state = view;
      const answer = await reading.call((call) =>
        api.get({ workspace: options.workspace, ids: [...ids], attributeIds: [...attributeIds] }, call),
      );
      // The refetched rows replace their copies in the window, as the store's revision rule would let them.
      if (answer.ok && state !== undefined && current(state)) {
        const fresh = new Map(answer.value.map((record) => [record.id, record]));
        const ids = windowIdsOf.window === state.window ? windowIdsOf.ids : undefined;
        state.window = state.window.map((record) => {
          const got = fresh.get(record.id);
          return got === undefined
            ? record
            : {
                ...record,
                values: { ...record.values, ...got.values },
                versions: { ...record.versions, ...got.versions },
              };
        });
        // The same rows with new values: the ids the live client asks for stay what they were.
        if (ids !== undefined) windowIdsOf = { window: state.window, ids };
      }
      return reading.answered();
    },
    reread,
  };

  return {
    join: (scheduledAt, measured) => open(firstShape(), 'join', scheduledAt, measured),
    act,
    burst: (scheduledAt, measured, slot) => edit(scheduledAt, measured, slot),
    hubEdit,
    holder,
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
