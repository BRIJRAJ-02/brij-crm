// Versions, the replaced notice and undo between two browsers (spec 0006,
// milestone 1, AC-46 to AC-48 and AC-65): Ada and Bea are two members of one
// workspace, each in a browser of their own.
// - The clash: both start from the same version of a cell; Bea's later save
//   wins and shows in both, and Ada, whose value was replaced, sees within a
//   second "Bea changed Job title on Grace Hopper just after you, so your
//   value was replaced." with Use mine, which puts hers back. Bea sees
//   nothing, and two quick saves of Ada's own raise nothing either.
// - Undo: Ada edits a cell and pastes six; Bea changes two of the pasted
//   cells; Cmd+Z (Ctrl+Z off Apple) undoes the paste but keeps Bea's two, and
//   a second press undoes the edit.
// Locally: `pnpm dev:apps` against a throwaway database (the member is added
// with `member:add`, which runs as the owner from the root .env). Set
// FLOW_SCREENSHOTS to a folder for pictures, and the clash's timing.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type Page, type TestInfo, type WebSocketRoute } from '@playwright/test';
import { addPerson, cellAt, checkScreen, newWorkspace, signInAgain } from './people.ts';

const SHOTS = process.env.FLOW_SCREENSHOTS;
const REALTIME = /\/connection\/websocket/;
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
/** AC-46: the member whose value was replaced hears of it within a second. */
const NOTICE_BUDGET_MS = 1000;

/** Keeps a picture of `page` when FLOW_SCREENSHOTS asks. */
async function picture(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  await page.screenshot({ path: path.join(SHOTS, `${test.info().project.name}-versions-${name}.png`) });
}

/** Adds `email` to the workspace as a member, as #23's invites will (local only: `member:add`). */
function addMember(slug: string, email: string, name: string): void {
  execFileSync(
    'pnpm',
    ['--filter', '@crm/core', 'member:add', '--workspace', slug, '--email', email, '--role', 'member', '--name', name],
    { cwd: ROOT, stdio: 'pipe' },
  );
}

/** Opens a second browser for `email`, signed in on `where`. */
async function secondBrowser(browser: Browser, testInfo: TestInfo, email: string, where: string, seen: string[] = []) {
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    viewport: testInfo.project.use.viewport ?? null,
  });
  const page = await context.newPage();
  const realtime = await realtimeSwitch(page);
  await signInAgain(page, email, where, seen);
  return { context, page, realtime };
}

/** Puts a page's Centrifugo connection behind a switch (as live.flow.ts does), counting subscribe replies. */
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
      await current?.page.close({ code: 4000, reason: 'offline in the test' });
      await current?.server.close();
      current = undefined;
    },
    restore: () => {
      isBlocked = false;
    },
  };
}

/** Types `value` into a grid cell and commits it, waiting for it to show. */
async function edit(page: Page, row: number, column: string, value: string): Promise<void> {
  const cell = await cellAt(page, row, column);
  await cell.click();
  await page.keyboard.type(value);
  await page.keyboard.press('Enter');
  await expect(cell).toContainText(value);
}

/** Presses undo the way the page's keyboard does it (the library's rule): Cmd+Z on a Mac keyboard, Ctrl+Z elsewhere. */
async function pressUndo(page: Page): Promise<void> {
  const isApple = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent));
  await page.keyboard.press(isApple ? 'Meta+z' : 'Control+z');
}

