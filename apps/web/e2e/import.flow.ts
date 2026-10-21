// Import (spec 0040, AC-1143): a People CSV end to end. The file is chosen,
// its columns match themselves, the preview sets aside the row that can't be
// read, the rows are sent and the job runs, and the summary says what it did;
// the people are then in the table, and Undo takes them back. FLOW_IMPORT_ROWS sets the file's size
// (5,000 by default, at 1280; the phone width checks the screens with 300).
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { checkScreen, newWorkspace } from './people.ts';

const ROWS = Number(process.env.FLOW_IMPORT_ROWS ?? 5_000);
/** Sending the rows and running the job, on a busy machine. */
const IMPORT_MS = Number(process.env.FLOW_IMPORT_MS ?? 300_000);
/** The phone width's file: the same screens, a smaller run. */
const PHONE_ROWS = 300;

/** A People file: first and last names and an email per row, then one row whose email can't be read. */
function peopleCsv(rows: number): string {
  const lines = ['First name,Last name,E-mail'];
  for (let index = 0; index < rows; index += 1) {
    lines.push(`Person${String(index)},Imported,person${String(index)}@import.test`);
  }
  lines.push('Broken,Row,not an email');
  return `${lines.join('\r\n')}\r\n`;
}

test('a People CSV imports through the four steps, and its summary says what it did', async ({ page }) => {
  test.setTimeout(2 * IMPORT_MS + 120_000);
  const rows = test.info().project.name === '375' ? Math.min(ROWS, PHONE_ROWS) : ROWS;
  const stamp = Date.now().toString(36);
  const slug = `import-${stamp}`;
  await newWorkspace(page, `import-${stamp}@example.com`, slug);

  await page.getByRole('button', { name: 'More view actions' }).click();
  await page.getByRole('menuitem', { name: 'Import CSV' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/objects/people/import$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Import people' })).toBeVisible();
  await checkScreen(page, 'import-upload');

  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: 'people.csv', mimeType: 'text/csv', buffer: Buffer.from(peopleCsv(rows)) });

  // Match columns: each header found its attribute on its own.
  await expect(page.getByText('3 of 3 columns will be imported')).toBeVisible();
  await checkScreen(page, 'import-columns');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Match records: Email addresses finds people, and a match fills empty fields.
  await expect(page.getByRole('button', { name: /Email addresses/u })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Fill empty fields' })).toBeChecked();
  await checkScreen(page, 'import-records');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Preview: the broken row is set aside with why.
  const readyRows = rows.toLocaleString('en-US');
  await expect(page.getByText(`${readyRows} ready, 1 with errors`)).toBeVisible();
  await page.getByRole('radiogroup', { name: 'Show rows' }).getByText('With errors').click();
  await expect(page.getByRole('gridcell', { name: /^E-mail: /u })).toBeVisible();
  await checkScreen(page, 'import-preview');

  await page.getByRole('button', { name: 'Start import' }).click();
  const confirm = page.getByRole('dialog', { name: `Import ${readyRows} rows into People?` });
  await confirm.getByRole('button', { name: 'Start import' }).click();

  // The summary: the job's progress, then what it did.
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/objects/people/imports/[0-9a-f-]+$`), { timeout: IMPORT_MS });
  await expect(page.getByRole('heading', { name: 'Import finished' })).toBeVisible({ timeout: IMPORT_MS });
  await expect(page.getByText(`${readyRows} new, 0 matched existing records`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo import' })).toBeVisible();
  await checkScreen(page, 'import-summary');
  await page.getByRole('link', { name: 'People' }).first().click();
  // Newest first: the file's last row leads the table.
  await expect(page.getByText(`person${String(rows - 1)}@import.test`)).toBeVisible();

  // Export CSV (AC-1130, AC-1131): the view comes back as a file, the name first, ready to import again.
  await page.getByRole('button', { name: 'More view actions' }).click();
  await page.getByRole('menuitem', { name: 'Export CSV' }).click();
  const ready = page.getByRole('alertdialog', { name: /People - .* is ready/u });
  await expect(ready).toBeVisible({ timeout: IMPORT_MS });
  const downloading = page.waitForEvent('download');
  await ready.getByRole('button', { name: 'Download' }).click();
  const file = await downloading;
  const text = await readFile(await file.path(), 'utf8');
  expect(text.startsWith('\uFEFFName,')).toBe(true);
  expect(text).toContain(`person${String(rows - 1)}@import.test`);
  expect(text.trim().split('\r\n')).toHaveLength(rows + 1);
  await page.goBack();

  // Undo: asked first, then the created people go to the trash.
  await page.getByRole('button', { name: 'Undo import' }).click();
  const undo = page.getByRole('alertdialog', { name: 'Undo this import?' });
  await expect(undo).toContainText(`${readyRows} created people move to the trash.`);
  await undo.getByRole('button', { name: 'Undo import' }).click();
  await expect(page.getByRole('heading', { name: 'Import undone' })).toBeVisible({ timeout: IMPORT_MS });
  await expect(page.getByRole('button', { name: 'Undo import' })).toHaveCount(0);

  await page.getByRole('button', { name: 'View people' }).click();
  await expect(page.getByText(`person${String(rows - 1)}@import.test`)).toHaveCount(0);
});
