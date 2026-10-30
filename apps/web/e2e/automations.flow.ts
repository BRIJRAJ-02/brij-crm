// Automations (parity #53): a first automation from a starter chip in two clicks, its run making a task for a new deal
// (the worker runs the task, so the flow waits for the log), the switch, the delete with its Undo, the Runs tab, and a
// second browser following the switch live. The dialog reads as a sentence with inline pickers.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { newWorkspace } from './people.ts';

test.describe('automations', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The settings and the builder run at desktop width.');

  test('a starter chip makes the first automation in two clicks, and a new deal gets its task', async ({ page }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `auto-${tag}`;
    await newWorkspace(page, `auto-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/settings/automations`);
    await expect(page.getByText('Nothing automated yet')).toBeVisible();

    // Click one: the chip. Click two: Turn on.
    await page.getByRole('button', { name: 'New deal → task' }).click();
    const dialog = page.getByRole('dialog', { name: 'New automation' });
    await expect(dialog.getByRole('group').first()).toContainText('When');
    await expect(dialog.getByLabel('Task title')).toHaveValue('Follow up');
    await dialog.getByRole('button', { name: 'Turn on' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('row').filter({ hasText: 'When a Deal is created' })).toBeVisible();
    await expect(page.getByRole('switch').first()).toBeChecked();

    // A deal made now gets its task and a line in the Runs tab.
    await page.goto(`/w/${slug}/objects/deals`);
    await page.getByRole('button', { name: 'New deal' }).first().click();
    const record = page.getByRole('dialog', { name: 'New deal' });
    await record.getByLabel('Name', { exact: true }).fill('Apollo');
    await record.getByRole('button', { name: 'Create' }).click();
    await expect(record).toBeHidden();
    await page.goto(`/w/${slug}/settings/automations`);
    await page.getByRole('tab', { name: 'Runs' }).click();
    await expect(page.getByRole('row').filter({ hasText: 'Done' })).toBeVisible({ timeout: 60_000 });
    await page.goto(`/w/${slug}/tasks`);
    await expect(page.getByText('Follow up')).toBeVisible();
  });

  test('a switch is followed live in a second browser, and a delete says Undo', async ({ page, browser }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `autolive-${tag}`;
    const email = `autolive-${tag}@example.com`;
    await newWorkspace(page, email, slug);
    await page.goto(`/w/${slug}/settings/automations`);
    await page.getByRole('button', { name: 'Task due → notify' }).click();
    await page.getByRole('dialog', { name: 'New automation' }).getByRole('button', { name: 'Turn on' }).click();
    const row = page.getByRole('row').filter({ hasText: 'When a task is due' });
    await expect(row).toBeVisible();

    const other = await browser.newPage();
    await page
      .context()
      .storageState()
      .then(async (state) => {
        await other.context().addCookies(state.cookies);
      });
    await other.goto(`/w/${slug}/settings/automations`);
    const there = other.getByRole('row').filter({ hasText: 'When a task is due' }).getByRole('switch');
    await expect(there).toBeChecked();
    await row.getByRole('switch').uncheck();
    await expect(there).not.toBeChecked();

    // Deleting is one click and Undo brings it back; nothing asks first.
    await row.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(row).toBeHidden();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(row).toBeVisible();
    await other.close();
  });

  test('the owner finds Automations in the settings navigation', async ({ page }) => {
    test.setTimeout(120_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `autono-${tag}`;
    await newWorkspace(page, `autono-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/settings/automations`);
    // The owner holds it; the navigation lists the page.
    await expect(page.getByRole('link', { name: 'Automations' })).toBeVisible();
  });
});
