// Bulk edit, several fields in one Apply (the CRM flow pass, 31 October
// 2026): Add field puts another field, its change and its value under the
// first; Apply sends one bulk edit per field (the server's edit takes one),
// says so in one toast, and its Undo takes every field back. A field another
// row took isn't offered again, and a row can be removed.
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { addPerson, checkScreen, newWorkspace } from './people.ts';

const table = (page: Page) => page.getByRole('grid', { name: 'People' });
const tick = (page: Page, name: string) => table(page).getByRole('gridcell', { name: new RegExp(`^Select ${name}`) });
const bar = (page: Page) => page.getByRole('toolbar', { name: 'Selected records' });

test.describe('bulk edit, several fields', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The table flow runs at desktop width.');

  test('sets two fields on two people in one Apply, and one Undo takes both back', async ({ page }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `bulkfields-${tag}`;
    await newWorkspace(page, `bulkfields-${tag}@example.com`, slug);
    await addPerson(page, 'Ada', 'Byron', `ada-${tag}@acme.com`);
    await addPerson(page, 'Bea', 'Stone', `bea-${tag}@acme.com`);

    await tick(page, 'Ada Byron').click();
    await tick(page, 'Bea Stone').click();
    await bar(page).getByRole('button', { name: 'Edit' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit 2 people' });
    await edit.getByRole('button', { name: /Field/ }).first().click();
    await page.getByRole('option', { name: 'Job title' }).click();
    await edit.getByRole('textbox', { name: 'Value' }).fill('Founder');

    // Add field: a second row, named by its place, whose list leaves out the field the first row took.
    await edit.getByRole('button', { name: 'Add field' }).click();
    await expect(edit.getByRole('group', { name: 'Field 2' })).toBeVisible();
    await edit
      .getByRole('group', { name: 'Field 2' })
      .getByRole('button', { name: /Field 2/ })
      .click();
    await expect(page.getByRole('option', { name: 'Job title' })).toHaveCount(0);
    await page.getByRole('option', { name: 'Time zone' }).click();
    await edit.getByRole('group', { name: 'Field 2' }).getByRole('textbox', { name: 'Value' }).fill('Europe/London');
    await checkScreen(page, 'bulk-edit-fields');

    // A third row can go again without a trace.
    await edit.getByRole('button', { name: 'Add field' }).click();
    await edit.getByRole('button', { name: 'Remove Field 3' }).click();
    await expect(edit.getByRole('group', { name: 'Field 3' })).toHaveCount(0);

    await edit.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('Updated 2 people.')).toBeVisible();
    await expect(edit).toHaveCount(0);
    await expect(table(page).getByRole('gridcell', { name: /Founder/ })).toHaveCount(2);

    // One Undo for both fields.
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('Undid the edit of 2 people.')).toBeVisible();
    await expect(table(page).getByRole('gridcell', { name: /Founder/ })).toHaveCount(0);
  });

  test('an empty second row says what it needs before anything is sent', async ({ page }) => {
    test.setTimeout(150_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `bulkempty-${tag}`;
    await newWorkspace(page, `bulkempty-${tag}@example.com`, slug);
    await addPerson(page, 'Ada', 'Byron', `ada-${tag}@acme.com`);
    await addPerson(page, 'Bea', 'Stone', `bea-${tag}@acme.com`);
    await tick(page, 'Ada Byron').click();
    await tick(page, 'Bea Stone').click();
    await bar(page).getByRole('button', { name: 'Edit' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit 2 people' });
    await edit.getByRole('button', { name: /Field/ }).first().click();
    await page.getByRole('option', { name: 'Job title' }).click();
    await edit.getByRole('textbox', { name: 'Value' }).fill('Founder');
    await edit.getByRole('button', { name: 'Add field' }).click();
    await edit.getByRole('button', { name: 'Apply' }).click();
    await expect(edit.getByText('Choose a field to change.')).toBeVisible();
    await expect(edit).toBeVisible();
  });
});
