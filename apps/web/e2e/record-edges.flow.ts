// The record journey's edges (CRM flow pass, 30 October 2026): New record says what it made, with Open, and its
// "Create more" keeps the dialog for the next one; a record's page deletes it from its More menu in one click,
// back to the table with Undo; a deleted record's banner restores it, or says why it can't (its email taken
// meanwhile); and the Notes and Tasks tabs start from their empty states.
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { addPerson, newWorkspace } from './people.ts';

/** The record's page address, from the toast's Open after it was made. */
async function openFromToast(page: Page, name: string): Promise<string> {
  const toast = page
    .getByRole('alertdialog')
    .or(page.getByRole('status'))
    .filter({ hasText: `${name} created` });
  await toast.getByRole('button', { name: 'Open' }).click();
  await expect(page).toHaveURL(/\/objects\/people\/[0-9a-f-]{36}\/overview$/);
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  return new URL(page.url()).pathname;
}

test.describe('the record journey’s edges', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The table and the record page run at desktop width.');

  test('New record says what it made, with Open, and Create more keeps the dialog for the next', async ({ page }) => {
    test.setTimeout(150_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `reccreate-${tag}`;
    await newWorkspace(page, `reccreate-${tag}@example.com`, slug);

    // Create more on: the dialog stays, emptied, its first field focused, and each one is said.
    await page.getByRole('button', { name: 'New person' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New person' });
    const more = dialog.getByRole('switch', { name: 'Create more' });
    await expect(more).not.toBeChecked();
    await more.click({ force: true });
    await expect(more).toBeChecked();
    await dialog.getByLabel('First name').fill('Grace');
    await dialog.getByLabel('Last name').fill('Hopper');
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Grace Hopper created')).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('First name')).toHaveValue('');
    await expect(dialog.getByLabel('First name')).toBeFocused();
    await dialog.getByLabel('First name').fill('Alan');
    await dialog.getByLabel('Last name').fill('Turing');
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Alan Turing created')).toBeVisible();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    const table = page.getByRole('grid', { name: 'People' });
    await expect(table.getByRole('rowheader', { name: /Grace Hopper/ })).toBeVisible();
    await expect(table.getByRole('rowheader', { name: /Alan Turing/ })).toBeVisible();

    // Off (the next opening keeps the choice, so it is turned off first): Create closes, says so, and Open goes there.
    await page.getByRole('button', { name: 'New person' }).first().click();
    if (await more.isChecked()) await more.click({ force: true });
    await expect(more).not.toBeChecked();
    await dialog.getByLabel('First name').fill('Ada');
    await dialog.getByLabel('Last name').fill('Lovelace');
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(dialog).toBeHidden();
    await openFromToast(page, 'Ada Lovelace');
  });

  test('a record deletes from its page in one click, and its banner restores it or says why not', async ({ page }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `recedge-${tag}`;
    await newWorkspace(page, `recedge-${tag}@example.com`, slug);
    await addPerson(page, 'Ada', 'Lovelace', `ada-${tag}@acme.com`);
    const recordPath = await openFromToast(page, 'Ada Lovelace');

    // The Notes and Tasks tabs start from their empty states, the way to begin inside them, once each.
    await page.getByRole('tab', { name: /Notes/ }).click();
    await expect(page.getByText('No notes yet', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New note' })).toHaveCount(1);
    await page.getByRole('tab', { name: /Tasks/ }).click();
    await expect(page.getByText('No open tasks', { exact: true })).toBeVisible();
    await expect(page.getByText('Add one above')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New task' })).toHaveCount(1);
    await page.getByRole('button', { name: 'New task' }).click();
    await expect(page).toHaveURL(/\/tasks\?task=new$/);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/tasks$/);
    await page.getByRole('tab', { name: /Overview/ }).click();

    // More › Delete is one click: back to the table with Undo.
    await page.getByRole('button', { name: 'More actions' }).click();
    await expect(page.getByRole('menuitem', { name: 'Copy link' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Delete person' }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/objects/people`));
    await expect(page.getByText('Deleted Ada Lovelace.')).toBeVisible();
    const table = page.getByRole('grid', { name: 'People' });
    await expect(table.getByRole('rowheader', { name: /Ada Lovelace/ })).toHaveCount(0);

    // Her page, opened again, is read only with Restore on its banner; Restore brings the page back to normal.
    await page.goto(recordPath);
    await expect(page.getByText('This person was deleted.')).toBeVisible();
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page.getByText('Restored Ada Lovelace.')).toBeVisible();
    await expect(page.getByText('This person was deleted.')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'More actions' })).toBeVisible();

    // Deleted again, and her email taken meanwhile: Restore says why, and the banner stays.
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete person' }).click();
    await expect(page.getByText('Deleted Ada Lovelace.')).toBeVisible();
    await addPerson(page, 'Ada', 'Again', `ada-${tag}@acme.com`);
    await page.goto(recordPath);
    await expect(page.getByText('This person was deleted.')).toBeVisible();
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page.getByText(new RegExp(`ada-${tag}@acme\\.com`))).toBeVisible();
    await expect(page.getByText('This person was deleted.')).toBeVisible();
  });
});
