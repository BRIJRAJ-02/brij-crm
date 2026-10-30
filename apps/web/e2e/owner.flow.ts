// Setting Owner (QA N1): a member attribute edits through the member picker,
// the workspace's members searched by name or email with "Me" first, in the
// table's cell, in the bulk Edit dialog, on the record page's Details, and in New deal, where a deal's
// Owner (required) starts as Me. Each pick is saved (a reload keeps it) and the
// record's timeline names the change. axe in light and dark with the picker
// open and on the dialog.
import { expect, test, type Page } from '@playwright/test';
import { addPerson, cellAt, checkScreen, newWorkspace, objectUrl } from './people.ts';

const RECORD_URL = /\/w\/[^/]+\/objects\/people\/([0-9a-f-]{36})\/overview$/;

/** One of the member picker's items, inline in a cell's popover or under a field's box. */
const memberItem = (page: Page, name: string) => page.getByRole('menuitem', { name });

// The table flows run at desktop width, as people.flow.ts does: at a phone's the pinned name covers the cells.
test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The table flow runs at desktop width.');

test('Owner is set from a cell, the record page, bulk Edit and New deal', async ({ page }, info) => {
  const tag = `${String(Date.now())}-${info.project.name}`;
  const slug = `owner-${tag}`;
  await newWorkspace(page, `owner-${tag}@example.com`, slug);
  await addPerson(page, 'Grace', 'Hopper', `grace-${tag}@example.com`);

  // The Owner cell has no lock any more: Enter opens the member picker in the cell, Me first.
  const owner = await cellAt(page, 0, 'Owner');
  await owner.click();
  await page.keyboard.press('Enter');
  const picker = page.getByRole('dialog', { name: 'Owner' });
  await expect(picker.getByRole('searchbox', { name: 'Search Owner' })).toBeFocused();
  // The signed in member comes first, marked Me, with their email to tell two of one name apart.
  await expect(memberItem(page, 'Ada Lovelace')).toContainText('Me');
  await expect(memberItem(page, 'Ada Lovelace')).toContainText(`owner-${tag}@example.com`);
  await checkScreen(page, 'owner-cell-picker');
  // A search drops the pinned Me: one that matches nobody lists nobody, so Enter can't pick Me by accident.
  await page.keyboard.type('zzz');
  await expect(memberItem(page, 'Ada Lovelace')).toHaveCount(0);
  // Searching by email finds the member (still marked Me); Enter picks the first match, saves and closes.
  await picker.getByRole('searchbox', { name: 'Search Owner' }).fill('owner-');
  await expect(memberItem(page, 'Ada Lovelace')).toContainText('Me');
  await page.keyboard.press('Enter');
  await expect(picker).toBeHidden();
  await expect(owner).toContainText('Ada Lovelace');

  // Saved: a reload reads it back from the server.
  await page.reload();
  await expect(page).toHaveURL(objectUrl(slug, 'people'));
  await expect(await cellAt(page, 0, 'Owner')).toContainText('Ada Lovelace');

  // The record page: Details shows the owner and edits it in place. Remove clears it; Me sets it again.
  await page
    .getByRole('rowheader', { name: /Grace Hopper/ })
    .getByText('Grace Hopper')
    .click();
  await expect(page).toHaveURL(RECORD_URL);
  const details = page.getByRole('region', { name: 'Details' });
  await expect(details).toContainText('Ada Lovelace');
  await details.getByRole('button', { name: 'Edit Owner' }).click();
  // The menu opens with the editor; Esc closes the menu and leaves the chip's Remove.
  await expect(memberItem(page, 'Ada Lovelace')).toBeVisible();
  await page.keyboard.press('Escape');
  await details.getByRole('button', { name: 'Remove Ada Lovelace' }).click();
  await expect(details).not.toContainText('Ada Lovelace');
  // The timeline's newest entry names each change.
  const newest = page.getByRole('feed', { name: 'Recent activity' }).getByRole('article').first();
  await expect(newest).toHaveAccessibleName(/cleared Owner/);
  // One person's changes in the same second read as one entry ("changed 2 attributes"): the next waits a second.
  await page.waitForTimeout(1_100);
  await details.getByRole('button', { name: 'Edit Owner' }).click();
  await memberItem(page, 'Ada Lovelace').click();
  await expect(details).toContainText('Ada Lovelace');
  await expect(newest).toHaveAccessibleName(/set Owner/);

  // Back on People for the bulk Edit.
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'People', exact: true })
    .click();
  await expect(page).toHaveURL(objectUrl(slug, 'people'));
  await expect(page.getByRole('heading', { level: 1, name: 'People' })).toBeFocused();
  // Bulk Edit (spec 0022, AC-529): Owner is offered, its value chosen through the same picker.
  await addPerson(page, 'Alan', 'Turing', `alan-${tag}@example.com`);
  await addPerson(page, 'Katherine', 'Johnson', `katherine-${tag}@example.com`);
  const grid = page.getByRole('grid', { name: 'People' });
  for (const name of ['Alan Turing', 'Katherine Johnson']) {
    await grid.getByRole('gridcell', { name: new RegExp(`^Select ${name}`) }).click();
  }
  await page.getByRole('toolbar', { name: 'Selected records' }).getByRole('button', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit 2 people' });
  await edit.getByRole('button', { name: /Field/ }).click();
  await page.getByRole('option', { name: 'Owner' }).click();
  await edit.getByRole('button', { name: 'Choose Value…' }).click();
  await memberItem(page, 'Ada Lovelace').click();
  await expect(edit.getByRole('group', { name: 'Value' })).toContainText('Ada Lovelace');
  await edit.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Updated 2 people.')).toBeVisible();
  for (const row of [0, 1]) await expect(await cellAt(page, row, 'Owner')).toContainText('Ada Lovelace');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('toolbar', { name: 'Selected records' })).toBeHidden();

  // New deal: Owner is required on a deal and starts as Me (its default is the current user). Emptied, Create
  // refuses it on the field; chosen again, the deal is made with its owner.
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Deals', exact: true })
    .click();
  await expect(page).toHaveURL(objectUrl(slug, 'deals'));
  await page.getByRole('button', { name: 'New deal' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New deal' });
  await dialog.getByLabel('Name', { exact: true }).fill('Big renewal');
  const ownerField = dialog.getByRole('group', { name: 'Owner' });
  await expect(ownerField).toContainText('Ada Lovelace');
  await checkScreen(page, 'owner-new-deal');
  await ownerField.getByRole('button', { name: 'Remove Ada Lovelace' }).click();
  await expect(ownerField).not.toContainText('Ada Lovelace');
  await dialog.getByRole('button', { name: 'Create deal' }).click();
  await expect(dialog.getByText('Owner is required.')).toBeVisible();
  await ownerField.getByRole('button', { name: 'Choose Owner…' }).click();
  await memberItem(page, 'Ada Lovelace').click();
  await expect(ownerField).toContainText('Ada Lovelace');
  await dialog.getByRole('button', { name: 'Create deal' }).click();
  await expect(dialog).toBeHidden();
  const deals = page.getByRole('grid', { name: 'Deals' });
  await expect(deals.getByRole('row', { name: /Big renewal/ })).toContainText('Ada Lovelace');
  await page.reload();
  await expect(deals.getByRole('row', { name: /Big renewal/ })).toContainText('Ada Lovelace');
});
