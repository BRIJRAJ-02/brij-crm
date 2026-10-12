// Types with setup and options (spec 0012, milestone 3), end to end: an owner
// makes a pipeline Status from settings, its starter stages edited before
// create (one renamed, one added, a target in days); archives a stage, which
// the table then refuses for new values; and in a Stage cell types a stage
// that doesn't exist and creates it. A second browser, the same person on the
// same table, sees the cell and the new stage without a reload (AC-236 to
// AC-238, AC-241).
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { addPerson, cellAt, checkScreen, newWorkspace, showColumn, signInAgain } from './people.ts';

/** The open list of a select or status cell's editor (its search over the options, and "Create" last). */
const listOf = (page: Page) => page.getByRole('listbox');

test.describe('options', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The table flow runs at desktop width.');

  test('an owner shapes a pipeline, archives a stage, and creates one from a cell that a second browser sees', async ({
    browser,
    page,
  }, testInfo) => {
    test.setTimeout(150_000);
    const tag = randomUUID().slice(0, 8);
    const email = `options-${tag}@example.com`;
    const slug = `options-${tag}`;
    const code = await newWorkspace(page, email, slug);

    // A new Status starts with its three stages, editable before create (AC-230).
    await page.goto(`/w/${slug}/settings/objects/people/attributes`);
    await page.getByRole('button', { name: 'New attribute' }).click();
    const dialog = page.getByRole('dialog', { name: 'New attribute' });
    await dialog.getByLabel('Name', { exact: true }).fill('Pipeline');
    await dialog.getByRole('button', { name: /Type$/ }).click();
    await page.getByRole('option', { name: 'Status', exact: true }).click();
    const stages = dialog.getByRole('grid', { name: 'Stages' });
    await expect(stages.getByRole('row')).toHaveCount(3);
    await stages.getByRole('textbox', { name: 'Stage 2' }).fill('Building');
    // A label commits as focus leaves it.
    await stages.getByRole('textbox', { name: 'Stage 2' }).press('Tab');
    await stages.getByRole('textbox', { name: 'Building target days' }).fill('14');
    await stages.getByRole('textbox', { name: 'Building target days' }).press('Tab');
    await dialog.getByRole('button', { name: 'Add stage' }).click();
    await page.keyboard.type('Blocked');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(stages.getByRole('row')).toHaveCount(4);
    await checkScreen(page, 'options-new-status');
    await dialog.getByRole('button', { name: 'Create attribute' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Pipeline added.')).toBeVisible();

    // Archiving a stage keeps it on the values that hold it, and the table won't offer it for new ones (AC-236).
    const own = page.getByRole('grid', { name: 'Attributes' });
    await own.getByRole('row', { name: /Pipeline/ }).click();
    const edit = page.getByRole('dialog', { name: 'Edit attribute' });
    await expect(edit.getByText('Changes to options save as you make them.')).toBeVisible();
    const editStages = edit.getByRole('grid', { name: 'Stages' });
    await expect(editStages.getByRole('textbox', { name: 'Building target days' })).toHaveValue('14');
    await editStages.getByRole('button', { name: 'Actions for Blocked' }).click();
    await page.getByRole('menuitem', { name: 'Archive' }).click();
    await expect(editStages.getByRole('row')).toHaveCount(3);
    await expect(edit.getByRole('button', { name: /Archived/ })).toBeVisible();
    await checkScreen(page, 'options-edit-status');
    await edit.getByRole('button', { name: 'Cancel' }).click();
    await expect(edit).toBeHidden();

    // The second browser: the same person, on the same table.
    const readerContext = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: testInfo.project.use.viewport ?? null,
    });
    const reader = await readerContext.newPage();
    const people = `/w/${slug}/objects/people`;
    await page.goto(people);
    await addPerson(page, 'Grace', 'Hopper', `grace-${tag}@example.com`);
    await signInAgain(reader, email, people, [code]);
    await expect(reader.getByRole('grid', { name: 'People' })).toBeVisible();

    // In the writer's Stage cell: the archived stage is off, and a stage typed that doesn't exist is offered (AC-238).
    const cell = await cellAt(page, 0, 'Pipeline');
    await cell.click();
    await page.keyboard.press('Enter');
    await expect(listOf(page)).toBeVisible();
    await expect(listOf(page).getByRole('option', { name: 'Blocked' })).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.type('Shipped');
    await checkScreen(page, 'options-create-in-cell');
    await listOf(page).getByRole('option', { name: 'Create "Shipped"' }).click();
    await expect(listOf(page)).toBeHidden();
    await expect(cell).toContainText('Shipped');

    // The reader sees the value and, opening the same cell, the new stage among the options, with no reload.
    const readerCell = await cellAt(reader, 0, 'Pipeline');
    await expect(readerCell).toContainText('Shipped');
    await readerCell.click();
    await reader.keyboard.press('Enter');
    await expect(listOf(reader).getByRole('option', { name: 'Shipped' })).toBeVisible();
    await reader.keyboard.press('Escape');

    // A stage that exists (ignoring case) is never offered again: it is chosen instead.
    await cell.click();
    await page.keyboard.press('Enter');
    await page.keyboard.type('shipped');
    await expect(listOf(page).getByRole('option', { name: /^Create/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await showColumn(page, 'Name');
    await readerContext.close();
  });
});
