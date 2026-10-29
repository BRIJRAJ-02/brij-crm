// The booking journey's edges (flow walks, phase 1, 29 October 2026), each from a page made through the API as
// the New dialog would: the host cancels from Bookings after a confirm; a paused page tells its visitor so and
// takes bookings again once resumed; a changed address still answers on the old one; a visitor in another time
// zone books in their own; a guest rides along; a Link only page stays off the link page but books by its link;
// and a round robin page can't be made before a group exists.
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

/** A new workspace with one live booking page, "Intro call"; answers the slug and the page's id. */
async function withPage(page: Page, kind: string): Promise<{ slug: string; pageId: string }> {
  const tag = randomUUID().slice(0, 8);
  const slug = `book${kind}-${tag}`;
  await newWorkspace(page, `book${kind}-${tag}@example.com`, slug);
  const made = await rpc<{ id: string }>(page, 'bookingPages/create', {
    workspace: slug,
    id: uuidv7(),
    title: 'Intro call',
    timeZone: 'UTC',
    mutationId: randomUUID(),
  });
  return { slug, pageId: made.id };
}

/** The page's public address, from its editor's View page. */
async function publicAddress(page: Page, slug: string, pageId: string): Promise<string> {
  await page.goto(`/w/${slug}/captures/links/${pageId}`);
  const href = await page.getByRole('link', { name: 'View page' }).getAttribute('href');
  expect(href).not.toBeNull();
  return href ?? '';
}

/** A visitor, signed in to nothing, in a browser of their own. */
async function visitorAt(browser: Browser, timezoneId?: string): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ...(timezoneId === undefined ? {} : { timezoneId }),
  });
  return context.newPage();
}

/** Books the first open time as `name`, at a person's pace; lands on the booking's own page. */
async function book(visitor: Page, address: string, name: string, email: string): Promise<void> {
  await visitor.goto(address);
  await visitor
    .getByRole('list', { name: /^Times on / })
    .getByRole('button')
    .first()
    .click();
  await visitor.getByRole('button', { name: /^Book / }).click();
  await visitor.getByLabel('Your name').fill(name);
  await visitor.getByLabel('Email').fill(email);
  await visitor.waitForTimeout(HUMAN_PACE_MS);
  await visitor.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(visitor).toHaveURL(/\/manage\?/, { timeout: 30_000 });
}

