// The million record proof (spec 0006, AC-52, AC-54): on the local scale
// seed (`pnpm db:seed:scale`, 1,000,000 deals), 20 scrollbar jumps timed until
// the right rows show, the heap after garbage collection sampled every 50,000
// rows while the whole view is scrolled by position, the same through 10,000
// rows of a view paged by cursor, and frame times over a scripted scroll at
// the grid story's speed (60 steps in 3 seconds). It prints its numbers for
// verify.md. Skipped unless SCALE_SLUG names the seeded workspace and
// SCALE_EMAIL a member of it who can sign in (`member:add`). Measure React's
// production build: `pnpm --filter @crm/web build`, then `vite preview --port
// 5173` in apps/web (it proxies /api like the dev server); the dev server's
// development React is several times slower and drops frames on its own.
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { codeFor } from './mailpit.ts';

const SLUG = process.env.SCALE_SLUG;
const EMAIL = process.env.SCALE_EMAIL;
const ROW = 34;

test.skip(SLUG === undefined || EMAIL === undefined, 'Set SCALE_SLUG and SCALE_EMAIL to run the scale proof.');
test.describe.configure({ timeout: 20 * 60_000 });

/** One measured line: printed for verify.md, and kept on the test's report. */
function report(line: string): void {
  test.info().annotations.push({ type: 'scale', description: line });
  process.stdout.write(`${line}\n`);
}

/** The nth percentile of `values`. */
const percentile = (values: readonly number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
};

/** Record reads that didn't answer 200, as `status path`. */
const failures: string[] = [];

async function signIn(page: Page): Promise<void> {
  page.on('response', (response) => {
    if (response.url().includes('/api/rpc/records/') && response.status() !== 200) {
      failures.push(`${String(response.status())} ${new URL(response.url()).pathname}`);
    }
  });
  await page.goto(`/w/${SLUG ?? ''}/objects/deals`);
  await expect(page).toHaveURL(/\/sign-in\?redirect=/);
  await page.getByLabel('Email').fill(EMAIL ?? '');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL(/\/verify/);
  await page.getByLabel('Code').fill(await codeFor(page.request, EMAIL ?? ''));
  await expect(page).toHaveURL(/\/objects\/deals$/);
  await expect(page.getByRole('grid', { name: 'Deals' })).toBeVisible();
}

/** The heap in MB after a full garbage collection. */
async function heapMb(cdp: CDPSession): Promise<number> {
  await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = await cdp.send('Runtime.getHeapUsage');
  return usedSize / 1_048_576;
}

/** Scrolls the grid so `row` is at the top, and waits until its row header shows its value, not a skeleton. */
async function showRow(page: Page, row: number): Promise<number> {
  const started = await page.evaluate(
    ({ row: target, height }) => {
      const grid = document.querySelector<HTMLElement>('[role="grid"]');
      if (grid === null) throw new Error('No grid.');
      // Past 15 million px of rows the grid scales scroll positions (DataGrid's MAX_BODY): undo that here.
      const rows = (Number(grid.getAttribute('aria-rowcount') ?? '1') - 1) * height;
      const range = grid.scrollHeight - grid.clientHeight;
      const scale = rows <= 15_000_000 ? 1 : (rows - 15_000_000 + range) / range;
      grid.scrollTop = (target * height) / scale;
      return performance.now();
    },
    { row, height: ROW },
  );
  try {
    await page.waitForFunction(
      (target) => {
        const cell = document.querySelector(`[data-cell="${String(target)}:1"]`);
        // Loaded: drawn, with no skeleton (a deal may have no name, so its cell can be empty).
        return cell !== null && cell.querySelector('[data-shape]') === null;
      },
      row,
      { timeout: 30_000, polling: 'raf' },
    );
  } catch (error) {
    const loading = await page.evaluate(() =>
      [...document.querySelectorAll('[role="rowheader"]')]
        .filter((cell) => cell.querySelector('[data-shape]') !== null)
        .map((cell) => cell.getAttribute('data-cell')),
    );
    report(`stuck at row ${String(row)}; rows still loading: ${loading.join(', ')}; answers: ${failures.join(' ')}`);
    throw error;
  }
  return page.evaluate((since) => performance.now() - since, started);
}

