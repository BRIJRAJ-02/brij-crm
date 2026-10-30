// Delete, undo and the trash (spec 0022, milestone 1), end to end with two
// browsers: an owner ticks two people and deletes them at once (Undo, no confirm); a
// second browser, the same person on the same table, sees them leave live;
// the toast's Undo brings them back on both. One person deleted alone goes at
// once; the Trash, in Settings (A120) and at its old address with the
// object filter kept, lists them and Restore brings them back. A person whose
// email another record took meanwhile stays in the trash, the reason on its
// Name cell. ⌘Z after a create moves the record to the trash (AC-522 to
// AC-527, AC-533, AC-534, AC-541, AC-542).
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { addPerson, checkScreen, newWorkspace, openTrash, signInAgain } from './people.ts';

/** People's table. */
const table = (page: Page) => page.getByRole('grid', { name: 'People' });

/** The row checkbox of a person, by name. */
const tick = (page: Page, name: string, grid = 'People') =>
  page.getByRole('grid', { name: grid }).getByRole('gridcell', { name: new RegExp(`^Select ${name}`) });

/**
 * Whether the second browser's live checks run: Centrifugo allows only
 * localhost:5173, so a second stack on another port sets FLOW_NO_LIVE.
 */
const LIVE = process.env.FLOW_NO_LIVE === undefined;

/** The floating bar while rows are ticked. */
const bar = (page: Page) => page.getByRole('toolbar', { name: 'Selected records' });

test.describe('trash', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The table flow runs at desktop width.');

  test('deletes at once, undoes live in a second browser, and restores from the trash', async ({
    browser,
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const email = `trash-${tag}@example.com`;
    const slug = `trash-${tag}`;
    const code = await newWorkspace(page, email, slug);
    await addPerson(page, 'Ada', 'Byron', `ada-${tag}@acme.com`);
    await addPerson(page, 'Bea', 'Stone', `bea-${tag}@acme.com`);
    await addPerson(page, 'Cy', 'Lane', `cy-${tag}@acme.com`);
    await expect(table(page).getByRole('rowheader', { name: /Cy Lane/ })).toBeVisible();

    // A second browser, the same person, on the same table.
    const other = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: { width: 1280, height: 800 },
    });
    const reader = await other.newPage();
    await signInAgain(reader, email, `/w/${slug}/objects/people`, [code]);
    await expect(table(reader).getByRole('rowheader', { name: /Bea Stone/ })).toBeVisible();

    // Two ticked: the bar counts them, and Delete goes at once, Undo in its toast (30 October 2026: no confirm).
    await tick(page, 'Ada Byron').click();
    await tick(page, 'Bea Stone').click();
    // The count, of the bar's two live regions (the other says the bulk steps as they run).
    await expect(bar(page).getByRole('status').filter({ hasText: 'selected' })).toHaveText('2 selected');
    await checkScreen(page, 'trash-bar');
    await bar(page).getByRole('button', { name: 'Delete' }).click();
    // No confirm opens: the only alert dialogs are toasts (each toast is one), Deleted 2 people. with its Undo.
    await expect(page.locator('[role="alertdialog"]:not([data-toast-region] *)')).toHaveCount(0);
    await expect(page.getByText('Deleted 2 people.')).toBeVisible();
    await expect(table(page).getByRole('rowheader', { name: /Ada Byron/ })).toHaveCount(0);
    await expect(bar(page)).toHaveCount(0);
    // The table takes focus back where the deleted rows were, so the keyboard carries on there.
    await expect(table(page).locator(':focus')).toHaveCount(1);
    // Live in the other browser (AC-527).
    if (LIVE) {
      await expect(table(reader).getByRole('rowheader', { name: /Ada Byron/ })).toHaveCount(0);
      await expect(table(reader).getByRole('rowheader', { name: /Bea Stone/ })).toHaveCount(0);
    }

    // The toast's Undo restores the batch, here and there (AC-526).
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText('Restored 2 people.')).toBeVisible();
    await expect(table(page).getByRole('rowheader', { name: /Ada Byron/ })).toBeVisible();
    if (LIVE) await expect(table(reader).getByRole('rowheader', { name: /Bea Stone/ })).toBeVisible();

    // Esc in the table clears the ticked rows (AC-522).
    await tick(page, 'Cy Lane').click();
    await expect(bar(page)).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(bar(page)).toHaveCount(0);
    // One ticked goes at once, no confirm (AC-524).
    await tick(page, 'Cy Lane').click();
    await bar(page).getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Deleted Cy Lane.')).toBeVisible();
    await expect(table(page).getByRole('rowheader', { name: /Cy Lane/ })).toHaveCount(0);

    // And Ada too; then someone takes her email meanwhile.
    await tick(page, 'Ada Byron').click();
    await bar(page).getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Deleted Ada Byron.')).toBeVisible();
    await addPerson(page, 'Ada', 'Again', `ada-${tag}@acme.com`);

    // The Trash lists them, newest first (AC-533), inside Settings (A120): the settings sidebar stays, Trash
    // current in it, and the bar's trail reads Settings › Workspace › Trash.
    await openTrash(page);
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/settings/trash$`));
    const settings = page.getByRole('navigation', { name: 'Settings' });
    await expect(settings.getByRole('link', { name: 'Trash', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('main').getByRole('list').first()).toHaveText(/^Settings\s*Workspace\s*Trash$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Trash' })).toBeVisible();
    const trash = page.getByRole('grid', { name: 'Trash' });
    await expect(trash.getByRole('rowheader')).toHaveText([/Ada Byron/, /Cy Lane/]);
    await checkScreen(page, 'trash-list');
    // The old address lands here too, keeping its object filter.
    await page.getByRole('button', { name: /All objects/ }).click();
    await page.getByRole('option', { name: 'People' }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/settings/trash\\?object=[0-9a-f-]{36}$`));
    const object = new URL(page.url()).searchParams.get('object') ?? '';
    await page.goto(`/w/${slug}/trash?object=${object}`);
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/settings/trash\\?object=${object}$`));
    await expect(trash.getByRole('rowheader')).toHaveText([/Ada Byron/, /Cy Lane/]);

    // Restore both: Cy comes back, Ada stays with the reason on her Name cell (AC-534).
    await tick(page, 'Ada Byron', 'Trash').click();
    await tick(page, 'Cy Lane', 'Trash').click();
    await bar(page).getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByText('Restored 1 record. 1 couldn’t be restored; its row says why.')).toBeVisible();
    await expect(trash.getByRole('rowheader')).toHaveText([/Ada Byron/]);
    await expect(trash.getByRole('rowheader', { name: /Ada Byron/ })).toHaveAttribute('aria-invalid', 'true');
    await checkScreen(page, 'trash-refused');

    // Back on People (Settings' way back returns to where it was opened from), Cy is there; the other browser saw
    // it too.
    if (LIVE) await expect(table(reader).getByRole('rowheader', { name: /Cy Lane/ })).toBeVisible();
    await settings.getByRole('link', { name: 'Leave settings' }).click();
    await expect(table(page).getByRole('rowheader', { name: /Cy Lane/ })).toBeVisible();

    // ⌘Z after a create moves it to the trash (AC-541).
    await addPerson(page, 'Dee', 'Fresh', `dee-${tag}@acme.com`);
    await table(page)
      .getByRole('rowheader', { name: /Dee Fresh/ })
      .click({ position: { x: 4, y: 4 } });
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.getByText('Undid the create of Dee Fresh.')).toBeVisible();
    await expect(table(page).getByRole('rowheader', { name: /Dee Fresh/ })).toHaveCount(0);
    await other.close();
  });
});
