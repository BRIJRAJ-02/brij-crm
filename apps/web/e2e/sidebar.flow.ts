// The sidebar v2 (spec 0034, milestone 1): the order (Home, Records, Scheduling's two rows, Bookings and Captures,
// then Tasks, and Settings and Help at the foot (the trash moved to Settings); AC-921, AC-928, AC-930, owner 21 and 22 October 2026);
// the workspace opens on Home; the member folds Records and turns the rail on with [
// in one browser, and their second browser follows within a second (AC-931, AC-935, AC-937); a reload keeps both
// (AC-936); and every address round 7 gave Availability, Booking pages and Forms lands back inside Bookings or
// Captures with its query kept, replacing the history entry. Milestone 2: an object hidden from its menu and back from Customise
// sidebar, an item and a section reordered by keyboard, live in the second browser, and Reset to default behind its
// confirm (AC-932, AC-933). Milestone 3's Favourites left the sidebar (owner, 30 October 2026), and its flow with it.
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { newWorkspace, objectUrl, signInAgain } from './people.ts';

/** Whether the second browser's live checks run: Centrifugo must allow the app's origin. */
const LIVE = process.env.FLOW_NO_LIVE === undefined;

const nav = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' });
const recordsLabel = (page: Page) => nav(page).getByRole('button', { name: 'Records', exact: true });
/** The first of the Records label and the Bookings row: which comes first in the sidebar. */
const firstOf = (page: Page) =>
  nav(page)
    .locator('a[href], button')
    .filter({ hasText: /^(Records|Bookings)$/ })
    .first();

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

  test('draws the order, keeps the member’s folds and rail, live in their second browser, and redirects round 7’s addresses', async ({
    browser,
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const email = `sidebar-${tag}@example.com`;
    const slug = `sidebar-${tag}`;
    const code = await newWorkspace(page, email, slug);
    await expect(nav(page).getByRole('link', { name: 'Deals', exact: true })).toBeVisible();

    // The order (AC-921, owner 21 and 22 October 2026): the workspace menu, Home, Records, Scheduling with Bookings
    // and Captures, Tasks, then the foot (the trash left the sidebar for Settings, owner, 22 October 2026); Availability, Booking pages and Forms are tabs, not rows.
    const names = await order(page);
    const at = (name: string) => names.indexOf(name);
    for (const [before, after] of [
      ['Home', 'Records'],
      ['Records', 'People'],
      ['Deals', 'Bookings'],
      ['Bookings', 'Captures'],
      ['Captures', 'Tasks'],
      ['Tasks', 'Settings'],
      ['Settings', 'Help and shortcuts'],
    ] as const) {
      expect(at(before), `${before} before ${after} in ${names.join(', ')}`).toBeLessThan(at(after));
      expect(at(before)).toBeGreaterThanOrEqual(0);
    }
    for (const tab of ['Availability', 'Booking pages', 'Forms']) expect(names).not.toContain(tab);
    // Bookings and Captures sit under Records with no label, as round 6 had them (the owner, 22 October 2026).
    expect(names).not.toContain('Scheduling');
    // Home is where the workspace opens; the trash is in neither the workspace menu nor the sidebar.
    await page.goto(`/w/${slug}`);
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/home$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
    await nav(page)
      .getByRole('button', { name: /workspace menu/ })
      .click();
    await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Trash' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    // No Trash in the sidebar either: it opens from Settings, under Workspace.
    await expect(nav(page).getByRole('link', { name: 'Trash', exact: true })).toHaveCount(0);
    await nav(page).getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByRole('navigation').getByRole('link', { name: 'Trash', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/settings/trash$`));
    await page.goto(`/w/${slug}/objects/people`);
    await expect(page).toHaveURL(objectUrl(slug, 'people'));

    const other = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: { width: 1280, height: 800 },
    });
    const second = await other.newPage();
    await signInAgain(second, email, `/w/${slug}/objects/people`, [code]);
    await expect(recordsLabel(second)).toHaveAttribute('aria-expanded', 'true');

    // Fold Records from its label, by keyboard (AC-931). The second browser follows (AC-937: within a second;
    // given room here for a busy machine, as live.flow.ts measures the timing itself). On the rail a section has no
    // label to fold, so the fold is seen to arrive before the rail goes on.
    await recordsLabel(page).focus();
    await page.keyboard.press('Enter');
    await expect(recordsLabel(page)).toHaveAttribute('aria-expanded', 'false');
    if (LIVE) await expect(recordsLabel(second)).toHaveAttribute('aria-expanded', 'false', { timeout: 10_000 });

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
    await expect(recordsLabel(page)).toHaveAttribute('aria-expanded', 'false');
    await recordsLabel(page).click();
    await expect(nav(page).getByRole('link', { name: 'Captures', exact: true })).toBeVisible();

    // Captures opens on Links with its row current, Forms a tab inside it (AC-928, AC-942; owner, 22 October 2026).
    await nav(page).getByRole('link', { name: 'Captures', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/captures/links$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Captures' })).toBeVisible();
    await expect(nav(page).getByRole('link', { name: 'Captures', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await page.getByRole('tab', { name: 'Forms' }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/captures/forms$`));
    await expect(nav(page).getByRole('link', { name: 'Captures', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // Availability is a tab of Bookings, with Bookings current.
    await nav(page).getByRole('link', { name: 'Bookings', exact: true }).click();
    await page.getByRole('tab', { name: 'Availability' }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/bookings/availability$`));
    await expect(nav(page).getByRole('link', { name: 'Bookings', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // Round 7's addresses land back inside Bookings and Captures, keeping the query, in place of their entry.
    await page.goto(`/w/${slug}/home`);
    await page.goto(`/w/${slug}/forms?from=old`);
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/captures/forms\\?from=old$`));
    await page.goto(`/w/${slug}/booking-pages`);
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/captures/links$`));
    await expect(page.getByRole('heading', { level: 1, name: 'Captures' })).toBeVisible();
    await page.goto(`/w/${slug}/availability`);
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/bookings/availability$`));
    await expect(page.getByRole('tab', { name: 'Availability' })).toHaveAttribute('aria-selected', 'true');
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/captures/links$`));
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
    const records = (on: Page) =>
      nav(on)
        .getByRole('link')
        .filter({ hasText: /^(People|Companies)$/ });
    // The drag wrapper lifts on the next frame and moves focus to its holder, and measures before it moves: a key
    // too soon is lost on a busy runner, so the move is made again (from the top) until it has landed.
    await expect(async () => {
      if ((await records(page).first().textContent()) !== 'Companies') {
        await grip.focus();
        await page.keyboard.press('Space');
        await expect(grip).not.toBeFocused({ timeout: 2_000 });
        await page.waitForTimeout(100);
        await page.keyboard.press('ArrowUp');
        await page.waitForTimeout(100);
        await page.keyboard.press('Space');
      }
      await expect(records(page).first()).toHaveText('Companies', { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    if (LIVE) await expect(records(second).first()).toHaveText('Companies', { timeout: 10_000 });

    // Records below Bookings and Captures from the keyboard on its section grip (its menu holds no Move up or
    // down): past Lists first (an owner sees it empty, with its New list, spec 0048), then past Scheduling.
    const sectionGrip = nav(page).getByRole('button', { name: 'Move the Records section' });
    const sectionDown = async () => {
      await sectionGrip.focus();
      await page.keyboard.press('Space');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Space');
    };
    await sectionDown();
    await expect(
      nav(page)
        .locator('button')
        .filter({ hasText: /^(Records|Lists)$/ })
        .first(),
    ).toHaveText('Lists');
    await sectionDown();
    await expect(firstOf(page)).toHaveText('Bookings');

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
    await expect(firstOf(page)).toHaveText('Bookings');
    await dialog.getByRole('button', { name: 'Reset to default' }).click();
    await confirm.getByRole('button', { name: 'Reset sidebar' }).click();
    await expect(confirm).toHaveCount(0);
    await expect(firstOf(page)).toHaveText('Records');
    await expect(records(page).first()).toHaveText('People');
    await dialog.getByRole('button', { name: 'Done' }).click();

    // A reload keeps the reset (AC-936).
    await page.reload();
    await expect(firstOf(page)).toHaveText('Records');
    await other.close();
  });
});
