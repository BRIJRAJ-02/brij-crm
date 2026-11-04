// The form template gallery against the running app (spec 0063, AC-6323):
// Captures › Forms › New form opens a gallery of ten tiles, Blank first, each
// with a preview of the form it would make and a one line purpose; pressing
// one lands in the new form's editor with the template's questions already
// filed onto People. Shot in light and dark inside the real page layout, both
// empty (nothing chosen yet) and chosen (the form it made), into
// `scratchpad/s8-shots/`.
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { newWorkspace } from './people.ts';

/** Where the shots land: the worktree's scratchpad, never the repo. */
const SHOTS = path.resolve(import.meta.dirname, '../../../scratchpad/s8-shots');

const SCHEMES = ['light', 'dark'] as const;

/** Waits for the colour transitions a theme change starts, so a shot is never taken mid fade. */
async function settled(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => setTimeout(resolve, 700));
      }),
  );
}

test.describe('the form template gallery', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The gallery runs at desktop width.');

  test('offers ten templates, and one press makes a draft that files onto People', async ({ page }) => {
    test.setTimeout(240_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `templates-${tag}`;
    await newWorkspace(page, `templates-${tag}@example.com`, slug);

    await page.goto(`/w/${slug}/captures/forms`);
    await page.getByRole('button', { name: 'New form' }).first().click();
    const gallery = page.getByRole('dialog', { name: 'Start a form' });
    await expect(gallery).toBeVisible({ timeout: 30_000 });

    // AC-6323's twelve tiles, Blank first, each with its purpose on the tile rather than in a tooltip.
    const tiles = gallery.getByRole('group', { name: 'Start a form' }).getByRole('button');
    await expect(tiles).toHaveCount(12);
    await expect(tiles.first()).toHaveAccessibleName('Blank form');
    await expect(gallery.getByText('A rating, and why.')).toBeVisible();
    // Both templates slice 5 held back are offered now: Lead qualification scores, Booking intake goes on to a page.
    await expect(gallery.getByRole('button', { name: 'Lead qualification' })).toHaveCount(1);
    await expect(gallery.getByRole('button', { name: 'Booking intake' })).toHaveCount(1);

    // Every tile keeps its preview: a real little form, not a mark in a box.
    await expect(gallery.locator('[data-tile][data-tall]')).toHaveCount(12);

    // The gallery as it opens, in both themes, inside the real page. The theme change rides the colour
    // transition tokens, so the shot waits for it to finish: taken at once, dark caught the tiles mid fade with
    // light text colours still on them, which reads as a contrast bug that isn't one.
    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect(tiles.first()).toBeVisible();
      await settled(page);
      await page.screenshot({ path: path.join(SHOTS, `gallery-empty-${scheme}.png`), fullPage: false });
    }
    await page.emulateMedia({ colorScheme: 'light' });

    // One press makes the draft and opens its editor.
    await gallery.getByRole('button', { name: 'Feedback' }).click();
    await expect(page).toHaveURL(/\/captures\/forms\/[0-9a-f-]{36}/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1, name: /Feedback/ })).toBeVisible({ timeout: 30_000 });

    // The template's own questions, with the rating it is named for (where each is saved shows in its editor).
    await expect(page.getByText('Your name').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('How was it?').first()).toBeVisible();

    // The form the chosen tile made, in both themes.
    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect(page.getByText('How was it?').first()).toBeVisible();
      await settled(page);
      await page.screenshot({ path: path.join(SHOTS, `gallery-chosen-${scheme}.png`), fullPage: false });
    }
    await page.emulateMedia({ colorScheme: 'light' });

    // It is on Forms as a draft, under the template's name.
    await page.goto(`/w/${slug}/captures/forms`);
    await expect(page.getByRole('link', { name: /Feedback/ }).first()).toBeVisible({ timeout: 30_000 });
  });
});
