// Relations' edges (CRM flow pass, 30 October 2026): a record picker that finds nothing is no dead end, since
// "Create "<typed>"" makes the far record and links it at once, with Undo; and the create dialog asks for a
// reference (a deal's company) and sends it with the create, so the record lands linked.
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { addPerson, newWorkspace, openFullPage } from './people.ts';

const RECORD_URL = /\/w\/[^/]+\/objects\/people\/([0-9a-f-]{36})\/overview$/;

/** A record picker's search menu once it opened (it opens with its search focused). */
async function openPicker(page: Page, scope: ReturnType<Page['getByRole']>, name: string) {
  const choose = scope.getByRole('button', { name: `Choose ${name}…` });
  if (await choose.isVisible()) await choose.click();
  const search = page.getByRole('searchbox', { name: `Search ${name}` });
  await expect(search).toBeFocused();
  return search;
}

test.describe('relations’ edges', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The record page’s sidebar runs at desktop width.');

  test('a company is made from a person’s Company picker by typing a new name', async ({ page }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `relmake-${tag}`;
    await newWorkspace(page, `relmake-${tag}@example.com`, slug);
    await addPerson(page, 'Grace', 'Hopper', `grace-${tag}@example.com`);
    await page
      .getByRole('rowheader', { name: /Grace Hopper/ })
      .getByText('Grace Hopper')
      .click();
    await openFullPage(page);
    await expect(page).toHaveURL(RECORD_URL);

    const details = page.getByRole('region', { name: 'Details' });
    const showEmpty = details.getByRole('button', { name: /^Show \d+ empty values?$/ });
    if (await showEmpty.isVisible()) await showEmpty.click();
    await details.getByRole('button', { name: /^(Set|Edit) Company/ }).click();
    const search = await openPicker(page, details, 'Company');
    await search.fill('Initech');
    // Nothing by that name: the last row makes it. A lone Create isn't focused first, so Enter on a typo makes nothing.
    const create = page.getByRole('menuitem', { name: 'Create "Initech"' });
    await expect(create).toBeVisible();
    await create.click();

    // Made and linked at once, said once with Undo.
    await expect(page.getByText('Created Initech.')).toBeVisible();
    await expect(details).toContainText('Initech');

    // The company is a real record, linked back on its Team.
    await page.goto(`/w/${slug}/objects/companies`);
    const row = page.getByRole('grid', { name: 'Companies' }).getByRole('row').filter({ hasText: 'Initech' });
    await expect(row).toHaveCount(1);
    await row.getByText('Initech').first().click();
    await expect(page.getByRole('heading', { level: 2, name: 'Initech' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Team' })).toContainText('Grace Hopper');
  });

  test('a deal is created with its company chosen in the create dialog', async ({ page }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `reldeal-${tag}`;
    await newWorkspace(page, `reldeal-${tag}@example.com`, slug);

    await page.goto(`/w/${slug}/objects/companies`);
    await page.getByRole('button', { name: 'New company' }).first().click();
    const company = page.getByRole('dialog', { name: 'New company' });
    await company.getByLabel('Name', { exact: true }).fill('Globex');
    await company.getByRole('button', { name: 'Create' }).click();
    await expect(company).toBeHidden();

    await page.goto(`/w/${slug}/objects/deals`);
    await page.getByRole('button', { name: 'New deal' }).first().click();
    const deal = page.getByRole('dialog', { name: 'New deal' });
    await deal.getByLabel('Name', { exact: true }).fill('Apollo');
    // A reference that holds one is asked at once, beside the name, through the same record picker.
    const field = deal.getByRole('group', { name: 'Associated company' });
    await expect(field).toBeVisible();
    const search = await openPicker(page, deal, 'Associated company');
    await search.fill('Glob');
    await page.getByRole('menuitem', { name: 'Globex' }).click();
    await expect(field.getByRole('list', { name: 'Associated company' })).toContainText('Globex');
    await deal.getByRole('button', { name: 'Create' }).click();
    await expect(deal).toBeHidden();

    // One write made the deal and its link: the company's side lists it.
    await expect(page.getByRole('grid', { name: 'Deals' }).getByRole('row').filter({ hasText: 'Apollo' })).toHaveCount(
      1,
    );
    await page.goto(`/w/${slug}/objects/companies`);
    await page
      .getByRole('grid', { name: 'Companies' })
      .getByRole('row')
      .filter({ hasText: 'Globex' })
      .getByText('Globex')
      .first()
      .click();
    await expect(page.getByRole('list', { name: 'Associated deals' })).toContainText('Apollo');
  });
});
