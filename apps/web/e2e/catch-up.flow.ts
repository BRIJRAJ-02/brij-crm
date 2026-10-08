// Catch up after a long drop (spec 0007, milestone 1, AC-72 and AC-75): one
// person signed in twice, in two browser contexts on the same workspace. The
// reader's Centrifugo connection drops; meanwhile the writer makes 150 edits
// across 40 people and adds a column, through the API. When the reader's
// connection comes back, Centrifugo can't recover what it missed, and the
// reader catches up from the outbox (`realtime.catchUp`): every change shows
// with no page reload, and the only rows it fetches again are rows that
// changed.
//
// By default Centrifugo loses the history by the reader's reconnect naming an
// epoch it never had, as after a Centrifugo restart (AC-75), so the flow runs
// in a minute. FLOW_LONG=1 keeps the reader offline for 6 minutes instead,
// past Centrifugo's 5 minute history, as AC-72 states it.
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test, type Page, type Request, type WebSocketRoute } from '@playwright/test';
import { newWorkspace, showColumn, signInAgain } from './people.ts';

const REALTIME = /\/connection\/websocket/;
const LONG = process.env.FLOW_LONG === '1';
const PEOPLE_COUNT = 40;
const EDITS = 150;
/**
 * AC-72 asks for every change within 2 seconds of reconnecting. An unrecovered
 * resubscribe first waits a random 0 to 2 seconds (AC-75), so the bound here
 * is both together.
 */
const BUDGET_MS = 4_000;

/** A UUID v7 from the clock, as the browser mints one (the API refuses others for a record). */
function uuidv7(): string {
  const time = Date.now().toString(16).padStart(12, '0');
  const random = randomBytes(10).toString('hex');
  const variant = ((Number.parseInt(random.slice(3, 4), 16) & 0x3) | 0x8).toString(16);
  return `${time.slice(0, 8)}-${time.slice(8, 12)}-7${random.slice(0, 3)}-${variant}${random.slice(4, 7)}-${random.slice(7, 19)}`;
}

/** Calls one oRPC procedure as the page's signed in person, from the app's own origin. */
async function rpc(page: Page, procedure: string, input: unknown): Promise<unknown> {
  const origin = new URL(page.url()).origin;
  const response = await page.request.post(`/api/rpc/${procedure}`, {
    data: { json: input },
    headers: { origin },
  });
  expect(response.ok(), `${procedure}: ${await response.text()}`).toBe(true);
  return ((await response.json()) as { json: unknown }).json;
}

/**
 * Puts the reader's Centrifugo connection behind a switch: `drop()` closes it
 * and refuses new ones until `restore()`. With `forget`, the next subscribe
 * names an epoch Centrifugo never had, so it can't recover (as after a
 * restart). `subscribed()` answers when Centrifugo last confirmed a subscribe.
 */
async function realtimeSwitch(page: Page) {
  let current: { readonly page: WebSocketRoute; readonly server: WebSocketRoute } | undefined;
  let isBlocked = false;
  let forgetting = false;
  let subscribes = 0;
  let subscribedAt = 0;
  let recovered: boolean | undefined;
  await page.routeWebSocket(REALTIME, (socket) => {
    if (isBlocked) {
      void socket.close({ code: 4000, reason: 'offline in the test' });
      return;
    }
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      server.send(
        forgetting && typeof message === 'string'
          ? message.replace(/"epoch":"[^"]*"/g, '"epoch":"lost-in-the-test"')
          : message,
      );
    });
    server.onMessage((message) => {
      if (typeof message === 'string' && message.includes('"subscribe":{')) {
        subscribes += 1;
        subscribedAt = Date.now();
        recovered = message.includes('"recovered":true');
      }
      socket.send(message);
    });
    current = { page: socket, server };
  });
  return {
    subscribes: () => subscribes,
    subscribedAt: () => subscribedAt,
    recovered: () => recovered,
    drop: async () => {
      isBlocked = true;
      await current?.page.close({ code: 4000, reason: 'offline in the test' });
      await current?.server.close();
      current = undefined;
    },
    restore: (forget: boolean) => {
      forgetting = forget;
      isBlocked = false;
    },
  };
}

