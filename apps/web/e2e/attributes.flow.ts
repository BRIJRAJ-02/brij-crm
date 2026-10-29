// Attributes without setup (spec 0012, milestone 2), end to end: an owner
// adds one attribute of each of the ten types without setup from settings, with a
// description, Unique, Allow multiple and defaults, and is refused Required while the first run's live Intro call
// books guests into People with nothing for it (late trap #11); edits one through
// `?attribute=<id>`; moves, archives and restores one; and the table shows the
// new columns, the "+" header and the column menu's schema items.
import { expect, test, type Page } from '@playwright/test';
import { checkScreen, newWorkspace } from './people.ts';

/** The ten types without setup, as the picker names them, with what each sets beyond its name. */
const TYPES = [
  { type: 'Text', name: 'Code', unique: true, description: 'The customer code from billing.' },
  { type: 'Long text', name: 'Background' },
  { type: 'Date', name: 'Follow up', days: '7' },
  { type: 'Checkbox', name: 'Is partner' },
  { type: 'Rating', name: 'Warmth' },
  { type: 'Email', name: 'Billing email', multiple: true },
  { type: 'Phone', name: 'Office phone' },
  { type: 'Link', name: 'Portfolio' },
  { type: 'Location', name: 'Office' },
  { type: 'Member', name: 'Account manager', currentUser: true },
] as const;

type TypeCase = (typeof TYPES)[number];

/** Dismisses every toast on screen, newest first. */
async function dismissToasts(page: Page): Promise<void> {
  const dismiss = page.getByRole('region', { name: 'Notifications' }).getByRole('button', { name: 'Dismiss' });
  // By key: a toast slides while the one above it leaves, so a click would wait for it to stand still.
  for (let left = await dismiss.count(); left > 0; left -= 1) {
    await dismiss.first().press('Enter');
    await expect(dismiss).toHaveCount(left - 1);
  }
}

