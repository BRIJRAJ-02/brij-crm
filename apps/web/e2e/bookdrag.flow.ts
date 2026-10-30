// Moving a booking by hand on the week (the flow pass, crm-bookdrag, 31 October 2026): a booking dragged to another
// time and back with Undo, its foot dragged to change its length, the keyboard doing the same with Alt and the
// arrows, a place the host can't take drawn red and never sent, and the workspace's currency and country saved from
// General. Each from a page and a booking made through the API and the visitor's own page, as the booking flows do.
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { newWorkspace } from './people.ts';

/** The booking page's bot check wants a human's pace before Confirm. */
const HUMAN_PACE_MS = 3_500;

function uuidv7(): string {
  const time = Date.now().toString(16).padStart(12, '0');
  const random = randomBytes(10).toString('hex');
  const variant = ((Number.parseInt(random.slice(3, 4), 16) & 0x3) | 0x8).toString(16);
  return `${time.slice(0, 8)}-${time.slice(8, 12)}-7${random.slice(0, 3)}-${variant}${random.slice(4, 7)}-${random.slice(7, 19)}`;
}

/** Calls one oRPC procedure as the page's signed in person, from the app's own origin. */
async function rpc<T>(page: Page, procedure: string, input: unknown): Promise<T> {
  const origin = new URL(page.url()).origin;
  const response = await page.request.post(`/api/rpc/${procedure}`, { data: { json: input }, headers: { origin } });
  expect(response.ok(), `${procedure}: ${await response.text()}`).toBe(true);
  return ((await response.json()) as { json: T }).json;
}

/** A new workspace with one live booking page, "Intro call", and one booking on it made by a visitor. */
async function withBooking(page: Page, kind: string, browser: Browser) {
  const tag = randomUUID().slice(0, 8);
  const slug = `drag${kind}-${tag}`;
  await newWorkspace(page, `drag${kind}-${tag}@example.com`, slug);
  const made = await rpc<{ id: string }>(page, 'bookingPages/create', {
    workspace: slug,
    id: uuidv7(),
    title: 'Intro call',
    timeZone: 'UTC',
    mutationId: randomUUID(),
  });
  await page.goto(`/w/${slug}/captures/links/${made.id}`);
  const address = (await page.getByRole('link', { name: 'View page' }).getAttribute('href')) ?? '';
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const visitor = await context.newPage();
  await visitor.goto(address);
  await visitor
    .getByRole('list', { name: /^Times on / })
    .getByRole('button')
    .first()
    .click();
  await visitor.getByRole('button', { name: /^Book / }).click();
  await visitor.getByLabel('Your name').fill('Dana Dragger');
  await visitor.getByLabel('Email').fill(`dana-${tag}@example.com`);
  await visitor.waitForTimeout(HUMAN_PACE_MS);
  await visitor.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(visitor).toHaveURL(/\/manage\?/, { timeout: 30_000 });
  await context.close();
  return { slug, pageId: made.id };
}

/** Opens the week holding the booking, and answers its block. */
async function openWeek(page: Page, slug: string) {
  await page.goto(`/w/${slug}/bookings/calendar`);
  // The booking may be in a later week: the empty week offers the way to it.
  const next = page.getByRole('button', { name: /^Next booking/ });
  if (await next.isVisible({ timeout: 4_000 }).catch(() => false)) await next.click();
  const block = page.getByRole('button', { name: /^Intro call/ }).first();
  await expect(block).toBeVisible({ timeout: 15_000 });
  return block;
}

/** The block's words: its name carries its title and time. */
const timeOf = async (block: ReturnType<Page['getByRole']>) => (await block.getAttribute('aria-label')) ?? '';

