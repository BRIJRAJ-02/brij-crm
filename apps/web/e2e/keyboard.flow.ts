// The core loop by keyboard alone (spec 0005, AC-41, milestone 4): sign in,
// name the workspace, make a person, cancel a dialog, edit a cell and sign
// out, never touching the pointer. At each stop it checks where focus is and
// that the focused control draws a ring (an outline or a box shadow, on it or
// on the box around it), and it fails on any browser error. Desktop width:
// the table is a desktop surface in this loop.
import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { codeFor } from './mailpit.ts';
import { cellAt } from './people.ts';

/** Making a workspace writes its standard objects in one transaction; on a busy machine that takes a while. */
const WORKSPACE_MADE_MS = 30_000;

/**
 * Whether the focused element, or the box it sits in (a field's frame), draws
 * a focus ring; or `ringOn`, where a control draws its ring elsewhere (the
 * code boxes ring the next box to fill, under one transparent input).
 */
async function drawsRing(page: Page, ringOn?: Locator): Promise<boolean> {
  if (ringOn !== undefined) return ringOn.evaluate((element) => getComputedStyle(element).boxShadow !== 'none');
  return page.evaluate(() => {
    let element = document.activeElement;
    for (let depth = 0; element !== null && depth < 3; depth += 1) {
      const style = getComputedStyle(element);
      const outlined = style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0;
      if (outlined || style.boxShadow !== 'none') return true;
      element = element.parentElement;
    }
    return false;
  });
}