/** Opens New attribute, fills it in for one case, creates it and waits for the toast. */
async function createAttribute(page: Page, each: TypeCase): Promise<void> {
  await page.getByRole('button', { name: 'New attribute' }).click();
  const dialog = page.getByRole('dialog', { name: 'New attribute' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Name', { exact: true })).toBeFocused();
  await dialog.getByLabel('Name', { exact: true }).fill(each.name);
  await dialog.getByRole('button', { name: /Type$/ }).click();
  await page.getByRole('option', { name: each.type, exact: true }).click();
  // The list of fifteen reaches over the settings below it: gone before the next click lands there.
  await expect(page.getByRole('listbox')).toBeHidden();
  if ('description' in each) await dialog.getByLabel('Description').fill(each.description);
  if ('unique' in each) await dialog.getByText('Unique', { exact: true }).click();
  if ('required' in each) await dialog.getByText('Required', { exact: true }).click();
  if ('multiple' in each) await dialog.getByText('Allow multiple', { exact: true }).click();
  if ('days' in each) {
    await dialog.getByRole('radio', { name: 'Today plus days' }).click({ force: true });
    await dialog.getByLabel('Days from today').fill(each.days);
  }
  if ('currentUser' in each) await dialog.getByRole('radio', { name: 'Current user' }).click({ force: true });
  if (each.type === 'Date') await checkScreen(page, 'attribute-date-default');
  await dialog.getByRole('button', { name: 'Create attribute' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(`${each.name} added.`)).toBeVisible();
}

test('an owner adds, edits, moves, archives and restores attributes without setup', async ({ page }) => {
  // Ten attributes made one by one, then the table: past the default minute at 375 wide.
  test.slow();
  const tag = Date.now().toString(36);
  await newWorkspace(page, `attributes-${tag}@example.com`, `attributes-${tag}`);
  const slug = `attributes-${tag}`;
  await page.goto(`/w/${slug}/settings/objects/people/attributes`);
  await expect(page.getByRole('tab', { name: 'Attributes', selected: true })).toBeVisible();
  await expect(page.getByRole('meter', { name: 'Attributes' })).toBeVisible();
  await checkScreen(page, 'attributes-tab');

  // One of each of the ten types, each landing last among People's own attributes (AC-229).
  for (const each of TYPES) await createAttribute(page, each);
  const own = page.getByRole('grid', { name: 'Attributes' });
  await expect(own.getByRole('row').last()).toContainText('Account manager');
  await expect(own.getByRole('row', { name: /Code/ })).toContainText('Unique');
  await expect(own.getByRole('row', { name: /Follow up/ })).toContainText('Default');

  // A taken API name is refused on its field (AC-245).
  await page.getByRole('button', { name: 'New attribute' }).click();
  const dialog = page.getByRole('dialog', { name: 'New attribute' });
  await dialog.getByLabel('Name', { exact: true }).fill('Code');
  await dialog.getByRole('button', { name: 'Create attribute' }).click();
  await expect(dialog.getByText('An attribute here already uses this API name. Pick another.')).toBeVisible();
  await checkScreen(page, 'attribute-refused');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();

  // Required is refused while the first run's Intro call is live and books guests into People with nothing for it:
  // each guest would quietly be left out of the CRM (late trap #11). The refusal says how to get past it.
  await page.getByRole('button', { name: 'New attribute' }).click();
  await dialog.getByLabel('Name', { exact: true }).fill('Score');
  await dialog.getByRole('button', { name: /Type$/ }).click();
  await page.getByRole('option', { name: 'Rating', exact: true }).click();
  await expect(page.getByRole('listbox')).toBeHidden();
  await dialog.getByText('Required', { exact: true }).click();
  await dialog.getByRole('button', { name: 'Create attribute' }).click();
  await expect(dialog.getByText(/Intro call is live and makes records here at bookings/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();

  // A row opens the same dialog, at its own address; Save sends what changed, and closing drops the param (AC-231).
  await own.getByRole('row', { name: /Office phone/ }).click();
  const edit = page.getByRole('dialog', { name: 'Edit attribute' });
  await expect(edit).toBeVisible();
  await expect(page).toHaveURL(/\?attribute=/);
  await expect(edit.getByText('Changing the type comes later.')).toBeVisible();
  await edit.getByLabel('Name', { exact: true }).fill('Desk phone');
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(edit).toBeHidden();
  await expect(page.getByText('Desk phone saved.')).toBeVisible();
  await expect(page).not.toHaveURL(/\?attribute=/);

  // An id that names nothing here opens nothing and leaves the address.
  await page.goto(`/w/${slug}/settings/objects/people/attributes?attribute=0199a6f2-0000-7000-8000-000000000000`);
  await expect(page).not.toHaveURL(/\?attribute=/);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Move up from the row menu, said in a toast (AC-232).
  await own.getByRole('button', { name: 'Actions for Account manager' }).click();
  await page.getByRole('menuitem', { name: 'Move up' }).click();
  await expect(page.getByText(/Account manager moved to/)).toBeVisible();

  // Archive asks first; the attribute moves to Archived, and Restore brings it back (AC-233).
  await own.getByRole('button', { name: 'Actions for Background' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Archive Background?' });
  await expect(confirm).toBeVisible();
  await checkScreen(page, 'attribute-archive-confirm');
  await confirm.getByRole('button', { name: 'Archive Background' }).click();
  await expect(page.getByText('Background archived.')).toBeVisible();
  await expect(own.getByRole('row', { name: /Background/ })).toHaveCount(0);
  // At 375 the toasts span the foot of the screen, over the Archived section: dismiss them, as a person would.
  await dismissToasts(page);
  await page.getByRole('button', { name: /Archived/ }).click();
  await page.getByRole('button', { name: 'Restore' }).first().click();
  await expect(page.getByText(/restored\./)).toBeVisible();

  // The table: the new columns, the "+" header and the column menu's schema items (AC-229, AC-242).
  await page.goto(`/w/${slug}/objects/people`);
  const grid = page.getByRole('grid', { name: 'People' });
  await expect(grid).toBeVisible();
  const plus = grid.getByRole('columnheader').getByRole('button', { name: 'Add attribute' });
  await expect(plus).toHaveCount(1);
  await plus.click();
  const fromTable = page.getByRole('dialog', { name: 'New attribute' });
  await expect(fromTable).toBeVisible();
  await fromTable.getByLabel('Name', { exact: true }).fill('Nickname');
  await fromTable.getByRole('button', { name: 'Create attribute' }).click();
  await expect(fromTable).toBeHidden();
  await expect(page.getByText('Nickname added.')).toBeVisible();
  // Its header takes focus once the column is drawn.
  await expect(page.locator('[role="columnheader"]:focus')).toContainText('Nickname');
  await page.getByRole('button', { name: 'Name options', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Edit attribute' })).toBeVisible();
  // The name every record goes by never archives.
  await expect(page.getByRole('menuitem', { name: 'Archive attribute' })).toHaveCount(0);
  await checkScreen(page, 'table-column-menu');
  await page.keyboard.press('Escape');

  // Sorted by a column that is then archived from its menu: the table goes back to its opening order and stays.
  await page.getByRole('button', { name: 'Nickname options' }).click();
  await page.getByRole('menuitem', { name: 'Sort ascending' }).click();
  await expect(grid.getByRole('columnheader', { name: /Nickname/ })).toHaveAttribute('aria-sort', 'ascending');
  await page.getByRole('button', { name: 'Nickname options' }).click();
  await page.getByRole('menuitem', { name: 'Archive attribute' }).click();
  await page
    .getByRole('alertdialog', { name: 'Archive Nickname?' })
    .getByRole('button', { name: 'Archive Nickname' })
    .click();
  await expect(page.getByText('Nickname archived.')).toBeVisible();
  await expect(grid.getByRole('columnheader', { name: /Nickname/ })).toHaveCount(0);
  await expect(page.getByText('Couldn’t load these records')).toHaveCount(0);
  // The chevron that opened the confirm left with its column: focus is on the name's header.
  await expect(page.locator('[role="columnheader"]:focus')).toContainText('Name');
});
