// The bookings QA lane's flows (4 November 2026, "bulletproof before release"), against a running app: the public
// booking page with axe in light and dark at each step, a booking made with the keyboard alone and where focus lands
// after each step, and a phone (390 by 844, touch; FLOW_PHONE_BROWSER=webkit for WebKit) with no sideways scroll,
// big enough tap targets, and inputs that don't make iOS zoom. Everything is found by role and label. A test marked
// BUG fails today on purpose (see BOOKINGS-QA.md).
import { randomUUID } from 'node:crypto';
import { chromium, expect, test, webkit, type Browser, type Page } from '@playwright/test';
import { baseOf, makeOwner, rpc, uuidv7, type Owner } from './forms-qa.ts';
import { checkScreen } from './people.ts';
import { PICKED_TIME } from './booking-pages.ts';

const HUMAN_PACE_MS = 3_500;
let owner: Owner;
let address: string;

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(180_000);
  owner = await makeOwner(browser, testInfo, 'bk');
  const context = await browser.newContext({ baseURL: baseOf() });
  await context.addCookies([...owner.cookies]);
  const page = await context.newPage();
  await page.goto(`/w/${owner.slug}`);
  const made = await rpc<{ publicKey: string }>(page, 'bookingPages/create', {
    workspace: owner.slug,
    id: uuidv7(),
    title: 'Intro call',
    timeZone: 'UTC',
    mutationId: randomUUID(),
  });
  address = `${baseOf()}/b/${made.publicKey}`;
  await context.close();
});

const timesList = (page: Page) => page.getByRole('list', { name: /^Times on / });
/** The month's days: a group named for the month ("November 2026"). */
const month = (page: Page) => page.getByRole('group', { name: /^\p{L}+ \d{4}$/u }).first();

/** Writes a measurement into the report (the list reporter shows annotations). */
function note(type: string, description: string): void {
  test.info().annotations.push({ type, description });
}

/** What has focus, as role and name. */
async function focused(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (el === null || el === document.body) return 'body';
    const label = el.getAttribute('aria-label') ?? el.textContent.trim().slice(0, 60);
    return `${el.tagName.toLowerCase()}${el.getAttribute('role') === null ? '' : `[${el.getAttribute('role') ?? ''}]`} ${label}`;
  });
}

test.describe('the public booking page, accessible', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The phone file covers 390.');

  test('axe finds nothing in light and dark: the calendar, a day’s times, the details, their errors', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const visitor = await (await browser.newContext({ reducedMotion: 'reduce' })).newPage();
    await visitor.goto(address);
    await expect(timesList(visitor)).toBeVisible({ timeout: 30_000 });
    await checkScreen(visitor, 'booking-calendar');
    await timesList(visitor).getByRole('button').first().click();
    await visitor.getByRole('button', { name: PICKED_TIME }).click();
    await expect(visitor.getByLabel('Your name')).toBeVisible();
    await checkScreen(visitor, 'booking-details');
    await visitor.getByRole('button', { name: 'Confirm booking' }).click();
    await checkScreen(visitor, 'booking-details-errors');
    await visitor.context().close();
  });

  test('the calendar grid and the time list name what they hold', async ({ browser }) => {
    const visitor = await (await browser.newContext({ reducedMotion: 'reduce' })).newPage();
    await visitor.goto(address);
    await expect(timesList(visitor)).toBeVisible({ timeout: 30_000 });
    // The month is a named group, each day a button naming its full date and whether it has times.
    const grid = month(visitor);
    await expect(grid).toBeVisible();
    const days = grid.getByRole('button');
    expect(await days.count()).toBeGreaterThan(0);
    await expect(days.first()).toHaveAccessibleName(/\d/);
    // Each time names its time, not just "button".
    await expect(timesList(visitor).getByRole('button').first()).toHaveAccessibleName(/\d{1,2}[:.]\d{2}|\d\s?(am|pm)/i);
    await visitor.context().close();
  });

  test('books with the keyboard alone, focus landing on the next thing to do at each step', async ({ browser }) => {
    test.setTimeout(120_000);
    const visitor = await (await browser.newContext({ reducedMotion: 'reduce' })).newPage();
    await visitor.goto(address);
    await expect(timesList(visitor)).toBeVisible({ timeout: 30_000 });
    const steps: string[] = [];
    // Tab until a time has focus: never more than 40 stops (skip links, the zone, the month's arrows, a day).
    let reached = false;
    let stops = 0;
    for (; stops < 40 && !reached; stops += 1) {
      await visitor.keyboard.press('Tab');
      reached = await timesList(visitor)
        .getByRole('button')
        .evaluateAll((buttons) => buttons.includes(document.activeElement as HTMLElement));
    }
    expect(reached, 'Tab reaches a time').toBe(true);
    steps.push(`Tab stops to the first time: ${String(stops)}`);
    await visitor.keyboard.press('Enter');
    steps.push(`after a time: ${await focused(visitor)}`);
    // B-14, fixed (bookings fix lane P): the day's times are one tab stop with the arrows between them, and Enter on
    // a time picks it and puts focus on the bar's Next (it was Book), as Cal.com moves on at once.
    const book = visitor.getByRole('button', { name: PICKED_TIME });
    await expect(book).toBeFocused();
    steps.push('Tab stops from the chosen time to Book: 0');
    await visitor.keyboard.press('Enter');
    // The first empty field takes focus as the details arrive.
    await expect(visitor.getByLabel('Your name')).toBeFocused();
    steps.push(`after Book: ${await focused(visitor)}`);
    await visitor.keyboard.type('Kim Keyboard');
    await visitor.keyboard.press('Tab');
    await expect(visitor.getByLabel('Email')).toBeFocused();
    await visitor.keyboard.type(`kim-${randomUUID().slice(0, 6)}@example.com`);
    await visitor.waitForTimeout(HUMAN_PACE_MS);
    // Enter in a field sends the form.
    await visitor.keyboard.press('Enter');
    await expect(visitor).toHaveURL(/\/manage\?/, { timeout: 30_000 });
    // The confirmation's heading takes focus, so a screen reader hears it.
    await expect.poll(() => focused(visitor)).toMatch(/^h1|^h2/);
    steps.push(`after Confirm: ${await focused(visitor)}`);
    note('focus', steps.join(' | '));
    await visitor.context().close();
  });
});