test.describe('catch up after a long drop', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The table flow runs at desktop width.');

  test('shows every change made while away, from the outbox, with no reload and no refetch of unchanged rows', async ({
    browser,
    page: writer,
  }, testInfo) => {
    test.setTimeout(LONG ? 600_000 : 180_000);
    const tag = randomUUID().slice(0, 8);
    const email = `catch-up-${tag}@example.com`;
    const slug = `catch-up-${tag}`;
    const peoplePath = `/w/${slug}/objects/people`;
    await newWorkspace(writer, email, slug);

    // Forty people, through the API.
    const objects = (await rpc(writer, 'objects/list', { workspace: slug })) as { id: string; apiSlug: string }[];
    const people = objects.find((object) => object.apiSlug === 'people');
    if (people === undefined) throw new Error('A new workspace has People.');
    const attributes = (await rpc(writer, 'attributes/list', { workspace: slug, objectId: people.id })) as {
      id: string;
      apiSlug: string;
    }[];
    const attribute = (apiSlug: string) => {
      const found = attributes.find((each) => each.apiSlug === apiSlug);
      if (found === undefined) throw new Error(`People has no ${apiSlug}.`);
      return found.id;
    };
    const ids = Array.from({ length: PEOPLE_COUNT }, () => uuidv7());
    for (const [index, id] of ids.entries()) {
      await rpc(writer, 'records/create', {
        workspace: slug,
        objectId: people.id,
        id,
        values: { [attribute('name')]: { firstName: `P${String(index)}`, lastName: 'Test' } },
        mutationId: randomUUID(),
      });
    }

    // The reader opens People and listens.
    const readerContext = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: testInfo.project.use.viewport ?? null,
    });
    const reader = await readerContext.newPage();
    const realtime = await realtimeSwitch(reader);
    await signInAgain(reader, email, peoplePath, []);
    const grid = reader.getByRole('grid', { name: 'People' });
    await expect(grid).toHaveAttribute('aria-rowcount', String(PEOPLE_COUNT + 1));
    await expect.poll(() => realtime.subscribes()).toBeGreaterThan(0);

    // Away: 150 edits across the forty, and a new column.
    await realtime.drop();
    await expect(reader.getByText('Live updates are paused')).toBeVisible();
    const finalTitle = new Map<number, string>();
    for (let edit = 0; edit < EDITS; edit += 1) {
      // Thirty of the forty change; the last ten stay as they were, so a refetch of one would show.
      const index = (edit * 7) % 30;
      const value = `Edit ${String(edit)}`;
      finalTitle.set(index, value);
      await rpc(writer, 'records/setValues', {
        workspace: slug,
        recordId: ids[index],
        values: { [attribute('job_title')]: { value } },
        mutationId: randomUUID(),
      });
    }
    const columns = Number(await grid.getAttribute('aria-colcount'));
    await rpc(writer, 'attributes/create', {
      workspace: slug,
      objectId: people.id,
      title: 'Nickname',
      type: 'text',
      mutationId: randomUUID(),
    });
    if (LONG) await reader.waitForTimeout(6 * 60_000);

    // Back: what the reader asks for from here on, and no navigation.
    const asked: Request[] = [];
    reader.on('request', (request) => {
      if (request.url().includes('/api/rpc/')) asked.push(request);
    });
    let navigations = 0;
    reader.on('framenavigated', (frame) => {
      if (frame === reader.mainFrame()) navigations += 1;
    });
    const before = realtime.subscribes();
    realtime.restore(!LONG);
    await expect.poll(() => realtime.subscribes(), { timeout: 60_000 }).toBeGreaterThan(before);
    const back = realtime.subscribedAt();
    expect(realtime.recovered(), 'Centrifugo could not recover the drop').toBe(false);

    // Every change shows: the new column, and each visible person's last title.
    await reader.waitForFunction(
      ([count]) => Number(document.querySelector('[role="grid"]')?.getAttribute('aria-colcount')) > count,
      [columns] as const,
      { polling: 'raf', timeout: 10_000 },
    );
    const nameColumn = await showColumn(reader, 'Name');
    const titleColumn = await showColumn(reader, 'Job title');
    await expect
      .poll(
        async () => {
          const wrong: string[] = [];
          for (let row = 0; row < 12; row += 1) {
            const name = await grid.locator(`[data-cell="${String(row)}:${String(nameColumn)}"]`).innerText();
            const index = Number(/P(\d+)/.exec(name)?.[1] ?? Number.NaN);
            const title = await grid.locator(`[data-cell="${String(row)}:${String(titleColumn)}"]`).innerText();
            // An empty cell reads "Empty" to a screen reader.
            const shown = title.trim() === 'Empty' ? '' : title.trim();
            if (shown !== (finalTitle.get(index) ?? '')) wrong.push(`${name}: ${title}`);
          }
          return wrong;
        },
        { timeout: 10_000, intervals: [50] },
      )
      .toEqual([]);
    const shownMs = Date.now() - back;
    testInfo.annotations.push({ type: 'catch up shown after (ms)', description: String(shownMs) });
    expect(shownMs).toBeLessThan(BUDGET_MS);
    await expect(reader.getByText('Live updates are paused')).toHaveCount(0);

    // From the outbox, with no reload and no refetch of a row that didn't change.
    expect(navigations).toBe(0);
    const paths = asked.map((request) => new URL(request.url()).pathname);
    expect(paths).toContain('/api/rpc/realtime/catchUp');
    expect(paths).not.toContain('/api/rpc/records/query');
    const changed = new Set([...finalTitle.keys()].map((index) => ids[index]));
    for (const request of asked.filter((each) => each.url().includes('/api/rpc/records/get'))) {
      const body = request.postDataJSON() as { json: { ids: string[] } };
      for (const id of body.json.ids) expect(changed.has(id), `refetched unchanged ${id}`).toBe(true);
    }

    await readerContext.close();
  });
});
