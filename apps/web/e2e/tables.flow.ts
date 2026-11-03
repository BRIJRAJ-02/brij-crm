// Table seating end to end (spec 0066 B7 lite), as a newcomer walks it in an empty workspace "Somewhere": install
// Table seating, set the hours, add tables, check the rules and publish; a guest reserves at phone width, finds and
// changes the reservation, then cancels another; staff seat and finish on the Service list, and a second browser's
// floor follows. FLOW_SCREENSHOTS=<dir> keeps a picture of each screen, light and dark, at 390 and 1280.
//
// Business apps are behind Timefix's early access: the flow opens it for the new workspace with the local cluster's
// owner (FLOW_OWNER_DB, the database name; `docker exec` into the compose Postgres), as the operator console would.
import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { codeFor } from './mailpit.ts';
import { firstRun } from './people.ts';

const SHOTS = process.env.FLOW_SCREENSHOTS;
const DB = process.env.FLOW_OWNER_DB ?? 'crm';

/** A screenshot of the page as it is, in both themes, at its current width. */
async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS === undefined) return;
  const width = page.viewportSize()?.width ?? 1280;
  for (const theme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${SHOTS}/${name}-${theme}-${String(width)}.png`, fullPage: true });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

/** The same screen at both widths. */
async function shots(page: Page, name: string): Promise<void> {
  const before = page.viewportSize() ?? { width: 1280, height: 900 };
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await shot(page, name);
  }
  await page.setViewportSize(before);
}

/** Opens early access for the workspace, as the operator console's switch does. */
function openEarlyAccess(slug: string): void {
  execFileSync('docker', [
    'exec',
    'crm-postgres-1',
    'sh',
    '-c',
    `psql -U "$POSTGRES_USER" -d ${DB} -c "update workspaces set early_access = '{business_apps}' where slug = '${slug}'"`,
  ]);
}

test.describe.configure({ mode: 'serial' });

test('a newcomer sets up Table seating, a guest reserves, the host runs service', async ({ page }) => {
  test.setTimeout(360_000);
  const slug = `somewhere-${String(Date.now()).slice(-6)}`;
  const email = `owner-${String(Date.now()).slice(-6)}@somewhere.example`;

  await test.step('sign in and make the workspace', async () => {
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: /^Continue( with email)?$/ }).click();
    await expect(page).toHaveURL(/\/verify/);
    await page.getByLabel('Code').fill(await codeFor(page.request, email));
    await firstRun(page, slug, 'Sam Host');
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/home$`), { timeout: 30_000 });
    openEarlyAccess(slug);
  });

  await test.step('install Table seating from Settings, Apps', async () => {
    await page.goto(`/w/${slug}/settings/apps`);
    await shot(page, '01-apps');
    await page.getByRole('button', { name: 'Install Table seating' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Business name').fill('Somewhere');
    await shot(page, '02-business-card');
    await dialog.getByRole('button', { name: 'Install' }).click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });
    await shot(page, '03-installed');
  });

  await test.step('the Reservations page before anything is set: the checklist says what is missing', async () => {
    await page.goto(`/w/${slug}/reservations`);
    await expect(page.getByText('Take reservations online')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Set your opening hours, so guests see times.')).toBeVisible();
    await shots(page, '04-reservations-empty');
    // Publish before anything is set: refused, with the one thing to fix and the way to it.
    await page.getByRole('button', { name: 'Publish', exact: true }).last().click();
    await expect(page.getByText('Set your opening hours, so guests see times.').last()).toBeVisible();
    await shots(page, '05-publish-refused');
  });

  await test.step('opening hours, every day 12:00 PM to 10:00 PM', async () => {
    await page.getByRole('link', { name: 'Fix it' }).click();
    await expect(page).toHaveURL(/\/settings\/business\/places\//);
    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
      await page.getByText(day, { exact: true }).click();
      await expect(page.getByRole('switch', { name: day })).toBeChecked();
    }
    await page.getByRole('button', { name: 'Set all days' }).click();
    await page.getByRole('button', { name: /All days start/ }).click();
    await page
      .getByRole('listbox', { name: 'All days start' })
      .getByRole('option', { name: '12:00 PM', exact: true })
      .click();
    await page.getByRole('button', { name: /All days end/ }).click();
    await page
      .getByRole('listbox', { name: 'All days end' })
      .getByRole('option', { name: '10:00 PM', exact: true })
      .click();
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('Saved').first()).toBeVisible({ timeout: 10_000 });
    // Every day took the new hours, not only the last one (walk of 4 Nov 2026), and keeps them after a reload.
    await page.reload();
    for (const day of ['Monday', 'Thursday', 'Sunday']) {
      await expect(page.getByRole('button', { name: new RegExp(`${day} from$`) })).toContainText('12:00 PM');
      await expect(page.getByRole('button', { name: new RegExp(`${day} until$`) })).toContainText('10:00 PM');
    }
    await shot(page, '06-hours');
  });

  await test.step('tables: T1 to T6 for 2 to 4, and T7 for 4 to 8', async () => {
    const add = async (from: string, to: string, fewest: string, most: string) => {
      await page.getByRole('button', { name: 'Add tables' }).first().click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('textbox', { name: 'From', exact: true }).fill(from);
      await dialog.getByRole('textbox', { name: 'To', exact: true }).fill(to);
      await dialog.getByRole('textbox', { name: 'Fewest', exact: true }).fill(fewest);
      await dialog.getByRole('textbox', { name: 'Most', exact: true }).fill(most);
      await dialog.getByRole('button', { name: /^Add/ }).last().click();
      await expect(dialog).toBeHidden({ timeout: 10_000 });
    };
    await add('1', '6', '2', '4');
    await add('7', '7', '4', '8');
    await expect(page.getByRole('rowheader', { name: 'T7' })).toBeVisible();
    await shot(page, '07-tables');
  });

  let key = '';
  await test.step('rules saved and the page published', async () => {
    await page.goto(`/w/${slug}/reservations`);
    await expect(page.getByLabel('Largest party')).toHaveValue('8', { timeout: 15_000 });
    await page.getByLabel('Book at least').fill('0');
    await page.getByRole('button', { name: 'Publish', exact: true }).last().click();
    await expect(page.getByText('Your reservation page is live.')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Your page is live' })).toBeVisible();
    const link = await page.getByRole('link', { name: 'Open page' }).getAttribute('href');
    key = /\/r\/([A-Za-z0-9_-]{16})/.exec(link ?? '')?.[1] ?? '';
    expect(key).not.toBe('');
    await shots(page, '08-reservations-live');
  });

  const guest = await page
    .context()
    .browser()
    ?.newContext({ viewport: { width: 390, height: 844 } });
  if (guest === undefined) throw new Error('No second context.');
  const phone = await guest.newPage();
  let manageUrl = '';
  await test.step('a guest reserves at phone width: party, day, time, details, reserved', async () => {
    await phone.goto(`/r/${key}`);
    await expect(phone.getByRole('heading', { name: 'Reserve a table' })).toBeVisible({ timeout: 15_000 });
    await shot(phone, '10-guest-party');
    await phone
      .getByRole('radio', { name: '4' })
      .or(phone.getByRole('button', { name: '4', exact: true }))
      .first()
      .click();
    await phone.locator('button[data-day]:not([disabled])').nth(1).click();
    const slot = phone
      .locator('button[aria-pressed]')
      .filter({ hasText: /PM|AM|:/ })
      .first();
    await expect(slot).toBeVisible({ timeout: 10_000 });
    await shot(phone, '11-guest-times');
    await slot.click();
    await phone.getByRole('button', { name: /^Reserve .* for 4$/ }).click();
    await phone.getByLabel('Your name').fill('Grace Hopper');
    await phone.getByLabel('Email').fill('grace@navy.example');
    await phone.getByLabel(/Number to call/).fill('7946 000000');
    await shot(phone, '12-guest-details');
    await phone.getByRole('button', { name: /^Confirm/ }).click();
    await expect(phone).toHaveURL(/\/r\/[A-Za-z0-9_-]{16}\/manage#/, { timeout: 15_000 });
    await expect(phone.getByText('Reservation code')).toBeVisible();
    manageUrl = phone.url();
    await shots(phone, '13-guest-reserved');
  });

  await test.step('the guest changes the party to 2 and moves the time', async () => {
    await phone.getByRole('button', { name: 'Move to another time' }).click();
    await phone
      .getByRole('group', { name: /^Guests/ })
      .or(phone.getByRole('radiogroup', { name: /^Guests/ }))
      .getByText('2', { exact: true })
      .click();
    const later = phone
      .locator('button[aria-pressed]')
      .filter({ hasText: /PM|AM|:/ })
      .nth(2);
    await later.click();
    await shots(phone, '14-guest-change');
    await phone.getByRole('button', { name: /^Save change/ }).click();
    await expect(phone.getByText('Your reservation is changed.')).toBeVisible({ timeout: 10_000 });
    await shot(phone, '15-guest-changed');
  });

  await test.step('without the link: found by code and email', async () => {
    const code =
      (await phone
        .getByText(/^[A-HJ-NP-Z2-9]{8}$/)
        .first()
        .textContent()) ?? '';
    const other = await guest.newPage();
    await other.goto(`/r/${key}/manage`);
    await other.getByLabel('Reservation code').fill(code.toLowerCase());
    await other.getByLabel('Email').fill('GRACE@navy.example');
    await shot(other, '16-guest-find');
    await other.getByRole('button', { name: 'Find reservation' }).click();
    await expect(other.getByText(code)).toBeVisible({ timeout: 10_000 });
    await other.close();
  });

  await test.step('the host runs the day: seat, then finish, with Undo; the floor follows in another browser', async () => {
    // The reservation's day on the Service list.
    await phone.goto(manageUrl);
    await page.goto(`/w/${slug}/service`);
    await expect(page.getByText('Covers booked')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Next day' }).click();
    await expect(page.getByRole('rowheader', { name: /Grace Hopper/ })).toBeVisible({ timeout: 10_000 });
    await shots(page, '20-service-list');
    const floor = await page.context().newPage();
    await floor.goto(`/w/${slug}/service`);
    await floor.getByRole('button', { name: 'Next day' }).click();
    await floor.getByText('Floor', { exact: true }).click();
    await page.getByRole('button', { name: 'Seat', exact: true }).click();
    await expect(page.getByText('Grace Hopper: Seated')).toBeVisible();
    await floor.reload();
    await floor.getByRole('button', { name: 'Next day' }).click();
    await floor.getByText('Floor', { exact: true }).click();
    await expect(floor.getByText('Seated', { exact: true }).first()).toBeVisible({ timeout: 70_000 });
    await shots(floor, '21-service-floor');
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await expect(page.getByText('Grace Hopper: Finished')).toBeVisible();
    await page
      .getByText('Grace Hopper: Finished')
      .locator('xpath=ancestor::*[.//button[normalize-space()="Undo"]][1]')
      .getByRole('button', { name: 'Undo' })
      .click();
    await expect(page.getByRole('button', { name: 'Finish', exact: true })).toBeVisible({ timeout: 10_000 });
    await floor.close();
  });

  await test.step('the guest cancels; the Service list shows it cancelled', async () => {
    // The same address with its fragment is a same document move: reload, as a guest opening it later would.
    await phone.goto(manageUrl);
    await phone.reload();
    await expect(phone.getByText('Reservation code')).toBeVisible({ timeout: 10_000 });
    // Seated: nothing left to change online.
    await expect(phone.getByRole('button', { name: 'Cancel booking' })).toHaveCount(0);
    await shot(phone, '17-guest-manage-seated');
    // A second reservation, cancelled by its guest.
    await phone.goto(`/r/${key}`);
    await phone.locator('button[data-day]:not([disabled])').nth(1).click();
    await phone
      .locator('button[aria-pressed]')
      .filter({ hasText: /PM|AM|:/ })
      .nth(6)
      .click();
    await phone.getByRole('button', { name: /^Reserve .* for 2$/ }).click();
    await phone.getByLabel('Your name').fill('Ada Lovelace');
    await phone.getByLabel('Email').fill('ada@engine.example');
    await phone.getByLabel(/Number to call/).fill('7946 000001');
    // A person takes more than the bot check's 2 seconds from opening the page to confirming.
    await phone.waitForTimeout(2_100);
    await phone.getByRole('button', { name: /^Confirm/ }).click();
    await expect(phone.getByText('Reservation code')).toBeVisible({ timeout: 15_000 });
    await phone.getByRole('button', { name: 'Cancel booking' }).click();
    await phone
      .getByRole('alertdialog')
      .or(phone.getByRole('dialog'))
      .getByRole('button', { name: 'Cancel booking' })
      .click();
    await expect(phone.getByText('Your reservation is cancelled.')).toBeVisible({ timeout: 10_000 });
    await shots(phone, '18-guest-cancelled');
    await guest.close();
    await page.reload();
    await page.getByRole('button', { name: 'Next day' }).click();
    await expect(page.getByText('Cancelled', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });
});
