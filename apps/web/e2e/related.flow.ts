// A record's related records (spec 0017, milestone 3), end to end: on a
// company's page its Team section starts empty with Add; adding Grace from
// the empty row and Alan from the heading shows them at once, with a toast,
// and in a second browser; Remove takes Grace out at once (no confirm) with focus on the row now in her place and a toast whose Undo
// brings her back, and the second browser follows each step. Overview's Team
// card shows them, and its View all moves focus to the section (AC-375,
// AC-377, AC-383).
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { addPerson, newWorkspace, signInAgain } from './people.ts';

/** How long a change may take to show in the other browser (AC-377 says 1 second; the flow allows for a busy machine). */
const LIVE_MS = 5_000;

/** Whether live updates reach the browsers (`FLOW_LIVE=off` reloads the second browser instead). */
const LIVE = process.env.FLOW_LIVE !== 'off';

const COMPANY_URL = /\/w\/[^/]+\/objects\/companies\/([0-9a-f-]{36})\/overview$/;

/** The record page's sidebar, its Details fold opened first on a phone. */
async function sidebarOf(page: Page) {
  const sidebar = page.getByRole('complementary', { name: 'Details' });
  const fold = sidebar.getByRole('button', { name: 'Details', exact: true });
  const team = sidebar.getByRole('heading', { name: /^Team/ });
  // Once the record has loaded (its name in the header): on a phone its details fold above the tabs, closed.
  await expect(page.getByRole('heading', { level: 2, name: 'Acme' })).toBeVisible();
  await expect(fold.or(team).first()).toBeVisible();
  if ((await fold.count()) > 0 && (await fold.getAttribute('aria-expanded')) === 'false') await fold.click();
  await expect(team).toBeVisible();
  return sidebar;
}

/** Picks a person in Add's search, by the start of their name (the only result, focused first). */
async function pick(page: Page, start: string, name: string): Promise<void> {
  const search = page.getByRole('searchbox', { name: 'Search people' });
  await search.fill(start);
  // By key: on a phone the last toast can sit over the menu's items.
  await expect(page.getByRole('menuitem', { name: new RegExp(name) })).toHaveAttribute('data-focused', 'true');
  await search.press('Enter');
}

test('a company’s Team: added and removed from its page, with Undo, live in a second browser', async ({
  browser,
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const tag = randomUUID().slice(0, 8);
  const email = `related-${tag}@example.com`;
  const slug = `related-${tag}`;
  const code = await newWorkspace(page, email, slug);
  await addPerson(page, 'Grace', 'Hopper', `grace-${tag}@example.com`);
  await addPerson(page, 'Alan', 'Turing', `alan-${tag}@example.com`);

  // A company, opened from its name.
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Companies', exact: true })
    .click();
  await page.getByRole('button', { name: 'New company' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New company' });
  await dialog.getByLabel('Name', { exact: true }).fill('Acme');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('rowheader', { name: /Acme/ }).getByText('Acme').click();
  await expect(page).toHaveURL(COMPANY_URL);
  const companyPath = new URL(page.url()).pathname;

  // The second browser, on the same company.
  const readerContext = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    viewport: testInfo.project.use.viewport ?? null,
  });
  const reader = await readerContext.newPage();
  await signInAgain(reader, email, companyPath, [code]);
  const theirs = await sidebarOf(reader);
  await expect(theirs.getByText('No people yet')).toBeVisible();

  // Empty: one Add, in the empty row; the pick shows at once, said in a toast.
  const sidebar = await sidebarOf(page);
  await expect(sidebar.getByText('No people yet')).toBeVisible();
  await expect(sidebar.getByRole('button', { name: 'Add to Team' })).toHaveCount(1);
  await sidebar.getByRole('button', { name: 'Add to Team' }).click();
  await pick(page, 'Gr', 'Grace Hopper');
  const team = sidebar.getByRole('list', { name: 'Team' });
  await expect(team).toContainText('Grace Hopper');
  await expect(page.getByText('Added Grace Hopper to Team.')).toBeVisible();
  // Then from the heading.
  await sidebar.getByRole('button', { name: 'Add to Team' }).click();
  await pick(page, 'Al', 'Alan Turing');
  await expect(team.getByRole('listitem')).toHaveCount(2);
  if (!LIVE) await reader.reload();
  const theirTeam = (await sidebarOf(reader)).getByRole('list', { name: 'Team' });
  await expect(theirTeam).toContainText('Alan Turing', { timeout: LIVE_MS });
  await expect(theirTeam).toContainText('Grace Hopper');

  // Remove acts at once (only the link goes, and Undo is one click), and focus moves to the row now in her place.
  await sidebar.getByRole('button', { name: 'Remove Grace Hopper from Team' }).click();
  await expect(page.getByRole('alertdialog', { name: /^Remove/ })).toHaveCount(0);
  await expect(team).not.toContainText('Grace Hopper');
  await expect(team.getByRole('link', { name: /Alan Turing/ })).toBeFocused();
  if (!LIVE) await reader.reload();
  await expect((await sidebarOf(reader)).getByRole('list', { name: 'Team' })).not.toContainText('Grace Hopper', {
    timeout: LIVE_MS,
  });
  // Undo, one click, brings her back here and there.
  const removed = page.getByRole('alertdialog').filter({ hasText: 'Removed Grace Hopper from Team.' });
  await expect(removed).toBeVisible();
  await removed.getByRole('button', { name: 'Undo' }).click();
  await expect(team).toContainText('Grace Hopper');
  if (!LIVE) await reader.reload();
  await expect((await sidebarOf(reader)).getByRole('list', { name: 'Team' })).toContainText('Grace Hopper', {
    timeout: LIVE_MS,
  });

  // Overview's Team card: both, and View all moves focus to the section's heading.
  const card = page.getByRole('tabpanel', { name: 'Overview' }).getByRole('list', { name: 'Team' });
  await expect(card).toContainText('Alan Turing');
  await expect(card).toContainText('Grace Hopper');
  await page.getByRole('button', { name: 'View all 2 people in Team' }).click();
  await expect(sidebar.getByRole('button', { name: /^Team/ })).toBeFocused();
  await readerContext.close();
});