test.describe('the public booking page on a phone', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'Runs once, with its own phone browser.');

  async function phone(): Promise<{ browser: Browser; page: Page }> {
    const engine = process.env.FLOW_PHONE_BROWSER === 'webkit' ? webkit : chromium;
    const browser = await engine.launch();
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: engine === chromium,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    page.on('response', (response) => {
      if (response.status() >= 400) note('refused', `${String(response.status())} ${new URL(response.url()).pathname}`);
    });
    return { browser, page };
  }

  test('books end to end at 390 with no sideways scroll, and axe finds nothing', async () => {
    test.setTimeout(150_000);
    const { browser, page } = await phone();
    await page.goto(address);
    await expect(timesList(page).or(month(page)).first()).toBeVisible({ timeout: 30_000 });
    const noSideways = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(await noSideways()).toBe(true);
    await checkScreen(page, 'booking-phone-calendar');
    // A day first when the times aren't shown yet.
    if (!(await timesList(page).isVisible())) {
      await month(page).getByRole('button', { disabled: false }).first().tap();
    }
    await timesList(page).getByRole('button').first().tap();
    const book = page.getByRole('button', { name: PICKED_TIME });
    if (await book.isVisible()) await book.tap();
    await page.getByLabel('Your name').fill('Pat Phone');
    await page.getByLabel('Email').fill(`pat-${randomUUID().slice(0, 6)}@example.com`);
    expect(await noSideways()).toBe(true);
    await checkScreen(page, 'booking-phone-details');
    await page.waitForTimeout(HUMAN_PACE_MS);
    await page.getByRole('button', { name: 'Confirm booking' }).tap();
    await expect(page).toHaveURL(/\/manage\?/, { timeout: 30_000 });
    expect(await noSideways()).toBe(true);
    await browser.close();
  });

  test('every day and time is at least 24 by 24 (WCAG 2.5.8), the times at least 44 tall', async () => {
    const { browser, page } = await phone();
    await page.goto(address);
    await expect(month(page)).toBeVisible({ timeout: 30_000 });
    const days = await month(page)
      .getByRole('button')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => [r.width, r.height]));
    for (const [width = 0, height = 0] of days) {
      expect(width).toBeGreaterThanOrEqual(24);
      expect(height).toBeGreaterThanOrEqual(24);
    }
    if (!(await timesList(page).isVisible())) {
      await month(page).getByRole('button', { disabled: false }).first().tap();
    }
    const times = await timesList(page)
      .getByRole('button')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    note('time heights', JSON.stringify([...new Set(times)]));
    // B-16, fixed (bookings fix lane P): under a coarse pointer every time is at least 44 tall, as Apple and Material
    // ask for under a finger (WCAG 2.5.8's 24 was already met).
    for (const height of times) expect(height).toBeGreaterThanOrEqual(44);
    await browser.close();
  });

  test('the details inputs are 16px or larger, so iOS doesn’t zoom the page when one is tapped', async () => {
    const { browser, page } = await phone();
    await page.goto(address);
    await expect(month(page)).toBeVisible({ timeout: 30_000 });
    if (!(await timesList(page).isVisible())) {
      await month(page).getByRole('button', { disabled: false }).first().tap();
    }
    await timesList(page).getByRole('button').first().tap();
    const book = page.getByRole('button', { name: PICKED_TIME });
    if (await book.isVisible()) await book.tap();
    await expect(page.getByLabel('Your name')).toBeVisible();
    const sizes = await page
      .locator('input:not([type=hidden]):not([type=radio]):not([type=checkbox]):not([tabindex="-1"]), textarea')
      .evaluateAll((els) =>
        els
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .map(
            (el) =>
              [
                (el as HTMLInputElement).labels?.[0]?.textContent.trim() ?? el.getAttribute('name') ?? el.id,
                Number.parseFloat(getComputedStyle(el).fontSize),
              ] as const,
          ),
      );
    note('input sizes', JSON.stringify(sizes));
    // An input under 16px makes iOS Safari zoom the whole page in when it's tapped.
    for (const [name, size] of sizes) expect(size, `${name} is ${String(size)}px`).toBeGreaterThanOrEqual(16);
    // A tapped field ends up above the on screen keyboard: the page lets it scroll into the top 60% of the view.
    await page.getByLabel('Email').tap();
    const top = await page.getByLabel('Email').evaluate((el) => el.getBoundingClientRect().top / window.innerHeight);
    expect(top).toBeLessThan(0.6);
    await browser.close();
  });
});
