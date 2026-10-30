// The field polish pass (30 October 2026): every field forgives what people paste and type, and behaves the same on
// every surface. New deal reads "$1.2k" and offers Create in a select; a deal's details offer Copy and Create too;
// a person's name splits when pasted whole, a pasted list of emails adds each, and an address pasted on one line
// fills its parts.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { newWorkspace } from './people.ts';

test.describe('the field polish pass', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The table and the record page run at desktop width.');

  test('New deal reads a pasted amount, and Create in a select makes the option and chooses it', async ({ page }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `fieldamt-${tag}`;
    await newWorkspace(page, `fieldamt-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/objects/deals`);
    await page.getByRole('button', { name: 'New deal' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New deal' });
    await dialog.getByLabel('Name', { exact: true }).fill('Apollo');
    await dialog.getByRole('button', { name: /Add more fields/ }).click();
    await dialog.getByRole('textbox', { name: 'Value' }).fill('€1.2k');
    await dialog.getByRole('textbox', { name: 'Value' }).blur();
    // The symbol moved the currency picker.
    await expect(dialog.getByRole('button', { name: 'EUR' })).toBeVisible();
    await dialog.getByRole('button', { name: /^Source/ }).click();
    await page.getByRole('textbox', { name: 'Search Source' }).fill('Podcast');
    await page.getByRole('option', { name: 'Create "Podcast"' }).click();
    await expect(dialog.getByText('Podcast')).toBeVisible();
    await dialog.getByRole('button', { name: 'Create deal' }).click();
    await expect(dialog).toBeHidden();
    const row = page.getByRole('grid', { name: 'Deals' }).getByRole('row').filter({ hasText: 'Apollo' });
    await expect(row).toContainText('€1,200');
    await expect(row).toContainText('Podcast');
  });

  test('a person’s pasted name splits, a pasted list of emails adds each, and Copy sits beside them', async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const tag = randomUUID().slice(0, 8);
    const slug = `fieldname-${tag}`;
    await newWorkspace(page, `fieldname-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/objects/people`);
    await page.getByRole('button', { name: 'New person' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New person' });
    const first = dialog.getByRole('textbox', { name: 'First name' });
    await first.focus();
    await page.evaluate(() => navigator.clipboard.writeText('Grace Brewster Hopper'));
    await page.keyboard.press('ControlOrMeta+V');
    await expect(first).toHaveValue('Grace');
    await expect(dialog.getByRole('textbox', { name: 'Last name' })).toHaveValue('Brewster Hopper');
    await dialog.getByRole('button', { name: 'Create person' }).click();
    await expect(dialog).toBeHidden();

    await page.getByRole('grid', { name: 'People' }).getByRole('link', { name: 'Grace Brewster Hopper' }).click();
    const details = page.getByRole('region', { name: 'Details' });
    await details.getByRole('button', { name: 'Edit Email addresses' }).click();
    await page.evaluate(() => navigator.clipboard.writeText('grace@navy.mil, Grace <hopper@yale.edu>'));
    await page.keyboard.press('ControlOrMeta+V');
    await expect(details.getByRole('button', { name: 'grace@navy.mil options' })).toBeVisible();
    await expect(details.getByRole('button', { name: 'hopper@yale.edu options' })).toBeVisible();
    await page.keyboard.press('Escape');
    await details.getByRole('link', { name: 'grace@navy.mil' }).hover();
    await expect(details.getByRole('button', { name: 'Copy grace@navy.mil' })).toBeVisible();
  });

  test('an address pasted on one line fills its parts', async ({ page, context }) => {
    test.setTimeout(180_000);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const tag = randomUUID().slice(0, 8);
    const slug = `fieldaddr-${tag}`;
    await newWorkspace(page, `fieldaddr-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/objects/companies`);
    await page.getByRole('button', { name: 'New company' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New company' });
    await dialog.getByLabel('Name', { exact: true }).fill('Downing');
    await dialog.getByRole('button', { name: /Add more fields/ }).click();
    await dialog.getByRole('textbox', { name: 'Address' }).focus();
    await page.evaluate(() => navigator.clipboard.writeText('10 Downing St, London SW1A 2AA, UK'));
    await page.keyboard.press('ControlOrMeta+V');
    await expect(dialog.getByRole('textbox', { name: 'City' })).toHaveValue('London');
    await expect(dialog.getByRole('textbox', { name: 'Postcode' })).toHaveValue('SW1A 2AA');
    await expect(dialog.getByRole('button', { name: /United Kingdom/ })).toBeVisible();
  });
});
