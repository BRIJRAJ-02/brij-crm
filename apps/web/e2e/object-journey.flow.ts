// The object journey end to end (flow walks, 29 October 2026): Settings › Objects › New object makes Projects
// with its first attributes in one dialog; a Status is added after, from the object's attributes; a record is made
// from the new table; the table switches to a board grouped by that Status and back, keeping the record in sight.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { newWorkspace } from './people.ts';

test.describe('the object journey', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The settings and the board run at desktop width.');

  test('make an object with attributes, add a record, and switch it between table and board', async ({ page }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `objjourney-${tag}`;
    await newWorkspace(page, `objjourney-${tag}@example.com`, slug);

    // New object: a name and its first attributes, each row's type guessed from its name and changeable.
    await page.goto(`/w/${slug}/settings/objects`);
    await page.getByRole('button', { name: 'New object' }).first().click();
    const create = page.getByRole('dialog', { name: 'New object' });
    await expect(create.getByLabel('Name', { exact: true })).toBeFocused();
    await create.getByLabel('Name', { exact: true }).fill('Project');
    const first = create.getByRole('group', { name: 'Attributes' }).getByRole('textbox').first();
    await first.fill('Code');
    await first.press('Enter');
    await expect(create.getByRole('group', { name: 'Attributes' }).getByRole('textbox')).toHaveCount(2);
    await create.getByRole('group', { name: 'Attributes' }).getByRole('textbox').nth(1).fill('Kickoff date');
    await expect(create.getByRole('button', { name: /Type of attribute Kickoff date/ })).toContainText('Date');
    await create.getByRole('button', { name: 'Create object' }).click();
    await expect(create).toBeHidden({ timeout: 30_000 });
    await expect(page.getByText('Projects created.')).toBeVisible();

    // A Status, added after from the object's attributes, with stages to start from.
    await page.goto(`/w/${slug}/settings/objects/projects/attributes`);
    await expect(
      page.getByRole('grid', { name: 'Attributes' }).getByRole('row', { name: /Kickoff date/ }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'New attribute' }).click();
    const attribute = page.getByRole('dialog', { name: 'New attribute' });
    await attribute.getByLabel('Name', { exact: true }).fill('Stage');
    await attribute.getByRole('button', { name: /Type$/ }).click();
    await page.getByRole('option', { name: 'Status', exact: true }).click();
    await expect(page.getByRole('listbox')).toBeHidden();
    await attribute.getByRole('button', { name: 'Create attribute' }).click();
    await expect(attribute).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText('Stage added.')).toBeVisible();

    // Out of settings, the new object is in the sidebar; its table makes a record.
    await page.getByRole('link', { name: 'Leave settings' }).click();
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Projects', exact: true })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
    await page.getByRole('button', { name: 'New project' }).first().click();
    const record = page.getByRole('dialog', { name: 'New project' });
    await record.getByLabel('Name', { exact: true }).fill('Apollo');
    await record.getByRole('button', { name: 'Create' }).click();
    await expect(record).toBeHidden();
    await expect(
      page.getByRole('grid', { name: 'Projects' }).getByRole('row').filter({ hasText: 'Apollo' }),
    ).toHaveCount(1);

    // Table to board: grouped by Stage, the record on a card; then back to the table, the record still there.
    const layout = page.getByRole('radiogroup', { name: 'Layout' });
    await layout.getByRole('radio', { name: 'Board' }).click({ force: true });
    await expect(layout.getByRole('radio', { name: 'Board' })).toBeChecked();
    await expect(page.getByText('Apollo').first()).toBeVisible();
    await layout.getByRole('radio', { name: 'Table' }).click({ force: true });
    await expect(
      page.getByRole('grid', { name: 'Projects' }).getByRole('row').filter({ hasText: 'Apollo' }),
    ).toHaveCount(1);
  });

  // A person may type the plural as the name; it must not come back doubled as "Invoiceses" (the walk's O1).
  test('a plural typed as the name is not made plural again', async ({ page }) => {
    test.setTimeout(120_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `objplural-${tag}`;
    await newWorkspace(page, `objplural-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/settings/objects`);
    await page.getByRole('button', { name: 'New object' }).first().click();
    const create = page.getByRole('dialog', { name: 'New object' });
    await create.getByLabel('Name', { exact: true }).fill('Invoices');
    await create.getByRole('button', { name: 'Create object' }).click();
    await expect(page.getByText('Invoices created.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('link', { name: 'Invoiceses' })).toHaveCount(0);
  });
});
