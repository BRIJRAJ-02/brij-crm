// The field polish pass (30 October 2026): every field forgives what people paste and type, and behaves the same on
// every surface. New deal reads "$1.2k" and offers Create in a select; a deal's details offer Copy and Create too;
// a person's name splits when pasted whole, a pasted list of emails adds each, and an address pasted on one line
// fills its parts. The review fixes: an amount says what it saves as and when its currency changed, an option made
// in a form shows at once, a list value edits in place, and a date reads Today, Tomorrow or Yesterday, else the date.
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
    // Before it saves, the field says what the typed text saves as.
    await expect(dialog.getByText('Saves as 1,200.')).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Value' }).blur();
    // The symbol moved the currency picker, and the hint says so.
    await expect(dialog.getByRole('button', { name: 'EUR' })).toBeVisible();
    await expect(dialog.getByText('Currency changed to EUR.')).toBeVisible();
    await dialog.getByRole('button', { name: /^Source/ }).click();
    await page.getByRole('textbox', { name: 'Search Source' }).fill('Podcast');
    await page.getByRole('option', { name: 'Create "Podcast"' }).click();
    // Chosen at once, its label shown while the server makes it.
    await expect(dialog.getByText('Podcast')).toBeVisible({ timeout: 1000 });
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

  test('a list value edits in place: Esc keeps it, Enter replaces it where it was, Make primary keeps focus', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `fieldedit-${tag}`;
    await newWorkspace(page, `fieldedit-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/objects/people`);
    await page.getByRole('button', { name: 'New person' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'New person' });
    await dialog.getByRole('textbox', { name: 'First name' }).fill('Ada');
    await dialog.getByRole('button', { name: 'Create person' }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole('grid', { name: 'People' }).getByRole('link', { name: 'Ada' }).click();
    const details = page.getByRole('region', { name: 'Details' });
    await details.getByRole('button', { name: 'Edit Email addresses' }).click();
    await page.keyboard.type('ada@one.com');
    await page.keyboard.press('Enter');
    await page.keyboard.type('ada@two.com');
    await page.keyboard.press('Enter');
    const add = details.getByRole('textbox', { name: 'Email addresses' });

    await details.getByRole('button', { name: 'ada@one.com options' }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(add).toBeFocused();
    await expect(add).toHaveValue('ada@one.com');
    await page.keyboard.press('Escape');
    await expect(details.getByRole('button', { name: 'ada@one.com options' })).toBeVisible();

    await details.getByRole('button', { name: 'ada@one.com options' }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await add.fill('ada@first.com');
    await page.keyboard.press('Enter');
    const chips = details.getByRole('list', { name: 'Email addresses' }).getByRole('listitem');
    await expect(chips.first()).toContainText('ada@first.com');

    await details.getByRole('button', { name: 'ada@two.com options' }).click();
    await page.getByRole('menuitem', { name: 'Make primary' }).click();
    await expect(chips.first()).toContainText('ada@two.com');
    await expect(details.getByRole('button', { name: 'ada@two.com options' })).toBeFocused();
  });

  test('a date reads Tomorrow next to today, and the exact date three days off', async ({ page, context }) => {
    test.setTimeout(180_000);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const tag = randomUUID().slice(0, 8);
    const slug = `fielddate-${tag}`;
    await newWorkspace(page, `fielddate-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/objects/deals`);
    for (const [name, typed] of [
      ['Soon', 'tomorrow'],
      ['Later', 'in 3 days'],
    ] as const) {
      await page.getByRole('button', { name: 'New deal' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'New deal' });
      await dialog.getByLabel('Name', { exact: true }).fill(name);
      await dialog.getByRole('button', { name: /Add more fields/ }).click();
      const closeDate = dialog.getByRole('group', { name: 'Close date' });
      await closeDate.getByRole('spinbutton').first().click();
      await page.evaluate((text) => navigator.clipboard.writeText(text), typed);
      await page.keyboard.press('ControlOrMeta+V');
      await dialog.getByRole('button', { name: 'Create deal' }).click();
      await expect(dialog).toBeHidden();
    }
    const grid = page.getByRole('grid', { name: 'Deals' });
    await expect(grid.getByRole('row').filter({ hasText: 'Soon' })).toContainText('Tomorrow');
    const later = grid.getByRole('row').filter({ hasText: 'Later' });
    await expect(later).not.toContainText(/In 3 days/i);
    await expect(later.locator('time')).toHaveCount(0);
  });
});
