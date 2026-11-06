// A salon set up from an empty workspace (spec 0066 B1): fill in the business card (the kind starts
// on Salon, the place on a working week), add the starter Haircut with a price, add a stylist with a photo cropped
// round, set her colour, change one date on the Shifts grid, copy that week to every week, and then prove through the
// API that the engine plans a haircut with her (B2 books from exactly this). Each step is a screenshot when
// FLOW_SCREENSHOTS names a folder; FLOW_COLOR_SCHEME=dark and FLOW_WIDTH=390 draw the same walk in dark and at a
// phone's width. The workspace is named through the owner connection (`FLOW_OWNER_URL`, a local
// database); without it the flow is skipped.
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
  await page.screenshot({
    path: join(SHOTS, `${name}-${scheme}-${width}.png`),
    fullPage: true,
    animations: 'disabled',
  });
}

/** A photo drawn in the page: a face's warm middle on a cool ground, 800 by 600. */
async function photoFile(page: Page): Promise<Buffer> {
  const data = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(800, 600);
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('No canvas.');
    const gradient = context.createRadialGradient(400, 280, 40, 400, 300, 300);
    gradient.addColorStop(0, '#f2c9a0');
    gradient.addColorStop(1, '#3a5f8a');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 800, 600);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  return Buffer.from(data);
}

