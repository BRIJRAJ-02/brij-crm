// A board's columns (the CRM flow pass, 31 October 2026): "+ Add stage" at
// the board's end makes a stage from the name typed, through the path a
// Select's Create uses, and the board gains its column; a column folds into a
// strip with its name and count, and stays folded on reload in this browser.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { checkScreen, newWorkspace } from './people.ts';

test.describe('a board’s columns', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The board runs at desktop width.');

  test('Add stage makes a column from the name typed', async ({ page }) => {
    test.setTimeout(150_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `addstage-${tag}`;
    await newWorkspace(page, `addstage-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/objects/deals`);
    const layout = page.getByRole('radiogroup', { name: 'Layout' });
    await layout.getByRole('radio', { name: 'Board' }).click({ force: true });
    const board = page.getByRole('group', { name: 'Deals by Stage' });
    await expect(board).toBeVisible();
    // Empty columns hide at first: bring them back, so the new one shows while it has no card.
    const hidden = page.getByRole('button', { name: /hidden column/u });
    if (await hidden.isVisible()) await hidden.click();

    await board.getByRole('button', { name: 'Add stage' }).click();
    const name = board.getByRole('textbox', { name: 'Add stage: name' });
    await expect(name).toBeFocused();
    await name.fill('Negotiation');
    await name.press('Enter');
    await expect(board.getByRole('region', { name: /Negotiation/ })).toBeVisible({ timeout: 15_000 });
    // The field clears for the next one; Esc puts the button back.
    await expect(board.getByRole('textbox', { name: 'Add stage: name' })).toHaveValue('');
    await page.keyboard.press('Escape');
    await expect(board.getByRole('button', { name: 'Add stage' })).toBeVisible();
    await checkScreen(page, 'board-add-stage');

    // A name a stage already holds is refused, and stays in the field.
    await board.getByRole('button', { name: 'Add stage' }).click();
    await board.getByRole('textbox', { name: 'Add stage: name' }).fill('Negotiation');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('alert').or(page.getByRole('status')).filter({ hasText: /./u }).first()).toBeVisible();
    await expect(board.getByRole('textbox', { name: 'Add stage: name' })).toHaveValue('Negotiation');
  });

  test('a column folds into a strip and stays folded on reload', async ({ page }) => {
    test.setTimeout(150_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `foldcol-${tag}`;
    await newWorkspace(page, `foldcol-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/objects/deals`);
    const layout = page.getByRole('radiogroup', { name: 'Layout' });
    await layout.getByRole('radio', { name: 'Board' }).click({ force: true });
    const board = page.getByRole('group', { name: 'Deals by Stage' });
    await expect(board).toBeVisible();
    const hidden = page.getByRole('button', { name: /hidden column/u });
    if (await hidden.isVisible()) await hidden.click();

    const first = board.getByRole('region').nth(1);
    const title = ((await first.getByRole('heading').textContent()) ?? '').replace(/\d+$/u, '').trim();
    await first.getByRole('button', { name: `Collapse ${title}` }).click();
    await expect(board.getByRole('button', { name: `Expand ${title}` })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: `Expand ${title}` })).toBeVisible();
    await page.getByRole('button', { name: `Expand ${title}` }).click();
    await expect(page.getByRole('button', { name: `Collapse ${title}` })).toBeAttached();
  });
});
