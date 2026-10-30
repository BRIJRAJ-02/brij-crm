// The popups and calendar polish (30 October 2026): a confirm asks with its question in the body and its keys on
// its buttons; the week's bar has a strong title, Day and Week, and single keys (T, J, K, D, W) taught in its
// tooltips; Go to date's title opens the year's months and Today comes back. Each from a new workspace.
// The review fixes (30 October 2026): a plain confirm opens on its answer (Enter); the keys are stated to screen
// readers and listed in the shortcut help; Day stays in the address; the months move on the arrows and Esc goes back
// to the days; a date's quick picks are a menu, Down from Type a date reaches the days, and a Form's submit shows ⌘↵.
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
  // A plain confirm opens on its answer, which says Enter answers it.
  const signOut = dialog.getByRole('button', { name: 'Sign out' });
  await expect(signOut).toBeFocused();
  await expect(signOut).toHaveAttribute('aria-keyshortcuts', 'Enter');
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

  // Each key is stated to screen readers: Today's T on its button, D and W on their segments.
  await expect(page.getByRole('button', { name: /^Today/ }).first()).toHaveAttribute('aria-keyshortcuts', 'T');
  await expect(page.getByRole('radio', { name: 'Day' })).toHaveAttribute('aria-keyshortcuts', 'D');
  await expect(page.getByRole('radio', { name: 'Week' })).toHaveAttribute('aria-keyshortcuts', 'W');

  // Day lives in the address, so a reload keeps it, and its empty line speaks of the day.
  await page.locator('body').press('d');
  await expect.poll(() => new URL(page.url()).searchParams.get('v')).toBe('day');
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Day' })).toBeChecked();
  await expect(page.getByText('No meetings this day')).toBeVisible();
  await page.locator('body').press('w');
  await expect.poll(() => new URL(page.url()).searchParams.get('v')).toBeNull();

  // The shortcut help lists the calendar's keys on this tab.
  await page.locator('body').press('?');
  const help = page.getByRole('dialog', { name: /shortcuts/i });
  await expect(help.getByText('Calendar', { exact: true })).toBeVisible();
  await expect(help.getByText('Go to today')).toBeVisible();
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

  // The months are one tab stop on the arrows; Esc goes back to the days, the popover still open.
  await month.click();
  const shown = page.getByRole('group', { name: /^\d{4}$/ }).locator('[aria-current="true"]');
  await expect(shown).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(shown).not.toBeFocused();
  await page.keyboard.press('Escape');
  await expect(month).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('grid')).toBeVisible();
});

test("a date's picks are a menu, Down reaches the days, and a Form's submit shows ⌘↵", async ({ page }) => {
  const slug = await workspace(page, 'date');
  await page.goto(`/w/${slug}/tasks`);
  await page.getByRole('main').getByRole('button', { name: 'New task' }).last().click();
  const dialog = page.getByRole('dialog', { name: 'New task' });
  // The submit names the task's Form, which ⌘↵ submits from any control in it.
  await expect(dialog.getByRole('button', { name: 'Create task' })).toHaveAttribute(
    'aria-keyshortcuts',
    /^(Meta|Control)\+Enter$/,
  );
  await dialog.getByRole('button', { name: 'Open calendar' }).click();
  const typed = page.getByRole('textbox', { name: 'Type a date' });
  await expect(typed).toBeFocused();
  // The day it names is the field's description, not a live region.
  await typed.fill('tomorrow');
  await expect(typed).toHaveAccessibleDescription(/\d/);
  // Down goes to the days.
  await typed.fill('');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('grid').locator('[tabindex="0"]')).toBeFocused();
  // The quick picks are a menu, and with them the header has no second Today.
  const picks = page.getByRole('menu', { name: 'Quick picks' });
  await expect(picks.getByRole('menuitem', { name: /Tomorrow/ })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Calendar' }).getByRole('button', { name: 'Today' })).toHaveCount(0);
  await picks.getByRole('menuitem', { name: /Tomorrow/ }).click();
  await expect(typed).toBeHidden();
});
