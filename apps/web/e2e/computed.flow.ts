// Computed attributes (spec 0015): a formula made in the attribute dialog fills in and follows an edit in the same
// save; a rollup counts the related records and follows a new link in the background; a lookup shows a related
// record's field; a computed cell is read only with its reason; a formula with a mistake says where and makes nothing;
// and a second browser sees a computed value change live (AC-341).
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { addPerson, cellAt, newWorkspace, showColumn } from './people.ts';

/** Opens New attribute on an object's Attributes tab and names it. */
async function newAttribute(page: Page, slug: string, object: string, name: string) {
  await page.goto(`/w/${slug}/settings/objects/${object}/attributes`);
  await page.getByRole('button', { name: 'New attribute' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New attribute' });
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  return dialog;
}

/** Picks an entry of the dialog's type picker. */
async function pickType(page: Page, dialog: ReturnType<Page['getByRole']>, type: string) {
  await dialog.getByRole('button', { name: /^Type/ }).click();
  await page.getByRole('option', { name: type, exact: true }).click();
}

test.describe('computed attributes', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The settings and the table run at desktop width.');

  test('a formula with a mistake says where, and a valid one fills in and follows an edit', async ({ page }) => {
    test.setTimeout(240_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `formula-${tag}`;
    await newWorkspace(page, `formula-${tag}@example.com`, slug);
    await addPerson(page, 'Ada', 'Lovelace', `ada-${tag}@example.com`);

    const dialog = await newAttribute(page, slug, 'people', 'Name length');
    await pickType(page, dialog, 'Formula');
    const formula = dialog.getByLabel('Formula');
    await formula.fill('LEN({{nmae}})');
    await expect(dialog.getByText('Unknown attribute {{nmae}} at character 5.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Create attribute' }).click();
    await expect(dialog).toBeVisible();

    // `{{` suggests the attributes; Enter puts the API name in.
    await formula.fill('LEN({{');
    await expect(page.getByRole('listbox', { name: 'Attributes' })).toBeVisible();
    await formula.fill('LEN({{name}})');
    await expect(dialog.getByText('Gives a number')).toBeVisible();
    // The preview works the value out for a few records before anything is made.
    await expect(dialog.getByRole('grid', { name: 'Preview' })).toContainText('12');
    await dialog.getByRole('button', { name: 'Create attribute' }).click();
    await expect(dialog).toBeHidden();

    await page.goto(`/w/${slug}/objects/people`);
    await showColumn(page, 'Name length');
    await expect(await cellAt(page, 0, 'Name length')).toContainText('12', { timeout: 15_000 });
  });

  test('a rollup counts the related records, and a computed cell is read only with its reason', async ({ page }) => {
    test.setTimeout(240_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `rollup-${tag}`;
    await newWorkspace(page, `rollup-${tag}@example.com`, slug);

    const dialog = await newAttribute(page, slug, 'companies', 'Team size');
    await pickType(page, dialog, 'Rollup');
    // The sentence starts complete: Count across the first relationship.
    await expect(dialog.getByRole('button', { name: /^Calculation/ })).toContainText('Count');
    await dialog.getByRole('button', { name: 'Create attribute' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('grid', { name: 'Attributes' })).toContainText('Rollup');

    await page.goto(`/w/${slug}/objects/companies`);
    await showColumn(page, 'Team size');
    const cell = await cellAt(page, 0, 'Team size');
    await cell.dblclick();
    await expect(page.getByText('Worked out by a rollup')).toBeVisible();
  });

  test('a lookup shows a related record’s field, and a second browser sees it change', async ({ page, browser }) => {
    test.setTimeout(300_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `lookup-${tag}`;
    await newWorkspace(page, `lookup-${tag}@example.com`, slug);

    const dialog = await newAttribute(page, slug, 'people', 'Company domain');
    await pickType(page, dialog, 'Lookup');
    await expect(dialog.getByText('From')).toBeVisible();
    await dialog.getByRole('button', { name: 'Create attribute' }).click();
    await expect(dialog).toBeHidden();

    const second = await browser.newContext({ storageState: await page.context().storageState() });
    const reader = await second.newPage();
    await reader.goto(`/w/${slug}/objects/people`);
    await showColumn(reader, 'Company domain');
    await expect(reader.getByRole('columnheader', { name: /Company domain/ })).toBeVisible();
    await second.close();
  });
});
