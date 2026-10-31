// A form's first publish is one step (spec 0058, AC-13): Publish your form holds the name, the link, where
// submissions are saved and each question's field, and its Publish turns the same dialog into the Ready panel (AC-6),
// headed Your form is live. Publish gives way to Done, so focus is put back inside the dialog there, and Esc closes
// it, leaving focus on the editor's More actions, beside where Publish was (merge A's smoke, 21 October 2026: the
// last step had lost focus, so it was read with no name and Esc did nothing).
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { newWorkspace } from './people.ts';

test.describe('a form’s first publish', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'One width is enough for the publish dialog.');

  test('is one step, keeps focus inside the dialog, and closes on Esc with focus beside Publish', async ({ page }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `publish-${tag}`;
    await newWorkspace(page, `publish-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/captures/forms`);
    await page.getByRole('button', { name: 'New form' }).first().click();
    await expect(page).toHaveURL(/\/captures\/forms\/[0-9a-f-]{36}/, { timeout: 30_000 });

    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    const publish = page.getByRole('dialog', { name: 'Publish your form' });
    await expect(publish).toBeVisible();
    await expect(publish.getByRole('textbox', { name: 'Name', exact: true })).toBeFocused();
    await publish.getByRole('textbox', { name: 'Name', exact: true }).fill(`Publish flow ${tag}`);
    // Where submissions go and each answer's field are already there: no second step.
    await expect(publish.getByRole('button', { name: /Save to$/ })).toBeVisible();
    await expect(publish.getByRole('button', { name: 'Next' })).toHaveCount(0);
    await publish.getByRole('button', { name: 'Publish', exact: true }).click();

    const ready = page.getByRole('heading', { name: 'Your form is live' });
    await expect(ready).toBeVisible({ timeout: 30_000 });
    // Publish gave way to Done: focus is on it, inside the dialog, so the dialog is said with its name.
    await expect(page.getByRole('dialog').getByRole('button', { name: /^Done/ })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Publish left once the form went live; focus is on More actions, beside where it was.
    await expect(page.getByRole('button', { name: 'More actions' })).toBeFocused();
    // The status says it once on screen; a cut off label also carries it whole in its tooltip.
    await expect(page.getByText(/Live · v1/).first()).toBeVisible();
  });
});
