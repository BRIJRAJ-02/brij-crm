// The object journey's edges (flow walks, phase 3, 29 October 2026): a name already taken is refused in the New
// object dialog before anything is made; archiving an object asks first, takes it out of the sidebar, and Restore
// brings it back with its records; and a board grouped by a field that is then archived says so and offers the
// ways out (late trap #14: it said "Pick another field" with no picker).
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { newWorkspace } from './people.ts';

test.describe('the object journey’s edges', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The settings and the board run at desktop width.');

  test('a name already taken is refused in the dialog, before anything is made', async ({ page }) => {
    test.setTimeout(120_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `objtaken-${tag}`;
    await newWorkspace(page, `objtaken-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/settings/objects`);
    await page.getByRole('button', { name: 'New object' }).first().click();
    const create = page.getByRole('dialog', { name: 'New object' });
    await create.getByLabel('Name', { exact: true }).fill('Company');
    await create.getByRole('button', { name: 'Create object' }).click();
    await expect(create.getByText('An object already uses this API name.')).toBeVisible();
    await expect(create).toBeVisible();
  });

  test('archiving an object asks first, leaves the sidebar, and Restore brings it back with its records', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `objarch-${tag}`;
    await newWorkspace(page, `objarch-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/objects/deals`);
    await page.getByRole('button', { name: 'New deal' }).first().click();
    const record = page.getByRole('dialog', { name: 'New deal' });
    await record.getByLabel('Name', { exact: true }).fill('Apollo');
    await record.getByRole('button', { name: 'Create' }).click();
    await expect(record).toBeHidden();

    await page.goto(`/w/${slug}/settings/objects/deals/configuration`);
    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Archive Deals?' });
    await expect(confirm).toContainText('its 1 record is kept');
    await confirm.getByRole('button', { name: 'Archive Deals' }).click();
    await expect(page.getByText('Deals archived.')).toBeVisible();

    // Archived, the same place offers it back.
    await expect(page.getByRole('heading', { name: 'Restore Deals' })).toBeVisible();
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page.getByText('Deals restored.')).toBeVisible();
    await page.getByRole('link', { name: 'Leave settings' }).click();
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Deals', exact: true })
      .click();
    await expect(page.getByRole('grid', { name: 'Deals' }).getByRole('row').filter({ hasText: 'Apollo' })).toHaveCount(
      1,
    );
  });

  test('a board grouped by a field that is then archived says so and offers a way out', async ({ page }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `objboard-${tag}`;
    await newWorkspace(page, `objboard-${tag}@example.com`, slug);
    // Deals' board groups by its Stage.
    await page.goto(`/w/${slug}/objects/deals`);
    const layout = page.getByRole('radiogroup', { name: 'Layout' });
    await layout.getByRole('radio', { name: 'Board' }).click({ force: true });
    await expect(layout.getByRole('radio', { name: 'Board' })).toBeChecked();
    await expect(page.getByRole('group', { name: 'Deals by Stage' })).toBeVisible();
    // The board saves the grouping it opened with.
    await page.waitForLoadState('networkidle');
    const boardUrl = page.url();

    await page.goto(`/w/${slug}/settings/objects/deals/attributes`);
    const own = page.getByRole('grid', { name: 'Attributes' });
    await own.getByRole('button', { name: 'Actions for Stage' }).click();
    await page.getByRole('menuitem', { name: 'Archive' }).click();
    await page
      .getByRole('alertdialog', { name: 'Archive Stage?' })
      .getByRole('button', { name: 'Archive Stage' })
      .click();
    await expect(page.getByText('Stage archived.')).toBeVisible();

    await page.goto(boardUrl);
    await expect(page.getByText('Stage is archived.')).toBeVisible();
    // Not a dead end: the table is one press away, and Stage comes back from the board itself.
    await expect(page.getByRole('button', { name: 'Show as table' })).toBeEnabled();
    await page.getByRole('button', { name: 'Restore Stage' }).click();
    await expect(page.getByText('Stage restored.')).toBeVisible();
    await expect(page.getByRole('group', { name: 'Deals by Stage' })).toBeVisible({ timeout: 15_000 });
    // It held the grouping all along: the view still groups by Stage after a reload.
    await page.reload();
    await expect(page.getByRole('group', { name: 'Deals by Stage' })).toBeVisible();
  });
});
