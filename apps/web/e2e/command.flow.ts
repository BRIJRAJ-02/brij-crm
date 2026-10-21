// The command menu (spec 0039): ⌘K (Ctrl+K off a Mac) opens it from anywhere
// in a workspace, typing finds a record, Enter opens it, and the record joins
// Recent. `/` opens it in search mode, but a slash typed in a text field stays
// a slash. Create a person runs the same New person dialog. axe in light and
// dark on the open menu.
import { expect, test } from '@playwright/test';
import { addPerson, checkScreen, newWorkspace } from './people.ts';

const RECORD_URL = /\/w\/[^/]+\/objects\/people\/[0-9a-f-]{36}\/overview$/;

test('the command menu finds a record, opens it, and keeps a slash in a text field', async ({ page }, info) => {
  const tag = `${String(Date.now())}-${info.project.name}`;
  const slug = `command-${tag}`;
  await newWorkspace(page, `command-${tag}@example.com`, slug);
  await addPerson(page, 'Grace', 'Hopper', `grace-${tag}@example.com`);

  // ⌘K opens the menu with focus in its field, and its actions and pages under headings.
  await page.keyboard.press('ControlOrMeta+k');
  const menu = page.getByRole('dialog', { name: 'Command menu' });
  await expect(menu).toBeVisible();
  const field = menu.getByLabel('Search records, views, pages and actions');
  await expect(field).toBeFocused();
  await expect(menu.getByRole('group', { name: 'Actions' })).toBeVisible();
  await checkScreen(page, 'command-menu');

  // Typing finds the record; Enter opens it and the menu closes.
  await page.keyboard.type('grace');
  const grace = menu.getByRole('menuitem', { name: /Grace Hopper/ });
  await expect(grace).toBeVisible();
  await checkScreen(page, 'command-menu-search');
  // Enter opens the top result, with no arrow pressed.
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(RECORD_URL);
  await expect(menu).toBeHidden();
  await expect(page.getByRole('heading', { level: 2, name: 'Grace Hopper' })).toBeVisible();

  // A slash typed in a text field stays in the field, and no menu opens.
  const isNarrow = info.project.name === '375';
  if (isNarrow) await page.getByRole('button', { name: 'Details', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Job title' }).click();
  const jobTitle = page.getByRole('textbox', { name: 'Job title' });
  await jobTitle.pressSequentially('a/b');
  await expect(jobTitle).toHaveValue('a/b');
  await expect(page.getByRole('dialog', { name: /Command menu|Search/ })).toHaveCount(0);
  await jobTitle.press('Escape');

  // `/` outside a field opens search, and Escape closes it.
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('/');
  const search = page.getByRole('dialog', { name: 'Search' });
  await expect(search).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(search).toBeHidden();

  // The record just opened shows under Recent.
  await page.keyboard.press('ControlOrMeta+k');
  await expect(menu.getByRole('group', { name: 'Recent' })).toContainText('Grace Hopper');

  // Esc first clears what is typed, then closes; ⌘K again closes too.
  await page.keyboard.type('zz');
  await page.keyboard.press('Escape');
  await expect(field).toHaveValue('');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(menu).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');
  await expect(menu).toBeHidden();
  await page.keyboard.press('ControlOrMeta+k');

  // Create a person runs the same dialog as New person.
  await page.keyboard.type('create a person');
  await expect(menu.getByRole('menuitem', { name: 'Create a person' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'New person' })).toBeVisible();
});
