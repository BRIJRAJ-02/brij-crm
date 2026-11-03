// The Menu app's first run, end to end (spec 0065, H1; owner, 4 Nov 2026): a new person in an empty workspace called
// Somewhere installs Menu, sets the place's hours, builds a menu from nothing (a section, a dish with a photo, sizes,
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
  await page.screenshot({ path: join(SHOTS, `${name}-${scheme}-${width}.png`), fullPage: false });
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

    await test.step('open Menus: one next action, set the hours first', async () => {
      await page.goto(`/w/${slug}/menus`);
      await expect(page.getByRole('heading', { level: 1, name: 'Menus' })).toBeVisible();
      await shot(page, '04-menus-empty');
      await page.getByRole('button', { name: 'Open' }).first().click();
      // Straight to the place's own page, where its week is.
      await expect(page).toHaveURL(/settings\/business\/places\//);
      await shot(page, '05-business');
    });

    await test.step('set the place’s hours', async () => {
      const monday = page.getByRole('switch', { name: 'Monday', exact: true });
      await expect(monday).toBeVisible();
      await monday.click({ force: true });
      await page.getByRole('button', { name: /Copy Monday/ }).click();
      await page.getByRole('checkbox', { name: /Select all/ }).click({ force: true });
      await page.getByRole('button', { name: 'Apply' }).click();
      // Every day copied sticks, not only the last.
      for (const day of ['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
        await expect(page.getByRole('switch', { name: day, exact: true })).toBeChecked();
      }
      await page.waitForTimeout(800);
      await shot(page, '06-hours');
    });

    await test.step('make the first menu: it comes with a first section', async () => {
      await page.goto(`/w/${slug}/menus`);
      await page.getByRole('button', { name: 'New menu' }).first().click();
      await expect(page.getByRole('tab', { name: /Dinner/ })).toBeVisible();
      await expect(page.getByText('1. Starters')).toBeVisible();
      await shot(page, '07-first-menu');
    });

    await test.step('add a dish from the section: name, photo, price, allergens', async () => {
      const add = page.getByLabel('Add dishes').first();
      await add.fill('Edamame');
      await expect(page.getByRole('option', { name: /Create “Edamame”/ })).toBeVisible();
      await shot(page, '08-add-dishes');
      await add.press('Enter');
      const drawer = page.getByRole('dialog', { name: 'Edamame' });
      await expect(drawer).toBeVisible();
      await expect(drawer.getByLabel('Name')).toHaveValue('Edamame');
      await drawer.locator('input[type=file]').setInputFiles({
        name: 'edamame.jpg',
        mimeType: 'image/jpeg',
        buffer: await photoFile(page),
      });
      await drawer.getByLabel('Price', { exact: true }).fill('5.5');
      await drawer.getByRole('button', { name: 'Soya', exact: true }).first().click();
      await drawer.getByRole('button', { name: 'Vegan', exact: true }).click();
      await shot(page, '09-dish-drawer');
      await drawer.getByRole('button', { name: 'Save dish' }).click();
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
      const add = page.getByLabel('Add dishes').first();
      await add.fill('Wine');
      await add.press('Enter');
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
      await drawer.getByRole('button', { name: 'Add size' }).click();
      await drawer.getByLabel('Size 1').fill('Glass');
      await drawer.getByRole('button', { name: 'Add size' }).click();
      await drawer.getByLabel('Size 2').fill('Bottle');
      await drawer.getByLabel('Price').nth(2).fill('38');
      await shot(page, '12-sizes');
      await drawer.getByRole('button', { name: 'Save dish' }).click();
      await expect(drawer).toBeHidden();
    });

    await test.step('make an option group and offer it', async () => {
      await page.getByRole('tab', { name: /Options/ }).click();
      await page.getByRole('button', { name: 'Add option group' }).first().click();
      const drawer = page.getByRole('dialog', { name: 'Option group' });
      await drawer.getByRole('textbox', { name: 'Name' }).fill('Sides');
      await drawer.getByRole('radio', { name: 'Up to' }).click({ force: true });
      await drawer.getByRole('textbox', { name: 'Option 1' }).fill('Fries');
      await drawer.getByLabel('Price change').first().fill('4.5');
      await drawer.getByRole('textbox', { name: 'Option 2' }).fill('Green salad');
      await drawer.getByLabel('Price change').nth(1).fill('4');
      await shot(page, '13-option-group');
      await drawer.getByRole('button', { name: 'Save group' }).click();
      await expect(drawer).toBeHidden();
      await expect(page.getByRole('row', { name: /Sides/ })).toBeVisible();
      await page.getByRole('tab', { name: /Dishes/ }).click();
      await page.getByRole('row', { name: /Wine/ }).click();
      const wine = page.getByRole('dialog', { name: 'Wine' });
      await wine.getByRole('button', { name: 'Sides', exact: true }).click();
      await wine.getByRole('button', { name: 'Save dish' }).click();
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
      const dishes = page.getByRole('grid', { name: 'Dishes in Starters' }).getByRole('row');
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
      await page.getByRole('button', { name: 'Review and publish' }).click();
      const review = page.getByRole('dialog', { name: 'Review and publish' });
      await expect(review).toBeVisible();
      await shot(page, '17-review');
      await review.getByRole('button', { name: 'Publish', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Your menu is live' })).toBeVisible();
      await shot(page, '18-live');
      await page.getByRole('button', { name: 'Done' }).click();
    });

    let guestUrl = '';
    await test.step('the guest menu: search, filter, open a dish, pick a size, add to picks', async () => {
      await page.getByRole('button', { name: 'More', exact: true }).click();
      const copy = page.getByRole('menuitem', { name: 'Copy link' });
      await expect(copy).toBeVisible();
      await page.keyboard.press('Escape');
      const draft = await page.evaluate(async (workspace) => {
        const response = await fetch('/api/rpc/menu/draft', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ json: { workspace } }),
        });
        return (await response.json()) as { json: { places: { menuKey: string }[] } };
      }, slug);
      guestUrl = `/m/${draft.json.places[0]?.menuKey ?? ''}`;
      const guest = await context.newPage();
      await guest.goto(guestUrl);
      await expect(guest.getByRole('heading', { name: 'Somewhere' })).toBeVisible();
      await shot(guest, '19-guest');
      await guest.getByRole('searchbox').fill('wine');
      await expect(guest.getByText('Edamame')).toBeHidden();
      await guest.getByRole('searchbox').fill('');
      await guest.getByRole('button', { name: /^Wine/ }).first().click();
      const sheet = guest.getByRole('dialog', { name: 'Wine' });
      await guest.getByRole('radio', { name: /Bottle/ }).click({ force: true });
      await expect(sheet.getByRole('button', { name: /Add to your picks.*£38\.00/ })).toBeVisible();
      await shot(guest, '20-guest-sheet');
      await sheet.getByRole('button', { name: /Add to your picks/ }).click();
      await expect(guest.getByRole('button', { name: /Your picks|View your picks/ })).toBeVisible();
      await shot(guest, '21-guest-picks');
      await guest.close();
    });

    await test.step('sold out goes live at once', async () => {
      await page.getByRole('switch', { name: 'Edamame available' }).first().click({ force: true });
      const guest = await context.newPage();
      await expect
        .poll(
          async () => {
            await guest.goto(guestUrl);
            return guest.getByText('Sold out').count();
          },
          { timeout: 20_000 },
        )
        .toBeGreaterThan(0);
      await shot(guest, '22-guest-sold-out');
      await guest.close();
    });

    await test.step('edit and republish, then discard an edit', async () => {
      await page
        .getByRole('row', { name: /Edamame/ })
        .first()
        .click();
      const drawer = page.getByRole('dialog', { name: 'Edamame' });
      await drawer.getByLabel('Price', { exact: true }).fill('6');
      await drawer.getByRole('button', { name: 'Save dish' }).click();
      await page.getByRole('button', { name: 'Review and publish' }).click();
      await page
        .getByRole('dialog', { name: 'Review and publish' })
        .getByRole('button', { name: 'Publish', exact: true })
        .click();
      await page.getByRole('button', { name: 'Done' }).click();
      await page.getByRole('tab', { name: /Settings/ }).click();
      await page.getByLabel('Service added').fill('12.5');
      await page.getByLabel('Service added').press('Tab');
      await expect(page.getByLabel('Note at the foot')).toHaveValue('12.5% service is added.');
      await shot(page, '23-settings');
      await page.getByRole('button', { name: 'More', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Discard' }).click();
      await page.getByRole('button', { name: 'Discard changes' }).click();
      await expect(page.getByLabel('Service added')).toHaveValue('0');
    });

    await test.step('delete the menu after the confirm', async () => {
      await page.getByRole('button', { name: 'Delete menu' }).click();
      await shot(page, '24-delete-confirm');
      await page.getByRole('alertdialog').getByRole('button', { name: 'Delete menu' }).click();
      await expect(page.getByText('No menus yet')).toBeVisible();
      // Deleting is a draft change: guests keep the published menu until the next Publish.
      await expect(page.getByText(/Live · \d+ changes?/)).toBeVisible();
      // Live with changes, More keeps Discard in reach even with no menu left.
      await expect(page.getByRole('button', { name: 'More', exact: true })).toBeVisible();
      await shot(page, '25-deleted');
    });
  });
});
