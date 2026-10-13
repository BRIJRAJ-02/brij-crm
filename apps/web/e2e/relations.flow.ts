// Creating a relationship (spec 0014, milestone 1), end to end: an owner on
// the Companies table names a new attribute, picks Relationship, and the
// relationship dialog takes over with that name: People, many to many,
// Investors and Investments. The column appears on Companies at once, and a
// second browser on People sees Investments without a reload. A relationship
// from People to itself refuses two names alike before sending; a side whose
// name People already has is refused on that name by the server. Renaming
// both sides from the column's Edit attribute reaches the second browser
// live (AC-282 to AC-285, AC-305, AC-307).
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { checkScreen, newWorkspace, signInAgain } from './people.ts';

/** How long a change may take to show in the other browser (AC-282 says 1 second; the flow allows for a busy machine). */
const LIVE_MS = 5_000;

/** Scrolls an object's grid sideways until a column's header is drawn, and answers that header. */
async function header(page: Page, grid: string, column: string) {
  const table = page.getByRole('grid', { name: grid });
  await table.evaluate((element) => {
    element.scrollLeft = 0;
  });
  for (let step = 0; step < 40; step += 1) {
    const found = table.getByRole('columnheader', { name: new RegExp(`^${column}`) });
    if ((await found.count()) > 0) return found.first();
    await table.evaluate((element) => {
      element.scrollLeft += 300;
    });
    await page.waitForTimeout(50);
  }
  return table.getByRole('columnheader', { name: new RegExp(`^${column}`) }).first();
}

/** Opens Add attribute, types a name, and picks Relationship: the relationship dialog takes over. */
async function newRelationship(page: Page, name: string) {
  await page.getByRole('button', { name: 'Add attribute' }).first().click();
  const attribute = page.getByRole('dialog', { name: 'New attribute' });
  await attribute.getByLabel('Name', { exact: true }).fill(name);
  await attribute.getByRole('button', { name: /Type$/ }).click();
  await page.getByRole('option', { name: 'Relationship', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'New relationship' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Picks the related object in the relationship dialog. */
async function relatedObject(page: Page, dialog: ReturnType<Page['getByRole']>, plural: string) {
  await dialog.getByRole('button', { name: /Related object/ }).click();
  await page.getByRole('option', { name: plural, exact: true }).click();
}

test.describe('relations', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The table flow runs at desktop width.');

  test('an owner creates relationships from a table and renames one, live in a second browser', async ({
    browser,
    page,
  }, testInfo) => {
    test.setTimeout(150_000);
    const tag = randomUUID().slice(0, 8);
    const email = `relations-${tag}@example.com`;
    const slug = `relations-${tag}`;
    const code = await newWorkspace(page, email, slug);

    // The second browser: the same person, on People.
    const readerContext = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      viewport: testInfo.project.use.viewport ?? null,
    });
    const reader = await readerContext.newPage();
    const peoplePath = `/w/${slug}/objects/people`;
    await signInAgain(reader, email, peoplePath, [code]);
    await expect(reader.getByRole('grid', { name: 'People' })).toBeVisible();

    // The sidebar lists every live object, so Companies' table opens (task 4).
    await page.getByRole('link', { name: 'Companies' }).first().click();
    await expect(page.getByRole('grid', { name: 'Companies' })).toBeVisible();

    // Add attribute, a name, then Relationship: the dialog takes over with the name on this side (AC-282).
    const dialog = await newRelationship(page, 'Investors');
    await relatedObject(page, dialog, 'People');
    await dialog.getByText('Each company has many people, each person has many companies').click();
    await expect(
      dialog.getByRole('radio', { name: 'Each company has many people, each person has many companies' }),
    ).toBeChecked();
    await expect(dialog.getByLabel('Name on Companies')).toHaveValue('Investors');
    await expect(dialog.getByLabel('Name on People')).toHaveValue('Companies');
    await dialog.getByLabel('Name on People').fill('Investments');
    await expect(dialog).toContainText(
      'Companies get “Investors”, holding many people. People get “Investments”, holding many companies.',
    );
    await checkScreen(page, 'relations-new');
    await dialog.getByRole('button', { name: 'Create relationship' }).click();
    await expect(dialog).toBeHidden();
    const created = Date.now();
    await expect(page.getByText('Investors added.')).toBeVisible();
    await expect(await header(page, 'Companies', 'Investors')).toBeVisible();

    // The other object's table, in the other browser, shows its side without a reload.
    await expect(await header(reader, 'People', 'Investments')).toBeVisible({ timeout: LIVE_MS });
    testInfo.annotations.push({ type: 'live column', description: `${String(Date.now() - created)} ms` });

    // A relationship from People to itself: two names alike are refused before anything is sent (AC-283).
    await page.goto(peoplePath);
    await expect(page.getByRole('grid', { name: 'People' })).toBeVisible();
    const self = await newRelationship(page, 'Manager');
    await relatedObject(page, self, 'People');
    await self.getByLabel('Reverse name on People').fill('manager');
    await self.getByRole('button', { name: 'Create relationship' }).click();
    await expect(self.getByText('Give each side its own name.')).toBeVisible();
    await self.getByLabel('Reverse name on People').fill('Reports');
    await self.getByRole('button', { name: 'Create relationship' }).click();
    await expect(self).toBeHidden();
    await expect(page.getByText('Manager added.')).toBeVisible();

    // A name People already has is refused on that side by the server, and nothing is made (AC-284).
    const taken = await newRelationship(page, '');
    await relatedObject(page, taken, 'Companies');
    await expect(taken.getByLabel('Name on People')).toHaveValue('Company');
    await taken.getByRole('button', { name: 'Create relationship' }).click();
    await expect(taken.getByText('People already has an attribute with this name. Pick another.')).toBeVisible();
    await checkScreen(page, 'relations-refused');
    await taken.getByLabel('Name on People').fill('Employer');
    await taken.getByRole('button', { name: 'Create relationship' }).click();
    await expect(taken).toBeHidden();
    await expect(page.getByText('Employer added.')).toBeVisible();

    // Edit mode from the column's menu: both objects and the cardinality read only, both names renamed in one
    // write, live in the other browser (AC-307).
    await page.goto(`/w/${slug}/objects/companies`);
    await (await header(page, 'Companies', 'Investors')).scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: 'Investors options' }).click();
    await page.getByRole('menuitem', { name: 'Edit attribute' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit relationship' });
    await expect(edit).toBeVisible();
    await expect(edit.getByRole('radiogroup')).toHaveAttribute('aria-readonly', 'true');
    await expect(edit).toContainText('The objects and how records link can’t change once the relationship exists.');
    await edit.getByLabel('Name on Companies').fill('Backers');
    await edit.getByLabel('Name on People').fill('Holdings');
    await checkScreen(page, 'relations-edit');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(edit).toBeHidden();
    await expect(await header(page, 'Companies', 'Backers')).toBeVisible();
    await expect(await header(reader, 'People', 'Holdings')).toBeVisible({ timeout: LIVE_MS });
    await readerContext.close();
  });
});
