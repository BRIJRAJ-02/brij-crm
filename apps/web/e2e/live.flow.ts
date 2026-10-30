// Live updates between two browsers (spec 0005, milestone 3, AC-38): one
// person signed in twice, in two browser contexts on the same workspace. The
// writer creates a person, edits a cell 20 times after a warm up write and
// adds a column; the other browser shows each change within a second at p95,
// timed from the writer's action to the change in the reader's page. The
// writer never fetches its own changes back. When the reader's connection
// drops, its table says live updates are paused, and the change it missed
// arrives once the connection is back. Set FLOW_SCREENSHOTS to a folder to
// keep pictures of both browsers (and the timings, as live-timings.json).
// FLOW_READER_BROWSER=webkit (or firefox) opens the reader in that engine,
// so the change crosses two browser engines (CI uses WebKit; the writer
// stays in the project's Chromium).
//
// Against production (verify.md, AC-38): FLOW_STATE names a saved signed in
// browser state and FLOW_SLUG its workspace; both browsers start from that
// state instead of signing in through Mailpit, and the person and the column
// carry the run's tag, so runs never clash. Use a workspace whose People
// table fits on one screen.
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, firefox, test, webkit, type Browser, type Page, type WebSocketRoute } from '@playwright/test';
import { addPerson, cellAt, checkScreen, chooseNewAttribute, newWorkspace, showColumn, signInAgain } from './people.ts';

const SHOTS = process.env.FLOW_SCREENSHOTS;
const REALTIME = /\/connection\/websocket/;
/** AC-38: a change reaches the other browser within 1 second at p95. */
const BUDGET_MS = 1000;
const EDITS = 20;
/** The reader's browser: the project's own (another context), or Firefox. */
const READER_BROWSER = process.env.FLOW_READER_BROWSER;
/** A saved signed in state and its workspace, for a run against a deployed app (no Mailpit there). */
const STATE = process.env.FLOW_STATE;
const STATE_SLUG = process.env.FLOW_SLUG;

/** The browser the reader opens in: WebKit or Firefox when FLOW_READER_BROWSER names one, else the writer's own. */
async function readerBrowser(
  writers: Browser,
): Promise<{ readonly browser: Browser; readonly close: () => Promise<void> }> {
  if (READER_BROWSER === undefined || READER_BROWSER === '')
    return { browser: writers, close: () => Promise.resolve() };
  const engines = { webkit, firefox } as const;
  if (READER_BROWSER !== 'webkit' && READER_BROWSER !== 'firefox') {
    throw new Error(`FLOW_READER_BROWSER is webkit, firefox or unset (got ${READER_BROWSER}).`);
  }
  const launched = await engines[READER_BROWSER].launch();
  return { browser: launched, close: () => launched.close() };
}

/** The p-th percentile of `values` (nearest rank). */
function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? Number.NaN;
}

/** Keeps a picture of `page` when FLOW_SCREENSHOTS asks. */
async function picture(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  await page.screenshot({ path: path.join(SHOTS, `${test.info().project.name}-live-${name}.png`) });
}

/** Resolves once `selector`'s text holds `text` in `page`, checked every frame; answers when (Date.now()). */
async function seen(page: Page, selector: string, text: string): Promise<number> {
  await page.waitForFunction(
    ([where, what]) => document.querySelector(where)?.textContent.includes(what) === true,
    [selector, text] as const,
    { polling: 'raf', timeout: 10_000 },
  );
  return Date.now();
}

/**
 * Puts the reader's Centrifugo connection behind a switch: `drop()` closes it
 * and refuses new ones until `restore()`. `subscribes()` counts Centrifugo's
 * subscribe replies, so the test knows when the reader is listening.
 */
