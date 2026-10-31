// Data in and out (lane wip/crm-dataio, scope #30 and #37): a view exported to
// Excel downloads as a workbook that the import page reads straight back (in
// its worker, Match columns on its columns); and an owner's Export everything
// in Settings › Workspace runs, offers Download and hands over a zip.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { addPerson, newWorkspace } from './people.ts';

/** How long a small export may take: the job runs in the background. */
const EXPORT_MS = 60_000;

test.describe('data in and out', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The import runs at desktop width.');

  test('a view exported to Excel imports back from the workbook', async ({ page }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `dataxlsx-${tag}`;
    await newWorkspace(page, `dataxlsx-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/objects/people`);
    await addPerson(page, 'Ada', 'Byron', `ada-${tag}@acme.com`);
    await addPerson(page, 'Bea', 'Stone', `bea-${tag}@acme.com`);
    await expect(
      page.getByRole('grid', { name: 'People' }).getByRole('rowheader', { name: /Bea Stone/u }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Import / Export' }).click();
    await page.getByRole('menuitem', { name: /^Export to Excel/u }).click();
    const ready = page.getByRole('alertdialog', { name: /People - .*\.xlsx is ready/u });
    await expect(ready).toBeVisible({ timeout: EXPORT_MS });
    const downloading = page.waitForEvent('download');
    await ready.getByRole('button', { name: 'Download' }).click();
    const file = await downloading;
    expect(file.suggestedFilename()).toMatch(/\.xlsx$/u);
    const bytes = await readFile(await file.path());
    // A zip: what every .xlsx is.
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');

    await page.goto(`/w/${slug}/objects/people/import`);
    await page.locator('input[type="file"]').setInputFiles({
      name: 'people.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: bytes,
    });
    // Read in the worker, then matched by header as a CSV would be.
    await expect(page.getByText(/^people\.xlsx, 2 rows$/u)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('rowheader', { name: 'Name' })).toBeVisible();
    await expect(page.getByText(`ada-${tag}@acme.com`)).toBeVisible();
  });

  test('an owner exports everything from Settings and downloads the zip', async ({ page }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `dataall-${tag}`;
    await newWorkspace(page, `dataall-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/objects/people`);
    await addPerson(page, 'Ada', 'Byron', `ada-${tag}@acme.com`);

    await page.goto(`/w/${slug}/settings/general`);
    await expect(page.getByRole('heading', { name: 'Your data' })).toBeVisible();
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    // The row follows the job, then offers the file; the toast says it too.
    const download = page.getByRole('main').getByRole('button', { name: 'Download' });
    await expect(download).toBeVisible({ timeout: EXPORT_MS });
    await expect(page.getByText(/^Ready, .* · goes in 2[34] hours$/u)).toBeVisible();
    const downloading = page.waitForEvent('download');
    await download.click();
    const file = await downloading;
    expect(file.suggestedFilename()).toMatch(/ - Export - \d{4}-\d{2}-\d{2}\.zip$/u);
    expect((await readFile(await file.path())).subarray(0, 2).toString('latin1')).toBe('PK');
  });
});
