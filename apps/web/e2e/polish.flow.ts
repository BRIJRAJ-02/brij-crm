// The popups and calendar polish (30 October 2026): a confirm asks with its question in the body and its keys on
// its buttons; the week's bar has a strong title, Day and Week, and single keys (T, J, K, D, W) taught in its
// tooltips; Go to date's title opens the year's months and Today comes back. Each from a new workspace.
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { newWorkspace } from './people.ts';

async function workspace(page: Page, kind: string): Promise<string> {
  const tag = randomUUID().slice(0, 8);
  const slug = `polish${kind}-${tag}`;
  await newWorkspace(page, `polish${kind}-${tag}@example.com`, slug);
  return slug;
}

test('a confirm asks in its body, with ESC on Cancel and no title bar', async ({ page }) => {
  const slug = await workspace(page, 'confirm');
  await page.goto(`/w/${slug}/home`);
  await page.getByRole('button', { name: /workspace menu/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sign out?' });
  await expect(dialog).toBeVisible();
  // The question opens the body: no close button in a title bar.
  await expect(dialog.getByRole('button', { name: 'Close' })).toHaveCount(0);
  // Cancel carries its key by default.
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toHaveAttribute('aria-keyshortcuts', 'Escape');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('the week bar: Day and Week, and T, J, K, D and W', async ({ page }) => {
  const slug = await workspace(page, 'week');
  await page.goto(`/w/${slug}/bookings/calendar`);
  // The bar's title: the week's dates (the day's name in the day view), never quiet.
  const bar = page.getByRole('heading', { level: 2, name: /\d/ }).first();
  await expect(bar).toBeVisible();
  const week = await bar.textContent();

  // D shows the picked day across the width, its name as the title; W goes back.
  await page.locator('body').press('d');
  await expect(page.getByRole('radio', { name: 'Day' })).toBeChecked();
  await expect(bar).not.toHaveText(week ?? '');
  await page.locator('body').press('w');
  await expect(page.getByRole('radio', { name: 'Week' })).toBeChecked();
  await expect(bar).toHaveText(week ?? '');

  // J moves a week on, K back, T to today.
  const before = new URL(page.url()).searchParams.get('w');
  await page.locator('body').press('j');
  await expect.poll(() => new URL(page.url()).searchParams.get('w')).not.toBe(before);
  await page.locator('body').press('k');
  await expect.poll(() => new URL(page.url()).searchParams.get('w')).toBe(before);
  await page.locator('body').press('j');
  await page.locator('body').press('t');
  await expect.poll(() => new URL(page.url()).searchParams.get('w')).toBe(before);

  // The arrows teach their keys in their tooltips.
  await page.getByRole('button', { name: 'Next week' }).hover();
  await expect(page.getByRole('tooltip')).toContainText('J');

  // A new workspace has nothing on: the empty week says so.
  await expect(page.getByText('No meetings this week')).toBeVisible();
});

test("Go to date's title opens the year's months, and Today comes back", async ({ page }) => {
  const slug = await workspace(page, 'jump');
  await page.goto(`/w/${slug}/bookings/calendar`);
  await page.getByRole('button', { name: 'Go to date' }).click();
  const month = page.getByRole('button', { name: /choose a month/ });
  await month.click();
  await expect(month).toHaveAttribute('aria-expanded', 'true');
  // A month other than today's, so Today has somewhere to come back from.
  const other = new Date().getMonth() === 0 ? 1 : 0;
  await page
    .getByRole('group', { name: /^\d{4}$/ })
    .getByRole('button')
    .nth(other)
    .click();
  await expect(month).toHaveAttribute('aria-expanded', 'false');
  const away = await month.textContent();
  await page.getByRole('button', { name: 'Today', exact: true }).last().click();
  await expect(month).not.toHaveText(away ?? '');
});
