// Table seating end to end (spec 0066 B7 lite), as a newcomer walks it in an empty workspace "Somewhere": install
// Table seating (the place opens for lunch and dinner, Tuesday to Sunday), add tables, check the rules and publish; a
// guest reserves at phone width, finds and changes the reservation, then cancels another; the guest's closed page,
// a time taken meanwhile and a bad manage link each leave a way on; staff seat and finish on the Reservations list (a
// double tap on Seat never finishes the table), open a table from the floor, and seat a walk in at a free table, and
// a second browser's floor follows. FLOW_SCREENSHOTS=<dir> keeps a picture of each screen, light and dark, at 390
// and 1280.
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

  await test.step('the Reservations page before anything is set: Online booking says what is missing', async () => {
    await page.goto(`/w/${slug}/reservations`);
    // One page: the day, with the way to online booking while guests can't reserve yet.
    await expect(page.getByText('Guests can’t reserve online yet.')).toBeVisible({ timeout: 15_000 });
    await shots(page, '04-reservations-empty');
    await page.getByRole('button', { name: 'Set up online booking' }).click();
    const sheet = page.getByRole('dialog', { name: 'Online booking' });
    // The first place opened with lunch and dinner, Tuesday to Sunday: only the tables are missing.
    await expect(sheet.getByText('Add a table guests can book online.')).toBeVisible();
    // One save: the sheet's foot.
    await expect(sheet.getByRole('button', { name: 'Save settings' })).toHaveCount(1);
    // Publishing before anything is set: refused, with the one thing to fix and the way to it.
    await sheet.getByText('Accept online bookings', { exact: true }).click();
    await sheet.getByRole('button', { name: 'Save settings' }).click();
    await expect(sheet.getByRole('link', { name: 'Fix it' }).first()).toBeVisible();
    await shots(page, '05-publish-refused');
  });

  await test.step('opening hours: lunch and dinner, Tuesday to Sunday, from the first install', async () => {
    await page.getByRole('dialog', { name: 'Online booking' }).getByRole('link', { name: 'Fix it' }).first().click();
    // The drawer's way out is a link: the switch turned on wasn't saved, and stays off.
    await expect(page).toHaveURL(/\/settings\/business\/places\//);
    await expect(page.getByRole('switch', { name: 'Monday' })).not.toBeChecked({ timeout: 15_000 });
    await expect(page.getByRole('switch', { name: 'Tuesday' })).toBeChecked();
    await expect(page.getByRole('button', { name: /Tuesday from$/ }).first()).toContainText('12:00 PM');
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
    await page.getByRole('button', { name: 'Online booking' }).click();
    const sheet = page.getByRole('dialog', { name: 'Online booking' });
    await expect(sheet.getByLabel('Max party')).toHaveValue('8', { timeout: 15_000 });
    // A number that isn't one says so under its field, never quietly becomes a default.
    await sheet.getByLabel('Max party').fill('lots');
    await sheet.getByRole('button', { name: 'Save settings' }).click();
    await expect(sheet.getByText('Give a number.')).toBeVisible();
    await expect(sheet.getByLabel('Max party')).toBeFocused();
    await shots(page, '07b-setup-field-error');
    await sheet.getByLabel('Max party').fill('8');
    await sheet.getByLabel('Min lead').fill('0');
    await sheet.getByText('Accept online bookings', { exact: true }).click();
    await sheet.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Your reservation page is live.')).toBeVisible({ timeout: 10_000 });
    // Published, the sheet stays, its top the page's link.
    await expect(sheet.getByText('Your page is live')).toBeVisible();
    const link = await sheet.getByRole('link', { name: 'Open page' }).getAttribute('href');
    key = /\/r\/([A-Za-z0-9_-]{16})/.exec(link ?? '')?.[1] ?? '';
    expect(key).not.toBe('');
    await shots(page, '08-reservations-live');
    // Taking it offline asks first; Keep taking them changes nothing.
    await sheet.getByText('Accept online bookings', { exact: true }).click();
    await sheet.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByRole('dialog', { name: 'Stop taking reservations online?' })).toBeVisible();
    await shot(page, '09-stop-asks');
    await page.getByRole('button', { name: 'Keep taking them' }).click();
    await expect(sheet.getByText('Your page is live')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /^Discard/ }).click();
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
    // "Somewhere / Somewhere": the place named as its business shows once.
    expect(await phone.getByText('Somewhere', { exact: true }).count()).toBeLessThan(2);
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
    // The day's times under its own service windows.
    await expect(phone.getByText('Lunch', { exact: true })).toBeVisible();
    await expect(phone.getByText('Dinner', { exact: true })).toBeVisible();
    // Reserve is never a dead button: with no time yet it takes the guest to the first one.
    await phone.getByRole('button', { name: 'Choose a time' }).click();
    await expect(slot).toBeFocused();
    await shot(phone, '11-guest-times');
    await slot.click();
    await phone.getByRole('button', { name: /^Reserve .* for 4$/ }).click();
    await phone.getByLabel('Your name').fill('Grace Hopper');
    await phone.getByLabel('Email').fill('grace@navy.example');
    await phone.getByLabel(/Number to call/).fill('7946 000000');
    await phone
      .getByRole('radio', { name: 'Birthday' })
      .or(phone.getByRole('button', { name: 'Birthday', exact: true }))
      .first()
      .click();
    await shot(phone, '12-guest-details');
    await phone.getByRole('button', { name: 'Reserve', exact: true }).click();
    await expect(phone).toHaveURL(/\/r\/[A-Za-z0-9_-]{16}\/manage#/, { timeout: 15_000 });
    await expect(phone.getByText('Reservation code')).toBeVisible();
    manageUrl = phone.url();
    // The calendar file comes by POST with the token in the body, then saves.
    const file = phone.waitForEvent('download');
    await phone.getByRole('button', { name: /Apple/ }).click();
    expect((await file).suggestedFilename()).toBe('reservation.ics');
    await shots(phone, '13-guest-reserved');
  });

  await test.step('the guest changes the party to 2 and moves the time', async () => {
    await phone.getByRole('button', { name: 'Change time' }).click();
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

  await test.step('dead ends that leave a way on: a bad link, a closed window, a time taken meanwhile', async () => {
    const other = await guest.newPage();
    // A manage link that opens nothing: Try again, and Find your reservation.
    await other.goto(`/r/${key}/manage#${'x'.repeat(32)}`);
    await expect(other.getByRole('button', { name: 'Try again' })).toBeVisible({ timeout: 10_000 });
    await expect(other.getByRole('link', { name: 'Find your reservation' })).toBeVisible();
    await shots(other, '16b-guest-bad-link');
    // No day open in the window: the closed message with the phone, never a spinner.
    await other.route(`**/api/public/tables/${key}`, async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as { hours: unknown };
      await route.fulfill({ response, json: { ...body, hours: { weekly: {}, exceptions: [] } } });
    });
    await other.goto(`/r/${key}`);
    await expect(other.getByText('No days open for reservations right now.')).toBeVisible({ timeout: 10_000 });
    await shots(other, '16c-guest-closed');
    await other.unroute(`**/api/public/tables/${key}`);
    // A time taken meanwhile, with nothing else offered: a warning, and the day's times read again.
    let timesRead = 0;
    await other.route(`**/api/public/tables/${key}/times**`, async (route) => {
      timesRead += 1;
      await route.continue();
    });
    await other.route(`**/api/public/tables/${key}/reserve`, (route) =>
      route.fulfill({ status: 409, json: { code: 'SLOT_TAKEN', message: 'That time was just taken.', next: [] } }),
    );
    await other.goto(`/r/${key}`);
    await other.locator('button[data-day]:not([disabled])').nth(1).click();
    await other
      .locator('button[aria-pressed]')
      .filter({ hasText: /PM|AM|:/ })
      .first()
      .click();
    await other.getByRole('button', { name: /^Reserve .* for 2$/ }).click();
    await other.getByLabel('Your name').fill('Ada Lovelace');
    await other.getByLabel('Email').fill('ada@engine.example');
    await other.getByLabel(/Number to call/).fill('7946 000001');
    const before = timesRead;
    await other.getByRole('button', { name: 'Reserve', exact: true }).click();
    await expect(other.getByText('That time was just taken. Pick another time below, or another day.')).toBeVisible({
      timeout: 10_000,
    });
    await expect.poll(() => timesRead).toBeGreaterThan(before);
    await shots(other, '16d-guest-slot-taken');
    await other.close();
  });

  await test.step('the host runs the day: seat, then finish, with Undo; the floor follows in another browser', async () => {
    // The reservation's day on the Reservations page (Service's old address redirects there).
    await phone.goto(manageUrl);
    await page.goto(`/w/${slug}/service`);
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/reservations`));
    await expect(page.getByRole('heading', { name: /^Bookings/ })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Next day' }).click();
    await expect(page.getByRole('rowheader', { name: /Grace Hopper/ })).toBeVisible({ timeout: 10_000 });
    await shots(page, '20-service-list');
    const floor = await page.context().newPage();
    await floor.goto(`/w/${slug}/reservations`);
    await floor.getByRole('button', { name: 'Next day' }).click();
    await floor.locator('label:has(input[value="floor"])').click();
    // A double tap on Seat seats once: the row's action stays Seat, pending, until the server answers.
    await page.route('**/api/rpc/tables/setStatus**', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.continue();
    });
    await page.getByRole('button', { name: 'Seat', exact: true }).dblclick();
    await expect(page.getByRole('button', { name: 'Finish', exact: true })).toHaveCount(0);
    await expect(page.getByText('Grace Hopper: Seated')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('row', { name: /Grace Hopper/ }).getByText('Seated', { exact: true })).toBeVisible();
    await page.unroute('**/api/rpc/tables/setStatus**');
    await floor.reload();
    await floor.getByRole('button', { name: 'Next day' }).click();
    await floor.locator('label:has(input[value="floor"])').click();
    await expect(floor.getByText('Seated', { exact: true }).first()).toBeVisible({ timeout: 70_000 });
    await shots(floor, '21-service-floor');
    // A tile opens its table, with the row's actions.
    await floor.getByRole('button', { name: 'T1', exact: true }).click();
    await expect(floor.getByRole('dialog', { name: 'Table T1' })).toBeVisible();
    await shots(floor, '22-table-detail');
    await floor.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Finish', exact: true }).click();
    await expect(page.getByText('Grace Hopper: Finished')).toBeVisible();
    await page
      .getByText('Grace Hopper: Finished')
      .locator('xpath=ancestor::*[.//button[normalize-space()="Undo"]][1]')
      .getByRole('button', { name: 'Undo' })
      .click();
    await expect(page.getByRole('button', { name: 'Finish', exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Grace Hopper: back as it was')).toBeVisible({ timeout: 10_000 });
    await floor.close();
  });

  await test.step('a walk in: party size, then the free tables that fit, then seat now', async () => {
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    await page.getByRole('button', { name: 'Walk in' }).click();
    const dialog = page.getByRole('dialog', { name: 'Seat a walk in' });
    await dialog
      .getByRole('radio', { name: '6' })
      .or(dialog.getByRole('button', { name: '6', exact: true }))
      .first()
      .click();
    await expect(dialog.getByText(/T7 · 8/)).toBeVisible({ timeout: 10_000 });
    // Two guests are picked to start with, and the name is there at once.
    await dialog.getByLabel(/Guest name/).fill('Linus');
    await shots(page, '23-walk-in');
    await dialog.getByRole('button', { name: 'Seat now' }).click();
    await expect(page.getByText('Walk in seated at T7, 6 guests')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('rowheader', { name: /Linus/ })).toBeVisible({ timeout: 10_000 });
    await shots(page, '24-service-walk-in-seated');
    await page.locator('label:has(input[value="floor"])').click();
    await shots(page, '25-floor-today');
    await page.locator('label:has(input[value="list"])').click();
  });

  await test.step('the guest cancels; the Reservations list shows it cancelled', async () => {
    // The same address with its fragment is a same document move: reload, as a guest opening it later would.
    await phone.goto(manageUrl);
    await phone.reload();
    await expect(phone.getByText('Reservation code')).toBeVisible({ timeout: 10_000 });
    // Seated: nothing left to change online.
    await expect(phone.getByRole('button', { name: 'Cancel reservation' })).toHaveCount(0);
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
    await phone.getByRole('button', { name: 'Reserve', exact: true }).click();
    await expect(phone.getByText('Reservation code')).toBeVisible({ timeout: 15_000 });
    await phone.getByRole('button', { name: 'Cancel reservation' }).click();
    const confirm = phone.getByRole('alertdialog').or(phone.getByRole('dialog'));
    await expect(confirm.getByRole('heading', { name: 'Cancel your table for 2 at Somewhere?' })).toBeVisible();
    await expect(confirm.getByRole('button', { name: 'Keep reservation' })).toBeVisible();
    await shot(phone, '18a-guest-cancel-asks');
    await confirm.getByRole('button', { name: 'Cancel reservation' }).click();
    await expect(phone.getByText('Your reservation is cancelled.')).toBeVisible({ timeout: 10_000 });
    await shots(phone, '18-guest-cancelled');
    await guest.close();
    await page.reload();
    await page.getByRole('button', { name: 'Next day' }).click();
    await expect(page.getByText('Cancelled', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  });
});