async function realtimeSwitch(page: Page) {
  let current: { readonly page: WebSocketRoute; readonly server: WebSocketRoute } | undefined;
  let isBlocked = false;
  let subscribes = 0;
  await page.routeWebSocket(REALTIME, (socket) => {
    if (isBlocked) {
      void socket.close({ code: 4000, reason: 'offline in the test' });
      return;
    }
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      server.send(message);
    });
    server.onMessage((message) => {
      if (typeof message === 'string' && message.includes('"subscribe":{')) subscribes += 1;
      socket.send(message);
    });
    current = { page: socket, server };
  });
  return {
    subscribes: () => subscribes,
    drop: async () => {
      isBlocked = true;
      // 4000 to 4499: Centrifugo's "reconnect" range, as a dropped network looks to the client.
      await current?.page.close({ code: 4000, reason: 'offline in the test' });
      await current?.server.close();
      current = undefined;
    },
    restore: () => {
      isBlocked = false;
    },
  };
}

test.describe('live updates between two browsers', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The table flow runs at desktop width.');
  if ((STATE === undefined) !== (STATE_SLUG === undefined)) throw new Error('Set FLOW_STATE and FLOW_SLUG together.');
  if (STATE !== undefined) test.use({ storageState: STATE });

  test("shows the other browser's create, edits and new column within a second, and says when it is paused", async ({
    browser,
    page: writer,
  }, testInfo) => {
    test.setTimeout(180_000);
    if (SHOTS !== undefined) mkdirSync(SHOTS, { recursive: true });
    const tag = randomUUID().slice(0, 8);
    const email = `live-${tag}@example.com`;
    const slug = STATE_SLUG ?? `live-${tag}`;
    const people = `/w/${slug}/objects/people`;
    const lastName = `Hopper ${tag}`;
    const fullName = `Grace ${lastName}`;

    // The writer makes the workspace (or opens the saved one); the reader is the same person in another browser.
    const firstCode = STATE === undefined ? await newWorkspace(writer, email, slug) : undefined;
    if (STATE !== undefined) await writer.goto(people);
    const second = await readerBrowser(browser);
    const readerContext = await second.browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: testInfo.project.use.viewport ?? null,
      ...(STATE === undefined ? {} : { storageState: STATE }),
    });
    const reader = await readerContext.newPage();
    const realtime = await realtimeSwitch(reader);
    if (firstCode === undefined) await reader.goto(people);
    else await signInAgain(reader, email, people, [firstCode]);
    await expect(reader.getByRole('grid', { name: 'People' })).toBeVisible();
    if (STATE === undefined) await expect(reader.getByText('No people yet')).toBeVisible();
    await expect.poll(() => realtime.subscribes(), { message: "the reader's live subscription" }).toBeGreaterThan(0);
    // Live: nothing says otherwise.
    await expect(reader.getByText('Live updates paused')).toHaveCount(0);

    // The writer's own changes never come back to it as fetches.
    let writerRefetches = 0;
    writer.on('request', (request) => {
      if (request.url().includes('/api/rpc/records/get')) writerRefetches += 1;
    });

    // A created person: from Create in the writer to the row in the reader.
    const timings: { readonly change: string; readonly ms: number }[] = [];
    const readerGrid = reader.getByRole('grid', { name: 'People' });
    const nameColumn = await showColumn(reader, 'Name');
    const createdAt = Date.now();
    await addPerson(writer, 'Grace', lastName, `grace-${tag}@example.com`);
    timings.push({ change: 'create', ms: (await seen(reader, '[role="grid"]', fullName)) - createdAt });
    // The header, the new row and the footer ("+ New person" and the count).
    if (STATE === undefined) await expect(readerGrid).toHaveAttribute('aria-rowcount', '3');
    // Where the reader shows the new person (first in an empty table; somewhere on screen in a deployed one).
    const readerRow = await reader
      .locator(`[data-cell$=":${String(nameColumn)}"]`, { hasText: fullName })
      .first()
      .getAttribute('data-cell')
      .then((cell) => Number(cell?.split(':')[0]));
    await picture(writer, '1-writer-created');
    await picture(reader, '1-reader-created');

    // One warm up write, then 20 timed edits of one cell.
    const titleColumn = await showColumn(reader, 'Job title');
    const titleCell = `[data-cell="${String(readerRow)}:${String(titleColumn)}"]`;
    const edit = async (value: string): Promise<number> => {
      const cell = await cellAt(writer, 0, 'Job title');
      await cell.click();
      await writer.keyboard.type(value);
      const at = Date.now();
      await writer.keyboard.press('Enter');
      await expect(cell).toContainText(value);
      return (await seen(reader, titleCell, value)) - at;
    };
    await edit('Warm up');
    for (let index = 1; index <= EDITS; index += 1) {
      timings.push({ change: `edit ${String(index)}`, ms: await edit(`Admiral ${String(index)}`) });
    }
    await picture(writer, '2-writer-edited');
    await picture(reader, '2-reader-edited');

    // A new column: from Create in the writer's dialog to the column in the reader's grid. Once shown, it is
    // read for the loaded rows (spec 0006, AC-55): a fetch of that one attribute, not of the writer's changes.
    const echoRefetches = writerRefetches;
    const columns = Number(await readerGrid.getAttribute('aria-colcount'));
    await writer.getByRole('button', { name: 'Add attribute' }).first().click();
    await chooseNewAttribute(writer);
    const dialog = writer.getByRole('dialog', { name: 'New attribute' });
    await dialog.getByLabel('Name', { exact: true }).fill(`Nickname ${tag}`);
    const addedAt = Date.now();
    await dialog.getByRole('button', { name: 'Create attribute' }).click();
    await reader.waitForFunction(
      ([count]) => Number(document.querySelector('[role="grid"]')?.getAttribute('aria-colcount')) > count,
      [columns] as const,
      { polling: 'raf', timeout: 10_000 },
    );
    timings.push({ change: 'add column', ms: Date.now() - addedAt });
    await showColumn(reader, `Nickname ${tag}`);
    await picture(reader, '3-reader-column-added');

    // Within a second at p95 (AC-38), and nothing the writer did came back to it.
    const all = timings.map((timing) => timing.ms);
    const edits = timings.filter((timing) => timing.change.startsWith('edit')).map((timing) => timing.ms);
    const summary = {
      p50: percentile(all, 50),
      p95: percentile(all, 95),
      max: Math.max(...all),
      editsP95: percentile(edits, 95),
      timings,
    };
    testInfo.annotations.push({ type: 'live timings (ms)', description: JSON.stringify(summary) });
    if (SHOTS !== undefined)
      writeFileSync(path.join(SHOTS, `${testInfo.project.name}-live-timings.json`), JSON.stringify(summary, null, 2));
    expect(summary.p95, JSON.stringify(summary)).toBeLessThan(BUDGET_MS);
    expect(echoRefetches).toBe(0);
    expect(writerRefetches).toBeLessThanOrEqual(1);

    // The reader's connection drops: its table says live updates are paused.
    const readerTitle = await cellAt(reader, readerRow, 'Job title');
    const subscribesBefore = realtime.subscribes();
    await realtime.drop();
    await expect(reader.getByText('Live updates paused')).toBeVisible();
    await checkScreen(reader, 'live-paused');
    // A change made meanwhile reaches it once the connection is back (recovered from the channel's history).
    const missed = await cellAt(writer, 0, 'Job title');
    await missed.click();
    await writer.keyboard.type('While paused');
    await writer.keyboard.press('Enter');
    await expect(missed).toContainText('While paused');
    await expect(readerTitle).not.toContainText('While paused');
    realtime.restore();
    await expect.poll(() => realtime.subscribes(), { timeout: 30_000 }).toBeGreaterThan(subscribesBefore);
    await expect(readerTitle).toContainText('While paused');
    await expect(reader.getByText('Live updates paused')).toHaveCount(0);
    await picture(reader, '4-reader-back');

    await readerContext.close();
    await second.close();
  });
});
