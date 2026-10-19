// Linking from the table (spec 0014, milestone 2), end to end: on the
// Companies table a person is linked to Acme from its Team cell (the picker
// searches by name), and the person's Company reads Acme in a second browser.
// Picking the same person for Globex says "At Acme" beside them, and the pick
// moves them in one save: Acme loses them, Globex gains them. Removing the
// chip unlinks them. Each step shows at once in the writer's cell (AC-288 to
// AC-292, AC-305).
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { addPerson, checkScreen, newWorkspace, signInAgain } from './people.ts';

/** How long a change may take to show in the other browser (AC-290 says 1 second; the flow allows for a busy machine). */
const LIVE_MS = 5_000;

/**
 * Whether live updates reach the browsers: Centrifugo admits only the app on :5173, so a run on another port
 * (`FLOW_LIVE=off`) reloads the second browser where it would otherwise watch the change arrive.
 */
const LIVE = process.env.FLOW_LIVE !== 'off';

/** Scrolls a grid sideways until a column's header is drawn, and answers its place in the row. */
async function columnOf(page: Page, grid: string, column: string): Promise<number> {
  const table = page.getByRole('grid', { name: grid });
  await table.evaluate((element) => {
    element.scrollLeft = 0;
  });
  for (let step = 0; step < 40; step += 1) {
    const header = table.getByRole('columnheader', { name: new RegExp(`^${column}`) });
    if ((await header.count()) > 0) {
      // The header may draw again under the call (the grid re-renders as rows land): read its place again then.
      const index = await header
        .first()
        .getAttribute('aria-colindex', { timeout: 2_000 })
        .catch(() => null);
      const shown = await header
        .first()
        .scrollIntoViewIfNeeded({ timeout: 2_000 })
        .then(() => true)
        .catch(() => false);
      if (index !== null && shown) return Number(index) - 1;
      continue;
    }
    await table.evaluate((element) => {
      element.scrollLeft += 300;
    });
    await page.waitForTimeout(50);
  }
  throw new Error(`No "${column}" column in ${grid}.`);
}

/** The cell of the row named `name` in a column. */
async function cellOf(page: Page, grid: string, name: string, column: string) {
  const col = await columnOf(page, grid, column);
  const row = page.getByRole('grid', { name: grid }).getByRole('row').filter({ hasText: name });
  return row.locator(`[data-cell$=":${String(col)}"]`);
}

/** Adds a company through "New company". */
async function addCompany(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'New company' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New company' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Name', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('grid', { name: 'Companies' }).getByRole('row').filter({ hasText: name })).toHaveCount(1);
}

/** Closes a relation cell's popover (Escape leaves the search first, then the popover). */
async function closeEditor(page: Page, column: string): Promise<void> {
  const popover = page.getByRole('dialog', { name: column });
  for (let step = 0; step < 3 && (await popover.count()) > 0; step += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);
  }
  await expect(popover).toHaveCount(0);
}

/** Opens a relation cell's picker and types into its search; answers the search's results. */
async function search(page: Page, grid: string, row: string, column: string, text: string) {
  const cell = await cellOf(page, grid, row, column);
  await cell.dblclick();
  const box = page.getByRole('searchbox', { name: `Search ${column}` });
  await expect(box).toBeFocused();
  await box.fill(text);
  return page.getByRole('menu', { name: column });
}

test.describe('linking from the table', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The table flow runs at desktop width.');

  test('links a person to a company from its Team cell, moves them to another, and unlinks them', async ({
    browser,
    page,
  }, testInfo) => {
    test.setTimeout(150_000);
    const tag = randomUUID().slice(0, 8);
    const email = `links-${tag}@example.com`;
    const slug = `links-${tag}`;
    const code = await newWorkspace(page, email, slug);
    await addPerson(page, 'Grace', 'Hopper', `grace-${tag}@example.com`);

    // The second browser: the same person, on People, reading Grace's Company.
    const readerContext = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: testInfo.project.use.viewport ?? null,
    });
    const reader = await readerContext.newPage();
    await signInAgain(reader, email, `/w/${slug}/objects/people`, [code]);
    await expect(reader.getByRole('grid', { name: 'People' })).toBeVisible();

    await page.getByRole('link', { name: 'Companies' }).first().click();
    await expect(page.getByRole('grid', { name: 'Companies' })).toBeVisible();
    await addCompany(page, 'Acme');
    await addCompany(page, 'Globex');

    // Acme's Team: "Gr" seeks names that start with it; the pick shows as a chip at once.
    const results = await search(page, 'Companies', 'Acme', 'Team', 'Gr');
    const grace = results.getByRole('menuitem', { name: /Grace Hopper/ });
    await expect(grace).toBeVisible();
    await grace.click();
    await closeEditor(page, 'Team');
    await expect(await cellOf(page, 'Companies', 'Acme', 'Team')).toContainText('Grace Hopper');

    // The far side, in the second browser: Grace's Company reads Acme.
    if (!LIVE) await reader.reload();
    await expect(await cellOf(reader, 'People', 'Grace Hopper', 'Company')).toContainText('Acme', { timeout: LIVE_MS });

    // Globex's Team: Grace is at Acme, said beside her name, read with it.
    const again = await search(page, 'Companies', 'Globex', 'Team', 'Gr');
    const taken = again.getByRole('menuitem', { name: /Grace Hopper/ });
    // Read with the item: its name in the cell's own search (inline), its description in a menu's.
    await expect(taken).toHaveAccessibleName(/Grace Hopper\s*At Acme/);
    await checkScreen(page, 'links-picker');
    await taken.click();
    await closeEditor(page, 'Team');
    // One save moves her: Globex gains her, Acme loses her.
    await expect(await cellOf(page, 'Companies', 'Globex', 'Team')).toContainText('Grace Hopper');
    await expect(await cellOf(page, 'Companies', 'Acme', 'Team')).not.toContainText('Grace Hopper');
    if (!LIVE) await reader.reload();
    await expect(await cellOf(reader, 'People', 'Grace Hopper', 'Company')).toContainText('Globex', {
      timeout: LIVE_MS,
    });

    // Removing the chip unlinks her.
    const cell = await cellOf(page, 'Companies', 'Globex', 'Team');
    await cell.dblclick();
    await page.getByRole('button', { name: 'Remove Grace Hopper' }).click();
    await closeEditor(page, 'Team');
    await expect(await cellOf(page, 'Companies', 'Globex', 'Team')).not.toContainText('Grace Hopper');
    if (!LIVE) await reader.reload();
    await expect(await cellOf(reader, 'People', 'Grace Hopper', 'Company')).not.toContainText('Globex', {
      timeout: LIVE_MS,
    });
    await readerContext.close();
  });
});
