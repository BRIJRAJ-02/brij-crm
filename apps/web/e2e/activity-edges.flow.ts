// The activity journey's edges (CRM flow pass, 30 October 2026): the Notes page lists a note written on a record
// and opens it over that record; ⌘K finds notes and tasks by title, and with nothing matching offers to create a
// person with that name; the Activity tab's filter shows one kind; a task says it was created (with Open) and
// completed (with Undo), and My tasks' empty state offers New task; and a note is deleted in one click with Undo.
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { addPerson, newWorkspace } from './people.ts';

const RECORD_URL = /\/w\/[^/]+\/objects\/people\/([0-9a-f-]{36})\/overview$/;

/** Opens the command menu with `text` typed in its field. */
async function typeInMenu(page: Page, text: string) {
  await page.keyboard.press('ControlOrMeta+k');
  const menu = page.getByRole('dialog', { name: 'Command menu' });
  await expect(menu).toBeVisible();
  await menu.getByLabel('Search records, notes, tasks, pages and actions').fill(text);
  return menu;
}

/** A workspace with Grace Hopper, on her record page; answers her page's address. */
async function withGrace(page: Page, prefix: string): Promise<{ readonly slug: string; readonly recordPath: string }> {
  const tag = randomUUID().slice(0, 8);
  const slug = `${prefix}-${tag}`;
  await newWorkspace(page, `${prefix}-${tag}@example.com`, slug);
  await addPerson(page, 'Grace', 'Hopper', `grace-${tag}@example.com`);
  await page
    .getByRole('rowheader', { name: /Grace Hopper/ })
    .getByText('Grace Hopper')
    .click();
  await expect(page).toHaveURL(RECORD_URL);
  const id = RECORD_URL.exec(page.url())?.[1] ?? '';
  return { slug, recordPath: `/w/${slug}/objects/people/${id}` };
}

