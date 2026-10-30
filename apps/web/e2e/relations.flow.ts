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
import { checkScreen, chooseNewAttribute, newWorkspace, signInAgain } from './people.ts';

/** How long a change may take to show in the other browser (AC-282 says 1 second; the flow allows for a busy machine). */
const LIVE_MS = 5_000;

/**
 * Scrolls an object's grid sideways until a column's header is drawn, and answers that header. A column that
 * arrives late (a busy machine, a live change from the other browser) is looked for again from the left until
 * `timeout` runs out, since the grid draws only the columns in view.
 */
async function header(page: Page, grid: string, column: string, timeout = 10_000) {
  const table = page.getByRole('grid', { name: grid });
  const named = table.getByRole('columnheader', { name: new RegExp(`^${column}`) });
  const deadline = Date.now() + timeout;
  do {
    await table.evaluate((element) => {
      element.scrollLeft = 0;
    });
    for (let step = 0; step < 40; step += 1) {
      if ((await named.count()) > 0) return named.first();
      const atEnd = await table.evaluate((element) => {
        const before = element.scrollLeft;
        element.scrollLeft += 300;
        return element.scrollLeft === before;
      });
      if (atEnd) break;
      await page.waitForTimeout(50);
    }
    if ((await named.count()) > 0) return named.first();
    await page.waitForTimeout(250);
  } while (Date.now() < deadline);
  return named.first();
}

/**
 * Waits until a column's header shows in an object's grid. The table may reload more than once after a schema
 * change (its own write, then the live echo), and each reload starts scrolled to the left, so the whole find
 * (scroll, then look) is tried again until it holds.
 */
async function expectHeader(page: Page, grid: string, column: string, timeout = 10_000) {
  await expect(async () => {
    await expect(await header(page, grid, column, 1_000)).toBeVisible({ timeout: 500 });
  }).toPass({ timeout });
}

/** Opens Add attribute, types a name, and picks Relationship: the relationship dialog takes over. */
async function newRelationship(page: Page, name: string) {
  await page.getByRole('button', { name: 'Add attribute' }).first().click();
  await chooseNewAttribute(page);
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
  await dialog
    .getByRole('button', { name: /Related object/ })
    .and(dialog.locator('[aria-haspopup="listbox"]'))
    .click();
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

    // By keyboard alone: Add attribute (at the foot of View settings since 21 October 2026), a name, Relationship
    // from the type picker, then Esc puts focus back on what opened it, View settings (AC-305).
    const viewSettings = page.getByRole('button', { name: 'View settings' });
    await viewSettings.focus();
    await page.keyboard.press('Enter');
    const addAttribute = page
      .getByRole('dialog', { name: 'View settings' })
      .getByRole('button', { name: 'Add attribute' });
    await addAttribute.focus();
    await page.keyboard.press('Enter');
    const byKeys = page.getByRole('dialog', { name: 'New attribute' });
    await expect(byKeys.getByLabel('Name', { exact: true })).toBeFocused();
    await page.keyboard.type('Advisers');
    await page.keyboard.press('Tab');
    await page.keyboard.press('ArrowDown');
    await page.getByRole('option', { name: 'Relationship', exact: true }).focus();
    await page.keyboard.press('Enter');
    const handedOver = page.getByRole('dialog', { name: 'New relationship' });
    await expect(handedOver).toBeVisible();
    await expect(
      handedOver.getByRole('button', { name: /Related object/ }).and(handedOver.locator('[aria-haspopup="listbox"]')),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(handedOver).toBeHidden();
    await expect(viewSettings).toBeFocused();

    // Add attribute, a name, then Relationship: the dialog takes over with the name on this side (AC-282).
    const dialog = await newRelationship(page, 'Investors');
    await relatedObject(page, dialog, 'People');
    // One question per side (owner ask A99): each company has many people, each person has many companies.
    const companySide = dialog.getByRole('radiogroup', { name: /^Each company has/ });
    const personSide = dialog.getByRole('radiogroup', { name: /^Each person has/ });
    await companySide.getByText('Many people', { exact: true }).click();
    await personSide.getByText('Many companies', { exact: true }).click();
    await expect(companySide.getByRole('radio', { name: 'Many people' })).toBeChecked();
    await expect(personSide.getByRole('radio', { name: 'Many companies' })).toBeChecked();
    await expect(dialog.getByLabel('Name on Companies', { exact: true })).toHaveValue('Investors');
    await expect(dialog.getByLabel('Name on People', { exact: true })).toHaveValue('Companies');
    await dialog.getByLabel('Name on People', { exact: true }).fill('Investments');
    await checkScreen(page, 'relations-new');
    await dialog.getByRole('button', { name: 'Create relationship' }).click();
    await expect(dialog).toBeHidden();
    const created = Date.now();
    await expect(page.getByText('Investors added.')).toBeVisible();
    await expectHeader(page, 'Companies', 'Investors');

    // The other object's table, in the other browser, shows its side without a reload.
    await expectHeader(reader, 'People', 'Investments', LIVE_MS);
    testInfo.annotations.push({ type: 'live column', description: `${String(Date.now() - created)} ms` });

    // A relationship from People to itself: two names alike are refused before anything is sent (AC-283).
    await page.goto(peoplePath);
    await expect(page.getByRole('grid', { name: 'People' })).toBeVisible();
    const self = await newRelationship(page, 'Manager');
    await relatedObject(page, self, 'People');
    await self.getByLabel('Reverse name on People', { exact: true }).fill('manager');
    await self.getByRole('button', { name: 'Create relationship' }).click();
    await expect(self.getByText('Give each side its own name.')).toBeVisible();
    await self.getByLabel('Reverse name on People', { exact: true }).fill('Reports');
    await self.getByRole('button', { name: 'Create relationship' }).click();
    await expect(self).toBeHidden();
    await expect(page.getByText('Manager added.')).toBeVisible();

    // A name People already has is refused on that side by the server, and nothing is made (AC-284).
    const taken = await newRelationship(page, '');
    await relatedObject(page, taken, 'Companies');
    await expect(taken.getByLabel('Name on People', { exact: true })).toHaveValue('Company');
    await taken.getByRole('button', { name: 'Create relationship' }).click();
    await expect(taken.getByText('People already has an attribute with this name. Pick another.')).toBeVisible();
    await checkScreen(page, 'relations-refused');
    await taken.getByLabel('Name on People', { exact: true }).fill('Employer');
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
    await expect(edit.getByRole('radio')).toHaveCount(0);
    // The two objects' cards say each side's answer in words (the CRM flow pass, 31 October 2026).
    const shape = edit.getByRole('group', { name: 'How records link' });
    await expect(shape).toContainText('Each company has many people');
    await expect(shape).toContainText('Each person has many companies');
    await expect(edit).toContainText('The objects and how records link can’t change once the relationship exists.');
    await edit.getByLabel('Name on Companies', { exact: true }).fill('Backers');
    await edit.getByLabel('Name on People', { exact: true }).fill('Holdings');
    await checkScreen(page, 'relations-edit');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(edit).toBeHidden();
    await expectHeader(page, 'Companies', 'Backers');
    await expectHeader(reader, 'People', 'Holdings', LIVE_MS);
    await readerContext.close();
  });
});
