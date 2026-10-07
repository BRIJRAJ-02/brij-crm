// The prototype gate's browser harness (AC-40). It draws the real DataGrid
// over 100,000 synthetic records, fed one of three ways: the grid's own
// baseline (rows made from their index, as in its 100,000 row story), the
// plain store, or the TanStack DB store, both behind the same windows and
// view. measure.ts builds it with React's production build and drives
// `window.gate` from Playwright.
import '@crm/ui/styles.css';
import { createToasts, UiProvider } from '@crm/ui';
import { DataGrid, type RowSource } from '@crm/ui/grid';
import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { createPlainStore } from '../../src/records/plain-store.ts';
import type { RecordStore } from '../../src/records/store.ts';
import { createTanstackStore } from '../tanstack-store.ts';
import { createRecordView, type RecordViewStore } from '../../src/records/view.ts';
import { createWindows, type Windows } from '../../src/records/windows.ts';
import { COLUMNS, idAt, queryRecords, recordAt, type SyntheticRecord } from './synthetic.ts';

/**
 * Which source feeds the grid. `held` is a control: the baseline grid while
 * the page holds all 100,000 records in a plain Map, to tell the cost of
 * holding the records apart from the cost of the store holding them.
 */
export type GateKind = 'baseline' | 'held' | 'plain' | 'tanstack';

/** Frame intervals while scrolling, in ms. */
export interface FrameStats {
  readonly frames: number;
  readonly meanMs: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  /** Intervals over 1.5 frames (25 ms): each is at least one dropped frame. */
  readonly dropped: number;
  readonly longTasks: readonly number[];
  readonly mostRowsInDom: number;
}

/** What the gate measures in the page. */
export interface Gate {
  readonly mount: (kind: GateKind, latencyMs: number) => Promise<number>;
  readonly scrollSmooth: (seconds: number, pixelsPerSecond: number) => Promise<FrameStats>;
  readonly scrollSteps: (steps: number, durationMs: number) => Promise<FrameStats>;
  readonly scrollWhole: () => Promise<{
    readonly ms: number;
    readonly storeSize: number;
    readonly blocksLoaded: number;
  }>;
  readonly patch: (
    runs: number,
  ) => Promise<{ readonly storeMs: readonly number[]; readonly renderedMs: readonly number[] }>;
  readonly edits: () => Promise<EditResults>;
}

/** The edit checks: timings, and whether each rule held, in the store and on screen. */
export interface EditResults {
  readonly applyMs: number;
  readonly rollbackMs: number;
  readonly appliedOnScreen: boolean;
  readonly rollbackExact: boolean;
  readonly rollbackOnScreen: boolean;
  readonly secondEditKept: boolean;
  readonly secondEditKeptOtherCell: boolean;
  readonly refusalKeepsLaterLayer: boolean;
}

declare global {
  interface Window {
    gate?: Gate;
  }
}

const COUNT = 100_000;
// Domain: a text cell near the left, so it's drawn at 1280 px (columns past 12 virtualise).
const DOMAIN_COLUMN = COLUMNS.findIndex((column) => column.id === 'domain') + 1;

const frame = () =>
  new Promise<number>((resolve) => {
    requestAnimationFrame(resolve);
  });
const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
const rowsInDom = () => document.querySelectorAll('[role="rowgroup"] [role="row"]').length;
const cellText = (row: number, col: number) =>
  document.querySelector(`[data-cell="${String(row)}:${String(col)}"]`)?.textContent ?? '';
const valuesOf = (row: SyntheticRecord | undefined) =>
  JSON.stringify(row === undefined ? undefined : { id: row.id, values: row.values, displays: row.displays });

const sorted = (values: readonly number[]) => [...values].sort((a, b) => a - b);
const at = (values: readonly number[], share: number) =>
  sorted(values)[Math.min(values.length - 1, Math.floor(values.length * share))] ?? 0;

interface Mounted {
  readonly store?: RecordStore<SyntheticRecord>;
  readonly windows?: Windows;
  readonly view?: RecordViewStore<SyntheticRecord>;
  readonly held?: ReadonlyMap<string, SyntheticRecord>;
}

let mounted: Mounted = {};

function grid(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[role="grid"]');
  if (element === null) throw new Error('No grid rendered.');
  return element;
}

const baseline: RowSource<SyntheticRecord> = {
  count: COUNT,
  getItem: (index) => recordAt(index),
  getKey: (row) => row.id,
};

function Table({ view }: { readonly view: RecordViewStore<SyntheticRecord> }) {
  const source = useSyncExternalStore(view.subscribe, view.getSnapshot);
  return <People rows={source} />;
}

