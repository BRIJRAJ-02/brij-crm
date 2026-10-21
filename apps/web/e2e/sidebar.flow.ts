// The sidebar v2 (spec 0034, milestone 1): the new order (Tasks, Records, Scheduling's four pages, then Trash,
// Settings and Help at the foot, AC-921, AC-928, AC-930); the member folds Scheduling and turns the rail on with [
// in one browser, and their second browser follows within a second (AC-931, AC-935, AC-937); a reload keeps both
// (AC-936); and every old Captures and Bookings › Availability address lands on its new page with its query kept,
// replacing the history entry (AC-929). Milestone 2: an object hidden from its menu and back from Customise
// sidebar, an item and a section reordered by keyboard, live in the second browser, and Reset to default behind its
// confirm (AC-932, AC-933).
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { newWorkspace, signInAgain } from './people.ts';

/** Whether the second browser's live checks run: Centrifugo must allow the app's origin. */
const LIVE = process.env.FLOW_NO_LIVE === undefined;

const nav = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' });
const scheduling = (page: Page) => nav(page).getByRole('button', { name: 'Scheduling', exact: true });

/** The names of the sidebar's links and buttons, top to bottom (a keycap, hidden from the name, left out). */
async function order(page: Page): Promise<string[]> {
  return nav(page)
    .locator('a[href], button')
    .evaluateAll((elements) =>
      elements.map((element) => {
        const label = element.getAttribute('aria-label');
        if (label !== null) return label.trim();
        const copy = element.cloneNode(true) as Element;
        for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
        return copy.textContent.trim();
      }),
    );
}