/** Pastes tab separated rows into the grid at the focused cell, as the clipboard would. */
async function paste(page: Page, rows: readonly (readonly string[])[]): Promise<void> {
  const text = rows.map((row) => row.join('\t')).join('\n');
  await page.evaluate((tsv) => {
    const data = new DataTransfer();
    data.setData('text/plain', tsv);
    document.activeElement?.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, text);
}

test.describe('versions, the replaced notice and undo between two members', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The table flows run at desktop width.');

  test('the later save wins, the replaced member is told within a second, and Use mine puts theirs back', async ({
    browser,
    page: ada,
  }, testInfo) => {
    test.setTimeout(180_000);
    if (SHOTS !== undefined) mkdirSync(SHOTS, { recursive: true });
    const tag = randomUUID().slice(0, 8);
    const slug = `clash-${tag}`;
    const people = `/w/${slug}/objects/people`;
    await newWorkspace(ada, `ada-${tag}@example.com`, slug);
    await addPerson(ada, 'Grace', 'Hopper', `grace-${tag}@example.com`);
    const beaEmail = `bea-${tag}@example.com`;
    addMember(slug, beaEmail, 'Bea');
    const bea = await secondBrowser(browser, testInfo, beaEmail, people);
    await expect(bea.page.getByRole('grid', { name: 'People' })).toContainText('Grace Hopper');
    await expect.poll(() => bea.realtime.subscribes()).toBeGreaterThan(0);

    // Two quick saves of Ada's own: the second names the first's base, and nothing is said (AC-47).
    await edit(ada, 0, 'Job title', 'Analyst');
    await edit(ada, 0, 'Job title', 'Lead analyst');
    await expect(await cellAt(bea.page, 0, 'Job title')).toContainText('Lead analyst');

    // Bea's live connection drops, so she doesn't see Ada's next save: both start from the same version.
    await bea.realtime.drop();
    await expect(bea.page.getByText('Live updates are paused')).toBeVisible();
    await edit(ada, 0, 'Job title', 'Principal');
    await expect(await cellAt(bea.page, 0, 'Job title')).toContainText('Lead analyst');
    const notice = 'Bea changed Job title on Grace Hopper just after you, so your value was replaced.';
    const savedAt = Date.now();
    await edit(bea.page, 0, 'Job title', 'Engineer');
    await expect(ada.getByText(notice)).toBeVisible({ timeout: 5_000 });
    const noticeMs = Date.now() - savedAt;
    // The later save shows in both.
    await expect(await cellAt(ada, 0, 'Job title')).toContainText('Engineer');
    await picture(ada, 'clash-ada-notice');
    await checkScreen(ada, 'versions-replaced');

    // Use mine saves Ada's value again as a normal edit, from Bea's version: Bea hears nothing.
    bea.realtime.restore();
    await expect.poll(() => bea.realtime.subscribes(), { timeout: 30_000 }).toBeGreaterThan(1);
    await ada.getByRole('button', { name: 'Use mine' }).click();
    await expect(await cellAt(ada, 0, 'Job title')).toContainText('Principal');
    await expect(await cellAt(bea.page, 0, 'Job title')).toContainText('Principal');
    await expect(bea.page.getByText(/just after you/)).toHaveCount(0);
    await picture(bea.page, 'clash-bea-after-use-mine');

    testInfo.annotations.push({ type: 'replaced notice (ms)', description: String(noticeMs) });
    if (SHOTS !== undefined) {
      writeFileSync(path.join(SHOTS, `${testInfo.project.name}-versions-timing.json`), JSON.stringify({ noticeMs }));
    }
    expect(noticeMs).toBeLessThan(NOTICE_BUDGET_MS);
    await bea.context.close();
  });

  test('undo walks back a paste, keeping the cells someone changed since, then an edit', async ({
    browser,
    page: ada,
  }, testInfo) => {
    test.setTimeout(180_000);
    if (SHOTS !== undefined) mkdirSync(SHOTS, { recursive: true });
    const tag = randomUUID().slice(0, 8);
    const slug = `undo-${tag}`;
    const people = `/w/${slug}/objects/people`;
    await newWorkspace(ada, `ada-${tag}@example.com`, slug);
    for (const [first, last] of [
      ['Grace', 'Hopper'],
      ['Alan', 'Turing'],
      ['Edsger', 'Dijkstra'],
      ['Barbara', 'Liskov'],
    ] as const) {
      await addPerson(ada, first, last, `${first.toLowerCase()}-${tag}@example.com`);
    }
    const beaEmail = `bea-${tag}@example.com`;
    addMember(slug, beaEmail, 'Bea');
    const bea = await secondBrowser(browser, testInfo, beaEmail, people);
    await expect(bea.page.getByRole('grid', { name: 'People' })).toContainText('Barbara Liskov');

    // An edit, then a paste of six cells (three rows of Job title and the column after it).
    await edit(ada, 3, 'Job title', 'Professor');
    const target = await cellAt(ada, 0, 'Job title');
    await target.click();
    await paste(ada, [
      ['Admiral', 'Navy'],
      ['Mathematician', 'Bletchley'],
      ['Scientist', 'Eindhoven'],
    ]);
    await expect(ada.getByText('Pasted into 6 cells')).toBeVisible();
    // The toast region is marked, so undo still answers while focus sits on a toast's button.
    await expect(ada.locator('[data-toast-region]')).toHaveCount(1);
    // Said once, by the screen once the write landed: the grid's own confirmation is off.
    await expect(ada.getByText('Pasted 6 cells', { exact: true })).toHaveCount(0);
    await expect(ada.getByRole('button', { name: 'Undo' })).toBeVisible();
    await expect(await cellAt(bea.page, 2, 'Job title')).toContainText('Scientist');
    await picture(ada, 'undo-pasted');

    // Bea changes two of the pasted cells.
    await edit(bea.page, 0, 'Job title', 'Rear admiral');
    await edit(bea.page, 1, 'Job title', 'Codebreaker');
    await expect(await cellAt(ada, 1, 'Job title')).toContainText('Codebreaker');

    // Ada's undo puts back the four cells nobody touched and keeps Bea's two.
    await (await cellAt(ada, 2, 'Name')).click();
    await pressUndo(ada);
    await expect(
      ada.getByText('Undid the paste into 6 cells. 2 cells were changed since, so they were kept.'),
    ).toBeVisible();
    await expect(await cellAt(ada, 0, 'Job title')).toContainText('Rear admiral');
    await expect(await cellAt(ada, 1, 'Job title')).toContainText('Codebreaker');
    await expect(await cellAt(ada, 2, 'Job title')).not.toContainText('Scientist');
    // An undo is an ordinary write, live to others.
    await expect(await cellAt(bea.page, 2, 'Job title')).not.toContainText('Scientist');
    await picture(ada, 'undo-paste-undone');
    await checkScreen(ada, 'versions-undone');

    // The paste toast's Undo is stale now (its paste was undone): it says so and undoes nothing else.
    await ada.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(ada.getByText(/Newer changes came after that one/)).toBeVisible();
    await expect(await cellAt(ada, 3, 'Job title')).toContainText('Professor');

    // The second press undoes the edit before it.
    await pressUndo(ada);
    await expect(ada.getByText('Undid Job title on Barbara Liskov')).toBeVisible();
    await expect(await cellAt(ada, 3, 'Job title')).not.toContainText('Professor');

    // Inside a text field the key is the field's own.
    const cell = await cellAt(ada, 3, 'Job title');
    await cell.click();
    await ada.keyboard.type('Draft');
    await pressUndo(ada);
    await expect(ada.getByText('Nothing to undo')).toHaveCount(0);
    await ada.keyboard.press('Escape');

    // ? lists the shortcut, from anywhere but a text field or a grid cell (where typing starts an edit).
    await ada.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    await ada.keyboard.press('?');
    const help = ada.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(help).toContainText('Undo your last change');
    await picture(ada, 'undo-shortcut-help');
    await ada.keyboard.press('Escape');
    await expect(help).toBeHidden();
    // And from the workspace menu, with the pointer.
    await ada.getByRole('button', { name: /workspace menu/ }).click();
    await ada.getByRole('menuitem', { name: /Keyboard shortcuts/ }).click();
    await expect(help).toBeVisible();
    await ada.keyboard.press('Escape');
    await bea.context.close();
  });
});
