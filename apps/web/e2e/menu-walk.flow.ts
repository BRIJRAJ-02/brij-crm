// The Menu app's first run, end to end (spec 0065, H1; owner, 4 Nov 2026): a new person in an empty workspace called
// Somewhere installs Menu, finds the place already keeping a restaurant's week, builds a menu from nothing (a section, a dish with a photo, sizes,
// options and allergens), reorders, previews, reviews and publishes, opens the guest menu, filters, searches, picks a
// size and adds to picks, marks a dish Sold out and sees it live, edits and republishes, discards, and deletes. Each
// step is a screenshot when FLOW_SCREENSHOTS names a folder. The operator's early access switch is flipped through
// the owner connection (`FLOW_OWNER_URL`, a local database), as the operator console would; without it the flow is
// skipped.
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
  const scheme = process.env.FLOW_COLOR_SCHEME === 'dark' ? 'dark' : 'light';
  // Animations finished, so a shot never catches a radio or a sheet mid way.
  await page.screenshot({
    path: join(SHOTS, `${name}-${scheme}-${width}.png`),
    fullPage: false,
    animations: 'disabled',
  });
}

/** Dismisses every toast on the page, newest first. */
async function clearToasts(page: Page): Promise<void> {
  const dismiss = page.getByRole('region', { name: 'Notifications' }).getByRole('button', { name: 'Dismiss' });
  while ((await dismiss.count()) > 0) await dismiss.first().click();
}

/** Starts adding from a section's foot: its quiet Add item turns into the search or create field. */
async function addItem(page: Page, name: string): Promise<void> {
  const button = page.getByRole('button', { name: 'Add item', exact: true }).first();
  if (await button.isVisible()) await button.click();
  const add = page.getByLabel('Add items').first();
  await add.fill(name);
  await expect(page.getByRole('option', { name: new RegExp(`Create “${name}”`) })).toBeVisible();
  await shot(page, `08-add-${name.toLowerCase()}`);
  await add.press('Enter');
}

/** Opens the guest's address afresh and says how many of `what` it holds once it has drawn, for a poll. */
async function countAfterOpening(guest: Page, address: string, what: ReturnType<Page['getByText']>): Promise<number> {
  await guest.goto(address);
  await what
    .first()
    .waitFor({ timeout: 3_000 })
    .catch(() => undefined);
  return what.count();
}

/** The workspace's menu draft as the page's own session reads it. */
async function draftOf(page: Page, workspace: string) {
  return page.evaluate(async (slug) => {
    const response = await fetch('/api/rpc/menu/draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: { workspace: slug } }),
    });
    return ((await response.json()) as { json: { places: { id: string; menuKey: string }[] } }).json;
  }, workspace);
}

/** A one pixel square JPEG is too small to be a photo; this draws a real one in the page and hands it back. */
async function photoFile(page: Page): Promise<Buffer> {
  const data = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(800, 600);
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('No canvas.');
    const gradient = context.createRadialGradient(400, 280, 40, 400, 300, 300);
    gradient.addColorStop(0, '#f6e7c8');
    gradient.addColorStop(1, '#7a9a3a');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 800, 600);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  return Buffer.from(data);
}

