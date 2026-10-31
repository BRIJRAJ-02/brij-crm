// The People table (spec 0005, milestone 2): add a column, create people,
// edit cells, and see refusals in place. Signs a new person in through
// Mailpit, names the workspace, then works the table by pointer and keyboard.
// Every state it reaches is checked with axe (WCAG A and AA, contrast
// included) in light and in dark. Set FLOW_SCREENSHOTS to a folder to keep a
// light and a dark picture of each, per project. Verifies AC-34 to AC-37.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { addPerson, cellAt, checkScreen, chooseNewAttribute, newWorkspace, showColumn } from './people.ts';

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

    // Add attribute (spec 0012, AttributeSettings): a name and a type; the column appears once the server agrees.
    const columnsBefore = Number(await grid.getAttribute('aria-colcount'));
    await page.getByRole('button', { name: 'Add attribute' }).first().click();
    await chooseNewAttribute(page);
    const addDialog = page.getByRole('dialog', { name: 'New attribute' });
    await expect(addDialog).toBeVisible();
    await addDialog.getByLabel('Name', { exact: true }).fill('Nickname');
    await checkScreen(page, '2-add-attribute');
    await addDialog.getByRole('button', { name: 'Create attribute' }).click();
    await expect(addDialog).toBeHidden();
    await expect.poll(async () => Number(await grid.getAttribute('aria-colcount'))).toBe(columnsBefore + 1);
    await expect(page.getByText('Nickname added.')).toBeVisible();
    await showColumn(page, 'Nickname');

    // The same name again would take the same API name: refused on the Name field before anything is sent.
    await page.getByRole('button', { name: 'Add attribute' }).first().click();
    await chooseNewAttribute(page);
    await addDialog.getByLabel('Name', { exact: true }).fill('Nickname');
    await addDialog.getByRole('button', { name: /Type$/ }).click();
    await page.getByRole('option', { name: 'Rating' }).click();
    await addDialog.getByRole('button', { name: 'Create attribute' }).click();
    await expect(addDialog.getByText('Another attribute here has this name. Pick another.')).toBeVisible();
    await checkScreen(page, '3-add-attribute-taken');
    await addDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(addDialog).toBeHidden();

    // New person: the row shows and takes focus (AC-35).
    await addPerson(page, 'Grace', 'Hopper', `grace-${tag}@example.com`);
    const first = await cellAt(page, 0, 'Name');
    await expect(first).toContainText('Grace Hopper');
    await expect(first).toBeFocused();
    // Newest first (spec 0006, AC-57): a record made here sits first, marked New, and takes focus there.
    await addPerson(page, 'Alan', 'Turing', `alan-${tag}@example.com`);
    await expect(await cellAt(page, 0, 'Name')).toBeFocused();
    await expect(await cellAt(page, 0, 'Name')).toContainText('Alan Turing');
    await expect(await cellAt(page, 1, 'Name')).toContainText('Grace Hopper');
    // The total count sits beside the title.
    await expect(page.getByText(/^2\s*people$/)).toBeVisible();

    // Create with no name is refused in the dialog, before any row is made.
    await page.getByRole('button', { name: 'New person' }).first().click();
    const blank = page.getByRole('dialog', { name: 'New person' });
    await blank.getByRole('button', { name: 'Create' }).click();
    await expect(blank.getByText('Name the person.')).toBeVisible();
    await expect(blank.getByLabel('First name')).toHaveAttribute('aria-invalid', 'true');
    await blank.getByRole('button', { name: 'Cancel' }).click();
    await expect(blank).toBeHidden();

    // A refused create keeps the dialog open with the message on its field, and no row.
    await page.getByRole('button', { name: 'New person' }).first().click();
    const newDialog = page.getByRole('dialog', { name: 'New person' });
    await newDialog.getByLabel('First name').fill('Grace');
    await newDialog.getByRole('button', { name: /Add more fields/ }).click();
    await newDialog.getByLabel('Email address', { exact: true }).fill(`grace-${tag}@example.com`);
    await newDialog.getByRole('button', { name: 'Create' }).click();
    // The holder is named, since this member can see Grace (spec 0049, AC-4905).
    await expect(newDialog.getByText(`grace-${tag}@example.com belongs to Grace Hopper.`)).toBeVisible();
    await checkScreen(page, '4-new-person-refused');
    await newDialog.getByRole('button', { name: 'Cancel' }).click();
    // The header, the two people and the footer: no third row.
    await expect(grid).toHaveAttribute('aria-rowcount', '4');

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

    // A refused edit rolls back and marks the cell with why, said once in the status line (spec 0006: a refused
    // value raises no toast and no Retry, which only a passing failure offers). Alan, first, takes Grace's email.
    const email = await cellAt(page, 0, 'Email addresses');
    await email.click();
    await page.keyboard.press('Enter');
    // Several emails edit in a popover on the cell (its field is named for the column).
    const editor = page
      .getByRole('dialog', { name: 'Email addresses' })
      .getByRole('textbox', { name: 'Email addresses' });
    await editor.fill(`grace-${tag}@example.com`);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await expect(
      page.getByRole('status').filter({ hasText: `grace-${tag}@example.com belongs to Grace Hopper.` }),
    ).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
    // Alan keeps his own address; the refusal under it names Grace's, and who holds it.
    await expect(email).toHaveText(`alan-${tag}@example.comgrace-${tag}@example.com belongs to Grace Hopper.`);
    await checkScreen(page, '6-edit-refused');

    await page.reload();
    await expect(await cellAt(page, 0, 'Job title')).toContainText('Rear admiral');
    await expect(await cellAt(page, 1, 'Nickname')).toContainText('Prof');
    await expect(await cellAt(page, 0, 'Name')).toContainText('Alan Turing');
  });
});
