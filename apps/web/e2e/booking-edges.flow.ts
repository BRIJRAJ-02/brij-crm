// The booking journey's edges (flow walks, phase 1, 29 October 2026), each from a page made through the API as
// the New dialog would: the host cancels from Bookings after a confirm; a paused page tells its visitor so and
// takes bookings again once resumed; a changed address still answers on the old one; a visitor in another time
// zone books in their own; a guest rides along; a Link only page stays off the link page but books by its link;
// and a round robin page can't be made before a group exists.
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { newWorkspace } from './people.ts';
import { openBookingPopup, PICKED_TIME, popupAction, setPageStatus, shareAddress } from './booking-pages.ts';

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

/** The page's public address, from its editor's Share section, where the editor is then left. */
async function publicAddress(page: Page, slug: string, pageId: string): Promise<string> {
  return shareAddress(page, `/w/${slug}/captures/links/${pageId}`);
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
  await visitor.getByRole('button', { name: PICKED_TIME }).click();
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
    // The meeting popup's ⋯ holds Cancel meeting (the redesign: every change but the one primary).
    await openBookingPopup(page, 'Vera Visitor');
    await popupAction(page, 'Vera Visitor', 'Cancel meeting');
    // Asked first, in a dialog, naming who it is with.
    const confirm = page.getByRole('alertdialog', { name: 'Cancel meeting with Vera?' });
    await expect(confirm).toBeVisible();
    await confirm.getByLabel(/^Note to Vera/).fill('Double booked');
    await confirm.getByRole('button', { name: 'Cancel meeting' }).click();
    await expect(page.getByText('Meeting cancelled. Vera has been told.')).toBeVisible();

    // The visitor's own page no longer offers a move.
    await visitor.reload();
    await expect(visitor.getByRole('button', { name: 'Reschedule' })).toBeHidden({ timeout: 15_000 });
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
    await openBookingPopup(page, 'Mo Mover');
    await popupAction(page, 'Mo Mover', 'Reschedule');
    const move = page.getByRole('dialog', { name: 'Reschedule with Mo' });
    await expect(move).toBeVisible();
    // The time the booking holds isn't offered: any time shown is a real move.
    await move.getByRole('list').last().getByRole('button').last().click();
    await move.getByRole('button', { name: /^Reschedule to / }).click();
    await expect(page.getByText('Moved. Mo Mover is emailed the new time.')).toBeVisible();

    await visitor.reload();
    await expect.poll(async () => (await visitor.locator('body').innerText()) !== was).toBe(true);
    await expect(visitor.getByRole('button', { name: 'Reschedule' })).toBeVisible();
    await visitor.context().close();
  });

  test('a hidden page tells its visitor so, and takes bookings again once live', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const { slug, pageId } = await withPage(page, 'pause');
    const address = await publicAddress(page, slug, pageId);

    // Live or Hidden, from the editor's status pill (Hidden is the old Pause).
    await setPageStatus(page, 'Intro call', 'Hidden');

    // Not a blank page or a bare error: it says why.
    const visitor = await visitorAt(browser);
    await visitor.goto(address);
    await expect(visitor.getByText(/isn’t taking bookings|Nothing is bookable here right now/).first()).toBeVisible();
    await expect(visitor.getByRole('list', { name: /^Times on / })).toHaveCount(0);

    await setPageStatus(page, 'Intro call', 'Live');
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
    // The bar's Publish goes once nothing is left to publish (spec 0074).
    await expect(page.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0, { timeout: 10_000 });
    const after = await publicAddress(page, slug, pageId);
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
    await visitor.getByRole('button', { name: PICKED_TIME }).click();
    await visitor.getByLabel('Your name').fill('Gus Host');
    await visitor.getByLabel('Email').fill(`gus-${pageId.slice(-6)}@example.com`);
    await visitor.getByRole('button', { name: /Add guests?/ }).click();
    // A guest's address is checked before anything is sent: one that isn't an address stays in the field to fix.
    // The guests are one email a row (the v5 mock's details step).
    const guests = visitor.getByRole('textbox', { name: 'Guest 1 email' });
    await guests.fill('notanemail');
    await visitor.waitForTimeout(HUMAN_PACE_MS);
    await visitor.getByRole('button', { name: 'Confirm booking' }).click();
    await expect(visitor.getByText(/isn’t an email address|Give each guest’s email address/).first()).toBeVisible();
    // Typed and not yet a chip, the fixed address still goes with the booking.
    await guests.fill(`guest-${pageId.slice(-6)}@example.com`);
    await visitor.getByRole('button', { name: 'Confirm booking' }).click();
    await expect(visitor).toHaveURL(/\/manage\?/, { timeout: 30_000 });

    await page.goto(`/w/${slug}/bookings/list`);
    await expect(await openBookingPopup(page, 'Gus Host')).toContainText(`guest-${pageId.slice(-6)}@example.com`);
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
    await expect(page.getByText(/Old address stops working on save/)).toBeVisible();
    await page.getByRole('button', { name: /^Save/ }).click();
    // The bar's Publish goes once nothing is left to publish (spec 0074).
    await expect(page.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0, { timeout: 10_000 });
    const after = await publicAddress(page, slug, pageId);
    expect(after).toMatch(/\/b\/[A-Za-z0-9_-]+$/);

    const visitor = await visitorAt(browser);
    // The owner's link page no longer lists it.
    await visitor.goto(before.replace(/\/[^/]+$/, ''));
    await expect(visitor.getByText('Intro call')).toHaveCount(0);
    // Its own link books.
    await book(visitor, after, 'Lia Link', `lia-${pageId.slice(-6)}@example.com`);
    await visitor.context().close();
  });

  test('a round robin page can’t be made before a group exists, and says where to make one, keeping the title', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const tag = randomUUID().slice(0, 8);
    await newWorkspace(page, `bookrr-${tag}@example.com`, `bookrr-${tag}`);
    // New booking page lives on Captures › Links; Bookings' own New is New meeting once a page exists.
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Captures', exact: true })
      .click();
    await page.getByRole('button', { name: /^New booking page/ }).click();
    const create = page.getByRole('dialog', { name: 'New booking page' });
    await create.getByLabel('Title').fill('Team call');
    await create.getByText('Round robin', { exact: true }).click();
    // Alone in the workspace: round robin needs teammates. Members opens beside it, so the title typed here isn't lost
    // on the way (B8). The Team link flow picks people here once there are some.
    await expect(create.getByText('Round robin shares meetings between 2 or more people.')).toBeVisible();
    const [settings] = await Promise.all([
      page.context().waitForEvent('page'),
      create.getByRole('link', { name: 'Invite teammates' }).click(),
    ]);
    await expect(settings).toHaveURL(/\/settings\/members/);
    await settings.close();
    await expect(create.getByLabel('Title')).toHaveValue('Team call');
  });

  test('an object a booking can’t file answers onto is shown off in the picker, with the reason', async ({ page }) => {
    test.setTimeout(120_000);
    const { slug, pageId } = await withPage(page, 'answers');
    await page.goto(`/w/${slug}/captures/links/${pageId}?tab=questions`);
    await page.getByRole('button', { name: /Where the answers go/ }).click();
    // A booking knows its guest by email alone: Deals has no unique email field, so it is offered but can't be picked.
    const deals = page.getByRole('option', { name: /^Deals/ });
    await expect(deals).toHaveAttribute('aria-disabled', 'true');
    await expect(deals).toContainText('Needs a unique email field');
    await expect(page.getByRole('option', { name: /^People/ })).not.toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByText('Only objects with a unique email field can take booking answers.')).toBeVisible();
  });
});
