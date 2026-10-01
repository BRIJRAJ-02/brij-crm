// AC-7: in a 1280 by 800 viewport, the grid with 100,000 rows and 20 columns
// draws its first screen in under 500 ms (the median of 3 runs) and never holds
// 100 or more rows in the DOM; a scripted scroll from top to bottom makes at
// most one long task, and none over 120 ms. Chromium only, on React's
// production build (the perf project). It logs its numbers on every run, so
// the budget can be tuned against real data; changing a threshold is a spec
// change.
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { createFixedClock } from '../../provider/clock.ts';
import { createToasts } from '../../provider/toasts.tsx';
import { UiProvider } from '../../provider/UiProvider.tsx';
import { sampleColumns, sampleRowAt, type SampleRow } from '../../workbench/grid-samples.ts';
import { DataGrid, type RowSource } from './DataGrid.tsx';

const ROWS = 100_000;
const COLUMNS = sampleColumns(20);
const FIRST_PAINT_BUDGET_MS = 500;
const LONG_TASK_BUDGET_MS = 120;
const SCROLL_STEPS = 60;
const SCROLL_DURATION_MS = 3000;

/** 100,000 companies made from their index: nothing is held, as with a real source. */
const source: RowSource<SampleRow> = { count: ROWS, getItem: sampleRowAt, getKey: (row) => row.id };

let root: Root | undefined;
let host: HTMLElement | undefined;

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Mounts the grid filling the viewport, and resolves with the milliseconds to its first painted screen. */
async function mount(): Promise<number> {
  host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;display:flex';
  document.body.append(host);
  root = createRoot(host);
  const started = performance.now();
  root.render(
    <UiProvider
      locale="en-US"
      timeZone="Europe/London"
      navigate={() => undefined}
      toasts={createToasts()}
      clock={createFixedClock(Date.UTC(2026, 9, 8, 14, 30))}
      platform="mac"
    >
      <DataGrid<SampleRow>
        label="Companies"
        columns={COLUMNS}
        pinnedCount={1}
        rows={source}
        getValue={(row, id) => row.values[id] ?? null}
        getDisplay={(row, id) => row.displays[id]}
        rowHeader="name"
      />
    </UiProvider>,
  );
  while (document.querySelector('[data-cell="0:1"]') === null) await frame();
  await frame();
  await frame();
  return performance.now() - started;
}

function unmount() {
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
}

const median = (values: readonly number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
const rowsInDom = () => document.querySelectorAll('[role="rowgroup"] [role="row"]').length;

describe('the grid at 100,000 rows (AC-7)', () => {
  beforeAll(async () => {
    await page.viewport(1280, 800);
  });

  it('measures React’s production build', () => {
    // The development build freezes every element's props; production doesn't.
    expect(Object.isFrozen(createElement('div', {}).props)).toBe(false);
  });

  afterEach(unmount);

  it('draws its first screen in under 500 ms, the median of 3 runs', async () => {
    const runs: number[] = [];
    for (let run = 0; run < 3; run += 1) {
      runs.push(await mount());
      unmount();
      await wait(50);
    }
    console.warn(
      `grid first paint, ms: ${runs.map((ms) => ms.toFixed(1)).join(', ')} (median ${median(runs).toFixed(1)})`,
    );
    expect(median(runs)).toBeLessThan(FIRST_PAINT_BUDGET_MS);
  });

  it('scrolls top to bottom with at most one long task, none over 120 ms, and under 100 rows in the DOM', async () => {
    await mount();
    const grid = document.querySelector<HTMLElement>('[role="grid"]');
    if (grid === null) throw new Error('No grid rendered.');
    const longTasks: number[] = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longTasks.push(entry.duration);
    });
    observer.observe({ type: 'longtask' });
    let mostRows = rowsInDom();
    const bottom = grid.scrollHeight - grid.clientHeight;
    for (let step = 1; step <= SCROLL_STEPS; step += 1) {
      grid.scrollTop = Math.round((bottom * step) / SCROLL_STEPS);
      await frame();
      mostRows = Math.max(mostRows, rowsInDom());
      await wait(SCROLL_DURATION_MS / SCROLL_STEPS - 16);
    }
    await frame();
    await frame();
    observer.disconnect();
    console.warn(
      `grid scroll: ${String(longTasks.length)} long task(s) [${longTasks.map((ms) => ms.toFixed(0)).join(', ')}] ms, at most ${String(mostRows)} rows in the DOM`,
    );
    expect(longTasks.length).toBeLessThanOrEqual(1);
    expect(Math.max(0, ...longTasks)).toBeLessThanOrEqual(LONG_TASK_BUDGET_MS);
    expect(mostRows).toBeLessThan(100);
    expect(document.querySelector(`[role="row"][aria-rowindex="${String(ROWS + 1)}"]`)).not.toBeNull();
  });
});
