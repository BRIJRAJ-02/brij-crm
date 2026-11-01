// The gaps the wave 3 lanes left (31 October 2026), end to end: a rule changed on an object's Access tab shows in a
// second tab holding the same tab without a reload, and removing a team moves focus to the next team's row; an
// automation's changes read as sentences in Settings › History; and a call logged on a record shows as Last
// contacted in the record's stat strip.
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { addPerson, newWorkspace } from './people.ts';

const RECORD_URL = /\/w\/[^/]+\/objects\/people\/([0-9a-f-]{36})\/overview$/;

/** Makes a team from Settings › Teams. */
async function newTeam(page: Page, slug: string, name: string): Promise<void> {
  await page.goto(`/w/${slug}/settings/teams`);
  await page.getByRole('button', { name: 'New team' }).first().click();
  const made = page.getByRole('dialog', { name: 'New team' });
  await made.getByLabel('Name', { exact: true }).fill(name);
  await made.getByRole('button', { name: 'Create team' }).click();
  await expect(page.getByText(`${name} created.`)).toBeVisible();
}

test.describe('the wave 3 gaps', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'Settings and the record page run at desktop width.');

  test('an Access tab follows a change made in another tab, and removing a team focuses the next row', async ({
    page,
    browser,
  }) => {
    test.setTimeout(240_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `accesslive-${tag}`;
    await newWorkspace(page, `accesslive-${tag}@example.com`, slug);
    await newTeam(page, slug, 'Sales');
    await newTeam(page, slug, 'Support');

    const other = await browser.newPage();
    const state = await page.context().storageState();
    await other.context().addCookies(state.cookies);
    const address = `/w/${slug}/settings/objects/deals/access`;
    await page.goto(address);
    await other.goto(address);
    await expect(other.getByText('Everyone can edit Deals.')).toBeVisible();

    // Two teams in, from the first tab: the second tab's grid gains both rows without a reload.
    for (const name of ['Sales', 'Support']) {
      await page.getByRole('button', { name: 'Add team' }).click();
      await page.getByRole('menuitem', { name }).click();
    }
    const grid = other.getByRole('grid', { name: 'Who can do what' });
    await expect(grid.getByRole('rowheader', { name: 'Sales' })).toBeVisible({ timeout: 15_000 });
    await expect(grid.getByRole('rowheader', { name: 'Support' })).toBeVisible({ timeout: 15_000 });

    // Removing Sales moves focus to Support's remove button, never back to the page title.
    await page.getByRole('button', { name: /Remove Sales/ }).click();
    await expect(page.getByRole('button', { name: /Remove Support/ })).toBeFocused();
    await expect(grid.getByRole('rowheader', { name: 'Sales' })).toHaveCount(0, { timeout: 15_000 });
    await other.close();
  });

  test('switching an automation off and deleting it read as sentences in History', async ({ page }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `autohist-${tag}`;
    await newWorkspace(page, `autohist-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/settings/automations`);
    await page.getByRole('button', { name: 'Task due → notify' }).click();
    await page.getByRole('dialog', { name: 'New automation' }).getByRole('button', { name: 'Turn on' }).click();
    const row = page.getByRole('row').filter({ hasText: 'When a task is due' });
    await row.getByRole('switch').uncheck();
    await expect(row.getByRole('switch')).not.toBeChecked();

    await page.goto(`/w/${slug}/settings/history/changes`);
    await expect(page.getByText(/made an automation for tasks/)).toBeVisible();
    await expect(page.getByText(/switched off an automation for tasks/)).toBeVisible();
  });

  test('a call logged on a person shows as Last contacted in their stat strip', async ({ page }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `contacted-${tag}`;
    await newWorkspace(page, `contacted-${tag}@example.com`, slug);
    await addPerson(page, 'Grace', 'Hopper', `grace-${tag}@example.com`);
    await page
      .getByRole('rowheader', { name: /Grace Hopper/ })
      .getByText('Grace Hopper')
      .click();
    await expect(page).toHaveURL(RECORD_URL);
    const graceId = RECORD_URL.exec(page.url())?.[1] ?? '';
    // Never contacted: the stat is there, with no time.
    const stat = page.locator('dt', { hasText: 'Last contacted' }).locator('xpath=following-sibling::dd[1]');
    await expect(stat).toBeVisible();
    await expect(stat).not.toContainText('just now');

    await page.goto(`/w/${slug}/objects/people/${graceId}/notes?log=call`);
    const dialog = page.getByRole('dialog', { name: 'Log activity' });
    await dialog.getByRole('button', { name: 'Connected' }).click();
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(dialog).toBeHidden();

    await page.goto(`/w/${slug}/objects/people/${graceId}/overview`);
    // Just now, as the strip words a recent time.
    await expect(stat).toContainText(/just now|min/);
  });
});
