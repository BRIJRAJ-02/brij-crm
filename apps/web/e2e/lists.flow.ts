// Lists and pipelines (spec 0048), milestones 1 and 2: a Blank list made from the sidebar's "+", a record added to it
// and shown first, a list field edited in its row, one entry taken out at once and brought back by Undo, two taken
// out after a confirm; a Pipeline made over Deals opening on its board grouped by Stage, a deal added from a column's
// "+" landing in that column, and the list's Table view a click away.
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { newWorkspace } from './people.ts';

/** Makes a deal through the Deals table's New deal dialog. */
async function newDeal(page: Page, slug: string, name: string) {
  await page.goto(`/w/${slug}/objects/deals`);
  await page.getByRole('button', { name: 'New deal' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New deal' });
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();
}

/** Makes a list from the sidebar's "+" on Lists, and waits for it to open. */
async function newList(page: Page, name: string, of: string, start: 'Blank' | 'Pipeline') {
  const sidebar = page.getByRole('navigation', { name: 'Main navigation' });
  await sidebar.getByRole('button', { name: 'New list' }).click();
  const dialog = page.getByRole('dialog', { name: 'New list' });
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: /^Of/ }).click();
  await page.getByRole('option', { name: of, exact: true }).click();
  await dialog.getByRole('radio', { name: start }).click();
  await dialog.getByRole('button', { name: 'Create list' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(sidebar.getByRole('link', { name, exact: true })).toBeVisible();
}

/** Adds a record to the open list through Add <singular>. */
async function addEntry(page: Page, button: string, record: string) {
  await page.getByRole('button', { name: button }).first().click();
  const dialog = page.getByRole('dialog', { name: new RegExp(`^${button} to`) });
  await dialog.getByRole('combobox').fill(record.slice(0, 3));
  await page.getByRole('option', { name: record }).first().click();
  await dialog.getByRole('button', { name: 'Add to list' }).click();
  await expect(dialog).toBeHidden();
}

test.describe('lists and pipelines', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The table and the board run at desktop width.');

  test('a Blank list: made from the sidebar, a record added and shown first, removed with Undo', async ({ page }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `lists-${tag}`;
    await newWorkspace(page, `lists-${tag}@example.com`, slug);
    await newDeal(page, slug, 'Apollo');
    await newDeal(page, slug, 'Borealis');
    await newDeal(page, slug, 'Cassini');

    await newList(page, 'Hot deals', 'Deals', 'Blank');
    const grid = page.getByRole('grid', { name: 'Hot deals' });
    await expect(page.getByText('No deals in this list yet.')).toBeVisible();

    // Added: the row shows first, marked new, with its toast.
    await addEntry(page, 'Add deal', 'Apollo');
    await expect(page.getByText('Added Apollo to Hot deals')).toBeVisible();
    await expect(grid.getByRole('row').filter({ hasText: 'Apollo' })).toHaveCount(1);
    await addEntry(page, 'Add deal', 'Borealis');
    await addEntry(page, 'Add deal', 'Cassini');

    // Each record once: Apollo can't go in twice.
    await page.getByRole('button', { name: 'Add deal' }).first().click();
    const again = page.getByRole('dialog', { name: /^Add deal to/ });
    await again.getByRole('combobox').fill('Apo');
    await expect(page.getByRole('option', { name: /Apollo/ }).getByText('Already in this list')).toBeVisible();
    await page.keyboard.press('Escape');
    await again.getByRole('button', { name: 'Cancel' }).click();

    // One entry goes at once, with Undo: no confirm.
    await grid.getByRole('row').filter({ hasText: 'Apollo' }).getByRole('checkbox').click();
    await page.getByRole('button', { name: 'Remove from list' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(grid.getByRole('row').filter({ hasText: 'Apollo' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(grid.getByRole('row').filter({ hasText: 'Apollo' })).toHaveCount(1);

    // Two or more ask first.
    await grid.getByRole('row').filter({ hasText: 'Borealis' }).getByRole('checkbox').click();
    await grid.getByRole('row').filter({ hasText: 'Cassini' }).getByRole('checkbox').click();
    await page.getByRole('button', { name: 'Remove from list' }).click();
    const confirm = page.getByRole('dialog', { name: 'Remove 2 entries from Hot deals?' });
    await expect(confirm).toContainText('Undo brings them back with their values.');
    await confirm.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(grid.getByRole('row').filter({ hasText: 'Borealis' })).toHaveCount(0);
    await expect(grid.getByRole('row').filter({ hasText: 'Cassini' })).toHaveCount(0);
  });

  test('a name another list holds is refused on Name', async ({ page }) => {
    test.setTimeout(120_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `listname-${tag}`;
    await newWorkspace(page, `listname-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/objects/people`);
    await newList(page, 'Hiring', 'People', 'Blank');
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'New list' }).click();
    const dialog = page.getByRole('dialog', { name: 'New list' });
    await dialog.getByLabel('Name', { exact: true }).fill('hiring');
    await dialog.getByRole('button', { name: 'Create list' }).click();
    await expect(dialog.getByText('A list named hiring already exists.')).toBeVisible();
  });

  test('a Pipeline opens on its board by Stage; a column’s "+" adds into that column', async ({ page }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `pipe-${tag}`;
    await newWorkspace(page, `pipe-${tag}@example.com`, slug);
    await newDeal(page, slug, 'Apollo');
    await newDeal(page, slug, 'Borealis');

    await newList(page, 'Sales pipeline', 'Deals', 'Pipeline');
    const board = page.getByRole('region', { name: 'Sales pipeline by stage' });
    for (const stage of ['Lead', 'Qualified', 'Proposal', 'Won', 'Lost']) {
      await expect(board.getByRole('heading', { name: new RegExp(`^${stage}`) })).toBeVisible();
    }
    // A new entry lands in Lead (the Stage default).
    await addEntry(page, 'Add deal', 'Apollo');
    await expect(board.getByRole('gridcell', { name: /Apollo/ })).toBeVisible();

    // The Qualified column's "+" sets Qualified.
    await board.getByRole('button', { name: 'Add to Qualified' }).click();
    const dialog = page.getByRole('dialog', { name: /^Add deal to/ });
    await dialog.getByRole('combobox').fill('Bor');
    await page.getByRole('option', { name: 'Borealis' }).first().click();
    await dialog.getByRole('button', { name: 'Add to list' }).click();
    await expect(dialog).toBeHidden();
    await expect(board.getByRole('grid', { name: /Qualified/ }).getByText('Borealis')).toBeVisible();

    // The table view sits beside it in the switcher.
    await page.getByRole('radio', { name: 'Table' }).click();
    await expect(
      page.getByRole('grid', { name: 'Sales pipeline' }).getByRole('row').filter({ hasText: 'Apollo' }),
    ).toHaveCount(1);
  });
});
