// Field types at par with Attio and Twenty (the field types pass, 31 October 2026), end to end: a text attribute's
// type changes in place from its settings (Change type…, checked against every value first), refused for Email
// while a value isn't one, with a link to the record that stops it, and made for Long text with the value kept; and
// Date and time is in the type picker (guessed from a name ending "at"), made, and set from a cell with Now.
import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { addPerson, cellAt, newWorkspace } from './people.ts';

/** Types into a People cell from the keyboard and commits it, as a person does. */
async function typeInto(page: Page, row: number, column: string, text: string): Promise<void> {
  const cell = await cellAt(page, row, column);
  await cell.click();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(cell).toContainText(text);
}

/** Picks a type in an open dialog's type Select, by the label it shows. */
async function pickType(page: Page, dialog: Locator, name: RegExp, type: string): Promise<void> {
  await dialog.getByRole('button', { name }).click();
  await page.getByRole('option', { name: type, exact: true }).click();
  await expect(page.getByRole('listbox')).toBeHidden();
}

test.describe('field types', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The settings and the table run at desktop width.');

  test('a text changes type in place: Email waits for its values, Long text keeps them', async ({ page }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `types-${tag}`;
    await newWorkspace(page, `types-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/objects/people`);
    await addPerson(page, 'Ada', 'Lovelace', `ada-${tag}@example.com`);
    await typeInto(page, 0, 'Job title', 'Rear admiral');

    await page.goto(`/w/${slug}/settings/objects/people/attributes`);
    await page
      .getByRole('grid', { name: 'Attributes' })
      .getByRole('row', { name: /Job title/ })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Edit attribute' });
    await expect(dialog).toBeVisible();
    // No more "archive and recreate" for a safe change: the type changes in place, in the same dialog.
    await dialog.getByRole('button', { name: 'Change type…' }).click();
    const step = page.getByRole('dialog', { name: 'Change type' });
    await expect(step).toBeVisible();

    // Email: the value isn't one, so the change waits, and the check links to the record that stops it.
    await pickType(page, step, /New type/, 'Email');
    await expect(step.getByText(/1 value can’t become Email/)).toBeVisible();
    await expect(step.getByRole('link', { name: 'Show the record' })).toBeVisible();
    await expect(step.getByRole('button', { name: 'Change type', exact: true })).toBeDisabled();

    // Long text: every value converts, and the change lands with the value kept.
    await pickType(page, step, /New type/, 'Long text');
    await expect(step.getByText(/Its 1 value converts/)).toBeVisible();
    await step.getByRole('button', { name: 'Change type', exact: true }).click();
    await expect(step).toBeHidden();
    await expect(page.getByText('Job title saved.')).toBeVisible();
    await expect(page.getByRole('grid', { name: 'Attributes' }).getByRole('row', { name: /Job title/ })).toContainText(
      'Long text',
    );

    await page.goto(`/w/${slug}/objects/people`);
    await expect(await cellAt(page, 0, 'Job title')).toContainText('Rear admiral');
  });

  test('Date and time is in the picker, guessed from its name, and Now sets it from a cell', async ({ page }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `moments-${tag}`;
    await newWorkspace(page, `moments-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/objects/people`);
    await addPerson(page, 'Grace', 'Hopper', `grace-${tag}@example.com`);

    await page.goto(`/w/${slug}/settings/objects/people/attributes`);
    await page.getByRole('button', { name: 'New attribute' }).click();
    const dialog = page.getByRole('dialog', { name: 'New attribute' });
    await dialog.getByLabel('Name', { exact: true }).fill('Last contacted at');
    // A name ending "at" is a moment: the type follows it until the person picks one.
    await expect(dialog.getByRole('button', { name: /Type$/ })).toContainText('Date and time');
    await dialog.getByRole('button', { name: 'Create attribute' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Last contacted at added.')).toBeVisible();
    await expect(
      page.getByRole('grid', { name: 'Attributes' }).getByRole('row', { name: /Last contacted at/ }),
    ).toContainText('Date and time');

    // From the table: the cell's editor holds the day and the time, and Now sets both, read as "Today".
    await page.goto(`/w/${slug}/objects/people`);
    const cell = await cellAt(page, 0, 'Last contacted at');
    await cell.click();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: /Time/ }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Open calendar' }).first().click();
    await page.getByRole('menuitem', { name: /^Now/ }).click();
    await page.keyboard.press('Escape');
    await expect(cell).toContainText('Today');
  });
});
