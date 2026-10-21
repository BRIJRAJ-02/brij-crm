// Bulk edit, bulk jobs and delete forever (spec 0022, milestones 2 to 4), end
// to end with two browsers: an owner ticks two people and sets their Job title
// in the edit dialog, a second browser sees it live, and the toast's Undo puts
// it back; "Select all 3 matching" deletes as a background change (counted,
// reviewed and confirmed with the exact number, then the finish toast with
// Undo); the Trash restores one (live in the second browser), deletes one
// forever and empties the rest after its count (AC-529 to AC-531, AC-534,
// AC-535, AC-542, AC-544). Needs the worker running beside the api (the jobs).
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { addPerson, checkScreen, newWorkspace, signInAgain } from './people.ts';

/** People's table. */
const table = (page: Page) => page.getByRole('grid', { name: 'People' });

/** The row checkbox of a person, by name. */
const tick = (page: Page, name: string, grid = 'People') =>
  page.getByRole('grid', { name: grid }).getByRole('gridcell', { name: new RegExp(`^Select ${name}`) });

/** Whether the second browser's live checks run (Centrifugo allows only localhost:5173). */
const LIVE = process.env.FLOW_NO_LIVE === undefined;

/** The floating bar while rows are ticked or a change runs. */
const bar = (page: Page) => page.getByRole('toolbar', { name: 'Selected records' });

/** A dialog or an alert dialog by its title. */
const dialog = (page: Page, name: string | RegExp) =>
  page.getByRole('alertdialog', { name }).or(page.getByRole('dialog', { name }));

test.describe('bulk', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The table flow runs at desktop width.');

  test('edits two people, deletes all matching as a job with undo, and deletes forever', async ({
    browser,
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    const tag = randomUUID().slice(0, 8);
    const email = `bulk-${tag}@example.com`;
    const slug = `bulk-${tag}`;
    const code = await newWorkspace(page, email, slug);
    await addPerson(page, 'Ada', 'Byron', `ada-${tag}@acme.com`);
    await addPerson(page, 'Bea', 'Stone', `bea-${tag}@acme.com`);
    await addPerson(page, 'Cy', 'Lane', `cy-${tag}@acme.com`);
    await expect(table(page).getByRole('rowheader', { name: /Cy Lane/ })).toBeVisible();

    const other = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: { width: 1280, height: 800 },
    });
    const reader = await other.newPage();
    await signInAgain(reader, email, `/w/${slug}/objects/people`, [code]);
    await expect(table(reader).getByRole('rowheader', { name: /Bea Stone/ })).toBeVisible();

    // Edit two (AC-529, AC-530): the field, Set, the value through its own editor, Apply.
    await tick(page, 'Ada Byron').click();
    await tick(page, 'Bea Stone').click();
    await bar(page).getByRole('button', { name: 'Edit' }).click();
    const edit = dialog(page, 'Edit 2 people');
    await edit.getByRole('button', { name: /Field/ }).click();
    await page.getByRole('option', { name: 'Job title' }).click();
    await edit.getByRole('textbox', { name: 'Value' }).fill('Founder');
    await checkScreen(page, 'bulk-edit');
    await edit.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByText('Updated 2 people.')).toBeVisible();
    await expect(edit).toHaveCount(0);
    if (LIVE) await expect(table(reader).getByRole('gridcell', { name: /Founder/ })).toHaveCount(2);
    // The toast's Undo puts back what each record held (AC-530).
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('Undid the edit of 2 people.')).toBeVisible();

    // All matching (AC-523, AC-528): a background change, counted, confirmed, then the finish toast with Undo.
    await page.keyboard.press('Escape');
    await tick(page, 'Ada Byron').click();
    await bar(page)
      .getByRole('button', { name: /Select all 3 matching/ })
      .click();
    await bar(page).getByRole('button', { name: 'Delete' }).click();
    // Counted in the background, then reviewed: the confirm never opens by itself.
    await expect(bar(page).getByRole('button', { name: 'Review' })).toBeVisible({ timeout: 60_000 });
    await expect(bar(page).getByText('3 people counted').first()).toBeVisible();
    await bar(page).getByRole('button', { name: 'Review' }).click();
    const confirm = dialog(page, 'Delete 3 people?');
    await expect(confirm).toBeVisible();
    await checkScreen(page, 'bulk-job-confirm');
    await confirm.getByRole('button', { name: 'Delete 3 people' }).click();
    await expect(page.getByText('Deleted 3 people.')).toBeVisible({ timeout: 60_000 });
    await expect(table(page).getByRole('rowheader', { name: /Ada Byron/ })).toHaveCount(0, { timeout: 15_000 });
    if (LIVE)
      await expect(table(reader).getByRole('rowheader', { name: /Ada Byron/ })).toHaveCount(0, { timeout: 15_000 });
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('Restored 3 people.')).toBeVisible();
    await expect(table(page).getByRole('rowheader', { name: /Ada Byron/ })).toBeVisible({ timeout: 15_000 });

    // The Trash (AC-534, AC-535): restore one, delete one forever, and empty the rest, owners only for the last two.
    for (const name of ['Ada Byron', 'Bea Stone', 'Cy Lane']) await tick(page, name).click();
    await bar(page).getByRole('button', { name: 'Delete' }).click();
    await dialog(page, 'Delete 3 people?').getByRole('button', { name: 'Delete 3 people' }).click();
    await expect(page.getByText('Deleted 3 people.')).toBeVisible();
    await page.getByRole('link', { name: 'Trash' }).click();
    const trash = page.getByRole('grid', { name: 'Trash' });
    await expect(trash.getByRole('rowheader')).toHaveCount(3);
    await tick(page, 'Cy Lane', 'Trash').click();
    await bar(page).getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByText('Restored Cy Lane.')).toBeVisible();
    await expect(trash.getByRole('rowheader')).toHaveCount(2);
    if (LIVE) await expect(table(reader).getByRole('rowheader', { name: /Cy Lane/ })).toBeVisible({ timeout: 15_000 });
    await tick(page, 'Ada Byron', 'Trash').click();
    await bar(page).getByRole('button', { name: 'Delete forever' }).click();
    const forever = dialog(page, 'Delete 1 record forever?');
    await expect(forever.getByText('This can’t be undone.')).toBeVisible();
    await forever.getByRole('button', { name: 'Delete 1 record forever' }).click();
    await expect(page.getByText('Deleted 1 record forever.')).toBeVisible();
    await expect(trash.getByRole('rowheader')).toHaveText([/Bea Stone/]);
    await page.getByRole('button', { name: 'Empty trash' }).click();
    await expect(bar(page).getByRole('button', { name: 'Review' })).toBeVisible({ timeout: 60_000 });
    await expect(bar(page).getByText('1 record counted').first()).toBeVisible();
    await bar(page).getByRole('button', { name: 'Review' }).click();
    const empty = dialog(page, 'Empty the trash?');
    await expect(empty.getByText('1 record will be deleted forever. This can’t be undone.')).toBeVisible();
    await checkScreen(page, 'bulk-empty-trash');
    await empty.getByRole('button', { name: 'Delete 1 record forever' }).click();
    await expect(page.getByText('Deleted 1 record forever.').last()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('The trash is empty')).toBeVisible({ timeout: 15_000 });
    await other.close();
  });
});