test.describe('sidebar', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The sidebar flow runs at desktop width.');

  test('draws the new order, keeps the member’s folds and rail, live in their second browser, and redirects the old addresses', async ({
    browser,
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const email = `sidebar-${tag}@example.com`;
    const slug = `sidebar-${tag}`;
    const code = await newWorkspace(page, email, slug);
    await expect(nav(page).getByRole('link', { name: 'Deals', exact: true })).toBeVisible();

    // The order (AC-921): the workspace menu, Tasks, Records, Scheduling and its pages, then the foot.
    const names = await order(page);
    const at = (name: string) => names.indexOf(name);
    for (const [before, after] of [
      ['Tasks', 'Records'],
      ['Records', 'People'],
      ['Deals', 'Scheduling'],
      ['Scheduling', 'Bookings'],
      ['Bookings', 'Availability'],
      ['Availability', 'Booking pages'],
      ['Booking pages', 'Forms'],
      ['Forms', 'Trash'],
      ['Trash', 'Settings'],
      ['Settings', 'Help and shortcuts'],
    ] as const) {
      expect(at(before), `${before} before ${after} in ${names.join(', ')}`).toBeLessThan(at(after));
      expect(at(before)).toBeGreaterThanOrEqual(0);
    }
    expect(names.some((name) => name === 'Captures')).toBe(false);

    const other = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: { width: 1280, height: 800 },
    });
    const second = await other.newPage();
    await signInAgain(second, email, `/w/${slug}/objects/people`, [code]);
    await expect(scheduling(second)).toHaveAttribute('aria-expanded', 'true');

    // Fold Scheduling from its label, by keyboard (AC-931). The second browser follows (AC-937: within a second;
    // given room here for a busy machine, as live.flow.ts measures the timing itself). On the rail a section has no
    // label to fold, so the fold is seen to arrive before the rail goes on.
    await scheduling(page).focus();
    await page.keyboard.press('Enter');
    await expect(scheduling(page)).toHaveAttribute('aria-expanded', 'false');
    if (LIVE) await expect(scheduling(second)).toHaveAttribute('aria-expanded', 'false', { timeout: 10_000 });

    // The rail with [ (AC-935), once focus is on the page, not in a field.
    await page.locator('main').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('[');
    await expect(nav(page).getByRole('button', { name: 'Expand the sidebar' })).toBeVisible();
    if (LIVE) {
      await expect(nav(second).getByRole('button', { name: 'Expand the sidebar' })).toBeVisible({ timeout: 10_000 });
    }

    // A reload keeps both, with no default order drawn first (AC-936).
    await page.reload();
    await expect(nav(page).getByRole('button', { name: 'Expand the sidebar' })).toBeVisible();
    await nav(page).getByRole('button', { name: 'Expand the sidebar' }).click();
    await expect(scheduling(page)).toHaveAttribute('aria-expanded', 'false');
    await scheduling(page).click();
    await expect(nav(page).getByRole('link', { name: 'Booking pages', exact: true })).toBeVisible();

    // The Scheduling pages open with their item current (AC-928, AC-942).
    await nav(page).getByRole('link', { name: 'Forms', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/forms$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Forms' })).toBeVisible();
    await expect(nav(page).getByRole('link', { name: 'Forms', exact: true })).toHaveAttribute('aria-current', 'page');

    // The old addresses land on the new pages, keeping the query, in place of the old entry (AC-929).
    await page.goto(`/w/${slug}/captures/forms?from=old`);
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/forms\\?from=old$`));
    await page.goto(`/w/${slug}/captures`);
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/booking-pages$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Booking pages' })).toBeVisible();
    await page.goto(`/w/${slug}/bookings/availability`);
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/availability$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Availability' })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/booking-pages$`));
    await other.close();
  });

  test('hides, brings back and reorders, live in the second browser, and resets behind a confirm', async ({
    browser,
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const email = `sidebar2-${tag}@example.com`;
    const slug = `sidebar2-${tag}`;
    const code = await newWorkspace(page, email, slug);
    const deals = (on: Page) => nav(on).getByRole('link', { name: 'Deals', exact: true });
    await expect(deals(page)).toBeVisible();
    const other = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: { width: 1280, height: 800 },
    });
    const second = await other.newPage();
    await signInAgain(second, email, `/w/${slug}/objects/people`, [code]);
    await expect(deals(second)).toBeVisible();

    // Hide Deals from its menu (AC-933); the second browser follows (AC-937).
    await deals(page).hover();
    await nav(page).getByRole('button', { name: 'More for Deals' }).click();
    await page.getByRole('menuitem', { name: 'Hide from sidebar' }).click();
    await expect(deals(page)).toHaveCount(0);
    if (LIVE) await expect(deals(second)).toHaveCount(0, { timeout: 10_000 });

    // Companies first by keyboard on its grip (AC-932): Space lifts, the arrow moves, Space drops.
    const grip = nav(page).getByRole('button', { name: 'Move Companies' });
    await grip.focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Space');
    const records = (on: Page) =>
      nav(on)
        .getByRole('link')
        .filter({ hasText: /^(People|Companies)$/ });
    await expect(records(page).first()).toHaveText('Companies');
    if (LIVE) await expect(records(second).first()).toHaveText('Companies', { timeout: 10_000 });

    // Scheduling above Records from its menu.
    await nav(page).getByRole('button', { name: 'Scheduling options' }).click();
    await page.getByRole('menuitem', { name: 'Move up' }).click();
    const labels = nav(page).getByRole('button', { name: /^(Records|Scheduling)$/ });
    await expect(labels.first()).toHaveText('Scheduling');

    // Customise sidebar brings Deals back.
    await nav(page).getByRole('button', { name: 'Records options' }).click();
    await page.getByRole('menuitem', { name: 'Customise sidebar' }).click();
    const dialog = page.getByRole('dialog', { name: 'Customise sidebar' });
    await dialog.getByRole('switch', { name: 'Show Deals in the sidebar' }).press('Space');
    await expect(deals(page)).toBeVisible();

    // Reset to default asks first: Cancel changes nothing, Reset sidebar puts the default back once.
    await dialog.getByRole('button', { name: 'Reset to default' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Reset your sidebar?' });
    await confirm.getByRole('button', { name: /Cancel/ }).click();
    await expect(confirm).toHaveCount(0);
    await expect(labels.first()).toHaveText('Scheduling');
    await dialog.getByRole('button', { name: 'Reset to default' }).click();
    await confirm.getByRole('button', { name: 'Reset sidebar' }).click();
    await expect(confirm).toHaveCount(0);
    await expect(labels.first()).toHaveText('Records');
    await expect(records(page).first()).toHaveText('People');
    await dialog.getByRole('button', { name: 'Done' }).click();

    // A reload keeps the reset (AC-936).
    await page.reload();
    await expect(
      nav(page)
        .getByRole('button', { name: /^(Records|Scheduling)$/ })
        .first(),
    ).toHaveText('Records');
    await other.close();
  });
});
