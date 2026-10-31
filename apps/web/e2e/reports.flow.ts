// Reports (the reports lane, parity item #52): the page opens with a chart already drawn (Deals' pipeline by stage),
// a first report is two clicks (the measure, then Save), the saved report is a tab that survives a reload, the same
// figures read as a table, Delete is undone from its toast, and Home and ⌘K both reach the page.
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { checkScreen, newWorkspace } from './people.ts';

/** Two deals in a new workspace, so a count has something to count. */
async function twoDeals(page: Page, slug: string): Promise<void> {
  await page.goto(`/w/${slug}/objects/deals`);
  for (const name of ['Apollo', 'Borealis']) {
    await page.getByRole('button', { name: 'New deal' }).first().click();
    const record = page.getByRole('dialog', { name: 'New deal' });
    await record.getByLabel('Name', { exact: true }).fill(name);
    await record.getByRole('button', { name: 'Create' }).click();
    await expect(record).toBeHidden();
  }
}

/** Picks `option` in the toolbar's select named `name`. */
async function choose(page: Page, name: string, option: string): Promise<void> {
  await page
    .getByRole('toolbar', { name: 'Report settings' })
    .getByRole('button', { name: new RegExp(`^${name}`) })
    .click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test.describe('reports', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The report builder runs at desktop width.');

  test('opens with a chart drawn, saves in one click, and keeps the report across a reload', async ({ page }) => {
    test.setTimeout(240_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `reports-${tag}`;
    await newWorkspace(page, `reports-${tag}@example.com`, slug);
    await twoDeals(page, slug);

    await page.goto(`/w/${slug}/reports`);
    await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();
    // Nothing was chosen, and the first report is already there to look at: Deals' pipeline, still empty of value.
    await expect(page.getByRole('tab', { name: 'New report' })).toBeVisible();
    await expect(page.getByRole('toolbar', { name: 'Report settings' })).toBeVisible();

    // The first click: count the deals instead of summing a value they don't have yet.
    await choose(page, 'Measure', 'Count');
    const chart = page.getByRole('img', { name: /^Deals by stage\./ });
    await expect(chart).toBeVisible();
    await expect(chart).toHaveAccessibleName(/2/);
    await checkScreen(page, 'reports');

    // The second: Save.
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Report saved.')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Deals by stage' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeHidden();

    await page.reload();
    await expect(page.getByRole('tab', { name: 'Deals by stage' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('img', { name: /^Deals by stage\./ })).toBeVisible();
  });

  test('reads the same figures as a table, and a change shows Save again', async ({ page }) => {
    test.setTimeout(240_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `reptable-${tag}`;
    await newWorkspace(page, `reptable-${tag}@example.com`, slug);
    await twoDeals(page, slug);
    await page.goto(`/w/${slug}/reports`);
    await choose(page, 'Measure', 'Count');
    await expect(page.getByRole('img', { name: /^Deals by stage\./ })).toBeVisible();

    await page.getByRole('radiogroup', { name: 'View' }).getByRole('radio', { name: 'Table' }).click({ force: true });
    const table = page.getByRole('grid', { name: 'Deals by stage' });
    await expect(table.getByRole('columnheader', { name: 'Stage' })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Deals' })).toBeVisible();

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeHidden();
    // Another way to see it saves nothing until asked: choosing a line brings Save back.
    await page
      .getByRole('radiogroup', { name: 'Chart type' })
      .getByRole('radio', { name: 'Line' })
      .click({ force: true });
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  });

  test('deleting a report is one click, and Undo brings it back', async ({ page }) => {
    test.setTimeout(240_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `repundo-${tag}`;
    await newWorkspace(page, `repundo-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/reports`);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Report saved.')).toBeVisible();
    const tab = page.getByRole('tab').filter({ hasNotText: 'New report' });
    await expect(tab).toHaveCount(1);
    const name = (await tab.first().innerText()).trim();

    await page.getByRole('button', { name: 'Delete report' }).click();
    await expect(page.getByText('Report deleted.')).toBeVisible();
    await expect(page.getByRole('tab', { name, exact: true })).toBeHidden();

    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('tab', { name, exact: true })).toBeVisible();
  });

  test('Home and the command menu both reach Reports', async ({ page }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `repnav-${tag}`;
    await newWorkspace(page, `repnav-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/home`);
    await page.getByRole('link', { name: 'Reports', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/reports`));
    await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();

    await page.goto(`/w/${slug}/home`);
    await page.keyboard.press('ControlOrMeta+K');
    const menu = page.getByRole('dialog', { name: /Command menu|Search/ });
    await menu.getByRole('combobox').fill('Reports');
    await menu.getByRole('option', { name: 'Reports' }).first().click();
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/reports`));
  });
});
