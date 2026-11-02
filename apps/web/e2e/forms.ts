// What every forms flow needs before it can edit a form: New form now opens
// the template gallery (spec 0063, AC-6323) instead of making an untitled form
// at once, so the two lines each flow used to write live here and change in
// one place.
import { expect, type Page } from '@playwright/test';

/** The gallery's first tile: the same Name, Email and Phone draft New form used to make on its own. */
export const BLANK_TEMPLATE = 'Blank form';

/**
 * Captures › Forms › New form, then one template, landing in the new form's
 * editor. `template` names another tile ("Feedback", "NPS"); without one it
 * takes Blank, which is what the flows wanting a plain form expect.
 */
export async function newForm(page: Page, template: string = BLANK_TEMPLATE): Promise<string> {
  await page.getByRole('button', { name: 'New form' }).first().click();
  const gallery = page.getByRole('dialog', { name: 'Start a form' });
  await expect(gallery).toBeVisible({ timeout: 30_000 });
  await gallery.getByRole('button', { name: template }).click();
  await expect(page).toHaveURL(/\/captures\/forms\/[0-9a-f-]{36}/, { timeout: 30_000 });
  return page.url().replace(/\?.*$/, '');
}
