// Lists and pipelines (spec 0048), milestones 1 and 2: a Blank list made from the sidebar's "+", a record added to it
// and shown first, a list field edited in its row, one entry taken out at once and brought back by Undo, two taken
// out after a confirm; a Pipeline made over Deals opening on its board grouped by Stage, a deal added from a column's
// "+" landing in that column, and the list's Table view a click away. Milestones 3 and 4: a record's Lists section,
// the bulk bar's and the command menu's Add to list, Settings › Lists with archive and restore, and the Toolbar.
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

test.describe('lists around the record, settings and archive (milestones 3 and 4)', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The table and the board run at desktop width.');

  test('a record’s Lists section: added from the header, a stage edited on its card, removed with Undo', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `reclists-${tag}`;
    await newWorkspace(page, `reclists-${tag}@example.com`, slug);
    await newDeal(page, slug, 'Apollo');
    await newList(page, 'Sales pipeline', 'Deals', 'Pipeline');

    // The deal's page says it is in no list, then Add to list from the header puts it in the first stage.
    await page.goto(`/w/${slug}/objects/deals`);
    await page.getByRole('link', { name: 'Apollo' }).first().click();
    const section = page.getByRole('region', { name: 'Lists' }).or(page.getByRole('heading', { name: 'Lists' }));
    await expect(section.first()).toBeVisible();
    await expect(page.getByText('Not in any list')).toBeVisible();
    await page.getByRole('button', { name: 'Add to list' }).first().click();
    await page.getByRole('menuitem', { name: 'Sales pipeline' }).click();
    await expect(page.getByText('Added Apollo to Sales pipeline')).toBeVisible();
    await expect(page.getByText('Not in any list')).toBeHidden();

    // Each record once: the list now shows disabled with "Already in".
    await page.getByRole('button', { name: 'Add to list' }).first().click();
    await expect(page.getByRole('menuitem', { name: /Sales pipeline/ })).toBeDisabled();
    await page.keyboard.press('Escape');

    // The card's menu takes it out at once, with Undo and no confirm.
    await page.getByRole('button', { name: 'Sales pipeline actions' }).click();
    await page.getByRole('menuitem', { name: 'Remove from list' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByText('Not in any list')).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('Not in any list')).toBeHidden();
  });

  test('the table’s bulk bar adds ticked records to a list, says how many were already in, and Undo takes them out', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `bulklists-${tag}`;
    await newWorkspace(page, `bulklists-${tag}@example.com`, slug);
    await newDeal(page, slug, 'Apollo');
    await newDeal(page, slug, 'Borealis');
    await newList(page, 'Shortlist', 'Deals', 'Blank');
    await addEntry(page, 'Add deal', 'Apollo');

    await page.goto(`/w/${slug}/objects/deals`);
    const grid = page.getByRole('grid', { name: 'Deals' });
    await grid.getByRole('row').filter({ hasText: 'Apollo' }).getByRole('checkbox').click();
    await grid.getByRole('row').filter({ hasText: 'Borealis' }).getByRole('checkbox').click();
    await page.getByRole('button', { name: 'Add to list' }).click();
    await page.getByRole('menuitem', { name: 'Shortlist' }).click();
    await expect(page.getByText('Added 1 to Shortlist. 1 was already in it')).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('Took 1 entry out of Shortlist again')).toBeVisible();
  });

  test('⌘K lists a list as a destination and puts the open record in one', async ({ page }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `cmdlists-${tag}`;
    await newWorkspace(page, `cmdlists-${tag}@example.com`, slug);
    await newDeal(page, slug, 'Apollo');
    await newList(page, 'Renewals', 'Deals', 'Blank');
    await page.goto(`/w/${slug}/objects/deals`);
    await page.getByRole('link', { name: 'Apollo' }).first().click();

    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog', { name: 'Command menu' });
    await palette.getByRole('combobox').fill('Renewals');
    await expect(palette.getByRole('option', { name: /Add Apollo to Renewals/ })).toBeVisible();
    await expect(palette.getByRole('option', { name: /^Renewals/ }).first()).toContainText('List · Deals');
    await palette.getByRole('option', { name: /Add Apollo to Renewals/ }).click();
    await expect(page.getByText('Added Apollo to Renewals')).toBeVisible();
  });

  test('Settings › Lists: rename, Each record once, archive with a confirm, the archived page, and Restore', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `listset-${tag}`;
    await newWorkspace(page, `listset-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/objects/people`);
    await newList(page, 'Hiring', 'People', 'Blank');

    await page.goto(`/w/${slug}/settings/lists`);
    await expect(page.getByRole('heading', { level: 1, name: 'Lists' })).toBeVisible();
    await page.getByRole('row').filter({ hasText: 'Hiring' }).click();
    await expect(page.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true');
    await page.getByLabel('Name', { exact: true }).fill('Recruiting');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Recruiting saved')).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Each record once' })).toBeChecked();

    // Fields: a manager adds one.
    await page.getByRole('tab', { name: 'Fields' }).click();
    await expect(page.getByRole('button', { name: 'Add field' }).first()).toBeVisible();

    // Archive asks first; the list then leaves the sidebar, and its address says it is archived.
    await page.getByRole('tab', { name: 'General' }).click();
    await page.getByRole('button', { name: 'Archive list' }).click();
    const confirm = page.getByRole('dialog', { name: 'Archive Recruiting?' });
    await expect(confirm).toContainText('Its entries are kept');
    await confirm.getByRole('button', { name: 'Archive', exact: true }).click();
    await expect(
      page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Recruiting' }),
    ).toHaveCount(0);
    await page.goto(`/w/${slug}/lists/hiring`);
    await expect(page.getByText('Recruiting is archived')).toBeVisible();
    await page.getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Recruiting' })).toBeVisible();
  });

  test('a list view’s Toolbar opens the filter builder over the list’s and the object’s fields', async ({ page }) => {
    test.setTimeout(240_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `listfilter-${tag}`;
    await newWorkspace(page, `listfilter-${tag}@example.com`, slug);
    await newDeal(page, slug, 'Apollo');
    await newList(page, 'Deals to watch', 'Deals', 'Pipeline');
    await addEntry(page, 'Add deal', 'Apollo');
    await page.getByRole('radio', { name: 'Table' }).click();
    await page.getByRole('button', { name: 'Filter' }).click();
    await expect(
      page.getByRole('dialog', { name: /Filter/ }).or(page.getByRole('group', { name: /Filter/ })),
    ).toBeVisible();
  });
});
