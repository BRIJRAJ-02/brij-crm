// The table view's edges (CRM flow pass, 30 October 2026): the default order says itself as a muted chip; a column
// header's sort goes first and keeps the sorts already built; ticked rows stay through a sort and go, with a word,
// when the filter changes; the view's search narrows by name, is never saved, and Esc clears it; and a ghost
// "+ New person" after the last row opens the same create dialog as New. Then the views pass: an unsaved draft
// survives leaving through the sidebar, "more than N days ago" filters by a relative date, Duplicate opens Rename
// with the name selected, Delete view is one click with Undo, and a column's footer works out a calculation.
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { addPerson, newWorkspace } from './people.ts';

const table = (page: Page) => page.getByRole('grid', { name: 'People' });
const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'View options' });

/** The row checkbox of a person, by name. */
const tick = (page: Page, name: string) => table(page).getByRole('gridcell', { name: new RegExp(`^Select ${name}`) });

/** The floating bar while rows are ticked. */
const bar = (page: Page) => page.getByRole('toolbar', { name: 'Selected records' });

/** Sorts the table by a column from its header's menu. */
async function sortBy(page: Page, column: string, direction: 'Sort ascending' | 'Sort descending'): Promise<void> {
  await table(page)
    .getByRole('columnheader', { name: new RegExp(column) })
    .click();
  await page.keyboard.press('Alt+ArrowDown');
  await page.getByRole('menuitem', { name: direction }).click();
}

/** The view switcher's menu, opened from its button (the current view's name). */
async function openSwitcher(page: Page, current: string): Promise<void> {
  await page.getByRole('button', { name: current, exact: true }).click();
  await expect(page.getByRole('menu')).toBeVisible();
}

/** Opens the Toolbar's filter builder and adds a filter on `attribute`. */
async function addFilter(page: Page, attribute: string) {
  await toolbar(page).getByRole('button', { name: 'Filter', exact: true }).click();
  const builder = page.getByRole('dialog', { name: 'Filters' });
  await builder.getByRole('button', { name: 'Add filter', exact: true }).click();
  await page.getByRole('menuitem', { name: attribute }).click();
  return builder;
}

/** A new workspace on People, holding three people. */
async function threePeople(page: Page, prefix: string): Promise<void> {
  const tag = randomUUID().slice(0, 8);
  await newWorkspace(page, `${prefix}-${tag}@example.com`, `${prefix}-${tag}`);
  await addPerson(page, 'Ada', 'Byron', `ada-${tag}@example.com`);
  await addPerson(page, 'Bea', 'Stone', `bea-${tag}@example.com`);
  await addPerson(page, 'Cy', 'Young', `cy-${tag}@example.com`);
  await expect(table(page).getByRole('rowheader', { name: /Cy Young/ })).toBeVisible();
}

