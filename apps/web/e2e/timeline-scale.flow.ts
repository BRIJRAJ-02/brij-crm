// The timeline at scale (spec 0017, AC-380, AC-388): on a seeded load
// workspace (`pnpm load:seed`, with `bench-activity.ts` run on it, so one deal
// holds 10,000 value versions), the time to open a record as #12 measures its
// `open` (one `records.get` for the record, end to end at the API, 30 warm
// tries), then that deal's Activity tab scrolled through 2,000 entries: the
// heap after garbage collection on the first page and every 500 entries, and
// the frame times over a scripted scroll at the feed perf test's speed (300 px
// a frame). It prints its numbers for verify.md. Skipped unless
// ACTIVITY_SLUG, ACTIVITY_EMAIL (a member who can sign in) and
// ACTIVITY_RECORD (the deal, or with ACTIVITY_OBJECT=companies the hub
// company) are set. Measure React's production build:
// `pnpm --filter @crm/web build`, then `vite preview --port 5173` in apps/web.
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { codeFor } from './mailpit.ts';

const SLUG = process.env.ACTIVITY_SLUG;
const EMAIL = process.env.ACTIVITY_EMAIL;
const RECORD = process.env.ACTIVITY_RECORD;
/** The record's object by its address: `deals` (the bench deal) unless named, `companies` for the hub. */
const OBJECT = process.env.ACTIVITY_OBJECT ?? 'deals';
/** How many entries to scroll through: 2,000 as AC-380 states, more with ACTIVITY_ENTRIES. */
const ENTRIES = Number(process.env.ACTIVITY_ENTRIES ?? 2_000);
const PX_PER_FRAME = 300;

test.skip(
  SLUG === undefined || EMAIL === undefined || RECORD === undefined,
  'Set ACTIVITY_SLUG, ACTIVITY_EMAIL and ACTIVITY_RECORD to run the timeline at scale.',
);
test.describe.configure({ timeout: 10 * 60_000 });

/** One measured line: printed for verify.md, and kept on the test's report. */
function report(line: string): void {
  test.info().annotations.push({ type: 'scale', description: line });
  process.stdout.write(`${line}\n`);
}

const percentile = (values: readonly number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
};

/** The heap in MB after a full garbage collection. */
async function heapMb(cdp: CDPSession): Promise<number> {
  await cdp.send('HeapProfiler.collectGarbage');
  const { usedSize } = await cdp.send('Runtime.getHeapUsage');
  return usedSize / 1_048_576;
}

async function signIn(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page).toHaveURL(/\/sign-in\?redirect=/);
  await page.getByLabel('Email').fill(EMAIL ?? '');
  await page.getByRole('button', { name: /^Continue( with email)?$/ }).click();
  await expect(page).toHaveURL(/\/verify/);
  await page.getByLabel('Code').fill(await codeFor(page.request, EMAIL ?? ''));
  await expect(page).toHaveURL(new RegExp(`${path}$`));
}

test('a record with a long history opens in budget and its timeline scrolls with flat memory', async ({
  page,
}, info) => {
  test.skip(info.project.name !== '1280', 'Measured at desktop width.');
  const path = `/w/${SLUG ?? ''}/objects/${OBJECT}/${RECORD ?? ''}/activity`;
  await signIn(page, path);
  const feed = page.getByRole('feed', { name: 'Activity' });
  await expect(feed.getByRole('article').first()).toBeVisible();

  // The open record budget (AC-388): one records.get for the record, as the load harness's open measures it.
  const origin = new URL(page.url()).origin;
  const opens: number[] = [];
  for (let run = 0; run < 33; run += 1) {
    const started = Date.now();
    const response = await page.request.post('/api/rpc/records/get', {
      data: { json: { workspace: SLUG, ids: [RECORD] } },
      headers: { origin },
    });
    expect(response.ok()).toBe(true);
    if (run >= 3) opens.push(Date.now() - started);
  }
  report(
    `open record (records.get, 30 warm): p50 ${String(percentile(opens, 50))} ms, p95 ${String(percentile(opens, 95))} ms`,
  );

  const cdp = await page.context().newCDPSession(page);
  const first = await heapMb(cdp);
  report(`heap after GC, first page: ${first.toFixed(1)} MB`);

  // Down through 2,000 entries as a person scrolls, pages arriving as it nears the end, with the heap every 500.
  let loaded = 0;
  let nextSample = 500;
  let most = first;
  for (let step = 0; step < 20_000 && loaded < ENTRIES; step += 1) {
    await feed.evaluate((element, by) => {
      element.scrollTop += by;
    }, PX_PER_FRAME);
    await page.waitForTimeout(16);
    // How far the scroll has reached: the last entry drawn (the set size is -1 while more pages wait).
    loaded = Number((await feed.getByRole('article').last().getAttribute('aria-posinset')) ?? 0);
    while (loaded >= nextSample) {
      const now = await heapMb(cdp);
      most = Math.max(most, now);
      report(`heap after GC, ${String(nextSample)} entries loaded: ${now.toFixed(1)} MB`);
      nextSample += 500;
    }
  }
  expect(loaded).toBeGreaterThanOrEqual(ENTRIES);
  const last = await heapMb(cdp);
  report(
    `heap after GC at ${String(loaded)} entries: at most ${most.toFixed(1)} MB, growth ${(last - first).toFixed(1)} MB`,
  );
  expect(most).toBeLessThan(200);
  expect(last - first).toBeLessThan(20);

  // Frames: from the top, 300 px every frame through everything loaded, timed between animation frames in the page.
  const frames = await feed.evaluate(async (element, by) => {
    element.scrollTop = 0;
    const next = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
    const times: number[] = [];
    let last = await next();
    while (element.scrollTop + element.clientHeight < element.scrollHeight - 1 && times.length < 5_000) {
      element.scrollTop += by;
      const now = await next();
      times.push(now - last);
      last = now;
    }
    return times;
  }, PX_PER_FRAME);
  const dropped = frames.filter((ms) => ms > 25).length;
  report(
    `scroll through ${String(loaded)} entries at ${String(PX_PER_FRAME)} px a frame: ${String(frames.length)} frames, p50 ${percentile(frames, 50).toFixed(1)} ms, p95 ${percentile(frames, 95).toFixed(1)} ms, max ${Math.max(...frames).toFixed(1)} ms, ${String(dropped)} dropped`,
  );
});
