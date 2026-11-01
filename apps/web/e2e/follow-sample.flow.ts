// Follow a record and sample data (the follow-sample lane, 31 October 2026): an empty Deals offers Add sample data,
// which fills People, Companies and Deals and gives Deals its Pipeline; Settings › General removes it in one action,
// with Undo; a record's header bell follows and unfollows it, and stays as set after a reload.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { newWorkspace } from './people.ts';

test.describe('follow and sample data', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The tables and settings run at desktop width.');

  test('sample data fills the tables from an empty Deals, and goes in one action with Undo', async ({ page }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `sample-${tag}`;
    await newWorkspace(page, `sample-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/objects/deals`);
    await page.getByRole('button', { name: 'Add sample data' }).click();
    await expect(page.getByText('Sample data added')).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByRole('grid', { name: 'Deals' }).getByRole('row').filter({ hasText: 'Northwind annual plan' }),
    ).toHaveCount(1);
    await page.goto(`/w/${slug}/objects/people`);
    await expect(page.getByRole('grid', { name: 'People' }).getByRole('row').filter({ hasText: 'Maya' })).toHaveCount(
      1,
    );

    await page.goto(`/w/${slug}/settings/general`);
    await page.getByRole('button', { name: 'Remove sample data' }).click();
    await expect(page.getByText('Removed 33 sample records')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add sample data' })).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('Sample data back')).toBeVisible();
  });

  test('the header’s bell follows a record you made, and unfollows it', async ({ page }) => {
    test.setTimeout(120_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `follow-${tag}`;
    await newWorkspace(page, `follow-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/objects/companies`);
    await page.getByRole('button', { name: 'New company' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New company' });
    await dialog.getByLabel('Name', { exact: true }).fill('Acme');
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole('grid', { name: 'Companies' }).getByRole('row').filter({ hasText: 'Acme' }).click();
    // Its maker follows it already.
    const bell = page.getByRole('button', { name: 'Follow' }).first();
    await expect(bell).toHaveAttribute('aria-pressed', 'true');
    await bell.click();
    await expect(bell).toHaveAttribute('aria-pressed', 'false');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Follow' }).first()).toHaveAttribute('aria-pressed', 'false');
  });
});
