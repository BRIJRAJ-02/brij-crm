// The record panel (spec 0017 AC-384 to AC-386, spec 0021 AC-509; the CRM
// flow pass, 31 October 2026): a row's name opens the record beside the
// table, kept in `?record=` so a reload or a shared link reopens it; ↓ and ↑
// step through the rows; an edit in the panel shows in the table at once; Esc
// closes it and Open full page goes on to the record's page. A board's card
// opens the same panel. A task stays a dialog, over the panel. The open row
// (or card) is marked and a row with open comment threads shows their count;
// ↓ goes on past the first 100 rows the table loads; a stage added from the
// board sits before Won and Lost.
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { addPerson, checkScreen, newWorkspace, openInPanel } from './people.ts';

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
    await openInPanel(page, /Bea Stone/);
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
    await openInPanel(page, /Bea Stone/);
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
    await openInPanel(page, /Grace Hopper/);
    const panel = page.getByRole('dialog', { name: 'Grace Hopper' });
    await panel.getByRole('tab', { name: /Tasks/ }).click();
    await panel.getByRole('button', { name: 'Add with details' }).click();
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
  test('the open row is marked and kept in step, and a row with open comments shows their count', async ({ page }) => {
    test.setTimeout(180_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `panelmark-${tag}`;
    await newWorkspace(page, `panelmark-${tag}@example.com`, slug);
    await addPerson(page, 'Ada', 'Byron', `ada-${tag}@example.com`);
    await addPerson(page, 'Bea', 'Stone', `bea-${tag}@example.com`);
    const table = page.getByRole('grid', { name: 'People' });
    const row = (name: string) => table.getByRole('row').filter({ hasText: name });

    await openInPanel(page, /Ada Byron/);
    const panel = page.getByRole('dialog', { name: 'Ada Byron' });
    await expect(panel).toBeVisible();
    await expect(row('Ada Byron')).toHaveAttribute('aria-current', 'true');
    await expect(row('Bea Stone')).not.toHaveAttribute('aria-current', 'true');

    // A comment in the panel puts its count on the row, at once.
    await panel.getByRole('tab', { name: /Comments/ }).click();
    const composer = panel.getByRole('textbox', { name: 'Add a comment' });
    await composer.click();
    await page.keyboard.type('Check the contract');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(row('Ada Byron')).toContainText('1 open comment thread');
    await expect(row('Bea Stone')).not.toContainText('open comment');

    // Stepping carries the mark along.
    const next = panel.getByRole('button', { name: 'Next record' });
    await ((await next.isEnabled()) ? next : panel.getByRole('button', { name: 'Previous record' })).click();
    await expect(page.getByRole('dialog', { name: 'Bea Stone' })).toBeVisible();
    await expect(row('Bea Stone')).toHaveAttribute('aria-current', 'true');
    await expect(row('Ada Byron')).not.toHaveAttribute('aria-current', 'true');
    await expect(row('Ada Byron')).toContainText('1 open comment thread');
  });

  test('↓ goes on past the first 100 rows the table loads, and Next is off only at the real end', async ({ page }) => {
    test.setTimeout(420_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `panelmore-${tag}`;
    await newWorkspace(page, `panelmore-${tag}@example.com`, slug);
    // 130 people, more than the table's first block of 100 rows, imported from a file.
    const lines = ['First name,Last name,E-mail'];
    for (let index = 0; index < 130; index += 1) {
      lines.push(`Person${String(index)},Stepper,person${String(index)}@${tag}.test`);
    }
    await page.getByRole('button', { name: 'Import / Export' }).click();
    await page.getByRole('menuitem', { name: 'Import people' }).click();
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: 'people.csv', mimeType: 'text/csv', buffer: Buffer.from(`${lines.join('\r\n')}\r\n`) });
    const start = page.getByRole('button', { name: 'Start import' });
    const carryOn = page.getByRole('button', { name: 'Continue' });
    for (let step = 0; step < 5; step += 1) {
      await expect(start.or(carryOn)).toBeVisible({ timeout: 60_000 });
      if (await start.isVisible()) break;
      await carryOn.click();
    }
    await start.click();
    await expect(page.getByRole('heading', { name: 'Import finished' })).toBeVisible({ timeout: 240_000 });
    await page.goto(`/w/${slug}/objects/people`);

    const table = page.getByRole('grid', { name: 'People' });
    await expect(table.getByRole('rowheader').first()).toBeVisible({ timeout: 30_000 });
    await openInPanel(page, /Person\d+ Stepper/u);
    const named = page.getByRole('dialog', { name: /Person\d+ Stepper/u });
    await expect(named).toBeVisible();
    // Down through the first block and past its end: the 101st record opens though its block was not loaded when the
    // panel opened, and Next is still on (the table has 30 more).
    await named.getByRole('button', { name: 'Open full page' }).focus();
    const recordOf = () => page.url().slice(page.url().indexOf('record='));
    const seen = new Set<string>([recordOf()]);
    for (let step = 0; step < 105; step += 1) {
      await page.keyboard.press('ArrowDown');
      // Wait for the step to land before the next press, as a held key's repeat would not.
      await expect
        .poll(
          () => {
            seen.add(recordOf());
            return seen.size;
          },
          { timeout: 15_000 },
        )
        .toBeGreaterThan(step + 1);
    }
    await expect(named.getByRole('button', { name: 'Next record' })).toBeEnabled();
  });

  test('a card on a board carries its open comments, and a stage added there sits before Won and Lost', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const tag = randomUUID().slice(0, 8);
    const slug = `panelstage-${tag}`;
    await newWorkspace(page, `panelstage-${tag}@example.com`, slug);
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
    const hidden = page.getByRole('button', { name: /hidden column/u });
    if (await hidden.isVisible()) await hidden.click();

    // The open card is marked, and a comment on it puts its count on the card.
    const card = board.getByRole('row', { name: /Apollo/ });
    await card.click();
    const panel = page.getByRole('dialog', { name: 'Apollo' });
    await expect(panel).toBeVisible();
    await expect(card.locator('[aria-current="true"]')).toHaveCount(1);
    await panel.getByRole('tab', { name: /Comments/ }).click();
    await panel.getByRole('textbox', { name: 'Add a comment' }).click();
    await page.keyboard.type('Send the quote');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(card).toContainText('1 open comment thread');
    await panel.getByRole('button', { name: 'Close' }).click();

    // A stage added from the board lands before the stages that end a deal.
    await board.getByRole('button', { name: 'Add stage' }).click();
    const name = board.getByRole('textbox', { name: 'Add stage: name' });
    await name.fill('Negotiation');
    await name.press('Enter');
    await expect(board.getByRole('region', { name: /Negotiation/ })).toBeVisible({ timeout: 15_000 });
    const titles = await board.getByRole('heading', { level: 3 }).allTextContents();
    const at = (title: string) => titles.findIndex((text) => text.startsWith(title));
    expect(at('Negotiation')).toBeGreaterThan(-1);
    expect(at('Negotiation')).toBeLessThan(at('Won'));
    expect(at('Won')).toBeLessThan(at('Lost'));
  });
});
