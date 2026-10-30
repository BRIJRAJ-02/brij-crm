// A saved view filtered on a field that is then archived (spec 0020, AC-480's own verify step): the view says so
// in a banner under the toolbar and its rows widen; a save that changes only the sort keeps the archived
// condition; and restoring the field brings the filter back, the banner gone. Before, there was no banner and a
// sort save deleted the condition for good (late trap #1 and #26).
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { addPerson, newWorkspace, objectUrl } from './people.ts';

/** The People grid. */
const grid = (page: Page) => page.getByRole('grid', { name: 'People' });

/** The view's toolbar. */
const toolbar = (page: Page) => page.getByRole('toolbar', { name: 'View options' });

const BANNER = /This view uses Job title, which is archived/;

test.describe('a view filtered on an archived field', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The table flow runs at desktop width.');

  test('says so, widens, keeps the condition through a sort save, and filters again once restored', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `viewarch-${tag}`;
    await newWorkspace(page, `viewarch-${tag}@example.com`, slug);
    await expect(page).toHaveURL(objectUrl(slug, 'people'));
    const viewUrl = page.url();
    await addPerson(page, 'Grace', 'Hopper', `grace-${tag}@example.com`);
    await addPerson(page, 'Alan', 'Turing', `alan-${tag}@example.com`);
    await expect(grid(page).getByText('Alan Turing', { exact: true })).toBeVisible();

    // Saved: Job title is not empty, which nobody here has, so the view shows no one.
    await toolbar(page).getByRole('button', { name: 'Filter', exact: true }).click();
    const builder = page.getByRole('dialog', { name: 'Filters' });
    await builder.getByRole('button', { name: 'Add filter', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Job title' }).click();
    await builder.getByRole('button', { name: 'is', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'is not empty', exact: true }).click();
    // The operator menu has closed (its exit takes a moment). With no value box left to hold it, focus went back to
    // the page; Esc closes the builder from inside it.
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(builder.getByText('is not empty')).toBeVisible();
    await builder.getByRole('button', { name: 'Add filter', exact: true }).focus();
    await page.keyboard.press('Escape');
    await expect(builder).toBeHidden();
    await expect(page).toHaveURL(/\?draft=/);
    await toolbar(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page).not.toHaveURL(/draft=/);
    await expect(grid(page).getByText('Grace Hopper', { exact: true })).toBeHidden();

    // Job title archived in settings.
    await page.goto(`/w/${slug}/settings/objects/people/attributes`);
    const own = page.getByRole('grid', { name: 'Attributes' });
    await own.getByRole('button', { name: 'Actions for Job title' }).click();
    await page.getByRole('menuitem', { name: 'Archive' }).click();
    await page
      .getByRole('alertdialog', { name: 'Archive Job title?' })
      .getByRole('button', { name: 'Archive Job title' })
      .click();
    await expect(page.getByText('Job title archived.')).toBeVisible();

    // The view: a banner says what was left out, and the rows widen.
    await page.goto(viewUrl);
    await expect(page.getByText(BANNER)).toBeVisible();
    await expect(grid(page).getByText('Grace Hopper', { exact: true })).toBeVisible();
    await expect(grid(page).getByText('Alan Turing', { exact: true })).toBeVisible();

    // Only the sort changes, and is saved.
    await toolbar(page).getByRole('button', { name: 'Sorted by Created at' }).click();
    const sorts = page.getByRole('dialog', { name: 'Sorts' });
    await sorts.getByRole('button', { name: 'Add sort' }).click();
    await page.getByRole('menuitem', { name: 'Created at' }).click();
    await expect(page.getByRole('menu')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(sorts).toBeHidden();
    await toolbar(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page).not.toHaveURL(/draft=/);

    // Job title restored: the original filter is back, so the view shows no one again, and the banner has gone.
    await page.goto(`/w/${slug}/settings/objects/people/attributes`);
    await page.getByRole('button', { name: /Archived/ }).click();
    await page.getByRole('button', { name: 'Restore' }).first().click();
    await expect(page.getByText(/restored\./)).toBeVisible();
    await page.goto(viewUrl);
    await expect(grid(page)).toBeVisible();
    await expect(page.getByText(BANNER)).toBeHidden();
    await expect(grid(page).getByText('Grace Hopper', { exact: true })).toBeHidden();
    await expect(grid(page).getByText('Alan Turing', { exact: true })).toBeHidden();
  });
});
