// The task side panel and the simplify pass (B1 and B14, 2 November 2026): a task from My tasks opens beside the
// list rather than over it, with Previous and Next through the list and Mark done as its one quick action;
// Notifications now live inside Preferences; and the sidebar's section rows have no menu of their own.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { newWorkspace } from './people.ts';

test.describe('the task panel', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The panel beside a list runs at desktop width.');

  test('a task opens beside My tasks, steps through it, and is ticked off from the panel', async ({ page }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `taskpanel-${tag}`;
    await newWorkspace(page, `taskpanel-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/tasks`);

    // Two tasks, so the panel has somewhere to step.
    for (const title of ['Call Ada back', 'Send the proposal']) {
      await page.getByRole('button', { name: 'New task' }).first().click();
      const dialog = page.getByRole('dialog', { name: 'New task' });
      await dialog.getByLabel('Title', { exact: true }).fill(title);
      await dialog.getByRole('button', { name: 'Create task' }).click();
      await expect(dialog).toBeHidden();
    }
    await expect(page.getByRole('row', { name: /Call Ada back/ })).toBeVisible();

    // The row opens the panel, not a dialog over the page: the list stays readable beside it.
    await page.getByRole('row', { name: /Call Ada back/ }).click();
    const panel = page.getByRole('dialog', { name: 'Call Ada back' });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('tablist')).toHaveCount(0);
    await expect(page.getByRole('row', { name: /Send the proposal/ })).toBeVisible();

    // The header's pair steps through the list the panel was opened from.
    await panel.getByRole('button', { name: 'Next task' }).click();
    await expect(page.getByRole('dialog', { name: 'Send the proposal' })).toBeVisible();
    await page
      .getByRole('dialog', { name: 'Send the proposal' })
      .getByRole('button', { name: 'Previous task' })
      .click();
    await expect(page.getByRole('dialog', { name: 'Call Ada back' })).toBeVisible();

    // The open task's row is marked, so stepping never loses your place in the list.
    await expect(page.locator('[role="row"][data-open]')).toHaveCount(1);

    // Done is the panel's one quick action, and the list shows it at once.
    await panel.getByRole('button', { name: 'Mark done' }).click();
    await expect(panel.getByRole('button', { name: 'Reopen' })).toBeVisible();

    // Esc closes it and the address loses the task.
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });
});

test.describe('the simplify pass', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The settings sidebar runs at desktop width.');

  test('notifications live in Preferences, and the sidebar sections have no menu', async ({ page }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `simplify-${tag}`;
    await newWorkspace(page, `simplify-${tag}@example.com`, slug);

    // One link to the sign in history, where it is read; the page no longer draws the list itself.
    await page.goto(`/w/${slug}/settings/account/sign-in`);
    await expect(page.getByRole('link', { name: 'Your sign ins' })).toBeVisible();
    await expect(page.getByText('Recent activity')).toHaveCount(0);

    // One screen for everything about this person: the old Notifications address lands on it.
    await page.goto(`/w/${slug}/settings/account/notifications`);
    await expect(page.getByRole('heading', { name: 'Preferences', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Email', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Notifications' })).toHaveCount(0);

    // The sidebar's sections are reordered by their grip, so no menu repeats it.
    await page.goto(`/w/${slug}/home`);
    await expect(page.getByRole('button', { name: /^Records options$/ })).toHaveCount(0);
  });
});