/** Presses Tab until `target` has focus (at most `limit` presses), failing if it never does. */
async function tabTo(page: Page, target: Locator, limit = 12): Promise<void> {
  for (let presses = 0; presses < limit; presses += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

/** Expects `target` focused with a visible ring. */
async function focusedWithRing(page: Page, target: Locator, what: string, ringOn?: Locator): Promise<void> {
  await expect(target, `${what} has focus`).toBeFocused();
  expect(await drawsRing(page, ringOn), `${what} draws a focus ring`).toBe(true);
}

test.describe('the core loop by keyboard', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The table flow runs at desktop width.');

  test('signs in, makes a person, edits a cell and signs out without the pointer', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // Signed out, me.get answers 401 ("nobody"), which the browser logs as a failed load; that is the answer,
    // not a fault. Any other 401 is.
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().includes('status of 401')) errors.push(message.text());
    });
    page.on('response', (response) => {
      const path = new URL(response.url()).pathname;
      if (response.status() === 401 && path !== '/api/rpc/me/get') errors.push(`401 ${path}`);
    });
    const tag = randomUUID().slice(0, 8);
    const email = `keys-${tag}@example.com`;
    const slug = `keys-${tag}`;

    // Sign in: focus starts in the email field; Enter sends the code.
    await page.goto('/sign-in');
    const emailField = page.getByLabel('Email');
    await focusedWithRing(page, emailField, 'the email field');
    await page.keyboard.type(email);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/verify$/);
    // The code boxes take focus; typing the code signs in.
    await focusedWithRing(page, page.getByLabel('Code'), 'the code field', page.locator('main [data-next]'));
    await page.keyboard.type(await codeFor(page.request, email));

    // First run (spec 0036): each step's first field has focus (F33), and Enter goes on.
    await expect(page).toHaveURL(/\/welcome$/);
    await focusedWithRing(page, page.getByLabel('Your name'), 'Your name');
    await page.keyboard.type('Ada Lovelace');
    await page.keyboard.press('Enter');
    await focusedWithRing(page, page.getByLabel('Workspace name'), 'Workspace name');
    await tabTo(page, page.getByLabel('Web address'));
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type(slug);
    await tabTo(page, page.getByRole('button', { name: 'Create workspace' }));
    const create = page.getByRole('button', { name: 'Create workspace' });
    await focusedWithRing(page, create, 'Create workspace');
    // A primary's edge is already blue, so its ring is the 1px outline just outside it, not the faint halo alone.
    expect(await create.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe('solid');
    await page.keyboard.press('Enter');
    // Where calendar sync is on, the calendar step's first button has focus: Tab on to Skip for now, and Enter.
    const calendar = page.getByRole('heading', { level: 1, name: 'Connect your calendar' });
    await expect
      .poll(async () => /\/home$/.test(page.url()) || (await calendar.isVisible()), {
        timeout: WORKSPACE_MADE_MS,
      })
      .toBe(true);
    if (await calendar.isVisible()) {
      await focusedWithRing(page, page.getByRole('button', { name: 'Connect Google Calendar' }), 'Connect Google');
      await tabTo(page, page.getByRole('button', { name: 'Skip for now' }));
      await page.keyboard.press('Enter');
    }
    // The workspace opens on Home (owner, 21 October 2026), its title focused; People is a row away.
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/home$`), { timeout: WORKSPACE_MADE_MS });
    await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeFocused();
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'People' }).click();
    await expect(page).toHaveURL(new RegExp(`/w/${slug}/objects/people/views/[0-9a-f-]{36}$`));

    // People: the title has focus; Tab goes on to New person in the top bar.
    await expect(page.getByRole('heading', { level: 1, name: 'People' })).toBeFocused();
    const newPerson = page.getByRole('button', { name: 'New person' }).first();
    await tabTo(page, newPerson);
    await focusedWithRing(page, newPerson, 'New person');

    // New person: Enter opens it with focus in its first field; ⌘↵ (Ctrl+Enter off Apple) creates.
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'New person' });
    await expect(dialog).toBeVisible();
    await focusedWithRing(page, dialog.getByLabel('First name'), 'First name');
    await page.keyboard.type('Grace');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Hopper');
    // Email waits behind "Add more fields" (spec 0012), the next stop; Enter opens it.
    await page.keyboard.press('Tab');
    await focusedWithRing(page, dialog.getByRole('button', { name: /Add more fields/ }), 'Add more fields');
    await page.keyboard.press('Enter');
    await tabTo(page, dialog.getByLabel('Email address', { exact: true }), 6);
    await focusedWithRing(page, dialog.getByLabel('Email address', { exact: true }), 'Email address');
    await page.keyboard.type(`grace-${tag}@example.com`);
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(dialog).toBeHidden();
    // The new row takes focus (AC-35).
    const name = await cellAt(page, 0, 'Name');
    await expect(name).toContainText('Grace Hopper');
    await focusedWithRing(page, name, 'the new row');

    // Add attribute, at the foot of View settings (it left the view bar, 21 October 2026): Esc closes its dialog
    // and focus goes back to View settings, which opened it.
    const viewSettings = page.getByRole('button', { name: 'View settings' });
    await page.getByRole('heading', { level: 1, name: 'People' }).focus();
    await tabTo(page, viewSettings);
    await focusedWithRing(page, viewSettings, 'View settings');
    await page.keyboard.press('Enter');
    const settings = page.getByRole('dialog', { name: 'View settings' });
    const addAttribute = settings.getByRole('button', { name: 'Add attribute' });
    await tabTo(page, addAttribute, 30);
    await focusedWithRing(page, addAttribute, 'Add attribute');
    await page.keyboard.press('Enter');
    const addDialog = page.getByRole('dialog', { name: 'New attribute' });
    await expect(addDialog).toBeVisible();
    await focusedWithRing(page, addDialog.getByLabel('Name', { exact: true }), 'the attribute name');
    await page.keyboard.type('Nickname');
    await page.keyboard.press('Escape');
    await expect(addDialog).toBeHidden();
    await focusedWithRing(page, viewSettings, 'View settings, after Esc');

    // A cell: arrows move, typing starts an edit, Enter saves it and keeps focus on the cell.
    // Tab enters the grid once, at the cell that last had focus (the new row's name).
    const grid = page.getByRole('grid', { name: 'People' });
    for (let presses = 0; presses < 20; presses += 1) {
      if (await grid.evaluate((element) => element.contains(document.activeElement))) break;
      await page.keyboard.press('Tab');
    }
    await focusedWithRing(page, name, 'the cell Tab enters the grid at');
    const title = await cellAt(page, 0, 'Job title');
    for (let presses = 0; presses < 12; presses += 1) {
      if (await title.evaluate((element) => element === document.activeElement)) break;
      await page.keyboard.press('ArrowRight');
    }
    await focusedWithRing(page, title, 'the Job title cell');
    await page.keyboard.type('Rear admiral');
    await page.keyboard.press('Enter');
    await expect(title).toContainText('Rear admiral');

    // Sign out from the workspace menu.
    const menu = page.getByRole('button', { name: /workspace menu/ });
    await menu.focus();
    await focusedWithRing(page, menu, 'the workspace menu');
    await page.keyboard.press('Enter');
    // The workspaces come first (spec 0031, AC-801), the open one checked; Sign out is last, so End reaches it.
    await expect(page.getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeFocused();
    await page.keyboard.press('Enter');
    // It asks first (the owner, 21 October 2026): Tab reaches its commit, last in the dialog, and Enter signs out.
    const commit = page
      .getByRole('dialog', { name: 'Sign out?' })
      .getByRole('button', { name: 'Sign out', exact: true });
    for (let tab = 0; tab < 4 && !(await commit.evaluate((button) => button === document.activeElement)); tab += 1) {
      await page.keyboard.press('Tab');
    }
    await focusedWithRing(page, commit, 'the sign out confirm');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(emailField).toBeFocused();

    expect(errors, 'browser errors').toEqual([]);
  });
});