/** One RPC as the page's own session (the API, not the screen). */
async function rpc<T>(page: Page, path: string, input: unknown): Promise<T> {
  return page.evaluate(
    async ({ path: at, input: body }) => {
      const response = await fetch(`/api/rpc/${at}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ json: body }),
      });
      const answer = (await response.json()) as { json: unknown };
      if (!response.ok) throw new Error(JSON.stringify(answer));
      return answer.json;
    },
    { path, input },
  ) as Promise<T>;
}

/** The next Tuesday after today (a working day of the salon's first week), `YYYY-MM-DD`. */
function nextTuesday(): string {
  const at = new Date();
  at.setUTCDate(at.getUTCDate() + 1);
  while (at.getUTCDay() !== 2) at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString().slice(0, 10);
}

test.describe('a salon set up from empty', () => {
  test.use({ locale: 'en-GB', timezoneId: 'Europe/London', actionTimeout: 15_000 });
  if (process.env.FLOW_COLOR_SCHEME === 'dark') test.use({ colorScheme: 'dark' });
  if (process.env.FLOW_WIDTH !== undefined) {
    test.use({ viewport: { width: Number(process.env.FLOW_WIDTH), height: 844 } });
  }
  test.skip(OWNER_URL === undefined, 'Needs FLOW_OWNER_URL to name the new workspace.');

  test('install Appointments, add a service and a stylist, set shifts, and the engine plans a haircut', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const slug = `studio-${String(Date.now()).slice(-6)}`;

    await test.step('a new person makes the Studio workspace', async () => {
      await newWorkspace(page, `${slug}@example.com`, slug);
      execFileSync('psql', [
        OWNER_URL ?? '',
        '-c',
        `update workspaces set name = 'Studio Asha' where slug = '${slug}'`,
      ]);
    });

    await test.step('the first screen: the card starts on Salon', async () => {
      await page.goto(`/w/${slug}/settings/services`);
      await page.getByRole('button', { name: 'Set up your business' }).click();
      const card = page.getByRole('dialog');
      await expect(card.getByRole('button', { name: /Type/ })).toContainText('Salon');
      await card.getByLabel('Address', { exact: true }).fill('12 MG Road');
      await card.getByLabel('City', { exact: true }).fill('London');
      await shot(page, '01-business-card');
      await card.getByRole('button', { name: 'Set up', exact: true }).click();
      await expect(card).toBeHidden({ timeout: 15_000 });
    });

    await test.step('Services: the checklist with its one next action, the starter Haircut', async () => {
      await page.goto(`/w/${slug}/settings/services`);
      await expect(page.getByRole('heading', { name: 'Set up online booking' })).toBeVisible();
      await shot(page, '02-services-empty');
      // The checklist holds the one next action: Add service opens the starter for a salon, a Haircut.
      await page.getByRole('button', { name: /^Add service/ }).click();
      const drawer = page.getByRole('dialog', { name: 'Haircut' });
      await expect(drawer.getByLabel('Name', { exact: true })).toHaveValue('Haircut');
      // Save with no price says how to fix it, in place.
      await drawer.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(drawer.getByText('Give a price like 25 or 25.50 in GBP.')).toBeVisible();
      await drawer.getByLabel('Amount', { exact: true }).fill('25');
      await shot(page, '03-service-drawer');
      await drawer.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(drawer).toBeHidden({ timeout: 15_000 });
      await expect(page.getByRole('rowheader', { name: 'Haircut' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Hair' })).toBeVisible();
      await shot(page, '04-services');
    });

    await test.step('Staff: add Asha, then her photo cropped round and her colour', async () => {
      await page.goto(`/w/${slug}/settings/staff`);
      await page.getByRole('button', { name: 'Add staff' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'Add staff' });
      await dialog.getByLabel('Name', { exact: true }).fill('Asha Rao');
      await dialog.getByLabel('Title').fill('Senior stylist');
      await dialog.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Asha Rao' })).toBeVisible({ timeout: 15_000 });
      await page
        .locator('input[type=file]')
        .first()
        .setInputFiles({
          name: 'asha.jpg',
          mimeType: 'image/jpeg',
          buffer: await photoFile(page),
        });
      const cropper = page.getByRole('dialog', { name: 'Crop photo' });
      await expect(cropper).toBeVisible();
      await shot(page, '05-photo-crop');
      await cropper.getByRole('button', { name: 'Use photo' }).click();
      await expect(cropper).toBeHidden();
      await expect(page.getByRole('button', { name: 'Adjust crop' })).toBeVisible({ timeout: 15_000 });
      await page.getByRole('radio', { name: 'Purple' }).check({ force: true });
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
      await shot(page, '06-profile');
      await page.goto(`/w/${slug}/settings/staff`);
      await expect(page.getByRole('rowheader', { name: /Asha Rao/ })).toBeVisible();
      await shot(page, '07-staff');
    });

    const tuesday = nextTuesday();
    await test.step('Shifts: Asha works the place’s week; one date changed, then that week copied to all weeks', async () => {
      await page.goto(`/w/${slug}/settings/shifts?week=${tuesday}`);
      const grid = page.getByRole('grid');
      const cell = grid.getByRole('button', { name: /Tuesday .*Asha Rao: 9:00/ });
      await expect(cell).toBeVisible({ timeout: 15_000 });
      await shot(page, '08-shifts');
      // Wednesday this week only: a late start.
      await grid.getByRole('button', { name: /Wednesday .*Asha Rao/ }).click();
      const editor = page.getByRole('dialog', { name: /Asha Rao, Wednesday/ });
      await editor.getByRole('button', { name: /from/i }).first().click();
      await page.getByRole('option', { name: '12:00 pm', exact: true }).click();
      await shot(page, '09-day-editor');
      await editor.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(grid.getByRole('button', { name: /Wednesday .*Asha Rao: 12:00 pm.*this date only/ })).toBeVisible();
      // Then make this week every week: one write with all seven days.
      await page.getByRole('button', { name: 'Shift actions for Asha Rao' }).click();
      await page.getByRole('menuitem', { name: 'Copy this week to all weeks' }).click();
      await page.getByRole('button', { name: 'Copy to all weeks' }).click();
      await expect(page.getByText('Asha Rao’s regular week now matches this one.')).toBeVisible();
      await page.getByRole('button', { name: 'Next week' }).click();
      await expect(grid.getByRole('button', { name: /Wednesday .*Asha Rao: 12:00 pm/ })).toBeVisible();
      await expect(grid.getByRole('button', { name: /Tuesday .*Asha Rao: 9:00 am/ })).toBeVisible();
      await expect(grid.getByRole('button', { name: /Saturday .*Asha Rao: 9:00 am/ })).toBeVisible();
      await shot(page, '10-shifts-copied');
    });

    await test.step('the engine plans a haircut with Asha (through the API, as B2 will book it)', async () => {
      const catalogue = await rpc<{
        places: { id: string }[];
        services: { id: string; name: string; variants: { id: string }[] }[];
      }>(page, 'services/catalogue', { workspace: slug });
      const haircut = catalogue.services.find((service) => service.name === 'Haircut');
      const team = await rpc<{ staff: { id: string; name: string }[] }>(page, 'services/team', { workspace: slug });
      const asha = team.staff.find((each) => each.name === 'Asha Rao');
      const times = await rpc<{ times: { start: string; staffId?: string }[] }>(page, 'services/times', {
        workspace: slug,
        placeId: catalogue.places[0]?.id,
        serviceId: haircut?.id,
        variantId: haircut?.variants[0]?.id,
        date: tuesday,
      });
      expect(times.times.length).toBeGreaterThan(0);
      expect(times.times[0]?.staffId).toBe(asha?.id);
      // London is on GMT or BST: her day starts at 9:00 on the place's clock.
      expect(new Date(times.times[0]?.start ?? '').toLocaleTimeString('en-GB', { timeZone: 'Europe/London' })).toBe(
        '09:00:00',
      );
    });

    await test.step('the checklist moves on to Publish', async () => {
      await page.goto(`/w/${slug}/settings/services`);
      await expect(page.getByText('One setup step left')).toBeVisible();
      await shot(page, '11-services-ready');
    });
  });
});