function People({ rows }: { readonly rows: RowSource<SyntheticRecord> }) {
  return (
    <DataGrid<SyntheticRecord>
      label="People"
      columns={COLUMNS}
      pinnedCount={1}
      rows={rows}
      getValue={(row, id) => row.values[id] ?? null}
      getDisplay={(row, id) => row.displays[id]}
      rowHeader="name"
    />
  );
}

/** Watches frames and long tasks while `drive` scrolls the grid. */
async function watchFrames(drive: (grid: HTMLElement) => Promise<void>): Promise<FrameStats> {
  const element = grid();
  const longTasks: number[] = [];
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) longTasks.push(entry.duration);
  });
  observer.observe({ type: 'longtask' });
  const intervals: number[] = [];
  const watch = { on: true };
  let mostRows = rowsInDom();
  void (async () => {
    let last = await frame();
    while (watch.on) {
      const now = await frame();
      intervals.push(now - last);
      last = now;
      mostRows = Math.max(mostRows, rowsInDom());
    }
  })();
  await drive(element);
  await frame();
  await frame();
  watch.on = false;
  observer.disconnect();
  const total = intervals.reduce((sum, each) => sum + each, 0);
  return {
    frames: intervals.length,
    meanMs: intervals.length === 0 ? 0 : total / intervals.length,
    p95Ms: at(intervals, 0.95),
    maxMs: Math.max(0, ...intervals),
    dropped: intervals.filter((each) => each > 25).length,
    longTasks,
    mostRowsInDom: mostRows,
  };
}

