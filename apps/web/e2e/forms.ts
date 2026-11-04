// What every forms flow needs before it can edit a form: New form now opens
// the template gallery (spec 0063, AC-6323) instead of making an untitled form
// at once, so the two lines each flow used to write live here and change in
// one place.
import { expect, type Page } from '@playwright/test';

/** The gallery's first tile: an empty form, its first question the member's own (spec 0063, AC-6323). */
export const BLANK_TEMPLATE = 'Blank form';
/** The plain form the flows edit: a name and a work email filed on People, as Blank used to make. */
export const PLAIN_TEMPLATE = 'Contact us';

/**
 * Captures › Forms › New form, then one template, landing in the new form's
 * editor. `template` names another tile ("Feedback", "NPS"); without one it
 * takes Contact us, the plain form with a name and an email the flows expect
 * (Blank starts empty now, and an empty form can't be published).
 */
export async function newForm(page: Page, template: string = PLAIN_TEMPLATE): Promise<string> {
  await page.getByRole('button', { name: 'New form' }).first().click();
  const gallery = page.getByRole('dialog', { name: 'Start a form' });
  await expect(gallery).toBeVisible({ timeout: 30_000 });
  // Pick it in the list (its preview shows beside it), then Use it.
  await gallery.getByRole('radio', { name: template }).click();
  await gallery.getByRole('button', { name: `Use ${template}` }).click();
  await expect(page).toHaveURL(/\/captures\/forms\/[0-9a-f-]{36}/, { timeout: 30_000 });
  return page.url().replace(/\?.*$/, '');
}
