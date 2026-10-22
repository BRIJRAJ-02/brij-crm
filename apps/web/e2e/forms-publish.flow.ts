// A form's first publish (spec 0023, Publishing) is one dialog in three steps,
// each named by its title: Set up your form, Where the answers go, then Your
// form is live. Each step's buttons replace the one just pressed, so focus is
// put back inside the dialog at every step, and Esc closes it at the last one,
// leaving focus on the editor's More actions, beside where Publish was
// (merge A's smoke, 21 October 2026: the last step had lost focus, so it was
// read with no name and Esc did nothing).
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { newWorkspace } from './people.ts';

test.describe('a form’s first publish', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'One width is enough for the publish dialog.');

  test('names each step, keeps focus inside it, and closes on Esc with focus beside Publish', async ({ page }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `publish-${tag}`;
    await newWorkspace(page, `publish-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/captures/forms`);
    await page.getByRole('button', { name: 'New form' }).first().click();
    await expect(page).toHaveURL(/\/captures\/forms\/[0-9a-f-]{36}/, { timeout: 30_000 });

    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    const setUp = page.getByRole('dialog', { name: 'Set up your form' });
    await expect(setUp).toBeVisible();
    await expect(setUp.getByLabel('Name')).toBeFocused();
    await setUp.getByLabel('Name').fill(`Publish flow ${tag}`);
    await setUp.getByRole('button', { name: 'Next' }).click();

    const answers = page.getByRole('dialog', { name: 'Where the answers go' });
    await expect(answers).toBeVisible();
    // Next gave way to Publish: focus moved to the step's first choice, inside the dialog.
    await expect(answers.getByRole('button', { name: /Where submissions go/ })).toBeFocused();
    await answers.getByRole('button', { name: 'Publish', exact: true }).click();

    const live = page.getByRole('dialog', { name: 'Your form is live' });
    await expect(live).toBeVisible({ timeout: 30_000 });
    // Publish gave way to Close: focus is on it, inside the dialog, so the dialog is said with its name.
    await expect(live.getByRole('button', { name: 'Close' }).last()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Publish left once the form went live; focus is on More actions, beside where it was.
    await expect(page.getByRole('button', { name: 'More actions' })).toBeFocused();
    // The status says it once on screen; a cut off label also carries it whole in its tooltip.
    await expect(page.getByText(/Live · v1/).first()).toBeVisible();
  });
});
