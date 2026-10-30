// Import's Review values and preview (owner walk 30 Oct 2026, after Attio's):
// a stage that isn't one is created, a source mapped to one that is, a date
// that can't be read left empty so its row still imports, money written with
// a symbol read as its currency; a file with nothing to settle skips the
// step; the preview counts new and update rows before the start, a second
// row with the same email updates the record the first makes, no match key
// warns of duplicates; a column becomes a new attribute through the attribute
// dialog, prefilled; an Excel file says how to save it as CSV; and a done
// step goes back.
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { addPerson, newWorkspace } from './people.ts';

/** Drops a file named `name` holding `text` on the import page's upload. */
async function upload(page: Page, name: string, text: string, mimeType = 'text/csv') {
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType, buffer: Buffer.from(text) });
}

/** Picks `option` in the Select whose name matches `select`. */
async function choose(page: Page, select: RegExp, option: string) {
  await page.getByRole('button', { name: select }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test.describe('import: review values and the preview', () => {
  test.describe.configure({ mode: 'parallel' });

  test('settles labels and unreadable cells in one step, and reads money written with a symbol', async ({ page }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `importrev-${tag}`;
    await newWorkspace(page, `importrev-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/objects/deals/import`);
    const csv = [
      'Name,Stage,Value,Close date,Source',
      'Apollo,Lead,"$1,200",2025-04-03,Inbound',
      'Zeus,Negotiation,€900,someday,Webinar',
      'Hera,Won,£5,2025-05-01,Inbound',
      'Ares,Negotiation,₹500,,Webinar',
      'Nike,Lost,¥300,,Inbound',
    ].join('\n');
    await upload(page, 'deals.csv', `${csv}\n`);
    await expect(page.getByText('5 of 5 columns will be imported')).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();

    // Review values: each with a choice made already.
    await expect(page.getByRole('heading', { name: 'Review values' })).toBeVisible();
    await expect(page.getByText('1 value isn’t an option of Stage')).toBeVisible();
    await expect(page.getByRole('button', { name: /What Negotiation becomes/u })).toContainText('Create option');
    // Webinar goes to an option Source already has.
    await choose(page, /What Webinar becomes/u, 'Use Event');
    // One date can't be read: left empty, so Zeus still imports.
    await expect(page.getByText('1 cell in Close date can’t be read')).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'Leave this cell empty' })).toBeChecked();
    await page.getByRole('button', { name: 'Continue' }).click();

    // Preview: every row ready, the money read as its currency, Negotiation made an option, and nothing to match by.
    await expect(page.getByText('5 ready')).toBeVisible();
    for (const amount of [/1,200/u, /900/u, /£5/u, /500/u, /300/u]) {
      await expect(page.getByRole('grid', { name: 'Rows to import' }).getByText(amount).first()).toBeVisible();
    }
    await expect(page.getByRole('grid', { name: 'Rows to import' }).getByText('Negotiation').first()).toBeVisible();
    await expect(page.getByText('5 new. You can undo it for 7 days.')).toBeVisible();
    // The Steps bar's done steps go back.
    await page.getByRole('button', { name: /Review values/u }).click();
    await expect(page.getByRole('heading', { name: 'Review values' })).toBeVisible();
  });

  test('a clean file skips review; the preview counts new and update, and a repeated email updates', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `importcount-${tag}`;
    await newWorkspace(page, `importcount-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/objects/people`);
    await addPerson(page, 'Ada', 'Lovelace', `ada-${tag}@example.com`);
    await page.goto(`/w/${slug}/objects/people/import`);
    const csv = [
      'First name,Last name,E-mail',
      `Ada,Lovelace,ada-${tag}@example.com`,
      `Bob,Byron,bob-${tag}@example.com`,
      `Bob,Again,BOB-${tag}@example.com`,
    ].join('\n');
    await upload(page, 'people.csv', `${csv}\n`);
    await page.getByRole('button', { name: 'Continue' }).click();

    // Nothing to settle: straight to the preview, with three steps in the bar.
    await expect(page.getByText('3 ready')).toBeVisible();
    await expect(page.getByRole('list', { name: 'Import steps' }).getByRole('listitem')).toHaveCount(3);
    await expect(page.getByRole('button', { name: /Match existing records by/u })).toContainText('Email addresses');
    // Ada is there already; the second Bob meets the record the first makes.
    await expect(page.getByText('1 new · 2 update. You can undo it for 7 days.')).toBeVisible();

    // Without a match key on an object holding records, importing again would duplicate: said before the start.
    await choose(page, /Match existing records by/u, 'Don’t match, always add');
    await expect(page.getByText('Rows are always added; importing this file again creates duplicates.')).toBeVisible();
    await choose(page, /Match existing records by/u, 'Email addresses');
    await expect(page.getByText('Rows are always added; importing this file again creates duplicates.')).toBeHidden();

    // Start goes at once; the summary counts one made and none twice.
    await page.getByRole('button', { name: 'Start import' }).click();
    await expect(page.getByRole('heading', { name: 'Import finished' })).toBeVisible({ timeout: 120_000 });
    const created = page.getByRole('main').getByRole('term').filter({ hasText: 'Created' });
    await expect(created).toBeVisible();
    await expect(page.getByRole('main').getByRole('definition').first()).toHaveText('1');

    // The upload step lists it under Recent imports, linking back to this summary.
    await page.goto(`/w/${slug}/objects/people/import`);
    await expect(
      page.getByRole('grid', { name: 'Recent imports' }).getByRole('link', { name: 'people.csv' }),
    ).toBeVisible();
  });

  test('New attribute opens the attribute dialog prefilled, and an Excel file says how to save as CSV', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `importattr-${tag}`;
    await newWorkspace(page, `importattr-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/objects/people/import`);

    await upload(
      page,
      'people.xlsx',
      'not really',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    await expect(
      page.getByText('Excel file? In Excel choose File › Save as › CSV UTF-8, then drop it here.'),
    ).toBeVisible();

    await upload(page, 'people.csv', 'First name,Tier\nAda,Gold\nBob,Silver\nCy,Gold\n');
    await choose(page, /Where Tier goes/u, 'New attribute');
    const dialog = page.getByRole('dialog', { name: 'New attribute' });
    await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Tier');
    await expect(dialog.getByText('Gold')).toBeVisible();
    await expect(dialog.getByText('Silver')).toBeVisible();
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: /Where Tier goes/u })).toContainText('Tier');
  });
});
