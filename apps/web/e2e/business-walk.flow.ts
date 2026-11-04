// The hospitality release end to end (spec 0065 H1, spec 0066 B4 lite and B7 lite, as they land together): in an
// empty workspace "Somewhere", install Menu and Table seating, keep the business, its place and the place's
// restaurant week, publish a menu, the table service and the business page; then a guest opens /<handle>, sees the
// Menu section, Reserve opens /r/<key>, books a table, and opens the whole menu at /m/<key>. Each step is a
// screenshot when FLOW_SCREENSHOTS names a folder. Business apps are behind Timefix's early access: the flow opens it
// with the owner connection (`FLOW_OWNER_URL`, a local database), as the operator console would; without it the
// flow is skipped.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { newWorkspace } from './people.ts';

const OWNER_URL = process.env.FLOW_OWNER_URL;
const SHOTS = process.env.FLOW_SCREENSHOTS;

/** A screenshot of the page as it stands, named for the step. */
async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  const width = String(page.viewportSize()?.width ?? 0);
  await page.screenshot({ path: join(SHOTS, `${name}-${width}.png`), fullPage: true, animations: 'disabled' });
}

test.describe('the business page with Menu and Table seating', () => {
  test.use({ locale: 'en-GB', timezoneId: 'Europe/London', actionTimeout: 15_000 });
  test.skip(OWNER_URL === undefined, 'Needs FLOW_OWNER_URL to open business apps for the new workspace.');

  test('install both apps, publish the menu, the tables and the page; a guest reserves and reads the menu', async ({
    page,
    browser,
  }) => {
    test.setTimeout(300_000);
    const stamp = String(Date.now()).slice(-6);
    const slug = `somewhere-${stamp}`;
    const handle = `somewhere-biz-${stamp}`;

    await test.step('a new person makes the Somewhere workspace', async () => {
      await newWorkspace(page, `${slug}@example.com`, slug);
      execFileSync('psql', [
        OWNER_URL ?? '',
        '-c',
        `update workspaces set early_access = '{business_apps}', name = 'Somewhere' where slug = '${slug}'`,
      ]);
    });

    await test.step('install Menu with the business card: the business and its place', async () => {
      await page.goto(`/w/${slug}/settings/apps`);
      await page.getByRole('button', { name: 'Install Menu', exact: true }).click();
      const card = page.getByRole('dialog');
      await card.getByLabel('Business name').fill('Somewhere');
      await card.getByLabel('Address', { exact: true }).fill('1 Example Street');
      await card.getByLabel('City', { exact: true }).fill('London');
      await shot(page, '01-business-card');
      await card.getByRole('button', { name: 'Install', exact: true }).click();
      await expect(card).toBeHidden({ timeout: 15_000 });
    });

    await test.step('install Table seating beside it', async () => {
      await page.getByRole('button', { name: 'Install Table seating', exact: true }).click();
      const dialog = page.getByRole('dialog');
      if (await dialog.isVisible().catch(() => false)) {
        await dialog.getByRole('button', { name: /^Install/ }).click();
        await expect(dialog).toBeHidden({ timeout: 15_000 });
      }
      await expect(page.getByRole('button', { name: 'Install Table seating', exact: true })).toBeHidden({
        timeout: 15_000,
      });
      await shot(page, '02-apps-installed');
    });

    let placeId = '';
    await test.step('the place keeps a restaurant’s week; add four tables', async () => {
      placeId = await page.evaluate(async (workspace) => {
        const response = await fetch('/api/rpc/hospitality/business', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ json: { workspace } }),
        });
        return ((await response.json()) as { json: { places: { id: string }[] } }).json.places[0]?.id ?? '';
      }, slug);
      await page.goto(`/w/${slug}/settings/business/places/${placeId}`);
      await expect(page.getByRole('switch', { name: 'Tuesday', exact: true })).toBeChecked({ timeout: 15_000 });
      await expect(page.getByRole('switch', { name: 'Monday', exact: true })).not.toBeChecked();
      await page.getByRole('button', { name: 'Add tables' }).first().click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('textbox', { name: 'From', exact: true }).fill('1');
      await dialog.getByRole('textbox', { name: 'To', exact: true }).fill('4');
      await dialog.getByRole('textbox', { name: 'Fewest', exact: true }).fill('2');
      await dialog.getByRole('textbox', { name: 'Most', exact: true }).fill('4');
      await dialog.getByRole('button', { name: /^Add/ }).last().click();
      await expect(dialog).toBeHidden({ timeout: 10_000 });
      await expect(page.getByRole('rowheader', { name: 'T4' })).toBeVisible();
      await shot(page, '03-place');
    });
    expect(placeId).not.toBe('');

    await test.step('a menu with two dishes, published', async () => {
      await page.goto(`/w/${slug}/menus`);
      await page.getByRole('button', { name: 'New menu' }).first().click();
      await expect(page.getByRole('tab', { name: /Dinner/ })).toBeVisible();
      for (const [name, price] of [
        ['Edamame', '5.5'],
        ['Ramen', '14'],
      ] as const) {
        const add = page.getByLabel('Add dishes').first();
        await add.fill(name);
        await expect(page.getByRole('option', { name: new RegExp(`Create “${name}”`) })).toBeVisible();
        await add.press('Enter');
        const drawer = page.getByRole('dialog', { name });
        await drawer.getByLabel('Price', { exact: true }).fill(price);
        await drawer.getByRole('button', { name: 'Save dish' }).click();
        await expect(drawer).toBeHidden();
      }
      await page.getByRole('button', { name: /^(Review and publish|Publish)$/ }).click();
      await page
        .getByRole('dialog', { name: 'Review and publish' })
        .getByRole('button', { name: 'Publish', exact: true })
        .click();
      await expect(page.getByRole('dialog', { name: 'Your menu is live' })).toBeVisible();
      await shot(page, '04-menu-live');
      await page.getByRole('button', { name: 'Done' }).click();
    });

    let key = '';
    await test.step('the table service published', async () => {
      await page.goto(`/w/${slug}/reservations`);
      await expect(page.getByLabel('Largest party')).toBeVisible({ timeout: 15_000 });
      await page.getByLabel('Largest party').fill('4');
      await page.getByLabel('Book at least').fill('0');
      await page.getByRole('button', { name: 'Publish', exact: true }).click();
      await expect(page.getByText('Your reservation page is live.')).toBeVisible({ timeout: 10_000 });
      const link = await page.getByRole('link', { name: 'Open page' }).getAttribute('href');
      key = /\/r\/([A-Za-z0-9_-]{16})/.exec(link ?? '')?.[1] ?? '';
      await shot(page, '05-reservations-live');
    });
    expect(key).not.toBe('');

    await test.step('the business page: its address claimed, then published', async () => {
      await page.goto(`/w/${slug}/settings/business/page`);
      const address = page.getByLabel('Page address');
      await expect(address).toBeVisible({ timeout: 15_000 });
      await address.fill(handle);
      await page.getByRole('button', { name: 'Claim', exact: true }).click();
      await expect(page.getByText('Address claimed.')).toBeVisible({ timeout: 10_000 });
      await page.getByRole('button', { name: 'Publish', exact: true }).click();
      await expect(page.getByText('Published. Guests see it now.')).toBeVisible({ timeout: 10_000 });
      await shot(page, '06-page-published');
    });

    const guestContext = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      locale: 'en-GB',
      timezoneId: 'Europe/London',
    });
    const guest = await guestContext.newPage();

    await test.step('a guest opens /<handle>: the Menu section, and Reserve to /r/<key>', async () => {
      await guest.goto(`/${handle}`);
      await expect(guest.getByRole('heading', { level: 1, name: 'Somewhere' })).toBeVisible({ timeout: 15_000 });
      const menu = guest.getByRole('region', { name: 'Menu' });
      await expect(menu.getByText('Edamame')).toBeVisible();
      await expect(menu.getByText('£5.50')).toBeVisible();
      await expect(menu.getByRole('link', { name: 'See the full menu' })).toHaveAttribute('href', /^\/m\//);
      const reserve = guest.getByRole('link', { name: 'Reserve a table' }).first();
      await expect(reserve).toHaveAttribute('href', `/r/${key}`);
      await shot(guest, '07-guest-business-page');
      await reserve.click();
      await expect(guest).toHaveURL(new RegExp(`/r/${key}$`));
      await expect(guest.getByRole('heading', { name: 'Reserve a table' })).toBeVisible({ timeout: 15_000 });
    });

    await test.step('the guest books a table for 2', async () => {
      await guest
        .getByRole('radio', { name: '2' })
        .or(guest.getByRole('button', { name: '2', exact: true }))
        .first()
        .click();
      // Tomorrow, or the next open day.
      const days = guest.locator('button[data-day]:not([disabled])');
      const slot = guest
        .locator('button[aria-pressed]')
        .filter({ hasText: /PM|AM|:/ })
        .first();
      for (let day = 1; day < 8; day += 1) {
        await days.nth(day).click();
        if (await slot.isVisible({ timeout: 3_000 }).catch(() => false)) break;
      }
      await slot.click();
      await shot(guest, '08-guest-time');
      await guest.getByRole('button', { name: /^Reserve .* for 2$/ }).click();
      await guest.getByLabel('Your name').fill('Grace Hopper');
      await guest.getByLabel('Email').fill('grace@navy.example');
      await guest.getByLabel(/Number to call/).fill('7946 000000');
      // A person takes a few seconds over their details; the page's bot guard refuses a form filled faster.
      await guest.waitForTimeout(4_000);
      await guest.getByRole('button', { name: 'Reserve', exact: true }).click();
      await expect(guest).toHaveURL(/\/r\/[A-Za-z0-9_-]{16}\/manage#/, { timeout: 15_000 });
      await expect(guest.getByText('Reservation code')).toBeVisible();
      await shot(guest, '09-guest-reserved');
    });

    await test.step('then opens the whole menu from the business page', async () => {
      await guest.goto(`/${handle}`);
      await guest.getByRole('region', { name: 'Menu' }).getByRole('link', { name: 'See the full menu' }).click();
      await expect(guest).toHaveURL(/\/m\/[A-Za-z0-9_-]+$/);
      await expect(guest.getByRole('heading', { name: 'Somewhere' })).toBeVisible({ timeout: 15_000 });
      await expect(guest.getByText('Ramen')).toBeVisible();
      await shot(guest, '10-guest-menu');
    });

    await guestContext.close();
  });
});