/** Scrolls top to bottom in `steps` steps over `ms`, as the grid story does, and answers each frame's time. */
async function scriptedScroll(page: Page, steps: number, ms: number): Promise<number[]> {
  return page.evaluate(
    async ({ steps: count, ms: duration }) => {
      const grid = document.querySelector<HTMLElement>('[role="grid"]');
      if (grid === null) throw new Error('No grid.');
      const frames: number[] = [];
      let last = performance.now();
      let running = true;
      const tick = (now: number) => {
        frames.push(now - last);
        last = now;
        if (running) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      const bottom = grid.scrollHeight - grid.clientHeight;
      for (let step = 1; step <= count; step += 1) {
        grid.scrollTop = Math.round((bottom * step) / count);
        await new Promise((resolve) => setTimeout(resolve, duration / count));
      }
      running = false;
      return frames.slice(1);
    },
    { steps, ms },
  );
}

test('jumps, memory and frames on a million records (AC-52, AC-54)', async ({ page }) => {
  await signIn(page);
  const cdp = await page.context().newCDPSession(page);
  const count = await page.evaluate(
    () => Number(document.querySelector('[role="grid"]')?.getAttribute('aria-rowcount') ?? '0') - 1,
  );
  report(`rows: ${String(count)}`);

  // AC-52: 20 jumps to rows spread over the view, each timed until its rows show.
  const jumps: number[] = [];
  for (let jump = 0; jump < 20; jump += 1) {
    const row = Math.floor(((jump * 7919) % 20) * (count / 20) + ((jump * 1013) % 997));
    jumps.push(await showRow(page, Math.min(count - 30, row)));
  }
  const at600k = await showRow(page, Math.min(count - 30, 600_000));
  report(
    `jumps: p50 ${percentile(jumps, 50).toFixed(0)} ms, p95 ${percentile(jumps, 95).toFixed(0)} ms, max ${Math.max(...jumps).toFixed(0)} ms; row 600,000 ${at600k.toFixed(0)} ms`,
  );

  // AC-54: frame times over the story's scripted scroll (60 steps in 3 s), top to bottom.
  await showRow(page, 0);
  const frames = await scriptedScroll(page, 60, 3000);
  report(
    `frames (position): ${String(frames.length)}, p95 ${percentile(frames, 95).toFixed(1)} ms, max ${Math.max(...frames).toFixed(1)} ms`,
  );

  // AC-54: the whole view by position, the heap after collection every 50,000 rows.
  await showRow(page, 0);
  const heap: [number, number][] = [[0, await heapMb(cdp)]];
  const stride = 2_000;
  for (let row = Number(process.env.SCALE_FROM ?? stride); row < count - 30; row += stride) {
    await showRow(page, row);
    if (row % 50_000 === 0) heap.push([row, await heapMb(cdp)]);
  }
  heap.push([count, await heapMb(cdp)]);
  const after50k = heap.filter(([row]) => row >= 50_000).map(([, mb]) => mb);
  report(`heap (position): ${heap.map(([row, mb]) => `${String(row)}=${mb.toFixed(1)}`).join(' ')}`);
  report(
    `heap (position): max ${Math.max(...heap.map(([, mb]) => mb)).toFixed(1)} MB, growth after 50,000 rows ${(Math.max(...after50k) - Math.min(...after50k)).toFixed(1)} MB`,
  );

  // A view that pages by cursor: sorted by a member column (Owner), from the column menu.
  await showRow(page, 0);
  const firstBefore = await page.locator('[data-cell="0:1"]').textContent();
  const owner = page.getByRole('columnheader', { name: /Owner/ });
  await owner.scrollIntoViewIfNeeded();
  await owner.click();
  await page.keyboard.press('Alt+ArrowDown');
  await page.getByRole('menuitem', { name: 'Sort ascending' }).click();
  // The new order's first rows replace the old ones once they are in.
  await page.waitForFunction((before) => {
    const cell = document.querySelector('[data-cell="0:1"]');
    return cell !== null && cell.querySelector('[data-shape]') === null && cell.textContent !== before;
  }, firstBefore);
  const cursorHeap: [number, number][] = [[0, await heapMb(cdp)]];
  const cursorSteps: number[] = [];
  for (let row = 100; row <= 10_000; row += 100) {
    cursorSteps.push(await showRow(page, row));
    if (row % 2_000 === 0) cursorHeap.push([row, await heapMb(cdp)]);
  }
  report(`heap (cursor): ${cursorHeap.map(([row, mb]) => `${String(row)}=${mb.toFixed(1)}`).join(' ')}`);
  report(
    `cursor blocks: p50 ${percentile(cursorSteps, 50).toFixed(0)} ms, p95 ${percentile(cursorSteps, 95).toFixed(0)} ms`,
  );
  await showRow(page, 0);
  const cursorFrames = await scriptedScroll(page, 60, 3000);
  report(
    `frames (cursor): ${String(cursorFrames.length)}, p95 ${percentile(cursorFrames, 95).toFixed(1)} ms, max ${Math.max(...cursorFrames).toFixed(1)} ms`,
  );

  expect(percentile(jumps, 95)).toBeLessThan(1000);
  // Frame times are the gaps between animation frames, which sit on the 60 Hz beat (16.7 ms) with up to a
  // millisecond of jitter; a dropped frame shows as 33 ms. So the p95 must stay on the beat.
  expect(percentile(frames, 95)).toBeLessThan(17.7);
  expect(percentile(cursorFrames, 95)).toBeLessThan(17.7);
  expect(Math.max(...cursorHeap.map(([, mb]) => mb))).toBeLessThan(200);
  expect(Math.max(...heap.map(([, mb]) => mb))).toBeLessThan(200);
  expect(Math.max(...after50k) - Math.min(...after50k)).toBeLessThan(30);
});