const gate: Gate = {
  mount: async (kind, latencyMs) => {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;display:flex';
    document.body.append(host);
    const root = createRoot(host);
    const started = performance.now();
    if (kind === 'baseline' || kind === 'held') {
      mounted =
        kind === 'held'
          ? { held: new Map(Array.from({ length: COUNT }, (_, index) => [idAt(index), recordAt(index)] as const)) }
          : {};
      root.render(
        <UiProvider
          locale="en-US"
          timeZone="Europe/London"
          navigate={() => undefined}
          toasts={createToasts()}
          platform="mac"
        >
          <People rows={baseline} />
        </UiProvider>,
      );
    } else {
      const store = kind === 'plain' ? createPlainStore<SyntheticRecord>() : createTanstackStore<SyntheticRecord>();
      const windows = createWindows({
        count: COUNT,
        load: async (offset, limit, signal) => {
          const rows = await queryRecords(offset, limit, COUNT, latencyMs, signal);
          store.receive(rows);
          return rows.map((row) => row.id);
        },
      });
      const view = createRecordView({ store, windows });
      mounted = { store, windows, view };
      root.render(
        <UiProvider
          locale="en-US"
          timeZone="Europe/London"
          navigate={() => undefined}
          toasts={createToasts()}
          platform="mac"
        >
          <Table view={view} />
        </UiProvider>,
      );
    }
    // First paint with rows: the first name cell has text.
    while (cellText(0, 1) === '') await frame();
    await frame();
    return performance.now() - started;
  },

  scrollSmooth: (seconds, pixelsPerSecond) =>
    watchFrames(async (element) => {
      const start = performance.now();
      const from = element.scrollTop;
      for (;;) {
        const now = await frame();
        const elapsed = (now - start) / 1000;
        if (elapsed >= seconds) break;
        element.scrollTop = from + elapsed * pixelsPerSecond;
      }
    }),

  // AC-7's scripted scroll: top to bottom in `steps` jumps over `durationMs`.
  scrollSteps: (steps, durationMs) =>
    watchFrames(async (element) => {
      element.scrollTop = 0;
      await frame();
      const bottom = element.scrollHeight - element.clientHeight;
      for (let step = 1; step <= steps; step += 1) {
        element.scrollTop = Math.round((bottom * step) / steps);
        await frame();
        await wait(durationMs / steps - 16);
      }
    }),

  // Every block, top to bottom, waiting for each to load: the store ends up holding every record.
  scrollWhole: async () => {
    const element = grid();
    const { windows, store } = mounted;
    const started = performance.now();
    const bottom = element.scrollHeight - element.clientHeight;
    const blocks = Math.ceil(COUNT / 100);
    for (let block = 0; block <= blocks; block += 1) {
      element.scrollTop = Math.round((bottom * Math.min(block, blocks)) / blocks);
      await frame();
      await frame();
      while (windows !== undefined && windows.stats().loading > 0) await frame();
    }
    return {
      ms: performance.now() - started,
      storeSize: store?.size() ?? mounted.held?.size ?? 0,
      blocksLoaded: windows?.stats().loaded ?? 0,
    };
  },

  // 50 records from one event's refetch: half on screen, half loaded off screen.
  patch: async (runs) => {
    const { store } = mounted;
    if (store === undefined) throw new Error('The baseline has no store to patch.');
    const element = grid();
    element.scrollTop = 0;
    await frame();
    while (cellText(0, 1) === '') await frame();
    const storeMs: number[] = [];
    const renderedMs: number[] = [];
    const indexes = [
      ...Array.from({ length: 25 }, (_, index) => index),
      ...Array.from({ length: 25 }, (_, index) => 100 + index * 3),
    ];
    for (let run = 0; run < runs; run += 1) {
      // The store and its notice alone (React renders later, in its own task)...
      const quiet = indexes.map((index) => recordAt(index, { domain: `quiet-${String(run)}.com` }));
      let started = performance.now();
      store.receive(quiet);
      storeMs.push(performance.now() - started);
      await frame();
      // ...then the store with the grid re-rendering in the same task, as one event's patch lands.
      const rows = indexes.map((index) =>
        recordAt(index, { domain: `patched-${String(run)}.com`, fit: (run % 5) + 1 }),
      );
      started = performance.now();
      flushSync(() => {
        store.receive(rows);
      });
      renderedMs.push(performance.now() - started);
      if (!cellText(0, DOMAIN_COLUMN).includes(`patched-${String(run)}.com`))
        throw new Error('The patch never reached the screen.');
      await frame();
    }
    return { storeMs, renderedMs };
  },

  edits: async () => {
    const { store } = mounted;
    if (store === undefined) throw new Error('The baseline has no store to edit.');
    const element = grid();
    element.scrollTop = 0;
    await frame();
    while (cellText(3, 1) === '') await frame();
    const row = 3;
    const id = idAt(row);
    const before = valuesOf(store.get(id));
    const beforeText = cellText(row, DOMAIN_COLUMN);

    let started = performance.now();
    const layer = flushSync(() => store.edit(id, { domain: 'edited.com' }, 'm-1'));
    const applyMs = performance.now() - started;
    const appliedOnScreen = cellText(row, DOMAIN_COLUMN).includes('edited.com');
    started = performance.now();
    flushSync(() => {
      layer.refuse();
    });
    const rollbackMs = performance.now() - started;
    const rollbackExact = valuesOf(store.get(id)) === before;
    const rollbackOnScreen = cellText(row, DOMAIN_COLUMN) === beforeText;

    // A confirmation while a second edit to the same cell is in flight keeps the second showing.
    const first = store.edit(id, { domain: 'first.com' }, 'm-2');
    const second = store.edit(id, { domain: 'second.com' }, 'm-3');
    flushSync(() => {
      first.confirm(recordAt(row, { domain: 'first.com' }));
    });
    const secondEditKept =
      cellText(row, DOMAIN_COLUMN).includes('second.com') && store.get(id)?.values.domain === 'second.com';
    flushSync(() => {
      second.confirm(recordAt(row, { domain: 'second.com' }));
    });

    // The same, with the second edit on another cell, and the confirmation carrying a change from elsewhere.
    const third = store.edit(id, { domain: 'third.com' }, 'm-4');
    const fourth = store.edit(id, { fit: 1 }, 'm-5');
    flushSync(() => {
      third.confirm(recordAt(row, { domain: 'third.com', employees: '7' }));
    });
    const shown = store.get(id)?.values;
    const secondEditKeptOtherCell = shown?.domain === 'third.com' && shown.fit === 1 && shown.employees === '7';
    flushSync(() => {
      fourth.refuse();
    });

    // A refusal while a later edit on the same record is in flight takes back only its own change.
    const base = valuesOf(store.get(id));
    const fifth = store.edit(id, { domain: 'fifth.com' }, 'm-6');
    const sixth = store.edit(id, { fit: 2 }, 'm-7');
    flushSync(() => {
      fifth.refuse();
    });
    const afterRefusal = store.get(id)?.values;
    const refusalKeepsLaterLayer = afterRefusal?.domain === 'third.com' && afterRefusal.fit === 2;
    flushSync(() => {
      sixth.refuse();
    });
    return {
      applyMs,
      rollbackMs,
      appliedOnScreen,
      rollbackExact,
      rollbackOnScreen,
      secondEditKept,
      secondEditKeptOtherCell,
      refusalKeepsLaterLayer: refusalKeepsLaterLayer && valuesOf(store.get(id)) === base,
    };
  },
};

window.gate = gate;