/** Writes a note titled `title` on the record page open now, and closes its window. */
async function writeNote(page: Page, title: string, text: string) {
  await page.getByRole('tab', { name: /Notes/ }).click();
  await page.getByRole('button', { name: 'New note' }).first().click();
  const window = page.getByRole('dialog').filter({ has: page.getByRole('textbox', { name: 'Note' }) });
  await window.getByRole('textbox', { name: 'Title' }).fill(title);
  await window.getByRole('textbox', { name: 'Note' }).click();
  await page.keyboard.type(text);
  await expect(window.getByText('Saved')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(window).toHaveCount(0);
}

test.describe('the activity journey’s edges', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The record page and the menu run at desktop width.');

  test('the Notes page lists a note with its record and opens it there; delete is one click with Undo', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const { slug, recordPath } = await withGrace(page, 'notespage');
    await writeNote(page, 'Kickoff call', 'They want 40 seats by March.');

    // The Notes page (out of the sidebar since 30 October 2026, still at its address) lists the note with Grace's chip.
    await page.goto(`/w/${slug}/notes`);
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/notes$`));
    const list = page.getByRole('grid', { name: 'Notes' });
    const row = list.getByRole('row', { name: /Kickoff call/ });
    await expect(row).toContainText('Grace Hopper');
    await row.click();
    await expect(page).toHaveURL(new RegExp(`${recordPath}/notes\\?note=[0-9a-f-]{36}$`));
    const window = page.getByRole('dialog').filter({ has: page.getByRole('textbox', { name: 'Note' }) });
    await expect(window.getByRole('textbox', { name: 'Title' })).toHaveValue('Kickoff call');

    // Delete asks nothing: the window closes, the note goes, and Undo brings it back.
    await window.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Delete note' }).click();
    await expect(page.getByRole('alertdialog', { name: /^Delete / })).toHaveCount(0);
    await expect(window).toHaveCount(0);
    const notes = page.getByRole('grid', { name: 'Notes' });
    await expect(notes.getByRole('row', { name: /Kickoff call/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(notes.getByRole('row', { name: /Kickoff call/ })).toBeVisible();
  });

  test('⌘K finds notes and tasks by title, makes a task from anywhere, and offers to create what nothing matched', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const { slug, recordPath } = await withGrace(page, 'menufind');
    await writeNote(page, 'Renewal plan', 'Pricing for the second year.');
    await page.getByRole('tab', { name: /Tasks/ }).click();
    await page.getByRole('textbox', { name: 'Add a task' }).fill('Renewal call with Grace');
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('grid', { name: 'Open tasks' }).getByRole('row', { name: /Renewal call/ }),
    ).toBeVisible();

    // From another page, both turn up under their own headings; a note opens over its record.
    await page.goto(`/w/${slug}/home`);
    let menu = await typeInMenu(page, 'renewal');
    await expect(menu.getByRole('group', { name: 'Notes' })).toContainText('Renewal plan');
    await expect(menu.getByRole('group', { name: 'Tasks' })).toContainText('Renewal call with Grace');
    await menu.getByRole('menuitem', { name: /Renewal plan/ }).click();
    await expect(page).toHaveURL(new RegExp(`${recordPath}/notes\\?note=[0-9a-f-]{36}$`));
    await page.keyboard.press('Escape');

    // A task opens its dialog.
    menu = await typeInMenu(page, 'renewal call');
    await menu.getByRole('menuitem', { name: /Renewal call with Grace/ }).click();
    await expect(page.getByRole('dialog', { name: 'Task' })).toBeVisible();
    await page.keyboard.press('Escape');

    // Create a task, from a page with no dialog of its own, opens it over Tasks; made, the toast offers Open.
    await page.goto(`/w/${slug}/home`);
    menu = await typeInMenu(page, 'create a task');
    await menu.getByRole('menuitem', { name: 'Create a task', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/tasks\\?task=new$`));
    const dialog = page.getByRole('dialog', { name: 'New task' });
    await dialog.getByRole('textbox', { name: 'Title' }).fill('Send the contract');
    await dialog.getByRole('button', { name: 'Create task' }).click();
    await expect(page.getByText('Task created')).toBeVisible();
    await page.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Task' })).toBeVisible();
    await page.keyboard.press('Escape');

    // Nothing matches: one row creates a person with that name, its dialog filled.
    await page.goto(`/w/${slug}/home`);
    menu = await typeInMenu(page, 'Ada Lovelace');
    const create = menu.getByRole('menuitem', { name: 'Create person named “Ada Lovelace”' });
    await expect(create).toBeVisible();
    await create.click();
    const newPerson = page.getByRole('dialog', { name: 'New person' });
    await expect(newPerson.getByLabel('First name')).toHaveValue('Ada');
    await expect(newPerson.getByLabel('Last name')).toHaveValue('Lovelace');
  });

  test('the Activity tab’s filter shows one kind of entry', async ({ page }) => {
    test.setTimeout(180_000);
    await withGrace(page, 'actfilter');
    await writeNote(page, 'Discovery', 'They use spreadsheets today.');
    await page.getByRole('tab', { name: /Activity/ }).click();
    const feed = page.getByRole('feed', { name: 'Activity' });
    await expect(feed).toContainText('added a note');
    await expect(feed).toContainText('created this record');
    await page.getByRole('button', { name: /Filter/ }).click();
    await page.getByRole('option', { name: 'Notes' }).click();
    await expect(feed).toContainText('added a note');
    await expect(feed.getByText('created this record')).toHaveCount(0);
    await page.getByRole('button', { name: /Filter/ }).click();
    await page.getByRole('option', { name: 'All activity' }).click();
    await expect(feed).toContainText('created this record');
  });

  test('a ticked task says so with Undo, and My tasks’ empty state offers New task', async ({ page }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `tasktoast-${tag}`;
    await newWorkspace(page, `tasktoast-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/tasks`);
    const list = page.getByRole('grid', { name: /Assigned to me/ });
    await expect(list).toBeHidden();
    await page.getByRole('main').getByRole('button', { name: 'New task' }).last().click();
    const dialog = page.getByRole('dialog', { name: 'New task' });
    await dialog.getByRole('textbox', { name: 'Title' }).fill('Book the venue');
    await dialog.getByRole('button', { name: 'Create task' }).click();
    await expect(page.getByText('Task created')).toBeVisible();
    const row = page.getByRole('row', { name: /Book the venue/ });
    await row.getByRole('checkbox').click();
    await expect(page.getByText('Task completed')).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(row.getByRole('checkbox')).not.toBeChecked();
  });
});
