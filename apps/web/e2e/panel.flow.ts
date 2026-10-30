// The record panel (spec 0017 AC-384 to AC-386, spec 0021 AC-509; the CRM
// flow pass, 31 October 2026): a row's name opens the record beside the
// table, kept in `?record=` so a reload or a shared link reopens it; ↓ and ↑
// step through the rows; an edit in the panel shows in the table at once; Esc
// closes it and Open full page goes on to the record's page. A board's card
// opens the same panel. A task stays a dialog, over the panel.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { addPerson, checkScreen, newWorkspace } from './people.ts';

test.describe('the record panel', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) < 1000, 'The panel sits beside the table at desktop width.');

  test('a name opens the record beside the table, steps with the arrows, and survives a reload', async ({ page }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `panel-${tag}`;
    await newWorkspace(page, `panel-${tag}@example.com`, slug);
    await addPerson(page, 'Ada', 'Byron', `ada-${tag}@example.com`);
    await addPerson(page, 'Bea', 'Stone', `bea-${tag}@example.com`);
    await addPerson(page, 'Cy', 'Lane', `cy-${tag}@example.com`);

    const table = page.getByRole('grid', { name: 'People' });
    await table
      .getByRole('rowheader', { name: /Bea Stone/ })
      .getByText('Bea Stone')
      .click();
    const panel = page.getByRole('dialog', { name: 'Bea Stone' });
    await expect(panel).toBeVisible();
    await expect(page).toHaveURL(/[?&]record=[0-9a-f-]{36}/u);
    await expect(panel.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
    await checkScreen(page, 'panel-details');

    // An edit in the panel is the table's edit: one record, shown everywhere at once.
    await panel.getByRole('button', { name: 'Edit Job title' }).click();
    const jobTitle = panel.getByRole('textbox', { name: 'Job title' });
    await jobTitle.fill('Navigator');
    await jobTitle.press('Enter');
    await expect(table.getByRole('row').filter({ hasText: 'Bea Stone' })).toContainText('Navigator');

    // ↓ and ↑ step to the rows below and above, from anywhere in the panel that doesn't own the arrows.
    await panel.getByRole('button', { name: 'Open full page' }).focus();
    await page.keyboard.press('ArrowDown');
    const below = page.getByRole('dialog', { name: /Ada Byron|Cy Lane/u });
    await expect(below).toBeVisible();
    await below.getByRole('button', { name: 'Open full page' }).focus();
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('dialog', { name: 'Bea Stone' })).toBeVisible();

    // The tab is in the address too; a reload opens the same record on the same tab.
    await page.getByRole('dialog', { name: 'Bea Stone' }).getByRole('tab', { name: 'Activity' }).click();
    await expect(page).toHaveURL(/[?&]panelTab=activity/u);
    await page.reload();
    const reopened = page.getByRole('dialog', { name: 'Bea Stone' });
    await expect(reopened).toBeVisible();
    await expect(reopened.getByRole('tab', { name: 'Activity' })).toHaveAttribute('aria-selected', 'true');
    await expect(reopened.getByRole('feed', { name: 'Activity' })).toContainText('created this record');

    // Esc closes it and drops it from the address.
    await reopened.getByRole('tab', { name: 'Activity' }).focus();
    await page.keyboard.press('Escape');
    await expect(reopened).toBeHidden();
    await expect(page).not.toHaveURL(/record=/u);

    // Open full page goes on to the record's page, on the tab the panel showed.
    await table
      .getByRole('rowheader', { name: /Bea Stone/ })
      .getByText('Bea Stone')
      .click();
    await page.getByRole('dialog', { name: 'Bea Stone' }).getByRole('button', { name: 'Open full page' }).click();
    await expect(page).toHaveURL(/\/objects\/people\/[0-9a-f-]{36}\/overview$/u);
    await expect(page.getByRole('heading', { level: 2, name: 'Bea Stone' })).toBeVisible();
  });

  test('a link naming a record nobody can see says so in the panel', async ({ page }) => {
    test.setTimeout(120_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `panelgone-${tag}`;
    await newWorkspace(page, `panelgone-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/objects/people`);
    await expect(page).toHaveURL(/\/views\//u);
    await page.goto(`${page.url().split('?')[0] ?? ''}?record=0199a6f2-0000-7000-8000-000000000001`);
    await expect(page.getByText('This record isn’t available', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page).not.toHaveURL(/record=/u);
  });

  test('a task opens as a dialog over the panel, and closing it leaves the panel', async ({ page }) => {
    test.setTimeout(150_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `paneltask-${tag}`;
    await newWorkspace(page, `paneltask-${tag}@example.com`, slug);
    await addPerson(page, 'Grace', 'Hopper', `grace-${tag}@example.com`);
    await page
      .getByRole('rowheader', { name: /Grace Hopper/ })
      .getByText('Grace Hopper')
      .click();
    const panel = page.getByRole('dialog', { name: 'Grace Hopper' });
    await panel.getByRole('tab', { name: /Tasks/ }).click();
    await panel.getByRole('button', { name: 'New task' }).first().click();
    const task = page.getByRole('dialog', { name: /task/iu }).last();
    await expect(task).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toBeVisible();
  });

  test('a card on a board opens the same panel', async ({ page }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `panelboard-${tag}`;
    await newWorkspace(page, `panelboard-${tag}@example.com`, slug);
    await page.goto(`/w/${slug}/objects/deals`);
    await page.getByRole('button', { name: 'New deal' }).first().click();
    const create = page.getByRole('dialog', { name: 'New deal' });
    await create.getByLabel('Name', { exact: true }).fill('Apollo');
    await create.getByRole('button', { name: 'Create' }).click();
    await expect(create).toBeHidden();
    const layout = page.getByRole('radiogroup', { name: 'Layout' });
    await layout.getByRole('radio', { name: 'Board' }).click({ force: true });
    const board = page.getByRole('group', { name: 'Deals by Stage' });
    await expect(board).toBeVisible();
    await board.getByRole('row', { name: /Apollo/ }).click();
    await expect(page.getByRole('dialog', { name: 'Apollo' })).toBeVisible();
    await expect(page).toHaveURL(/[?&]record=[0-9a-f-]{36}/u);
    await checkScreen(page, 'panel-board');
  });
});