test.describe('the booking journey’s edges', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'One width is enough for the edges.');

  test('the host cancels from Bookings after a confirm, and the visitor’s page says it is cancelled', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const { slug, pageId } = await withPage(page, 'cancel');
    const address = await publicAddress(page, slug, pageId);
    const visitor = await visitorAt(browser);
    await book(visitor, address, 'Vera Visitor', `vera-${pageId.slice(-6)}@example.com`);

    await page.goto(`/w/${slug}/bookings/list`);
    await page.getByText('Intro call').first().click();
    const panel = page.getByRole('dialog', { name: /Booking/ });
    await panel.getByRole('button', { name: 'More for this booking' }).click();
    await page.getByRole('menuitem', { name: 'Cancel booking' }).click();
    // Asked first, in a dialog, naming who it is with.
    const confirm = page.getByRole('alertdialog', { name: 'Cancel Intro call with Vera Visitor?' });
    await expect(confirm).toBeVisible();
    await confirm.getByLabel('Reason').fill('Double booked');
    await confirm.getByRole('button', { name: 'Cancel booking' }).click();
    await expect(page.getByText('Cancelled. Vera Visitor is emailed.')).toBeVisible();

    // The visitor's own page no longer offers a move.
    await visitor.reload();
    await expect(visitor.getByRole('button', { name: 'Move to another time' })).toBeHidden({ timeout: 15_000 });
    await visitor.context().close();
  });

  test('the host moves a booking to another time from Bookings, and the visitor’s page shows the new one', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const { slug, pageId } = await withPage(page, 'move');
    const address = await publicAddress(page, slug, pageId);
    const visitor = await visitorAt(browser);
    await book(visitor, address, 'Mo Mover', `mo-${pageId.slice(-6)}@example.com`);
    const was = await visitor.locator('body').innerText();

    await page.goto(`/w/${slug}/bookings/list`);
    await page.getByText('Intro call').first().click();
    await page
      .getByRole('dialog', { name: /Booking/ })
      .getByRole('button', { name: 'Reschedule' })
      .click();
    const move = page.getByRole('dialog', { name: 'Reschedule Intro call with Mo Mover' });
    await expect(move).toBeVisible();
    // The time the booking holds isn't offered: any time shown is a real move.
    await move
      .getByRole('list', { name: /^Times on / })
      .getByRole('button')
      .last()
      .click();
    await move.getByRole('button', { name: /^Move to / }).click();
    await expect(page.getByText('Moved. Mo Mover is emailed the new time.')).toBeVisible();

    await visitor.reload();
    await expect.poll(async () => (await visitor.locator('body').innerText()) !== was).toBe(true);
    await expect(visitor.getByRole('button', { name: 'Move to another time' })).toBeVisible();
    await visitor.context().close();
  });

  test('a paused page tells its visitor so, and takes bookings again once resumed', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const { slug, pageId } = await withPage(page, 'pause');
    const address = await publicAddress(page, slug, pageId);

    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: /^Pause/ }).click();
    await expect(page.getByText(/This page is off, so visitors see it closed\./)).toBeVisible();

    // Not a blank page or a bare error: it says why.
    const visitor = await visitorAt(browser);
    await visitor.goto(address);
    await expect(visitor.getByText(/isn’t taking bookings|Nothing is bookable here right now/).first()).toBeVisible();
    await expect(visitor.getByRole('list', { name: /^Times on / })).toHaveCount(0);

    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: /^Resume/ }).click();
    await expect(page.getByText(/This page is off/)).toBeHidden();
    await visitor.reload();
    await expect(visitor.getByRole('list', { name: /^Times on / })).toBeVisible();
    await visitor.context().close();
  });

  test('a changed address answers on the old one too', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const { slug, pageId } = await withPage(page, 'slug');
    const before = await publicAddress(page, slug, pageId);

    const field = page.getByRole('textbox', { name: /Web address/ });
    await field.fill('first-call');
    await page.getByRole('button', { name: /^Save/ }).click();
    await expect(page.getByText('Unsaved changes')).toBeHidden({ timeout: 10_000 });
    const after = await page.getByRole('link', { name: 'View page' }).getAttribute('href');
    expect(after).toMatch(/\/first-call$/);

    const visitor = await visitorAt(browser);
    await visitor.goto(before);
    await expect(visitor).toHaveURL(/\/first-call$/);
    await expect(visitor.getByRole('list', { name: /^Times on / })).toBeVisible();
    await visitor.context().close();
  });

  test('a visitor in another time zone sees and books in their own', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const { slug, pageId } = await withPage(page, 'zone');
    const address = await publicAddress(page, slug, pageId);
    const visitor = await visitorAt(browser, 'America/New_York');
    await visitor.goto(address);
    await expect(visitor.getByText(/New York/).first()).toBeVisible();
    await book(visitor, address, 'Nia Newyork', `nia-${pageId.slice(-6)}@example.com`);
    await expect(visitor.getByText(/New York/).first()).toBeVisible();
    await visitor.context().close();
  });

  test('a guest added while booking is on the host’s booking', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const { slug, pageId } = await withPage(page, 'guest');
    const address = await publicAddress(page, slug, pageId);
    const visitor = await visitorAt(browser);
    await visitor.goto(address);
    await visitor
      .getByRole('list', { name: /^Times on / })
      .getByRole('button')
      .first()
      .click();
    await visitor.getByRole('button', { name: /^Book / }).click();
    await visitor.getByLabel('Your name').fill('Gus Host');
    await visitor.getByLabel('Email').fill(`gus-${pageId.slice(-6)}@example.com`);
    await visitor.getByRole('button', { name: /Add guests?/ }).click();
    // A guest's address is checked before anything is sent.
    await visitor.getByLabel('Guest 1 email').fill('not an email');
    await visitor.waitForTimeout(HUMAN_PACE_MS);
    await visitor.getByRole('button', { name: 'Confirm booking' }).click();
    await expect(visitor.getByText(/guest’s email address/).first()).toBeVisible();
    await visitor.getByLabel('Guest 1 email').fill(`guest-${pageId.slice(-6)}@example.com`);
    await visitor.getByRole('button', { name: 'Confirm booking' }).click();
    await expect(visitor).toHaveURL(/\/manage\?/, { timeout: 30_000 });

    await page.goto(`/w/${slug}/bookings/list`);
    await page.getByText('Intro call').first().click();
    await expect(page.getByRole('dialog', { name: /Booking/ })).toContainText(`guest-${pageId.slice(-6)}@example.com`);
    await visitor.context().close();
  });

  test('a Link only page warns that its old address stops working, leaves the link page, and books by its link', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const { slug, pageId } = await withPage(page, 'private');
    const before = await publicAddress(page, slug, pageId);
    await page.getByRole('radio', { name: 'Link only' }).click({ force: true });
    // Said before Save: the address people already have stops working.
    await expect(page.getByText(/Its old address stops working once you save/)).toBeVisible();
    await page.getByRole('button', { name: /^Save/ }).click();
    await expect(page.getByText('Unsaved changes')).toBeHidden({ timeout: 10_000 });
    const after = await page.getByRole('link', { name: 'View page' }).getAttribute('href');
    expect(after).toMatch(/\/b\/[A-Za-z0-9_-]+$/);

    const visitor = await visitorAt(browser);
    // The owner's link page no longer lists it.
    await visitor.goto(before.replace(/\/[^/]+$/, ''));
    await expect(visitor.getByText('Intro call')).toHaveCount(0);
    // Its own link books.
    await book(visitor, after ?? '', 'Lia Link', `lia-${pageId.slice(-6)}@example.com`);
    await visitor.context().close();
  });

  test('a round robin page can’t be made before a group exists, and says where to make one', async ({ page }) => {
    test.setTimeout(120_000);
    const tag = randomUUID().slice(0, 8);
    await newWorkspace(page, `bookrr-${tag}@example.com`, `bookrr-${tag}`);
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Bookings', exact: true })
      .click();
    await page.getByRole('button', { name: /^New booking page/ }).click();
    const create = page.getByRole('dialog', { name: 'Add a booking page' });
    await create.getByLabel('Title').fill('Team call');
    await create.getByText('A round robin group').click();
    await expect(create.getByText('Make a round robin group first, in Settings.')).toBeVisible();
    await expect(create.getByRole('link', { name: 'Manage round robin' })).toBeVisible();
  });
});
