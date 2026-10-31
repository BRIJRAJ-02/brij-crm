// The data journey's edges (CRM flow pass, 30 October 2026): a board column's "+" opens New deal with its stage
// set; the view bar's Import / Export menu; Match columns guarding a required field nobody matched and asking
// which way round a date column's dates are; Deleted records from the sidebar's object menu and ⌘K; and ⌘K's page actions.
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { addPerson, newWorkspace } from './people.ts';

/** Opens the command menu and runs the action named `name`. */
async function runCommand(page: Page, name: string) {
  await page.keyboard.press('ControlOrMeta+k');
  const menu = page.getByRole('dialog', { name: 'Command menu' });
  await expect(menu).toBeVisible();
  await menu.getByLabel('Search records, notes, tasks, pages and actions').fill(name);
  await menu.getByRole('menuitem', { name, exact: true }).click();
}

test.describe('the data journey’s edges', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The board and the import run at desktop width.');

  test('a board column’s + opens New deal with that stage set', async ({ page }) => {
    test.setTimeout(120_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `databoard-${tag}`;
    await newWorkspace(page, `databoard-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/objects/deals`);
    const layout = page.getByRole('radiogroup', { name: 'Layout' });
    await layout.getByRole('radio', { name: 'Board' }).click({ force: true });
    await expect(page.getByRole('group', { name: 'Deals by Stage' })).toBeVisible();
    // Empty columns are hidden at first; bring them back so In progress has its head.
    const hidden = page.getByRole('button', { name: /hidden column/u });
    if (await hidden.isVisible()) await hidden.click();
    await page.getByRole('button', { name: 'Add to In progress' }).click();
    const dialog = page.getByRole('dialog', { name: 'New deal' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('In progress')).toBeVisible();
    await dialog.getByLabel('Name', { exact: true }).fill('Hermes');
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('grid', { name: /In progress/u }).getByText('Hermes')).toBeVisible();
  });

  test('Import / Export sits in the view bar, and Export turns into Download', async ({ page }) => {
    test.setTimeout(120_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `datamenu-${tag}`;
    await newWorkspace(page, `datamenu-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/objects/people`);
    await page.getByRole('button', { name: 'Import / Export' }).click();
    await expect(page.getByRole('menuitem', { name: 'Import people' })).toBeVisible();
    await page.getByRole('menuitem', { name: /^Export view \(\d+ columns?\)/u }).click();
    // One toast: working, then the file.
    await expect(page.getByRole('button', { name: 'Download' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/^Exporting /u)).toBeHidden();

    await page.getByRole('button', { name: 'Import / Export' }).click();
    await page.getByRole('menuitem', { name: 'Import people' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Import people' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download a sample CSV' })).toBeVisible();
  });

  test('Match columns names a required field nobody matched, and asks which way round dates are', async ({ page }) => {
    test.setTimeout(120_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `datacols-${tag}`;
    await newWorkspace(page, `datacols-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/objects/deals/import`);
    const csv = 'Label,Close date\nApollo,03/04/2025\nZeus,13/04/2025\n';
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: 'deals.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });

    // Name is required and no column fills it: said here, and Continue waits.
    await expect(page.getByText('Name is required')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await page.getByRole('button', { name: /Match a column to Name/u }).click();
    await page.getByRole('option', { name: 'Label' }).click();
    await expect(page.getByText('Name is required')).toBeHidden();

    // 13/04/2025 can only be day first, so the column reads day first, and says how it reads the first value.
    await expect(page.getByText('Dates in Close date')).toBeVisible();
    await expect(page.getByRole('button', { name: /How Close date writes dates/u })).toContainText('Day first');
    await expect(page.getByText(/03\/04\/2025 → (3 April 2025|April 3, 2025)/u)).toBeVisible();
    await page.getByRole('button', { name: /How Close date writes dates/u }).click();
    await page.getByRole('option', { name: 'Month first' }).click();
    await expect(page.getByText(/03\/04\/2025 → (4 March 2025|March 4, 2025)/u)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });

  test('the trash is a step away: the object’s Deleted records in the sidebar, and ⌘K', async ({ page }) => {
    test.setTimeout(120_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `datatrash-${tag}`;
    await newWorkspace(page, `datatrash-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/objects/people`);
    // Open trash left the view's menu for the object's own (31 October 2026).
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: 'More for People' })
      .click();
    await page.getByRole('menuitem', { name: 'Deleted records' }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/settings/trash`));

    await page.goto(`/w/${slug}/objects/people`);
    await page.keyboard.press('ControlOrMeta+k');
    const menu = page.getByRole('dialog', { name: 'Command menu' });
    await menu.getByLabel('Search records, notes, tasks, pages and actions').fill('go to trash');
    await menu.getByRole('menuitem', { name: 'Open trash' }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/settings/trash`));
  });

  test('⌘K runs the page’s own actions: Import, Export this view, Create a view and Invite members', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `datacmd-${tag}`;
    await newWorkspace(page, `datacmd-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/objects/people`);
    await expect(page.getByRole('grid', { name: 'People' })).toBeVisible();

    await runCommand(page, 'Create a view');
    await expect(page.getByRole('dialog', { name: 'Create view' })).toBeVisible();
    await page.keyboard.press('Escape');

    await runCommand(page, 'Export this view');
    await expect(page.getByRole('button', { name: 'Download' })).toBeVisible({ timeout: 30_000 });

    await runCommand(page, 'Invite members');
    await expect(page.getByRole('dialog', { name: /Invite/u })).toBeVisible();
    await page.keyboard.press('Escape');

    await runCommand(page, 'Import people');
    await expect(page.getByRole('heading', { level: 1, name: 'Import people' })).toBeVisible();
  });

  test('Export names its column count and offers the hidden ones; the bulk bar exports the ticked rows', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `dataexport-${tag}`;
    await newWorkspace(page, `dataexport-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/objects/people`);
    const grid = page.getByRole('grid', { name: 'People' });
    await expect(grid).toBeVisible();
    await addPerson(page, 'Ada', 'Byron', `ada-${tag}@acme.com`);
    await addPerson(page, 'Bea', 'Stone', `bea-${tag}@acme.com`);
    await expect(grid.getByRole('rowheader', { name: /Bea Stone/u })).toBeVisible();

    // The view bar's export says how many columns it writes; People's default view hides some, offered apart.
    await page.getByRole('button', { name: 'Import / Export' }).click();
    const shown = page.getByRole('menuitem', { name: /^Export view \((\d+) columns?\)/u });
    await expect(shown).toBeVisible();
    await expect(shown).toBeEnabled();
    await expect(page.getByRole('menuitem', { name: /^Export all columns \(\d+\)/u })).toBeVisible();
    await page.keyboard.press('Escape');

    // Two ticked rows: Export 2 selected, one toast that turns into Download.
    const tick = (name: string) => grid.getByRole('gridcell', { name: new RegExp(`^Select ${name}`, 'u') });
    await tick('Ada Byron').click();
    await tick('Bea Stone').click();
    const bar = page.getByRole('toolbar', { name: 'Selected records' });
    await bar.getByRole('button', { name: 'Export 2 selected' }).click();
    await expect(page.getByText('Exporting 2 people…')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/People - Selected - /u)).toBeVisible();
  });
});