test.describe('the table view’s edges', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The table runs at desktop width.');

  test('the default order shows as a muted chip, and a header sort keeps the sorts already built', async ({ page }) => {
    test.setTimeout(180_000);
    await threePeople(page, 'vsort');
    // Nobody chose an order: it still says what it is, with nothing to remove.
    const chip = toolbar(page).getByRole('group', { name: /the default order/ });
    await expect(chip).toContainText('Sorted by Created at');
    await expect(chip.getByRole('button', { name: /Remove/ })).toHaveCount(0);

    // Two header sorts: the second goes first, and the first stays behind it.
    await sortBy(page, 'Job title', 'Sort ascending');
    await expect(toolbar(page).getByRole('group', { name: 'Sort: Job title, ascending' })).toBeVisible();
    await sortBy(page, 'Name', 'Sort descending');
    await expect(toolbar(page).getByRole('group', { name: 'Sort: Name, descending, and 1 more' })).toBeVisible();
    // The same column again turns its own rule round rather than adding a second one.
    await sortBy(page, 'Name', 'Sort ascending');
    await expect(toolbar(page).getByRole('group', { name: 'Sort: Name, ascending, and 1 more' })).toBeVisible();

    // Removing the sorts goes back to the default order's chip.
    await toolbar(page).getByRole('button', { name: 'Remove sorts' }).click();
    await expect(toolbar(page).getByRole('button', { name: 'Sorted by Created at' })).toBeFocused();
  });

  test('ticked rows stay through a sort, and a filter change clears them and says so', async ({ page }) => {
    test.setTimeout(180_000);
    await threePeople(page, 'vtick');
    await tick(page, 'Ada Byron').click();
    await tick(page, 'Bea Stone').click();
    await expect(bar(page).getByRole('status').filter({ hasText: 'selected' })).toHaveText('2 selected');

    // A sort is the same rows: the two stay ticked.
    await sortBy(page, 'Name', 'Sort ascending');
    await expect(toolbar(page).getByRole('group', { name: 'Sort: Name, ascending' })).toBeVisible();
    await expect(bar(page).getByRole('status').filter({ hasText: 'selected' })).toHaveText('2 selected');

    // A search is a filter: the old rows can't be known to match it, so the ticks go, and a toast says why.
    await toolbar(page).getByRole('button', { name: 'Search people' }).click();
    await page.keyboard.type('Cy');
    await expect(page.getByText('Selection cleared: the filter changed.')).toBeVisible();
    await expect(bar(page)).toHaveCount(0);
  });

  test('search narrows the view by name, is never saved, and Esc clears it', async ({ page }) => {
    test.setTimeout(180_000);
    await threePeople(page, 'vsearch');
    await toolbar(page).getByRole('button', { name: 'Search people' }).click();
    const search = toolbar(page).getByRole('searchbox', { name: 'Search people' });
    await expect(search).toBeFocused();
    await page.keyboard.type('bea');
    await expect(table(page).getByRole('rowheader', { name: /Bea Stone/ })).toBeVisible();
    await expect(table(page).getByRole('rowheader', { name: /Ada Byron/ })).toHaveCount(0);
    // A search is no draft: nothing to save or discard, and the address carries no draft.
    await expect(toolbar(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get('draft')).toBeNull();

    // Nothing matches: the empty state says so and clears it.
    await search.fill('zzz');
    await expect(page.getByText('No people match “zzz”')).toBeVisible();
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(table(page).getByRole('rowheader', { name: /Ada Byron/ })).toBeVisible();

    // Esc clears it and folds it back to the button.
    await toolbar(page).getByRole('button', { name: 'Search people' }).click();
    await page.keyboard.type('ada');
    await expect(table(page).getByRole('rowheader', { name: /Bea Stone/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(toolbar(page).getByRole('button', { name: 'Search people' })).toBeFocused();
    await expect(table(page).getByRole('rowheader', { name: /Bea Stone/ })).toBeVisible();

    // A reload shows every row: the search was never kept.
    await page.reload();
    await expect(table(page).getByRole('rowheader', { name: /Bea Stone/ })).toBeVisible();
    await expect(toolbar(page).getByRole('searchbox')).toHaveCount(0);
  });

  test('a ghost "New person" after the last row opens the create dialog, beside the count', async ({ page }) => {
    test.setTimeout(180_000);
    await threePeople(page, 'vghost');
    const add = table(page).getByRole('gridcell', { name: /New person/ });
    await expect(add).toContainText(/\d+ records/);
    const before = Number(((await add.innerText()).match(/([\d,]+) records/)?.[1] ?? '0').replaceAll(',', ''));
    await add.click();
    const dialog = page.getByRole('dialog', { name: 'New person' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('First name').fill('Dee');
    await dialog.getByLabel('Last name').fill('Lane');
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(dialog).toBeHidden();
    await expect(table(page).getByRole('rowheader', { name: /Dee Lane/ })).toBeVisible();
    await expect(add).toContainText(`${(before + 1).toLocaleString('en')} records`);
  });

  test('an unsaved draft survives leaving through the sidebar, and comes back with Save and Discard', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await threePeople(page, 'vkeep');
    const builder = await addFilter(page, 'Email addresses');
    await builder.getByRole('button', { name: 'is', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'contains', exact: true }).click();
    await builder.getByRole('textbox').last().fill('bea-');
    await page.keyboard.press('Escape');
    await expect(table(page).getByRole('rowheader', { name: /Ada Byron/ })).toHaveCount(0);
    await expect(toolbar(page).getByRole('button', { name: 'Discard changes' })).toBeVisible();

    // Away through the sidebar and back: the draft is still there, not silently dropped.
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await nav.getByRole('link', { name: 'Companies', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Companies' })).toBeVisible();
    await nav.getByRole('link', { name: 'People', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'People' })).toBeVisible();
    await expect(toolbar(page).getByRole('button', { name: 'Discard changes' })).toBeVisible();
    await expect(table(page).getByRole('rowheader', { name: /Bea Stone/ })).toBeVisible();
    await expect(table(page).getByRole('rowheader', { name: /Ada Byron/ })).toHaveCount(0);
    await expect(page).toHaveURL(/\?draft=/);

    // Discard ends it for good: the next visit opens the saved view.
    await toolbar(page).getByRole('button', { name: 'Discard changes' }).click();
    await nav.getByRole('link', { name: 'Companies', exact: true }).click();
    await nav.getByRole('link', { name: 'People', exact: true }).click();
    await expect(table(page).getByRole('rowheader', { name: /Ada Byron/ })).toBeVisible();
    await expect(toolbar(page).getByRole('button', { name: 'Discard changes' })).toHaveCount(0);
  });

  test('a relative date filter: created more than 30 days ago matches nobody made today', async ({ page }) => {
    test.setTimeout(180_000);
    await threePeople(page, 'vrel');
    const builder = await addFilter(page, 'Created at');
    await builder.getByRole('button', { name: 'is before', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'is more than', exact: true }).click();
    // It starts at 30 days, and says "ago" after its unit.
    await expect(builder).toContainText('ago');
    await page.keyboard.press('Escape');
    await expect(toolbar(page)).toContainText('30 days ago');
    await expect(page.getByText('No people match these filters')).toBeVisible();
  });

  test('Duplicate opens Rename with the name selected, and Delete view is one click with Undo', async ({ page }) => {
    test.setTimeout(180_000);
    await threePeople(page, 'vdup');
    await openSwitcher(page, 'All People');
    await page.getByRole('menuitem', { name: 'Duplicate' }).click();
    const rename = page.getByRole('dialog', { name: 'Rename view' });
    await expect(rename).toBeVisible();
    const name = rename.getByRole('textbox', { name: 'Name' });
    await expect(name).toBeFocused();
    // The whole name is selected: typing replaces it, so no "copy" is left by accident.
    await page.keyboard.type('My people');
    await expect(name).toHaveValue('My people');
    await rename.getByRole('button', { name: 'Rename' }).click();
    await expect(rename).toBeHidden();
    await expect(page.getByRole('button', { name: 'My people', exact: true })).toBeVisible();

    // Delete acts at once, with no confirm; Undo makes the view again.
    await openSwitcher(page, 'My people');
    await page.getByRole('menuitem', { name: 'Delete view' }).click();
    await expect(page.getByText('Deleted My people.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'All People', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('button', { name: 'My people', exact: true })).toBeVisible();
    await openSwitcher(page, 'My people');
    await expect(page.getByRole('menuitemradio', { name: 'My people' })).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('a column footer counts across every matching record, and the view keeps the choice', async ({ page }) => {
    test.setTimeout(180_000);
    await threePeople(page, 'vcalc');
    const footer = table(page).getByRole('row').last();
    await footer.getByRole('button', { name: 'Calculate' }).first().click();
    await page.getByRole('menuitemradio', { name: 'Count', exact: true }).click();
    await expect(footer.getByRole('button', { name: 'Count 3' })).toBeVisible();

    // A person made here moves the count with no reload: the footer reads again once the create lands (about 1.5 s
    // after, never per keystroke), keeping "Count 3" on screen until then.
    const tag = randomUUID().slice(0, 8);
    await addPerson(page, 'Dee', 'Lane', `dee-${tag}@example.com`);
    await expect(table(page).getByRole('row').last().getByRole('button', { name: 'Count 4' })).toBeVisible({
      timeout: 15_000,
    });

    // Kept with the view: a reload shows it again, worked out afresh.
    await page.reload();
    await expect(table(page).getByRole('row').last().getByRole('button', { name: 'Count 4' })).toBeVisible();

    // None takes it away, and the quiet Calculate is back.
    await table(page).getByRole('row').last().getByRole('button', { name: 'Count 4' }).click();
    await page.getByRole('menuitemradio', { name: 'None', exact: true }).click();
    await expect(table(page).getByRole('row').last().getByRole('button', { name: 'Count 4' })).toHaveCount(0);
  });
});
