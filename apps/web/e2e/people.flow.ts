// The People table (spec 0005, milestone 2): add a column, create people,
// edit cells, and see refusals in place. Signs a new person in through
// Mailpit, names the workspace, then works the table by pointer and keyboard.
// Every state it reaches is checked with axe (WCAG A and AA, contrast
// included) in light and in dark. Set FLOW_SCREENSHOTS to a folder to keep a
// light and a dark picture of each, per project. Verifies AC-34 to AC-37.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { addPerson, cellAt, checkScreen, newWorkspace, showColumn } from './people.ts';

test.describe('the People table', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The table flow runs at desktop width.');

  test('adds a column, creates people, edits cells, and shows refusals in place', async ({ page }) => {
    const tag = randomUUID().slice(0, 8);
    await newWorkspace(page, `people-${tag}@example.com`, `people-${tag}`);

    // Empty: the columns stay, with "New person" in the empty state and the top bar (AC-34).
    const grid = page.getByRole('grid', { name: 'People' });
    await expect(grid).toBeVisible();
    await expect(grid.getByRole('columnheader', { name: /Email addresses/ })).toBeVisible();
    await expect(page.getByText('No people yet')).toBeVisible();
    await expect(page.getByRole('button', { name: 'New person' })).toHaveCount(2);
    await checkScreen(page, '1-people-empty');

    // Add attribute: a name and a type; the column appears once the server agrees (AC-37).
    const columnsBefore = Number(await grid.getAttribute('aria-colcount'));
    await page.getByRole('button', { name: 'Add attribute' }).click();
    const addDialog = page.getByRole('dialog', { name: 'Add attribute' });
    await expect(addDialog).toBeVisible();
    await addDialog.getByLabel('Name').fill('Nickname');
    await checkScreen(page, '2-add-attribute');
    await addDialog.getByRole('button', { name: 'Create' }).click();
    await expect(addDialog).toBeHidden();
    await expect.poll(async () => Number(await grid.getAttribute('aria-colcount'))).toBe(columnsBefore + 1);
    await expect(page.getByText('Nickname added.')).toBeVisible();
    await showColumn(page, 'Nickname');

    // The same name again is refused inline, on the name field.
    await page.getByRole('button', { name: 'Add attribute' }).click();
    await addDialog.getByLabel('Name').fill('Nickname');
    await addDialog.getByRole('button', { name: 'Type' }).click();
    await page.getByRole('option', { name: 'Number' }).click();
    await addDialog.getByRole('button', { name: 'Create' }).click();
    await expect(addDialog.getByText('An attribute with this name exists.')).toBeVisible();
    await checkScreen(page, '3-add-attribute-taken');
    await addDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(addDialog).toBeHidden();

    // New person: the row shows and takes focus (AC-35).
    await addPerson(page, 'Grace', 'Hopper', `grace-${tag}@example.com`);
    const first = await cellAt(page, 0, 'Name');
    await expect(first).toContainText('Grace Hopper');
    await expect(first).toBeFocused();
    await addPerson(page, 'Alan', 'Turing', `alan-${tag}@example.com`);
    await expect(await cellAt(page, 1, 'Name')).toBeFocused();
    // The total count sits beside the title.
    await expect(page.getByText(/^2\s*people$/)).toBeVisible();

    // Create with no name is refused in the dialog, before any row is made.
    await page.getByRole('button', { name: 'New person' }).first().click();
    const blank = page.getByRole('dialog', { name: 'New person' });
    await blank.getByRole('button', { name: 'Create' }).click();
    await expect(blank.getByText('Name the person.')).toBeVisible();
    await blank.getByRole('button', { name: 'Cancel' }).click();
    await expect(blank).toBeHidden();

    // A refused create keeps the dialog open with the message on its field, and no row.
    await page.getByRole('button', { name: 'New person' }).first().click();
    const newDialog = page.getByRole('dialog', { name: 'New person' });
    await newDialog.getByLabel('First name').fill('Grace');
    await newDialog.getByLabel('Email addresses').fill(`grace-${tag}@example.com`);
    await newDialog.getByRole('button', { name: 'Create' }).click();
    await expect(newDialog.getByText('Another record already has this value for Email addresses.')).toBeVisible();
    await checkScreen(page, '4-new-person-refused');
    await newDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(grid).toHaveAttribute('aria-rowcount', '3');

    // Edit a cell: it shows at once and stays after a reload (AC-36).
    const jobTitle = await cellAt(page, 0, 'Job title');
    await jobTitle.click();
    await page.keyboard.type('Rear admiral');
    await page.keyboard.press('Enter');
    await expect(jobTitle).toContainText('Rear admiral');
    const nickname = await cellAt(page, 1, 'Nickname');
    await nickname.dblclick();
    await page.keyboard.type('Prof');
    await page.keyboard.press('Enter');
    await expect(nickname).toContainText('Prof');
    await checkScreen(page, '5-people-edited');

    // A refused edit rolls back, marks the cell and raises a toast with Retry.
    const email = await cellAt(page, 1, 'Email addresses');
    await email.click();
    await page.keyboard.press('Enter');
    // Several emails edit in a popover on the cell (its field is named for the column).
    const editor = page
      .getByRole('dialog', { name: 'Email addresses' })
      .getByRole('textbox', { name: 'Email addresses' });
    await editor.fill(`grace-${tag}@example.com`);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    // The toast says why (the cell carries the same reason, shown on focus or hover).
    await expect(
      page.getByText('Another record already has this value for Email addresses.').filter({ visible: true }).first(),
    ).toBeVisible();
    await expect(email).not.toContainText(`grace-${tag}@example.com`);
    await checkScreen(page, '6-edit-refused');

    await page.reload();
    await expect(await cellAt(page, 0, 'Job title')).toContainText('Rear admiral');
    await expect(await cellAt(page, 1, 'Nickname')).toContainText('Prof');
    await expect(await cellAt(page, 1, 'Name')).toContainText('Alan Turing');
  });
});