test.describe('the Menu app from an empty workspace', () => {
  // A team member in London, as Somewhere's will be.
  test.use({ locale: 'en-GB', timezoneId: 'Europe/London', actionTimeout: 15_000 });
  // For review shots: FLOW_COLOR_SCHEME=dark and FLOW_WIDTH=390 draw the same walk in dark and at a phone's width.
  if (process.env.FLOW_COLOR_SCHEME === 'dark') test.use({ colorScheme: 'dark' });
  if (process.env.FLOW_WIDTH !== undefined)
    test.use({ viewport: { width: Number(process.env.FLOW_WIDTH), height: 844 } });
  test.skip(OWNER_URL === undefined, 'Needs FLOW_OWNER_URL to open business apps for the new workspace.');
  test.skip(
    ({ viewport }) => (viewport?.width ?? 0) < 1000 && process.env.FLOW_WIDTH === undefined,
    'Walked at a desktop width.',
  );

  test('install, build, publish, guest, sold out, republish, discard, delete', async ({ page, context }) => {
    test.setTimeout(240_000);
    const slug = `somewhere-${String(Date.now()).slice(-6)}`;
    const email = `${slug}@example.com`;

    await test.step('a new person makes the Somewhere workspace', async () => {
      await newWorkspace(page, email, slug);
      execFileSync('psql', [
        OWNER_URL ?? '',
        '-c',
        `update workspaces set early_access = '{business_apps}', name = 'Somewhere' where slug = '${slug}'`,
      ]);
    });

    await test.step('install Menu with the business card', async () => {
      await page.goto(`/w/${slug}/settings/apps`);
      await shot(page, '01-apps');
      await page
        .getByRole('button', { name: /^Install/ })
        .first()
        .click();
      const card = page.getByRole('dialog');
      await expect(card).toBeVisible();
      await card.getByLabel('Business name').fill('Somewhere');
      await shot(page, '02-business-card');
      // Country, time zone and currency start from the person's own, so Install works at once.
      await card.getByRole('button', { name: 'Install', exact: true }).click();
      await page.waitForTimeout(1500);
      await shot(page, '02b-after-install');
      await expect(card).toBeHidden({ timeout: 15_000 });
      await shot(page, '03-installed');
    });

    await test.step('open Menus: the place already keeps a restaurant’s hours, so the next step is a menu', async () => {
      await page.goto(`/w/${slug}/menus`);
      await expect(page.getByRole('heading', { level: 1, name: 'Menus' })).toBeVisible();
      // Hours are done, so the checklist's next action is the first menu.
      await expect(page.getByRole('button', { name: /Make your first menu/ })).toBeVisible();
      await shot(page, '04-menus-empty');
    });

    await test.step('the new place’s week: lunch and dinner, Tuesday to Sunday, closed Monday', async () => {
      const place = (await draftOf(page, slug)).places[0];
      await page.goto(`/w/${slug}/settings/business/places/${place?.id ?? ''}`);
      await expect(page.getByRole('switch', { name: 'Tuesday', exact: true })).toBeChecked();
      await expect(page.getByRole('switch', { name: 'Sunday', exact: true })).toBeChecked();
      await expect(page.getByRole('switch', { name: 'Monday', exact: true })).not.toBeChecked();
      await shot(page, '05-business');
    });

    await test.step('make the first menu: it comes with a first section', async () => {
      await page.goto(`/w/${slug}/menus`);
      await page.getByRole('button', { name: 'New menu' }).first().click();
      // The menu is picked in the header; a first menu is Dinner, and comes with a section to fill.
      await expect(page.getByRole('button', { name: 'Menu to edit' })).toContainText('Dinner');
      await expect(page.getByRole('button', { name: 'Starters', exact: true })).toBeVisible();
      await shot(page, '07-first-menu');
    });

    await test.step('add a dish from the section: name, photo, price, allergens', async () => {
      await addItem(page, 'Edamame');
      const drawer = page.getByRole('dialog', { name: 'Edamame' });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByLabel('Name')).toHaveValue('Edamame');
      await drawer.locator('input[type=file]').setInputFiles({
        name: 'edamame.jpg',
        mimeType: 'image/jpeg',
        buffer: await photoFile(page),
      });
      // The shared cropper opens on the chosen photo in the dish's shape (spec 0068, AC-6809): keep its middle.
      const cropper = page.getByRole('dialog', { name: 'Crop photo' });
      await expect(cropper).toBeVisible();
      await shot(page, '09a-dish-crop');
      await cropper.getByRole('button', { name: 'Use photo' }).click();
      await expect(cropper).toBeHidden();
      await expect(drawer.getByRole('button', { name: 'Adjust crop' })).toBeVisible();
      await drawer.getByLabel('Price', { exact: true }).fill('5.5');
      await drawer.getByRole('button', { name: /Contains allergens/ }).click();
      await page.getByRole('option', { name: 'Soya' }).click();
      await page.keyboard.press('Escape');
      await expect(drawer.getByRole('button', { name: /Contains allergens/ })).toContainText('Soya');
      await drawer.getByRole('button', { name: /Dietary/ }).click();
      await page.getByRole('option', { name: 'Vegan' }).click();
      await page.keyboard.press('Escape');
      await shot(page, '09-dish-drawer');
      await drawer.getByRole('button', { name: 'Save item' }).click();
      await expect(drawer).toBeHidden();
      await expect(page.getByRole('row', { name: /Edamame/ }).first()).toBeVisible();
      // The photo chosen before the dish existed went up with it.
      await expect(
        page
          .getByRole('row', { name: /Edamame/ })
          .first()
          .locator('img'),
      ).toBeVisible();
      await shot(page, '10-dish-added');
    });

    await test.step('closing a drawer with changes asks first', async () => {
      await addItem(page, 'Wine');
      const drawer = page.getByRole('dialog', { name: 'Wine' });
      await expect(drawer).toBeVisible();
      await drawer.getByLabel('Description').fill('A crisp white.');
      await drawer.getByRole('button', { name: 'Cancel' }).click();
      await expect(page.getByRole('alertdialog', { name: 'Discard your changes?' })).toBeVisible();
      await shot(page, '11-unsaved-confirm');
      await page.getByRole('button', { name: 'Keep editing' }).click();
      await expect(drawer).toBeVisible();
      // Sizes: the first takes the price already typed.
      await drawer.getByLabel('Price', { exact: true }).fill('9.5');
      await drawer.getByText('Sizes', { exact: true }).click();
      await drawer.getByLabel('Size 1', { exact: true }).fill('Glass');
      await drawer.getByLabel('Size 2', { exact: true }).fill('Bottle');
      await drawer.getByLabel('Size 2 price (GBP)').fill('38');
      await shot(page, '12-sizes');
      await drawer.getByRole('button', { name: 'Save item' }).click();
      await expect(drawer).toBeHidden();
    });

    await test.step('make an option group and offer it', async () => {
      await page.getByRole('tab', { name: /^Add-ons/ }).click();
      await page.getByRole('button', { name: 'New add-on' }).first().click();
      const drawer = page.getByRole('dialog', { name: 'New add-on' });
      await drawer.getByRole('textbox', { name: 'Name' }).fill('Sides');
      await drawer.getByRole('radio', { name: 'Up to' }).click({ force: true });
      await drawer.getByRole('textbox', { name: 'Option 1' }).fill('Fries');
      await drawer.getByLabel('Price change (GBP)').first().fill('4.5');
      await drawer.getByRole('textbox', { name: 'Option 2' }).fill('Green salad');
      await drawer.getByLabel('Price change (GBP)').nth(1).fill('4');
      await shot(page, '13-option-group');
      await drawer.getByRole('button', { name: 'Save add-on' }).click();
      await expect(drawer).toBeHidden();
      await expect(page.getByRole('row', { name: /Sides/ })).toBeVisible();
      await page.getByRole('tab', { name: /^Items/ }).click();
      await page.getByRole('row', { name: /Wine/ }).click();
      const wine = page.getByRole('dialog', { name: 'Wine' });
      await wine.getByRole('button', { name: /Add-ons/ }).click();
      await page.getByRole('option', { name: 'Sides' }).click();
      await page.keyboard.press('Escape');
      await wine.getByRole('button', { name: 'Save item' }).click();
      await expect(wine).toBeHidden();
      await shot(page, '14-dishes-tab');
    });

    await test.step('reorder with the keyboard', async () => {
      await page.getByRole('tab', { name: /Structure/ }).click();
      const grip = page.getByRole('button', { name: 'Move Wine' });
      await grip.focus();
      await page.keyboard.press('Space');
      await expect(grip).not.toBeFocused();
      await page.waitForTimeout(300);
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(300);
      await page.keyboard.press('Space');
      const dishes = page.getByRole('grid', { name: 'Items in Starters' }).getByRole('row');
      await expect(dishes.first()).toContainText('Wine');
      await shot(page, '15-reordered');
    });

    await test.step('Preview at Saturday noon reads the menu then', async () => {
      // On a phone the preview opens in a sheet from its Preview button.
      const narrow = !(await page.getByRole('button', { name: /Preview on/ }).isVisible());
      if (narrow) await page.getByRole('button', { name: 'Preview', exact: true }).click();
      await page.getByRole('button', { name: /Preview on/ }).click();
      await page.getByRole('option', { name: 'Saturday' }).click();
      await expect(page).toHaveURL(/at=sat-12%3A00|at=sat-12:00/);
      await shot(page, '16b-preview-at');
      if (narrow) {
        await page.getByRole('button', { name: 'Close' }).last().click();
        await expect(page.getByRole('button', { name: /Preview on/ })).toBeHidden();
      }
    });

    await test.step('preview at a time, then review and publish', async () => {
      await shot(page, '16-preview');
      // The first publish goes through the review: "Publish & go live", or "Publish" on a phone's bar.
      await page.getByRole('button', { name: /^Publish( & go live)?$/ }).click();
      const review = page.getByRole('dialog', { name: 'Review and publish' });
      await expect(review).toBeVisible();
      // Every check passes, so the review says what goes live instead of a list of ticks.
      await expect(review).toContainText('Guests will see 2 items on Dinner.');
      await shot(page, '17-review');
      await review.getByRole('button', { name: 'Publish & go live', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Your menu is live' })).toBeVisible();
      await shot(page, '18-live');
      await page.getByRole('button', { name: 'Done' }).click();
    });

    let guestUrl = '';
    await test.step('the guest menu: its name and sections, open an item, pick a size, add to the selection', async () => {
      // Once live, the header's split button views the guest menu, and its chevron shares it.
      await page.getByRole('button', { name: 'Share menu' }).click();
      await expect(page.getByRole('menuitem', { name: 'Show QR code' })).toBeVisible();
      await page.keyboard.press('Escape');
      guestUrl = `/m/${(await draftOf(page, slug)).places[0]?.menuKey ?? ''}`;
      const guest = await context.newPage();
      await guest.goto(guestUrl);
      await expect(guest.getByRole('heading', { level: 1, name: 'Dinner' })).toBeVisible();
      await expect(guest.getByRole('banner').getByText('Somewhere')).toBeVisible();
      await expect(guest.getByRole('tab', { name: 'Starters' })).toBeVisible();
      await shot(guest, '19-guest');
      await guest.getByRole('button', { name: /^Wine/ }).first().click();
      const sheet = guest.getByRole('dialog', { name: 'Wine' });
      await guest.getByRole('radio', { name: /Bottle/ }).click({ force: true });
      await expect(guest.getByRole('radio', { name: /Bottle/ })).toBeChecked();
      await expect(sheet.getByRole('button', { name: /Add to selection.*£38\.00/ })).toBeVisible();
      await shot(guest, '20-guest-sheet');
      await sheet.getByRole('button', { name: /Add to selection/ }).click();
      await expect(guest.getByRole('button', { name: /View selection/ })).toBeVisible();
      await shot(guest, '21-guest-picks');
      await guest.close();
    });

    await test.step('sold out goes live at once', async () => {
      // On the row, a quick action beside its ⋯ (on a phone, in its ⋯).
      if ((page.viewportSize()?.width ?? 0) >= 640) {
        await page.getByRole('button', { name: 'Mark Edamame sold out' }).click();
      } else {
        await page.getByRole('button', { name: 'More for Edamame' }).click();
        await page.getByRole('menuitem', { name: 'Mark sold out' }).click();
      }
      await expect(page.getByText('Edamame sold out. Guests see it now.')).toBeVisible();
      await shot(page, '22a-sold-out-toast');
      const guest = await context.newPage();
      await expect
        .poll(() => countAfterOpening(guest, guestUrl, guest.getByText('Sold out')), { timeout: 20_000 })
        .toBeGreaterThan(0);
      await shot(guest, '22-guest-sold-out');
      await guest.close();
    });

    await test.step('take the live menu down, then put it back (Live or Hidden)', async () => {
      await page.getByRole('button', { name: 'Live', exact: true }).click();
      await expect(page.getByRole('menuitemradio', { name: /Hidden/ })).toBeVisible();
      await shot(page, '22c-live-hidden-menu');
      await page.getByRole('menuitemradio', { name: /Hidden/ }).click();
      const ask = page.getByRole('alertdialog', { name: 'Hide the menu from guests?' });
      await expect(ask).toBeVisible();
      await shot(page, '22d-hide-confirm');
      await ask.getByRole('button', { name: 'Hide menu' }).click();
      await expect(page.getByRole('button', { name: 'Hidden', exact: true })).toBeVisible();
      const guest = await context.newPage();
      await expect
        .poll(
          () =>
            countAfterOpening(
              guest,
              guestUrl,
              guest.getByRole('heading', { name: 'This menu isn’t available right now' }),
            ),
          { timeout: 20_000 },
        )
        .toBeGreaterThan(0);
      await expect(guest.getByText('Somewhere').first()).toBeVisible();
      await expect(guest.getByText('Edamame')).toHaveCount(0);
      await shot(guest, '22e-guest-hidden');
      await page.getByRole('button', { name: 'Hidden', exact: true }).click();
      await page.getByRole('menuitemradio', { name: /Live/ }).click();
      await expect(page.getByRole('button', { name: 'Live', exact: true })).toBeVisible();
      // "Menu live again" is said; put the toasts away so none sits over the next drawer's footer.
      await expect(page.getByText('Menu live again. Guests see it now.')).toBeVisible();
      await clearToasts(page);
      await expect
        .poll(() => countAfterOpening(guest, guestUrl, guest.getByText('Edamame')), { timeout: 20_000 })
        .toBeGreaterThan(0);
      await guest.close();
    });

    await test.step('edit and republish, then discard an edit', async () => {
      await page
        .getByRole('row', { name: /Edamame/ })
        .first()
        .click();
      const drawer = page.getByRole('dialog', { name: 'Edamame' });
      await drawer.getByLabel('Price', { exact: true }).fill('6');
      await drawer.getByRole('button', { name: 'Save item' }).click();
      await expect(drawer).toBeHidden();
      // Once live, Publish · N drafts publishes at once; with nothing new, the same button is View.
      await page.getByRole('button', { name: /^Publish( · \d+ drafts?)?$/ }).click();
      await expect(page.getByText('Published. Guests see your changes now.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'View', exact: true })).toBeVisible();
      await clearToasts(page);
      if ((page.viewportSize()?.width ?? 0) >= 640) {
        await page.getByRole('button', { name: 'Settings', exact: true }).click();
      } else {
        await page.getByRole('button', { name: 'More', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Settings' }).click();
      }
      await page.getByLabel('Service added').fill('12.5');
      await page.getByLabel('Service added').press('Tab');
      await expect(page.getByLabel('Note at the foot')).toHaveValue('12.5% service is added.');
      // Serving times start from the place's own week, not a made up brunch.
      await page.getByRole('switch', { name: 'Serve at set times' }).click({ force: true });
      await expect(page.getByRole('switch', { name: 'Friday', exact: true })).toBeChecked();
      await expect(page.getByRole('button', { name: /Friday from/ }).first()).toContainText(/12:00/);
      await shot(page, '23-settings');
      await page.getByRole('button', { name: 'More', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Discard changes' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Discard changes' }).click();
      await expect(page.getByLabel('Service added')).toHaveValue('0');
    });

    await test.step('delete the menu after the confirm', async () => {
      await page.getByRole('button', { name: 'More', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Delete menu' }).click();
      await shot(page, '24-delete-confirm');
      await page.getByRole('alertdialog').getByRole('button', { name: 'Delete menu' }).click();
      await expect(page.getByText('No menus yet')).toBeVisible();
      // Deleting is a draft change: guests keep the published menu until the next Publish.
      await expect(page.getByRole('button', { name: 'Live', exact: true })).toBeVisible();
      // The deletion waits on the header's Publish, its count said there (on a phone, just Publish).
      await expect(page.getByRole('button', { name: /^Publish( · \d+ drafts?)?$/ })).toBeVisible();
      // Live with changes, More keeps Discard in reach even with no menu left.
      await expect(page.getByRole('button', { name: 'More', exact: true })).toBeVisible();
      await shot(page, '25-deleted');
    });
  });
});

/** One procedure as the page's own session calls it, answering its result; a refusal throws its message. */
async function rpc<T>(page: Page, path: string, input: Record<string, unknown>): Promise<T> {
  return page.evaluate(
    async ([procedure, body]) => {
      const response = await fetch(`/api/rpc/${procedure}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ json: body }),
      });
      const answer = (await response.json()) as { json: unknown };
      if (!response.ok) throw new Error(JSON.stringify(answer.json));
      return answer.json as T;
    },
    [path, input] as const,
  );
}

test.describe('Menu QR from an empty workspace (spec 0065, H2)', () => {
  test.use({ locale: 'en-GB', timezoneId: 'Europe/London', actionTimeout: 15_000 });
  if (process.env.FLOW_COLOR_SCHEME === 'dark') test.use({ colorScheme: 'dark' });
  if (process.env.FLOW_WIDTH !== undefined)
    test.use({ viewport: { width: Number(process.env.FLOW_WIDTH), height: 844 } });
  test.skip(OWNER_URL === undefined, 'Needs FLOW_OWNER_URL to open business apps for the new workspace.');
  test.skip(
    ({ viewport }) => (viewport?.width ?? 0) < 1000 && process.env.FLOW_WIDTH === undefined,
    'Walked at a desktop width.',
  );

  test('install both, tables, a code per table, downloads, the print sheet, the guest’s table, a new code', async ({
    page,
    context,
    browser,
  }) => {
    test.setTimeout(240_000);
    const slug = `somewhere-qr-${String(Date.now()).slice(-6)}`;
    await newWorkspace(page, `${slug}@example.com`, slug);
    execFileSync('psql', [
      OWNER_URL ?? '',
      '-c',
      `update workspaces set early_access = '{business_apps}', name = 'Somewhere' where slug = '${slug}'`,
    ]);

    await test.step('install Menu QR: it needs Menu, so both go in one step', async () => {
      await page.goto(`/w/${slug}/settings/apps`);
      await page.getByRole('button', { name: 'Install Menu QR' }).click();
      const asked = page.getByRole('dialog');
      await expect(asked).toBeVisible();
      await shot(page, 'qr-01-needs-menu');
      await asked.getByRole('button', { name: 'Install both' }).click();
      const card = page.getByRole('dialog');
      await card.getByLabel('Business name').fill('Somewhere');
      await card.getByRole('button', { name: 'Install', exact: true }).click();
      await expect(card).toBeHidden({ timeout: 15_000 });
    });

    const place = (await draftOf(page, slug)).places[0];
    const placeId = place?.id ?? '';
    const menuKey = place?.menuKey ?? '';

    await test.step('Tables with none yet: the way to add them', async () => {
      await page.goto(`/w/${slug}/qr`);
      await expect(page.getByRole('heading', { level: 1, name: 'Tables' })).toBeVisible();
      await expect(page.getByText('No tables yet')).toBeVisible();
      // Nothing is published yet, so the page says scans would show nothing.
      await expect(page.getByText(/Your menu isn’t published yet/)).toBeVisible();
      await shot(page, 'qr-02-empty');
      await expect(page.getByRole('button', { name: 'Add your first table' })).toBeVisible();
    });

    await test.step('a menu published and four tables added', async () => {
      const menuId = crypto.randomUUID();
      const sectionId = crypto.randomUUID();
      await rpc(page, 'menu/saveMenu', {
        workspace: slug,
        id: menuId,
        name: 'Dinner',
        placeIds: [placeId],
        mutationId: crypto.randomUUID(),
      });
      await rpc(page, 'menu/saveSection', {
        workspace: slug,
        id: sectionId,
        menuId,
        name: 'Mains',
        mutationId: crypto.randomUUID(),
      });
      for (const [name, price] of [
        ['Soup', 650],
        ['Risotto', 1450],
        ['Tart', 700],
      ] as const) {
        await rpc(page, 'menu/saveItem', {
          workspace: slug,
          id: crypto.randomUUID(),
          sectionId,
          item: {
            name,
            priceMinor: price,
            diet: [],
            allergens: [],
            kcal: null,
            featured: false,
            sizes: [],
            groupIds: [],
          },
          mutationId: crypto.randomUUID(),
        });
      }
      await rpc(page, 'menu/publish', { workspace: slug, mutationId: crypto.randomUUID() });
      await rpc(page, 'hospitality/addResources', {
        workspace: slug,
        placeId,
        kind: 'table',
        labels: ['T1', 'T2', 'T3', 'T4'],
        minCapacity: 2,
        maxCapacity: 4,
        online: true,
        mutationId: crypto.randomUUID(),
      });
    });

    let firstAddress = '';
    await test.step('every table has its own code; one opens in a dialog with its link and downloads', async () => {
      await page.goto(`/w/${slug}/qr`);
      await expect(page.getByRole('rowheader', { name: 'T4' })).toBeVisible();
      await expect(page.getByText(/Your menu isn’t published yet/)).toBeHidden();
      await shot(page, 'qr-03-list');
      await page.getByRole('button', { name: 'QR code for T1' }).click();
      const dialog = page.getByRole('dialog', { name: 'QR for T1' });
      await expect(dialog.getByRole('img', { name: 'QR code for T1' })).toBeVisible();
      await shot(page, 'qr-04-code');
      const download = page.waitForEvent('download');
      await dialog.getByRole('button', { name: 'Download the T1 code as PNG' }).click();
      expect((await download).suggestedFilename()).toMatch(/-t1-qr\.png$/);
      const svg = page.waitForEvent('download');
      await dialog.getByRole('button', { name: 'Download the T1 code as SVG' }).click();
      expect((await svg).suggestedFilename()).toMatch(/-t1-qr\.svg$/);
      firstAddress = (await dialog.getByRole('link', { name: 'Open menu' }).getAttribute('href')) ?? '';
      expect(firstAddress).toMatch(new RegExp(`/m/${menuKey}\\?t=[A-Za-z0-9_-]{22}$`));
      await page.keyboard.press('Escape');
    });

    await test.step('download every code as one zip', async () => {
      const zip = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download all' }).click();
      expect((await zip).suggestedFilename()).toMatch(/\.zip$/);
      await expect(page.getByText('Downloaded 4 codes.')).toBeVisible();
    });

    await test.step('the print sheet: tiles, or tent cards two or four to a sheet', async () => {
      await page.getByRole('link', { name: 'Print QR sheet' }).click();
      await expect(page.getByText('4 tables · scan-ready')).toBeVisible();
      // It opens as tiles; tent cards go two to a sheet, or four.
      await page.getByRole('radio', { name: 'Tent cards' }).click({ force: true });
      await expect(page.getByRole('region', { name: 'Page 1 of 2' })).toBeVisible();
      await expect(page.getByRole('article', { name: 'T1' })).toBeVisible();
      await shot(page, 'qr-05-print-two');
      await page.getByRole('radio', { name: '4 per sheet' }).click({ force: true });
      await expect(page.getByRole('region', { name: 'Page 1 of 1' })).toBeVisible();
      await shot(page, 'qr-06-print-four');
      await page.emulateMedia({ media: 'print' });
      await shot(page, 'qr-07-print-media');
      await page.emulateMedia({ media: 'screen' });
      await page.getByRole('link', { name: 'Back to Tables' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Tables' })).toBeVisible();
    });

    await test.step('a guest scans Table 1: the menu says so in its bar, and the scan counts', async () => {
      // A phone's browser: a headless one reads as a machine, whose scans are never counted.
      const phone = await browser.newContext({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
        ...(process.env.FLOW_COLOR_SCHEME === 'dark' ? { colorScheme: 'dark' as const } : {}),
        viewport: { width: 390, height: 844 },
      });
      const guest = await phone.newPage();
      await guest.goto(firstAddress.replace(/^https?:\/\/[^/]+/, ''));
      await expect(guest.getByText('Table 1', { exact: true })).toBeVisible();
      await shot(guest, 'qr-08-guest-table');
      await phone.close();
      const after = await rpc<{ tables: { label: string; scans: number }[] }>(page, 'hospitality/qrCodes', {
        workspace: slug,
        placeId,
      });
      expect(after.tables.find((table) => table.label === 'T1')?.scans).toBe(1);
    });

    await test.step('a new code asks first; the old print then opens the menu with no table', async () => {
      await page.getByRole('button', { name: 'More for T1' }).last().click();
      await page.getByRole('menuitem', { name: 'New code…' }).click();
      const confirm = page.getByRole('alertdialog', { name: 'New code for T1?' });
      await expect(confirm).toBeVisible();
      await shot(page, 'qr-09-new-code');
      await confirm.getByRole('button', { name: 'Make a new code' }).click();
      await expect(page.getByText('T1 has a new code. Print it to replace the old one.')).toBeVisible();
      const guest = await context.newPage();
      await guest.goto(firstAddress.replace(/^https?:\/\/[^/]+/, ''));
      await expect(guest.getByRole('heading', { level: 1, name: 'Dinner' })).toBeVisible();
      await guest.waitForTimeout(1000);
      await expect(guest.getByText('Table 1', { exact: true })).toBeHidden();
      await guest.close();
    });

    await test.step('reservations online, for the link page’s Reserve block', async () => {
      await rpc(page, 'hospitality/install', {
        workspace: slug,
        app: 'table_seating',
        withNeeded: false,
        mutationId: crypto.randomUUID(),
      });
      const setup = await rpc<{ rules: Record<string, unknown> }>(page, 'tables/setup', { workspace: slug, placeId });
      await rpc(page, 'tables/saveSetup', {
        workspace: slug,
        placeId,
        rules: { ...setup.rules, partyMax: 4, online: true },
        mutationId: crypto.randomUUID(),
      });
    });

    let publicPage = '';
    await test.step('the link page gets a Menu block and a Reserve a table block, then Publish', async () => {
      await page.goto(`/w/${slug}/link-page`);
      await expect(page.getByRole('heading', { level: 1, name: 'Link page' })).toBeVisible();
      await page.getByRole('button', { name: 'Edit page' }).click();
      await page.getByRole('button', { name: 'Add item' }).click();
      const add = page.getByRole('dialog', { name: 'Add to your link page' });
      await add.getByRole('radio', { name: /^Menu/ }).check({ force: true });
      await expect(add.getByLabel('Label')).toHaveAttribute('placeholder', 'Our menu');
      await shot(page, 'blocks-01-menu-editor');
      await add.getByRole('button', { name: /^Add item/ }).click();
      await expect(add).toBeHidden();
      await page.getByRole('button', { name: 'Add item' }).click();
      await add.getByRole('radio', { name: /^Reserve a table/ }).check({ force: true });
      await add.getByRole('button', { name: /^Add item/ }).click();
      await expect(add).toBeHidden();
      await expect(page.getByText(/Menu · /).first()).toBeVisible();
      await expect(page.getByText(/Reserve a table · /).first()).toBeVisible();
      await shot(page, 'blocks-02-editor-rows');
      await page.getByRole('button', { name: 'Done' }).click();
      await rpc(page, 'profile/publish', { workspace: slug, mutationId: crypto.randomUUID() });
      // A new link page is private until it is shared; then it is live at its handle.
      await rpc(page, 'profile/show', { workspace: slug, mutationId: crypto.randomUUID() });
      const { handle } = await rpc<{ handle: string }>(page, 'profile/get', { workspace: slug });
      publicPage = `/${handle}`;
    });

    await test.step('a visitor sees the menu’s first dishes and Reserve a table, each opening its page', async () => {
      const visitorContext = await browser.newContext({
        viewport: { width: 390, height: 844 },
        ...(process.env.FLOW_COLOR_SCHEME === 'dark' ? { colorScheme: 'dark' as const } : {}),
      });
      const visitor = await visitorContext.newPage();
      await visitor.goto(publicPage);
      const menuRow = visitor.getByRole('link', { name: /Our menu.*Soup £6\.50 · Risotto £14\.50 · Tart £7\.00/ });
      await expect(menuRow).toHaveAttribute('href', `/m/${menuKey}`);
      await expect(visitor.getByRole('link', { name: /Reserve a table/ })).toHaveAttribute('href', /^\/r\//);
      await shot(visitor, 'blocks-03-public');
      await visitorContext.close();
    });

    await test.step('the menu hidden: the block goes, and the menu page says so in its own look', async () => {
      await rpc(page, 'menu/setHidden', { workspace: slug, hidden: true, mutationId: crypto.randomUUID() });
      const visitorContext = await browser.newContext({
        viewport: { width: 390, height: 844 },
        ...(process.env.FLOW_COLOR_SCHEME === 'dark' ? { colorScheme: 'dark' as const } : {}),
      });
      const visitor = await visitorContext.newPage();
      await visitor.goto(publicPage);
      await expect(visitor.getByRole('link', { name: /Reserve a table/ })).toBeVisible();
      await expect(visitor.getByRole('link', { name: /Our menu/ })).toHaveCount(0);
      await expect
        .poll(
          () =>
            countAfterOpening(
              visitor,
              `/m/${menuKey}`,
              visitor.getByRole('heading', { name: 'This menu isn’t available right now' }),
            ),
          { timeout: 20_000 },
        )
        .toBeGreaterThan(0);
      await expect(visitor.getByRole('link', { name: 'Reserve a table' })).toHaveAttribute('href', /^\/r\//);
      await expect(visitor.getByText('Soup')).toHaveCount(0);
      await shot(visitor, 'hidden-01-menu');
      await visitorContext.close();
      await rpc(page, 'menu/setHidden', { workspace: slug, hidden: false, mutationId: crypto.randomUUID() });
    });
  });
});
