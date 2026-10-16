// The record page (spec 0017, milestone 1): open a person from the table's
// name, read and edit Details in place (the header's name follows the name at
// once), see who made the record in Recent activity and on the Activity tab,
// keep the tab on reload, and the unavailable state for an id that names
// nothing. axe in light and dark on each screen.
import { expect, test } from '@playwright/test';
import { addPerson, checkScreen, newWorkspace } from './people.ts';

const RECORD_URL = /\/w\/[^/]+\/objects\/people\/([0-9a-f-]{36})\/overview$/;

test('a record opens from the table, edits in place, and keeps its tab', async ({ page, context }, info) => {
  const tag = `${String(Date.now())}-${info.project.name}`;
  const slug = `record-${tag}`;
  await newWorkspace(page, `record-${tag}@example.com`, slug);
  await addPerson(page, 'Grace', 'Hopper', `grace-${tag}@example.com`);

  // The name opens the record's page on Overview.
  await page
    .getByRole('rowheader', { name: /Grace Hopper/ })
    .getByText('Grace Hopper')
    .click();
  await expect(page).toHaveURL(RECORD_URL);
  const recordId = RECORD_URL.exec(page.url())?.[1] ?? '';
  await expect(page).toHaveTitle('Grace Hopper · CRM');
  await expect(page.getByRole('link', { name: 'People' }).first()).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'Grace Hopper' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  const recent = page.getByRole('feed', { name: 'Recent activity' });
  await expect(recent).toContainText('created this record');
  await expect(recent).toContainText('Ada Lovelace');

  // On a phone the details fold above the tabs.
  const isNarrow = info.project.name === '375';
  if (isNarrow) {
    const details = page.getByRole('button', { name: 'Details', exact: true });
    await expect(details).toHaveAttribute('aria-expanded', 'false');
    await details.click();
  }
  await checkScreen(page, 'record-overview');

  // Details edit in place, saved through the data layer.
  await page.getByRole('button', { name: 'Edit Job title' }).click();
  const jobTitle = page.getByRole('textbox', { name: 'Job title' });
  await jobTitle.fill('Rear admiral');
  await jobTitle.press('Enter');
  await expect(page.getByRole('region', { name: 'Details' })).toContainText('Rear admiral');

  // The name edits only here, and the header follows it at once.
  await page.getByRole('button', { name: 'Edit Name' }).click();
  const first = page.getByRole('textbox', { name: 'First name' });
  await first.fill('Amazing Grace');
  await first.press('Enter');
  await expect(page.getByRole('heading', { level: 2, name: 'Amazing Grace Hopper' })).toBeVisible();
  await expect(page).toHaveTitle('Amazing Grace Hopper · CRM');

  // Copy link puts the page's address on the clipboard.
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy link' }).click();
  await expect(page.getByText('Link copied')).toBeVisible();

  // View all opens the Activity tab: the address is replaced (Back leaves the record) and focus lands on the tab.
  const before = await page.evaluate(() => history.length);
  await page.getByRole('button', { name: 'View all', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: 'Activity' })).toBeFocused();
  expect(await page.evaluate(() => history.length)).toBe(before);
  await page.getByRole('tab', { name: 'Overview' }).click();

  // The Activity tab replaces the address, keeps focus on the tab, and a reload reopens it.
  await page.getByRole('tab', { name: 'Activity' }).click();
  await expect(page).toHaveURL(new RegExp(`/${recordId}/activity$`));
  await expect(page.getByRole('tab', { name: 'Activity' })).toBeFocused();
  await expect(page.getByRole('feed', { name: 'Activity' })).toContainText('created this record');
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Activity' })).toHaveAttribute('aria-selected', 'true');
  await expect(
    page.getByRole('region', { name: 'Details' }).or(page.getByRole('button', { name: 'Details' })),
  ).toBeVisible();
  if (!isNarrow) await expect(page.getByRole('region', { name: 'Details' })).toContainText('Rear admiral');
  await checkScreen(page, 'record-activity');

  // An unknown tab, and no tab at all, open Overview.
  await page.goto(`/w/${slug}/objects/people/${recordId}/nonsense`);
  await expect(page).toHaveURL(new RegExp(`/${recordId}/overview$`));
  await page.goto(`/w/${slug}/objects/people/${recordId}`);
  await expect(page).toHaveURL(new RegExp(`/${recordId}/overview$`));

  // An id that names nothing, and one that isn't an id: one state, with the way back.
  for (const missing of ['0199a6f2-0000-7000-8000-000000000001', 'not-an-id']) {
    await page.goto(`/w/${slug}/objects/people/${missing}/overview`);
    await expect(page.getByText('This record isn’t available.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to People' })).toBeVisible();
  }
  await checkScreen(page, 'record-unavailable');
  await page.getByRole('link', { name: 'Back to People' }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/objects/people$`));
});
