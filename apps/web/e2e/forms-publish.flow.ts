// A form's first publish is one click (the owner, 5 November 2026, after Tally): nothing is asked first, the form goes
// live with its own name, a link and its answers matched to fields, and the Ready panel opens, headed Your form is
// live. Focus is on Done inside it, and Esc closes it, leaving focus on the editor's More actions, beside where
// Publish was (merge A's smoke, 21 October 2026: the last step had lost focus, so it was read with no name and Esc
// did nothing).
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { newWorkspace } from './people.ts';
import { newForm } from './forms.ts';

test.describe('a form’s first publish', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'One width is enough for the publish dialog.');

  test('is one click, keeps focus inside the Ready dialog, and closes on Esc with focus beside Publish', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `publish-${tag}`;
    await newWorkspace(page, `publish-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/captures/forms`);
    await newForm(page);

    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    const ready = page.getByRole('heading', { name: / is live$/ });
    await expect(ready).toBeVisible({ timeout: 30_000 });
    // No field was asked for, and focus is on Done, inside the dialog, so the dialog is said with its name.
    await expect(page.getByRole('dialog').getByRole('textbox')).toHaveCount(0);
    await expect(page.getByRole('dialog').getByRole('button', { name: /^Done/ })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // Publish left once the form went live; focus is on More actions, beside where it was.
    await expect(page.getByRole('button', { name: 'More actions' })).toBeFocused();
    // The status says it in a plain word, with no version number.
    await expect(page.getByText('Live', { exact: true }).first()).toBeVisible();
  });
});