test.describe('moving a booking on the week', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'One width is enough for the week’s drag.');

  test('a drag moves it, the toast says the guest is emailed, and Undo puts it back', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const { slug } = await withBooking(page, 'move', browser);
    const block = await openWeek(page, slug);
    const was = await timeOf(block);
    const box = await block.boundingBox();
    expect(box).not.toBeNull();
    if (box === null) return;
    // Pick it up by its body, take it a column to the right (a day later) and hold: it reads where it is.
    await page.mouse.move(box.x + box.width / 2, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 20, box.y + 20, { steps: 4 });
    await page.mouse.move(box.x + box.width * 1.5, box.y + 8, { steps: 8 });
    await expect(block).toHaveAttribute('data-moving', 'true');
    await page.mouse.up();
    await expect(page.getByText('Moved. Dana Dragger is emailed the new time.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /^Intro call/ }).first()).not.toHaveAttribute('aria-label', was);
    // One click puts it back, and says the guest is told again.
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('Put back. Dana Dragger is emailed.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /^Intro call/ }).first()).toHaveAttribute('aria-label', was);
  });

  test('dragging its foot changes the length, and the toast says only the length changed', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const { slug } = await withBooking(page, 'size', browser);
    const block = await openWeek(page, slug);
    const box = await block.boundingBox();
    expect(box).not.toBeNull();
    if (box === null) return;
    // The edge is the strip at the block's foot: half an hour more is half an hour of the grid's height.
    const foot = { x: box.x + box.width / 2, y: box.y + box.height - 2 };
    await page.mouse.move(foot.x, foot.y);
    await page.mouse.down();
    await page.mouse.move(foot.x, foot.y + 10, { steps: 3 });
    await page.mouse.move(foot.x, foot.y + 32, { steps: 6 });
    await expect(block).toHaveAttribute('data-moving', 'true');
    await page.mouse.up();
    await expect(page.getByText('Length changed. Dana Dragger is emailed the new time.')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('Alt and the arrows hold it a step later, Escape puts it back, Enter lands it', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const { slug } = await withBooking(page, 'keys', browser);
    const block = await openWeek(page, slug);
    const was = await timeOf(block);
    await block.focus();
    // The week reads ahead where it may land while the block keeps focus.
    await page.waitForResponse((response) => response.url().includes('bookings/moveSlots'), { timeout: 15_000 });
    await page.keyboard.press('Alt+ArrowDown');
    await expect(page.getByRole('status').filter({ hasText: /^Moving to |isn’t free$/ })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('status').filter({ hasText: 'Put back' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Intro call/ }).first()).toHaveAttribute('aria-label', was);
    // Day later, then Enter: sent, with Undo.
    await page.keyboard.press('Alt+ArrowRight');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Moved. Dana Dragger is emailed the new time.')).toBeVisible({ timeout: 15_000 });
  });

  test('a place the host can’t take is outlined red, and let go there it asks nothing and slides home', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const { slug } = await withBooking(page, 'red', browser);
    const block = await openWeek(page, slug);
    const was = await timeOf(block);
    const box = await block.boundingBox();
    expect(box).not.toBeNull();
    if (box === null) return;
    let sent = 0;
    await page.route('**/api/rpc/bookings/move', async (route) => {
      sent += 1;
      await route.continue();
    });
    await block.focus();
    await page.waitForResponse((response) => response.url().includes('bookings/moveSlots'), { timeout: 15_000 });
    // The middle of the night is outside any hours the page offers.
    await page.mouse.move(box.x + box.width / 2, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + 20, { steps: 3 });
    await page.mouse.move(box.x + box.width / 2, box.y - 6 * 64, { steps: 10 });
    await expect(block).toHaveAttribute('data-refused', 'true');
    await page.mouse.up();
    await expect(block).not.toHaveAttribute('data-moving', 'true');
    await expect(block).toHaveAttribute('aria-label', was);
    expect(sent).toBe(0);
    await expect(page.getByText(/is emailed the new time/)).toBeHidden();
  });

  test('the workspace’s currency and country are saved from General, with Undo, and a new money field starts in it', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `region-${tag}`;
    await newWorkspace(page, `region-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/settings/general`);
    await page.getByRole('button', { name: /^Currency/ }).click();
    await page.getByRole('searchbox', { name: 'Search currencies' }).fill('rupee');
    await page.getByRole('option', { name: /Indian Rupee/ }).click();
    await expect(page.getByText('Currency is now INR.')).toBeVisible();
    await page.getByRole('button', { name: /^Country/ }).click();
    await page.getByRole('searchbox', { name: /^Search country/ }).fill('india');
    await page.getByRole('option', { name: /^India/ }).click();
    await expect(page.getByText('Country is now IN.')).toBeVisible();
    // Undo takes the country back to Automatic.
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('button', { name: /^Country/ })).toContainText('Automatic');
    // It stays after a reload.
    await page.reload();
    await expect(page.getByRole('button', { name: /^Currency/ })).toContainText('Indian Rupee');
  });
});
